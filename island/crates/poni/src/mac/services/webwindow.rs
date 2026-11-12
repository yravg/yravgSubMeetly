//! The main window: the app's own pages (`/app/app.html`, `/app/minutes.html`, served by the engine)
//! in a WKWebView inside a normal macOS window, with its own Dock presence while it is open, not a
//! tab in a browser. One window per page; asking again brings it to the front.
//!
//! The pages keep their data (the Minutes register is localStorage) in this app's own web store, so it
//! is separate from the one in the person's Chrome.

use objc2::rc::Retained;
use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, sel, MainThreadMarker, MainThreadOnly};
use objc2::runtime::Sel;
use objc2_app_kit::{
    NSAlert, NSAlertFirstButtonReturn, NSApplication, NSMenu, NSMenuItem, NSApplicationActivationPolicy, NSBackingStoreType, NSModalResponseOK, NSSavePanel, NSTextField, NSWindow,
    NSWindowStyleMask,
};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString, NSURL, NSURLRequest, NSURLResponse};
use objc2_web_kit::{
    WKDownload, WKDownloadDelegate, WKFrameInfo, WKNavigationAction, WKNavigationActionPolicy, WKNavigationDelegate, WKUIDelegate, WKWebView, WKWebViewConfiguration,
    WKWindowFeatures,
};
use poni_core::helper;
use std::cell::RefCell;
use std::time::Duration;

struct Open {
    path: &'static str,
    window: Retained<NSWindow>,
    _web: Retained<WKWebView>,
    /// WebKit holds its delegates weakly: this keeps ours alive as long as the window.
    _host: Retained<WebHost>,
}

define_class!(
    /// What a browser would do for the page and a bare web view does not: the JavaScript dialogs
    /// (`alert`, `confirm`, `prompt` answer "no" without it), downloads (every export is a blob link
    /// with a `download` name; the Save panel picks the place) and links (the engine's own pages open
    /// in their window, anything else in the default browser).
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "SubMeetlyWebHost"]
    struct WebHost;

    unsafe impl NSObjectProtocol for WebHost {}

    unsafe impl WKUIDelegate for WebHost {
        #[unsafe(method(webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:))]
        fn alert_panel(&self, _web: &WKWebView, message: &NSString, _frame: &WKFrameInfo, done: &block2::DynBlock<dyn Fn()>) {
            ask(self.mtm(), message, None, false);
            done.call(());
        }

        #[unsafe(method(webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:))]
        fn confirm_panel(&self, _web: &WKWebView, message: &NSString, _frame: &WKFrameInfo, done: &block2::DynBlock<dyn Fn(objc2::runtime::Bool)>) {
            let ok = ask(self.mtm(), message, None, true).is_some();
            done.call((objc2::runtime::Bool::new(ok),));
        }

        #[unsafe(method(webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:))]
        fn text_panel(&self, _web: &WKWebView, prompt: &NSString, default: Option<&NSString>, _frame: &WKFrameInfo, done: &block2::DynBlock<dyn Fn(*mut NSString)>) {
            let text = ask(self.mtm(), prompt, Some(default.map(|d| d.to_string()).unwrap_or_default()), true);
            match text {
                // An empty string is a different answer from Cancel (null) for `prompt`.
                Some(t) => done.call((Retained::as_ptr(&NSString::from_str(&t)) as *mut NSString,)),
                None => done.call((std::ptr::null_mut(),)),
            }
        }

        #[unsafe(method(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:))]
        fn new_window(&self, _web: &WKWebView, _cfg: &WKWebViewConfiguration, action: &WKNavigationAction, _features: &WKWindowFeatures) -> *mut WKWebView {
            // `window.open` and `target=_blank`: never a second web view of ours, the URL goes where it belongs.
            if let Some(url) = unsafe { action.request().URL() }.and_then(|u| u.absoluteString()) {
                route(&url.to_string());
            }
            std::ptr::null_mut()
        }
    }

    unsafe impl WKNavigationDelegate for WebHost {
        #[unsafe(method(webView:decidePolicyForNavigationAction:decisionHandler:))]
        fn decide(&self, _web: &WKWebView, action: &WKNavigationAction, decision: &block2::DynBlock<dyn Fn(WKNavigationActionPolicy)>) {
            let policy = if unsafe { action.shouldPerformDownload() } {
                WKNavigationActionPolicy::Download
            } else {
                // A link out of the app's own pages (https://…) opens in the browser, not in this window.
                let out = unsafe { action.request().URL() }.and_then(|u| u.absoluteString()).map(|u| u.to_string()).filter(|u| u.starts_with("http") && !is_engine(u));
                match out {
                    Some(url) if unsafe { action.targetFrame() }.is_some_and(|f| unsafe { f.isMainFrame() }) => {
                        route(&url);
                        WKNavigationActionPolicy::Cancel
                    }
                    _ => WKNavigationActionPolicy::Allow,
                }
            };
            decision.call((policy,));
        }

        #[unsafe(method(webView:navigationAction:didBecomeDownload:))]
        fn became_download(&self, _web: &WKWebView, _action: &WKNavigationAction, download: &WKDownload) {
            unsafe { download.setDelegate(Some(ProtocolObject::from_ref(self))) };
        }
    }

    unsafe impl WKDownloadDelegate for WebHost {
        #[unsafe(method(download:decideDestinationUsingResponse:suggestedFilename:completionHandler:))]
        fn destination(&self, _download: &WKDownload, _response: &NSURLResponse, name: &NSString, done: &block2::DynBlock<dyn Fn(*mut NSURL)>) {
            let panel = NSSavePanel::savePanel(self.mtm());
            panel.setNameFieldStringValue(name);
            if panel.runModal() == NSModalResponseOK {
                if let Some(url) = panel.URL() {
                    done.call((Retained::as_ptr(&url) as *mut NSURL,));
                    return;
                }
            }
            done.call((std::ptr::null_mut(),));
        }
    }
);

