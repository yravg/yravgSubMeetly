//! yravgSubMeetly local engine: non-ML HTTP contract + Native Messaging host.

pub mod app;
pub mod native_host;
pub mod notes;
pub mod protocol;
pub mod server;
pub mod state;

pub use app::App;
pub use protocol::{Request, Response};
