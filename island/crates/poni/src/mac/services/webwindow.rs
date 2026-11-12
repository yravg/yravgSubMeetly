//! The main window: the app's own pages (`/app/app.html`, `/app/minutes.html`, served by the engine)
//! in a WKWebView inside a normal macOS window, with its own Dock presence while it is open, not a
//! tab in a browser. One window per page; asking again brings it to the front.
//!
//! The pages keep their data (the Minutes register is localStorage) in this app's own web store, so it
//! is separate from the one in the person's Chrome.

use objc2::rc::Retained;
use objc2::{msg_send, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy, NSBackingStoreType, NSWindow, NSWindowStyleMask};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString, NSURL, NSURLRequest};
use objc2_web_kit::{WKWebView, WKWebViewConfiguration};
use poni_core::helper;
use std::cell::RefCell;
use std::time::Duration;

struct Open {
    path: &'static str,
    window: Retained<NSWindow>,
    _web: Retained<WKWebView>,
}

thread_local! {
    static WINDOWS: RefCell<Vec<Open>> = const { RefCell::new(Vec::new()) };
}

/// Open (or raise) the window for `path`, once the engine answers /health (it is started first).
pub fn open(path: &'static str, title: &'static str) {
    let _ = std::thread::Builder::new().name("web-window".into()).spawn(move || {
        let port = helper::configured_port();
        for _ in 0..50 {
            if helper::request(port, "GET", "/health", None).is_ok_and(|(code, _)| code == 200) {
                break;
            }
            std::thread::sleep(Duration::from_millis(300));
        }
        dispatch2::DispatchQueue::main().exec_async(move || {
            if let Some(mtm) = MainThreadMarker::new() {
                show(mtm, port, path, title);
            }
        });
    });
}

fn show(mtm: MainThreadMarker, port: u16, path: &'static str, title: &str) {
    let raise = |w: &NSWindow| {
        // A window needs a regular app to take the front: the island is an accessory app (no Dock icon),
        // so it becomes a regular one (a Dock icon) once a window has been opened.
        let app = NSApplication::sharedApplication(mtm);
        app.setActivationPolicy(NSApplicationActivationPolicy::Regular);
        w.makeKeyAndOrderFront(None);
        app.activate();
    };
    if WINDOWS.with(|ws| ws.borrow().iter().find(|o| o.path == path).map(|o| raise(&o.window)).is_some()) {
        return;
    }
    let rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1180.0, 760.0));
    let style = NSWindowStyleMask::Titled | NSWindowStyleMask::Closable | NSWindowStyleMask::Miniaturizable | NSWindowStyleMask::Resizable;
    let window: Retained<NSWindow> =
        unsafe { msg_send![NSWindow::alloc(mtm), initWithContentRect: rect, styleMask: style, backing: NSBackingStoreType::Buffered, defer: false] };
    unsafe { window.setReleasedWhenClosed(false) };
    window.setTitle(&NSString::from_str(title));
    window.setMinSize(NSSize::new(760.0, 520.0));
    let web = unsafe { WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), rect, &WKWebViewConfiguration::new(mtm)) };
    window.setContentView(Some(&web));
    window.center();
    let url = format!("http://127.0.0.1:{port}{path}");
    if let Some(u) = NSURL::URLWithString(&NSString::from_str(&url)) {
        unsafe { web.loadRequest(&NSURLRequest::requestWithURL(&u)) };
    }
    raise(&window);
    WINDOWS.with(|ws| ws.borrow_mut().push(Open { path, window, _web: web }));
}