impl WebHost {
    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        let this = mtm.alloc::<Self>().set_ivars(());
        unsafe { msg_send![super(this), init] }
    }
}

/// An alert: the message, an optional text field (`prompt`), OK and, when it asks, Cancel. `None` =
/// cancelled; `Some(text)` = OK (the field's text, empty without a field).
fn ask(mtm: MainThreadMarker, message: &NSString, field: Option<String>, cancel: bool) -> Option<String> {
    let alert = NSAlert::new(mtm);
    alert.setMessageText(message);
    alert.addButtonWithTitle(&NSString::from_str("OK"));
    if cancel {
        alert.addButtonWithTitle(&NSString::from_str("Cancel"));
    }
    let input = field.map(|text| {
        let f = NSTextField::initWithFrame(mtm.alloc(), NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(280.0, 24.0)));
        f.setStringValue(&NSString::from_str(&text));
        alert.setAccessoryView(Some(&f));
        f
    });
    NSApplication::sharedApplication(mtm).activate();
    if alert.runModal() == NSAlertFirstButtonReturn {
        Some(input.map(|f| f.stringValue().to_string()).unwrap_or_default())
    } else {
        None
    }
}

fn is_engine(url: &str) -> bool {
    url.starts_with("http://127.0.0.1:") || url.starts_with("http://localhost:")
}

/// The engine's own pages open in a window of ours, anything else in the default browser.
fn route(url: &str) {
    match url.split_once("/app/").filter(|_| is_engine(url)).map(|(_, rest)| rest.split(['?', '#']).next().unwrap_or("")) {
        Some("minutes.html") => open("/app/minutes.html", "Minutes register"),
        Some("app.html") | Some("") => open("/app/app.html", "yravgSubMeetly"),
        _ => super::open(url),
    }
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

/// The island is an accessory app with no menu bar of its own, so ⌘C, ⌘V, ⌘A, ⌘Z, ⌘W and ⌘M did nothing in
/// a window. A standard Edit and Window menu, sent to whatever has focus, gives them back.
fn install_main_menu(mtm: MainThreadMarker) {
    let app = NSApplication::sharedApplication(mtm);
    if app.mainMenu().is_some() {
        return;
    }
    let entry = |title: &str, action: Sel, key: &str| unsafe {
        NSMenuItem::initWithTitle_action_keyEquivalent(NSMenuItem::alloc(mtm), &NSString::from_str(title), Some(action), &NSString::from_str(key))
    };
    let submenu = |title: &str, items: Vec<Retained<NSMenuItem>>| {
        let menu = NSMenu::initWithTitle(NSMenu::alloc(mtm), &NSString::from_str(title));
        for i in &items {
            menu.addItem(i);
        }
        let holder = NSMenuItem::new(mtm);
        holder.setSubmenu(Some(&menu));
        (holder, menu)
    };
    let bar = NSMenu::new(mtm);
    // The first entry is the application menu (its title is the app's name in the bar).
    let (app_holder, _app_menu) = submenu("yravgSubMeetly", vec![]);
    bar.addItem(&app_holder);
    let (edit, _e) = submenu(
        "Edit",
        vec![
            entry("Undo", sel!(undo:), "z"),
            entry("Redo", sel!(redo:), "Z"),
            NSMenuItem::separatorItem(mtm),
            entry("Cut", sel!(cut:), "x"),
            entry("Copy", sel!(copy:), "c"),
            entry("Paste", sel!(paste:), "v"),
            entry("Select All", sel!(selectAll:), "a"),
        ],
    );
    bar.addItem(&edit);
    let (window, window_menu) = submenu("Window", vec![entry("Minimize", sel!(performMiniaturize:), "m"), entry("Close", sel!(performClose:), "w")]);
    bar.addItem(&window);
    app.setMainMenu(Some(&bar));
    app.setWindowsMenu(Some(&window_menu));
}

fn show(mtm: MainThreadMarker, port: u16, path: &'static str, title: &str) {
    install_main_menu(mtm);
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
    let host = WebHost::new(mtm);
    unsafe {
        web.setUIDelegate(Some(ProtocolObject::from_ref(&*host)));
        web.setNavigationDelegate(Some(ProtocolObject::from_ref(&*host)));
    }
    window.setContentView(Some(&web));
    // Where and how big the person left it comes back next time.
    let name = NSString::from_str(&format!("SubMeetlyWindow {path}"));
    if !window.setFrameUsingName(&name) {
        window.center();
    }
    window.setFrameAutosaveName(&name);
    let url = format!("http://127.0.0.1:{port}{path}");
    if let Some(u) = NSURL::URLWithString(&NSString::from_str(&url)) {
        unsafe { web.loadRequest(&NSURLRequest::requestWithURL(&u)) };
    }
    raise(&window);
    WINDOWS.with(|ws| ws.borrow_mut().push(Open { path, window, _web: web, _host: host }));
}
