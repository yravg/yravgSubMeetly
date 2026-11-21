fn main() {
    // vulkan-1.dll is delay-loaded: the engine starts on a PC without it, and
    // `ggml::vulkan_loader` finds a copy before whisper.cpp first touches Vulkan.
    let windows = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows");
    if windows && std::env::var_os("CARGO_FEATURE_VULKAN").is_some() {
        println!("cargo:rustc-link-arg=/DELAYLOAD:vulkan-1.dll");
        println!("cargo:rustc-link-lib=delayimp");
    }
}
