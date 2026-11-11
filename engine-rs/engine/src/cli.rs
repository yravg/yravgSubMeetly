//! `submeetly-engine cli ...`: scripts and terminals talk to the running engine.
//!
//! ```text
//! submeetly-engine cli list [--limit N] [--json]
//! submeetly-engine cli show <id> [--json]
//! submeetly-engine cli transcript <id>
//! submeetly-engine cli search <words...> [--json]
//! submeetly-engine cli actions [--meeting <id>] [--all] [--json]
//! submeetly-engine cli export <id> [--format md|txt|json] [--out file]
//! submeetly-engine cli ask <question...> [--meeting <id>]
//! submeetly-engine cli webhook list|add <url> [--secret S] [--events a,b]|remove <id>|enable <id>|disable <id>|test <id>
//! ```
//! Exit code 0 on success, 1 when the engine answered with an error or is not running, 2 for
//! a command line it does not understand. `--json` prints JSON for scripts.

use std::io::Write;

use serde_json::{json, Value};

use crate::client::{grounding, summary_row, transcript_text, Client};

pub const USAGE: &str = "usage: submeetly-engine cli <command>
  list [--limit N] [--json]              the saved meetings
  show <id> [--json]                     one meeting
  transcript <id>                        its transcript
  search <words...> [--json]             search every meeting
  actions [--meeting <id>] [--all] [--json]   open action items
  export <id> [--format md|txt|json] [--out file]
  ask <question...> [--meeting <id>]     ask the on-device model
  webhook list | add <url> [--secret S] [--events a,b] | remove <id> | enable <id> | disable <id> | test <id>
