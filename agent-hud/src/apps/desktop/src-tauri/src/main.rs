#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// ai-one change: the upstream entry passes no product extension. ai-one passes
// `export::AiOneExport`, which publishes the HUD's quota snapshot to a folder
// ai-one reads (resources page and title bar), so there is one source of truth.
mod export;

fn main() {
    agent_hud_host::run_with_context(
        tauri::generate_context!(),
        Some(std::sync::Arc::new(export::AiOneExport::from_environment())),
    );
}
