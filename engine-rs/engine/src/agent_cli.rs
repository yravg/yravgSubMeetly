//! "Agent on this computer": use an AI subscription the person already pays for (Claude Code,
//! OpenAI Codex, Gemini CLI, OpenCode) by running that CLI here in its non-interactive mode.
//! The prompt goes in on stdin and the answer comes back on stdout. Arguments are fixed lists,
//! never a shell string, and no user text is ever put on a command line. A hard timeout kills
//! the whole process tree. Nothing runs unless the person picked an agent (`connector::Config::agent`).

use std::ffi::OsStr;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Result};
use serde_json::{json, Value};

/// How long a summary or an answer may take before the agent is stopped.
pub const ANSWER_TIMEOUT: Duration = Duration::from_secs(180);
const VERSION_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_OUTPUT: usize = 1 << 20;

/// A CLI we know how to drive: (id, name, whose subscription, non-interactive args).
pub struct Agent {
    pub id: &'static str,
    pub label: &'static str,
    pub plan: &'static str,
    pub args: &'static [&'static str],
}

/// Gemini and OpenCode read stdin only as an addition to a prompt argument, so they get a fixed one.
pub const AGENTS: &[Agent] = &[
    Agent {
        id: "claude",
        label: "Claude Code",
        plan: "your Claude subscription (Anthropic)",
        args: &["-p", "--output-format", "text"],
    },
    Agent {
        id: "codex",
        label: "OpenAI Codex",
        plan: "your ChatGPT subscription (OpenAI)",
        args: &["exec", "--skip-git-repo-check", "-"],
    },
    Agent {
        id: "gemini",
        label: "Gemini CLI",
        plan: "your Google account (Gemini)",
        args: &["-p", "Answer the request given on standard input."],
    },
    Agent {
        id: "opencode",
        label: "OpenCode",
        plan: "the provider you signed in to OpenCode with",
        args: &["run", "Answer the request given on standard input."],
    },
];

pub fn find(id: &str) -> Option<&'static Agent> {
    AGENTS.iter().find(|a| a.id == id)
}

/// The program file for `name` on `path_var` (PATH), trying PATHEXT endings on Windows
/// (npm installs `claude.cmd`, `codex.cmd`).
pub fn find_in(name: &str, path_var: &OsStr) -> Option<PathBuf> {
    let exts: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into())
            .split(';')
            .filter(|e| !e.is_empty())
            .map(str::to_lowercase)
            .collect()
    } else {
        vec![String::new()]
    };
    std::env::split_paths(path_var).find_map(|dir| {
        exts.iter()
            .map(|e| dir.join(format!("{name}{e}")))
            .find(|p| p.is_file())
    })
}

fn locate(id: &str) -> Option<PathBuf> {
    find_in(id, &std::env::var_os("PATH")?)
}

/// Run `program args` with `input` on stdin; stdout is the answer. Errors name the agent's own
/// complaint (its stderr's last line) or the timeout.
pub fn run(program: &Path, args: &[&str], input: &str, timeout: Duration) -> Result<String> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| anyhow!("could not start {}: {e}", program.display()))?;
    let mut stdin = child.stdin.take();
    let input = input.to_string();
    let writer = std::thread::spawn(move || {
        if let Some(s) = stdin.as_mut() {
            let _ = s.write_all(input.as_bytes());
        }
    });
    let reader = |mut r: Box<dyn Read + Send>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = r.by_ref().take(MAX_OUTPUT as u64).read_to_end(&mut buf);
            String::from_utf8_lossy(&buf).into_owned()
        })
    };
    let out = reader(Box::new(child.stdout.take().expect("piped")));
    let err = reader(Box::new(child.stderr.take().expect("piped")));
    let started = Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait()? {
            break s;
        }
        if started.elapsed() >= timeout {
            kill_tree(&mut child);
            let _ = writer.join();
            bail!(
                "{} did not answer within {} s and was stopped",
                program.display(),
                timeout.as_secs()
            );
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let _ = writer.join();
    let (out, err) = (
        out.join().unwrap_or_default(),
        err.join().unwrap_or_default(),
    );
    if !status.success() {
        let why = err
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("no message");
        bail!("{} exited with {status}: {}", program.display(), why.trim());
    }
    if out.trim().is_empty() {
        bail!("{} answered with no text", program.display());
    }
    Ok(out.trim().replace("\r\n", "\n"))
}

/// A .cmd shim runs node under cmd.exe: killing only cmd.exe would leave node running.
fn kill_tree(child: &mut std::process::Child) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/T", "/F", "/PID", &child.id().to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// The system text and turns as one prompt (the CLIs take one block of text).
pub fn prompt(system: &str, turns: &[(String, String)]) -> String {
    let mut out = String::new();
    if !system.trim().is_empty() {
        out.push_str(system.trim());
        out.push_str("\n\n");
    }
    if let [(_, only)] = turns {
        out.push_str(only);
        return out;
    }
    for (role, content) in turns {
        let who = if role == "assistant" {
            "Assistant"
        } else {
            "User"
        };
        out.push_str(&format!("{who}: {content}\n\n"));
    }
    out.push_str("Assistant:");
    out
}

