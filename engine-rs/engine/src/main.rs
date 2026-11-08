use std::process::exit;

use submeetly_engine::state::{default_state_dir, legacy_state_dir, migrate_state_dir};

fn main() {
    match std::env::args().nth(1).as_deref() {
        Some("native-host") => {
            if let Err(error) = submeetly_engine::native_host::run() {
                eprintln!("native-host: {error}");
                exit(1);
            }
        }
        Some(other) => {
            eprintln!("unknown command: {other}\nusage: submeetly-engine [native-host]");
            exit(2);
        }
        None => {
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
