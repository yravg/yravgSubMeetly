use std::process::exit;

use submeetly_engine::state::{default_state_dir, legacy_state_dir, migrate_state_dir};

fn main() {
    match std::env::args().nth(1).as_deref() {
        // Chrome starts a registered host as `exe chrome-extension://<id>/`.
        Some(arg) if arg == "native-host" || arg.starts_with("chrome-extension://") => {
            if let Err(error) = submeetly_engine::native_host::run() {
                eprintln!("native-host: {error}");
                exit(1);
            }
        }
        // `submeetly-engine mcp`: the MCP server on stdio (docs/INTEGRATIONS.md).
        Some("mcp") => {
            let client = match submeetly_engine::client::Client::from_env() {
                Ok(client) => client,
                Err(error) => {
                    eprintln!("mcp: {error}");
                    exit(1);
                }
            };
            let stdin = std::io::stdin();
            if let Err(error) = submeetly_engine::mcp::run(&client, stdin.lock(), std::io::stdout())
            {
                eprintln!("mcp: {error}");
                exit(1);
            }
        }
        // `submeetly-engine cli <command>`: scripts and terminals (docs/INTEGRATIONS.md).
        Some("cli") => {
            let argv: Vec<String> = std::env::args().skip(2).collect();
            let client = match submeetly_engine::client::Client::from_env() {
                Ok(client) => client,
                Err(error) => {
                    eprintln!("{error}");
                    exit(1);
                }
            };
            if let Err((code, message)) =
                submeetly_engine::cli::run(&client, &argv, &mut std::io::stdout())
            {
                eprintln!("{message}");
                exit(code);
            }
        }
        Some(other) => {
            eprintln!("unknown command: {other}\nusage: submeetly-engine [native-host | mcp | cli <command>]");
            exit(2);
        }
        None => {
            submeetly_engine::models::pin_real_hf_home();
            let state_dir = default_state_dir();
            migrate_state_dir(&state_dir, &legacy_state_dir());
            if let Err(error) = submeetly_engine::server::run(submeetly_engine::App::new(state_dir))
            {
                eprintln!("engine: {error}");
                exit(1);
            }
        }
    }
}