/// Ask agent `id`: the connector's `chat` calls this when an agent is picked.
pub fn chat(id: &str, system: &str, turns: &[(String, String)]) -> Result<String> {
    let agent = find(id).ok_or_else(|| anyhow!("unknown agent {id}"))?;
    let program = locate(agent.id).ok_or_else(|| {
        anyhow!(
            "{} is not installed on this computer (`{}` is not on PATH)",
            agent.label,
            agent.id
        )
    })?;
    run(&program, agent.args, &prompt(system, turns), ANSWER_TIMEOUT)
}

/// `GET /ai/agents`: each known CLI, whether it is installed and its version. Probing starts a
/// process per CLI, so the answer is kept for a minute.
pub fn detect() -> Value {
    static CACHE: OnceLock<Mutex<Option<(Instant, Value)>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    if let Some((at, v)) = cache.lock().unwrap_or_else(|p| p.into_inner()).as_ref() {
        if at.elapsed() < Duration::from_secs(60) {
            return v.clone();
        }
    }
    let probes: Vec<_> = AGENTS
        .iter()
        .map(|a| {
            std::thread::spawn(move || {
                let path = locate(a.id);
                let version = path
                    .as_deref()
                    .and_then(|p| run(p, &["--version"], "", VERSION_TIMEOUT).ok())
                    .and_then(|v| v.lines().next().map(|l| l.trim().to_string()))
                    .unwrap_or_default();
                json!({ "id": a.id, "label": a.label, "plan": a.plan, "installed": path.is_some(), "version": version })
            })
        })
        .collect();
    let v =
        json!({ "agents": probes.into_iter().filter_map(|h| h.join().ok()).collect::<Vec<_>>() });
    *cache.lock().unwrap_or_else(|p| p.into_inner()) = Some((Instant::now(), v.clone()));
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fake CLI in its own folder: `body` is a cmd script on Windows, sh elsewhere.
    fn fake(name: &str, win: &str, unix: &str) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("ysm-agent-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = if cfg!(windows) {
            dir.join(format!("{name}.cmd"))
        } else {
            dir.join(name)
        };
        std::fs::write(&file, if cfg!(windows) { win } else { unix }).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        (dir, file)
    }

    #[test]
    fn a_fake_agent_reads_the_prompt_on_stdin_and_answers_on_stdout() {
        let (dir, file) = fake(
            "echoagent",
            "@echo off\r\nfindstr \"^\"\r\n",
            "#!/bin/sh\ncat\n",
        );
        // Shell metacharacters in the prompt stay text: nothing is built into a command line.
        let text = "summarise this & echo pwned | del x \"quoted\"";
        let out = run(&file, &["-p"], text, Duration::from_secs(20)).unwrap();
        assert_eq!(out, text);
        assert_eq!(find_in("echoagent", dir.as_os_str()), Some(file));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_slow_agent_is_stopped_at_the_timeout() {
        let (dir, file) = fake(
            "slowagent",
            "@echo off\r\nping -n 30 127.0.0.1 >nul\r\necho late\r\n",
            "#!/bin/sh\nsleep 30\necho late\n",
        );
        let started = Instant::now();
        let err = run(&file, &[], "hi", Duration::from_secs(1))
            .unwrap_err()
            .to_string();
        assert!(err.contains("did not answer within 1 s"), "{err}");
        assert!(
            started.elapsed() < Duration::from_secs(15),
            "{:?}",
            started.elapsed()
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_failing_agent_reports_its_own_complaint() {
        let (dir, file) = fake(
            "sadagent",
            "@echo off\r\necho not logged in 1>&2\r\nexit /b 3\r\n",
            "#!/bin/sh\necho not logged in >&2\nexit 3\n",
        );
        let err = run(&file, &[], "hi", Duration::from_secs(20))
            .unwrap_err()
            .to_string();
        assert!(err.contains("not logged in"), "{err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_agent_that_is_not_installed_is_found_nowhere() {
        let empty = std::env::temp_dir().join(format!("ysm-agent-none-{}", std::process::id()));
        std::fs::create_dir_all(&empty).unwrap();
        assert_eq!(find_in("claude", empty.as_os_str()), None);
        assert!(run(
            &empty.join("claude-missing.exe"),
            &[],
            "",
            Duration::from_secs(1)
        )
        .is_err());
        assert!(chat("nobody", "", &[])
            .unwrap_err()
            .to_string()
            .contains("unknown agent"));
        let _ = std::fs::remove_dir_all(&empty);
    }

    #[test]
    fn prompt_joins_system_and_turns() {
        let one = [("user".to_string(), "Q".to_string())];
        assert_eq!(prompt("S", &one), "S\n\nQ");
        let many = [
            ("user".into(), "a".into()),
            ("assistant".into(), "b".into()),
            ("user".into(), "c".into()),
        ];
        assert_eq!(
            prompt("", &many),
            "User: a\n\nAssistant: b\n\nUser: c\n\nAssistant:"
        );
    }
}
