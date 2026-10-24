//! The Windows HUD host: a WebView2 window positioned in physical desktop
//! pixels, with Win32 button and modifier state. Geometry, hover and drag state
//! stay in the shared owner.
pub(super) use super::generic::{
    begin_text_focus, end_text_focus, global_pointer, measure_screens, panel_builder, place,
    screen, set_drag_cursor, shown, TextFocusOrigin,
};
use super::{base_limitations, HudCapabilities, PointerKeys};

/// Windows reports global physical desktop pixels, with a per-window DPI scale.
pub(super) const GLOBAL_POINTS: bool = false;
pub(super) const COORDINATE_SPACE: &str = "monitor-scaled-physical-top-left";
pub(super) const NATIVE_DRAG: bool = true;

pub(super) fn wayland_session() -> bool {
    false
}

fn key_down(virtual_key: i32) -> bool {
    // Query only button/modifier state. The low "pressed since last call" bit is
    // deliberately ignored; no keyboard event stream is installed.
    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetAsyncKeyState(virtual_key: i32) -> i16;
    }
    unsafe { GetAsyncKeyState(virtual_key) < 0 }
}

pub(super) fn left_mouse_down() -> Result<bool, String> {
    Ok(key_down(0x01))
}

pub(super) fn pointer_keys() -> PointerKeys {
    let buttons = [(0x01, 1), (0x02, 2), (0x04, 4), (0x05, 8), (0x06, 16)]
        .into_iter()
        .fold(0, |bits, (key, mask)| {
            bits | if key_down(key) { mask } else { 0 }
        });
    PointerKeys {
        buttons: Some(buttons),
        alt: Some(key_down(0x12)),
        ctrl: Some(key_down(0x11)),
        meta: Some(key_down(0x5b) || key_down(0x5c)),
        shift: Some(key_down(0x10)),
    }
}

pub(super) fn capabilities() -> HudCapabilities {
    let mut limitations = base_limitations();
    limitations.push("Tauri does not support visible-on-all-workspaces on Windows. Exclusive fullscreen applications and secure desktops are not covered.");
    HudCapabilities {
        platform: std::env::consts::OS,
        backend: "win32-webview2",
        lazy_creation: true,
        single_window: false,
        per_screen_windows: true,
        transparent_surface: true,
        native_material: false,
        non_focusing_window: true,
        native_nonactivating_panel: false,
        keyboard_handoff: false,
        cursor_passthrough: true,
        interactive_regions: true,
        native_drag: NATIVE_DRAG,
        global_pointer: "native_cursor_polling",
        absolute_edge_position: "supported",
        all_workspaces: "unsupported",
        fullscreen_overlay: "not_guaranteed",
        hardware_notch: false,
        persistent_display_identity: false,
        limitations,
    }
}
