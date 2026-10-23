mod adapters;
mod bridge;
mod github_readonly;
mod github_write;
mod dispatch_readonly;
mod session_checkpoint;
mod settings;
mod snapshots;
mod webviews;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // The feature-frozen edition intentionally uses GitHub Releases instead of a self-updater.
        .setup(|app| {
            // SPEC §5 hot-update: refresh adapters at startup and every 6h (best-effort, off the UI thread).
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                adapters::refresh_all_adapters(handle.clone(), false).await;
                let mut interval =
                    tokio::time::interval(std::time::Duration::from_secs(6 * 60 * 60));
                interval.tick().await; // consume the immediate first tick (startup run already done)
                loop {
                    interval.tick().await;
                    adapters::refresh_all_adapters(handle.clone(), false).await;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            webviews::provider_open,
            webviews::provider_close,
            webviews::provider_show,
            webviews::provider_hide,
            webviews::provider_set_bounds,
            webviews::provider_eval,
            webviews::provider_eval_with_callback,
            webviews::provider_open_login,
            webviews::provider_open_login_external,
            webviews::provider_reload,
            webviews::provider_new_session,
            webviews::connections_get,
            webviews::dev_log,
            adapters::adapter_push,
            adapters::report_broken,
            adapters::open_adapter_issue,
            settings::settings_get,
            settings::settings_set,
            settings::export_markdown,
            settings::open_external_url,
            snapshots::snapshot_save,
            snapshots::snapshot_list,
            snapshots::snapshot_load,
            snapshots::snapshot_delete,
            session_checkpoint::session_checkpoint_save,
            session_checkpoint::session_checkpoint_load,
            session_checkpoint::session_checkpoint_clear,
            github_readonly::github_readonly_get,
            github_readonly::github_readonly_associations,
            github_write::github_write_status,
            github_write::github_write_create_issue,
            github_write::github_write_comment,
            github_write::github_write_set_pause,
            github_write::github_write_accept,
            github_write::github_write_request_changes,
            dispatch_readonly::dispatch_readonly_snapshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
