//! The phone's status and navigation bars follow the Skin's Background (PLAN
//! §24.10). `<meta name="theme-color">` is all a browser needs, but Android's
//! WebView and iOS's WKWebView ignore it, so the UI calls `set_system_bars`
//! whenever the Background on screen changes.
//!
//! Rust only, through the webview handles Tauri already exposes (JNI on
//! Android, the Objective-C runtime on iOS): `src-tauri/gen/` is regenerated
//! by `tauri android init` / `ios init` in CI, so nothing here may depend on
//! a hand edit or a Kotlin/Swift file there. On desktop the command does
//! nothing.

use crate::CmdResult;

/// `#rrggbb` as 0xRRGGBB.
pub fn parse_hex(color: &str) -> Option<u32> {
    let hex = color.trim().strip_prefix('#')?;
    if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    u32::from_str_radix(hex, 16).ok()
}

/// Paint the bars `color` (`#rrggbb`) with light icons when `dark` (the
/// Background is dark), dark icons otherwise.
#[tauri::command]
pub fn set_system_bars(window: tauri::WebviewWindow, color: String, dark: bool) -> CmdResult<()> {
    let rgb = parse_hex(&color).ok_or_else(|| format!("not a #rrggbb colour: {color}"))?;
    #[cfg(target_os = "android")]
    {
        android::apply(&window, rgb, dark)?;
    }
    #[cfg(target_os = "ios")]
    {
        ios::apply(&window, rgb, dark)?;
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let _ = (window, rgb, dark);
    Ok(())
}

#[cfg(target_os = "android")]
mod android {
    use crate::{err, CmdResult};
    use jni::objects::{JObject, JValue};
    use jni::JNIEnv;

    // android.view.WindowInsetsController (API 30)
    const APPEARANCE_LIGHT_STATUS_BARS: i32 = 0x8;
    const APPEARANCE_LIGHT_NAVIGATION_BARS: i32 = 0x10;
    // android.view.View, the pre-30 equivalents
    const SYSTEM_UI_FLAG_LIGHT_STATUS_BAR: i32 = 0x2000; // API 23
    const SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR: i32 = 0x10; // API 26

    pub fn apply(window: &tauri::WebviewWindow, rgb: u32, dark: bool) -> CmdResult<()> {
        let argb = (0xFF00_0000u32 | rgb) as i32;
        window
            .with_webview(move |wv| {
                // `exec` runs on the Activity's UI thread, where Window and View
                // calls must happen.
                wv.jni_handle().exec(move |env, activity, _webview| {
                    if paint(env, activity, argb, dark).is_err() {
                        // A Java exception left pending would abort the next JNI call.
                        let _ = env.exception_describe();
                        let _ = env.exception_clear();
                    }
                });
            })
            .map_err(err)
    }

    fn paint(env: &mut JNIEnv, activity: &JObject, argb: i32, dark: bool) -> jni::errors::Result<()> {
        let sdk = env.get_static_field("android/os/Build$VERSION", "SDK_INT", "I")?.i()?;
        let window = env.call_method(activity, "getWindow", "()Landroid/view/Window;", &[])?.l()?;
        let decor = env.call_method(&window, "getDecorView", "()Landroid/view/View;", &[])?.l()?;

        // The Activity is edge to edge (Tauri's template, and enforced from
        // API 35): the bars are see-through and MainActivity pads the content
        // by their insets (scripts/android-post-init.mjs), so what shows behind
        // them is the window's own background.
        env.call_method(&decor, "setBackgroundColor", "(I)V", &[JValue::Int(argb)])?;
        if sdk < 35 {
            // Ignored from 35 on; below it a bar may still be painted opaque.
            env.call_method(&window, "setStatusBarColor", "(I)V", &[JValue::Int(argb)])?;
            env.call_method(&window, "setNavigationBarColor", "(I)V", &[JValue::Int(argb)])?;
        }
        if sdk >= 29 {
            // No translucent scrim over the three-button navigation bar.
            env.call_method(&window, "setNavigationBarContrastEnforced", "(Z)V", &[JValue::Bool(0)])?;
            env.call_method(&window, "setStatusBarContrastEnforced", "(Z)V", &[JValue::Bool(0)])?;
        }

        let light = !dark;
        if sdk >= 30 {
            let controller = env
                .call_method(&window, "getInsetsController", "()Landroid/view/WindowInsetsController;", &[])?
                .l()?;
            if !controller.is_null() {
                let mask = APPEARANCE_LIGHT_STATUS_BARS | APPEARANCE_LIGHT_NAVIGATION_BARS;
                let value = if light { mask } else { 0 };
                env.call_method(&controller, "setSystemBarsAppearance", "(II)V", &[JValue::Int(value), JValue::Int(mask)])?;
            }
        } else if sdk >= 23 {
            let mut flags = env.call_method(&decor, "getSystemUiVisibility", "()I", &[])?.i()?;
            let mut bits = SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if sdk >= 26 {
                bits |= SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            flags = if light { flags | bits } else { flags & !bits };
            env.call_method(&decor, "setSystemUiVisibility", "(I)V", &[JValue::Int(flags)])?;
        }
        Ok(())
    }
}

#[cfg(target_os = "ios")]
mod ios {
    use crate::{err, CmdResult};
    use objc2::ffi::{class_replaceMethod, object_getClass};
    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
    use objc2::{class, msg_send, sel};
    use std::sync::atomic::{AtomicIsize, Ordering};

    // UIStatusBarStyle
    const LIGHT_CONTENT: isize = 1;
    const DARK_CONTENT: isize = 3; // iOS 13

    static STYLE: AtomicIsize = AtomicIsize::new(0); // UIStatusBarStyleDefault

    /// `-[UIViewController preferredStatusBarStyle]` for tao's view controller,
    /// which does not override it (it would follow the system's dark mode,
    /// not the Skin).
    extern "C-unwind" fn preferred_status_bar_style(_this: *mut AnyObject, _cmd: Sel) -> isize {
        STYLE.load(Ordering::Relaxed)
    }

    pub fn apply(window: &tauri::WebviewWindow, rgb: u32, dark: bool) -> CmdResult<()> {
        STYLE.store(if dark { LIGHT_CONTENT } else { DARK_CONTENT }, Ordering::Relaxed);
        let [r, g, b] = [(rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF].map(|c| c as f64 / 255.0);
        // `with_webview` runs on the main thread, where UIKit must be called.
        window
            .with_webview(move |wv| unsafe {
                let webview = wv.inner() as *mut AnyObject;
                let controller = wv.view_controller() as *mut AnyObject;
                if webview.is_null() || controller.is_null() {
                    return;
                }
                let color: *mut AnyObject = msg_send![class!(UIColor), colorWithRed: r, green: g, blue: b, alpha: 1.0f64];
                // Behind the status bar, the home indicator and an overscroll
                // bounce, before the page paints.
                let _: () = msg_send![webview, setBackgroundColor: color];
                let scroll: *mut AnyObject = msg_send![webview, scrollView];
                if !scroll.is_null() {
                    let _: () = msg_send![scroll, setBackgroundColor: color];
                }
                let view: *mut AnyObject = msg_send![controller, view];
                if !view.is_null() {
                    let _: () = msg_send![view, setBackgroundColor: color];
                }

                let cls = object_getClass(controller) as *mut AnyClass;
                let imp: Imp = std::mem::transmute(preferred_status_bar_style as extern "C-unwind" fn(*mut AnyObject, Sel) -> isize);
                // NSInteger (q) returned from (id self, SEL _cmd).
                class_replaceMethod(cls, sel!(preferredStatusBarStyle), imp, c"q@:".as_ptr());
                let _: () = msg_send![controller, setNeedsStatusBarAppearanceUpdate];
            })
            .map_err(err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_only_six_digit_hex() {
        assert_eq!(parse_hex("#2E3440"), Some(0x2E3440));
        assert_eq!(parse_hex(" #f8f6f1 "), Some(0xF8F6F1));
        assert_eq!(parse_hex("2e3440"), None);
        assert_eq!(parse_hex("#fff"), None);
        assert_eq!(parse_hex("#2e344g"), None);
        assert_eq!(parse_hex("oklch(0.98 0 0)"), None);
    }
}