environment: PORT or ENGINE_URL choose the engine (default http://127.0.0.1:17865)";

struct Args {
    words: Vec<String>,
    flags: Vec<(String, Option<String>)>,
}

impl Args {
    fn parse(raw: &[String], with_value: &[&str]) -> Args {
        let mut words = Vec::new();
        let mut flags = Vec::new();
        let mut it = raw.iter();
        while let Some(a) = it.next() {
            if let Some(name) = a.strip_prefix("--") {
                if with_value.contains(&name) {
                    flags.push((name.to_string(), it.next().cloned()));
                } else {
                    flags.push((name.to_string(), None));
                }
            } else {
                words.push(a.clone());
            }
        }
        Args { words, flags }
    }
    fn has(&self, name: &str) -> bool {
        self.flags.iter().any(|(n, _)| n == name)
    }
    fn value(&self, name: &str) -> Option<&str> {
        self.flags
            .iter()
            .find(|(n, _)| n == name)
            .and_then(|(_, v)| v.as_deref())
    }
}

/// Runs a command; `out` receives what it prints. Ok(()) is exit 0, Err((code, message)) the failure.
pub fn run(client: &Client, argv: &[String], out: &mut dyn Write) -> Result<(), (i32, String)> {
    let usage = |why: &str| (2, format!("{why}\n{USAGE}"));
    let fail = |e: String| (1, e);
    let Some(command) = argv.first().map(String::as_str) else {
        return Err(usage("no command"));
    };
    let a = Args::parse(
        &argv[1..],
        &["limit", "meeting", "format", "out", "secret", "events"],
    );
    let json_out = a.has("json");
    let mut put = |text: String| writeln!(out, "{text}").map_err(|e| (1, e.to_string()));
    let pretty = |v: &Value| serde_json::to_string_pretty(v).unwrap_or_default();
    match command {
        "help" | "--help" | "-h" => put(USAGE.to_string()),
        "list" => {
            let limit = a
                .value("limit")
                .and_then(|v| v.parse().ok())
                .unwrap_or(50usize);
            let rows: Vec<Value> = client
                .notes()
                .map_err(fail)?
                .iter()
                .take(limit)
                .map(summary_row)
                .collect();
            if json_out {
                return put(pretty(&json!({ "meetings": rows })));
            }
            for r in &rows {
                put(format!(
                    "{}\t{}\t{}\t{} decisions, {} actions",
                    r["id"].as_str().unwrap_or(""),
                    r["date"].as_str().unwrap_or(""),
                    r["title"].as_str().unwrap_or(""),
                    r["decisions"],
                    r["actions"]
                ))?;
            }
            Ok(())
        }
        "show" => {
            let id = a
                .words
                .first()
                .ok_or_else(|| usage("show needs a meeting id"))?;
            let note = client.note(id).map_err(fail)?;
            if json_out {
                return put(pretty(&note));
            }
            put(crate::notes::export_note_md(&note))
        }
        "transcript" => {
            let id = a
                .words
                .first()
                .ok_or_else(|| usage("transcript needs a meeting id"))?;
            let note = client.note(id).map_err(fail)?;
            let t = transcript_text(&note);
            if t.is_empty() {
                return Err((1, "this meeting has no transcript".into()));
            }
            put(t.trim_end().to_string())
        }
        "search" => {
            if a.words.is_empty() {
                return Err(usage("search needs words"));
            }
            let hits = client.search(&a.words.join(" ")).map_err(fail)?;
            if json_out {
                return put(pretty(&json!({ "results": hits })));
            }
            for h in &hits {
                put(format!(
                    "{}\t{}",
                    h["id"].as_str().unwrap_or(""),
                    h["title"].as_str().unwrap_or("")
                ))?;
                for m in h["matches"].as_array().into_iter().flatten() {
                    put(format!("    {}", m.as_str().unwrap_or("")))?;
                }
            }
            Ok(())
        }
        "actions" => {
            let items = client
                .action_items(a.value("meeting"), a.has("all"))
                .map_err(fail)?;
            if json_out {
                return put(pretty(&json!({ "actionItems": items })));
            }
            for i in &items {
                put(format!(
                    "[{}] {}  ({}{})  — {}",
                    if i["status"] == "closed" { "x" } else { " " },
                    i["text"].as_str().unwrap_or(""),
                    i["owner"].as_str().unwrap_or("no owner"),
                    i["due"]
                        .as_str()
                        .map(|d| format!(", due {d}"))
                        .unwrap_or_default(),
                    i["meetingTitle"].as_str().unwrap_or("")
                ))?;
            }
            Ok(())
        }
        "export" => {
            let id = a
                .words
                .first()
                .ok_or_else(|| usage("export needs a meeting id"))?;
            let format = a.value("format").unwrap_or("md");
            let content = match format {
                "json" => pretty(&client.note(id).map_err(fail)?),
                "md" | "txt" => client
                    .post("/notes/export", &json!({ "id": id, "format": format }))
                    .map_err(fail)?
                    .get("content")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                other => return Err(usage(&format!("format {other:?} is not md, txt or json"))),
            };
            match a.value("out") {
                Some(path) => {
                    std::fs::write(path, content).map_err(|e| (1, format!("{path}: {e}")))
                }
                None => put(content.trim_end().to_string()),
            }
        }
        "ask" => {
            if a.words.is_empty() {
                return Err(usage("ask needs a question"));
            }
            let notes = client.notes().map_err(fail)?;
            let answer = client
                .ask(&a.words.join(" "), &grounding(&notes, a.value("meeting")))
                .map_err(fail)?;
            put(answer.trim().to_string())
        }
        "webhook" => webhook(client, &argv[1..], out),
        other => Err(usage(&format!("unknown command {other:?}"))),
    }
}

fn webhook(client: &Client, argv: &[String], out: &mut dyn Write) -> Result<(), (i32, String)> {
    let usage = |why: &str| (2, format!("{why}\n{USAGE}"));
    let fail = |e: String| (1, e);
    let sub = argv.first().map(String::as_str).unwrap_or("list");
    let a = Args::parse(argv.get(1..).unwrap_or(&[]), &["secret", "events"]);
    let id = || {
        a.words
            .first()
            .cloned()
            .ok_or_else(|| usage("this needs a webhook id"))
    };
    let mut put = |v: &Value| {
        writeln!(
            out,
            "{}",
            serde_json::to_string_pretty(v).unwrap_or_default()
        )
        .map_err(|e| (1, e.to_string()))
    };
    match sub {
        "list" => {
            let v = client.get("/integrations/webhooks").map_err(fail)?;
            put(&v)
        }
        "add" => {
            let url = a.words.first().ok_or_else(|| usage("add needs a url"))?;
            let mut body = json!({ "url": url });
            if let Some(s) = a.value("secret") {
                body["secret"] = json!(s);
            }
            if let Some(e) = a.value("events") {
                body["events"] = json!(e
                    .split(',')
                    .map(str::trim)
                    .filter(|x| !x.is_empty())
                    .collect::<Vec<_>>());
            }
            put(&client.post("/integrations/webhooks", &body).map_err(fail)?)
        }
        "remove" => put(&client
            .post(
                "/integrations/webhooks",
                &json!({ "id": id()?, "remove": true }),
            )
            .map_err(fail)?),
        "enable" | "disable" => put(&client
            .post(
                "/integrations/webhooks",
                &json!({ "id": id()?, "enabled": sub == "enable" }),
            )
            .map_err(fail)?),
        "test" => {
            let v = client
                .post("/integrations/webhooks/test", &json!({ "id": id()? }))
                .map_err(fail)?;
            let ok = v["ok"] == true;
            put(&v)?;
            if ok {
                Ok(())
            } else {
                Err((1, "the test delivery failed".into()))
            }
        }
        other => Err(usage(&format!("unknown webhook command {other:?}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run_args(args: &[&str]) -> (Result<(), (i32, String)>, String) {
        let client = Client::new("http://127.0.0.1:9").unwrap();
        let argv: Vec<String> = args.iter().map(|s| s.to_string()).collect();
        let mut out = Vec::new();
        let r = run(&client, &argv, &mut out);
        (r, String::from_utf8(out).unwrap())
    }

    #[test]
    fn bad_command_lines_are_exit_2_and_a_dead_engine_is_exit_1() {
        assert_eq!(run_args(&[]).0.unwrap_err().0, 2);
        assert_eq!(run_args(&["frobnicate"]).0.unwrap_err().0, 2);
        assert_eq!(run_args(&["show"]).0.unwrap_err().0, 2);
        assert_eq!(
            run_args(&["export", "x", "--format", "pdf"])
                .0
                .unwrap_err()
                .0,
            2
        );
        let (r, _) = run_args(&["list"]);
        let (code, msg) = r.unwrap_err();
        assert_eq!(code, 1);
        assert!(msg.contains("not answering"));
        assert!(run_args(&["help"]).1.contains("usage:"));
    }

    #[test]
    fn flags_with_values_are_not_words() {
        let a = Args::parse(
            &[
                "a".into(),
                "--limit".into(),
                "3".into(),
                "b".into(),
                "--json".into(),
            ],
            &["limit"],
        );
        assert_eq!(a.words, ["a", "b"]);
        assert_eq!(a.value("limit"), Some("3"));
        assert!(a.has("json"));
    }
}
