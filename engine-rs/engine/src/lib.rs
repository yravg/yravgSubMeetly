//! yravgSubMeetly local engine: HTTP contract, candle ASR/translation, Native Messaging host.

pub mod app;
pub mod audio;
pub mod calendar;
pub mod diarize;
pub mod connector;
pub mod cli;
pub mod client;
pub mod engine;
pub mod export_docs;
pub mod heuristic;
pub mod ics;
pub mod integrations;
pub mod locations;
pub mod marian;
pub mod mcp;
pub mod ml;
pub mod models;
pub mod native_host;
pub mod notes;
pub mod protocol;
pub mod server;
pub mod state;
pub mod templates;
pub mod translate;
pub mod web;
pub mod whisper;
mod whisper_model;

pub use app::App;
pub use protocol::{Request, Response};
