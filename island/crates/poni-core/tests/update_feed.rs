//! Runs poni's own `services/feed.rs` (the signature check and the Setup command) with its
//! tests, because the poni binary's test target does not build.
#![cfg(any(windows, target_os = "macos"))]

#[path = "../../poni/src/services/feed.rs"]
mod feed;
