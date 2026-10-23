//! Public local MCP channel, attached to the application's existing owners.
use super::{presentation::Presentation, Backend};
use agent_hud_runtime::local_tools::{self, Server};
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, Weak,
    },
};
use tauri::Manager;
enum ChannelState {
    Disabled,
    Listening(Server),
    Failed(String),
}
pub(super) struct ToolsChannel {
    app: tauri::AppHandle,
    backend: Weak<Mutex<Backend>>,
    directory: PathBuf,
    state: Mutex<ChannelState>,
}
impl ToolsChannel {
    pub(super) fn new(
        app: tauri::AppHandle,
        backend: Weak<Mutex<Backend>>,
        directory: PathBuf,
    ) -> Self {
        Self {
            app,
            backend,
            directory,
            state: Mutex::new(ChannelState::Disabled),
        }
    }
    pub(super) fn configure(&self, enabled: bool) -> Value {
        let Ok(mut state) = self.state.lock() else {
            return json!({"supported":local_tools::supported(),"enabled":enabled,"listening":false,"notice":"Local tools state unavailable"});
        };
        if !enabled {
            *state = ChannelState::Disabled;
        } else if matches!(*state, ChannelState::Disabled) {
            let backend = self.backend.clone();
            let app = self.app.clone();
            let handler = Arc::new(move |request: Value, active: &AtomicBool| {
                let id = request.get("id").cloned().unwrap_or(Value::Null);
                match handle(&app, &backend, &request, active) {
                    Ok(result) => json!({"id":id,"result":result}),
                    Err(error) => {
                        json!({"id":id,"error":{"code":"tools_unavailable","message":error}})
                    }
                }
            });
            *state = match Server::start(&self.directory, handler) {
                Ok(server) => ChannelState::Listening(server),
                Err(error) => ChannelState::Failed(error),
            };
        }
        let (listening, notice) = match &*state {
            ChannelState::Disabled => (false, None),
            ChannelState::Listening(server) if server.is_listening() => (true, None),
            ChannelState::Listening(_) => (
                false,
                Some("The local tools channel stopped; reopen it in Settings"),
            ),
            ChannelState::Failed(error) => (false, Some(error.as_str())),
        };
        json!({"supported":local_tools::supported(),"enabled":enabled,"listening":listening,"notice":notice})
    }
    pub(super) fn stop(&self) {
        if let Ok(mut state) = self.state.lock() {
            *state = ChannelState::Disabled;
        }
    }
}
fn handle(
    app: &tauri::AppHandle,
    weak: &Weak<Mutex<Backend>>,
    request: &Value,
    active: &AtomicBool,
) -> Result<Value, String> {
    let backend = weak.upgrade().ok_or("The application is stopping")?;
    let method = request["method"]
        .as_str()
        .ok_or("Tool method is required")?;
    let params = request.get("params").cloned().unwrap_or(json!({}));
    if HOST_METHODS.contains(&method) {
        // The product's own tool groups and switches: not HUD tools', and
        // never with the application's lock held, which the product's own
        // work takes.
        let extension = backend
            .lock()
            .map_err(|_| "Application state unavailable")?
            .extension
            .clone();
        if !active.load(Ordering::Acquire) {
            return Err("Local tools are disabled".into());
        }
        return host_request(extension.as_deref(), method, params);
    }
    let mut owner = backend
        .lock()
        .map_err(|_| "Application state unavailable")?;
    if !active.load(Ordering::Acquire) {
        return Err("Local tools are disabled".into());
    }
    let snapshot = owner
        .snapshot
        .as_ref()
        .ok_or("Application data is loading")?;
    if snapshot["settings"]["hudTools"] != true {
        return Err("Local tools are disabled".into());
    }
    match method {
        "snapshot" | "refresh" => Ok(snapshot.as_ref().clone()),
        "statistics" | "session_detail" | "sessions" => owner.runtime.local_query(method, params),
        "set_setting" => {
            let key = params["key"]
                .as_str()
                .ok_or("Presentation preference is required")?;
            let value = params.get("value").ok_or("Preference value is required")?;
            let settings = owner.runtime.set_presentation(key, value)?;
            let snapshot = owner.snapshot.as_mut().unwrap();
            Arc::make_mut(snapshot)["settings"] = settings;
            owner.publish_snapshot(app);
            if let Some(view) = app.state::<Presentation>().manual_app_edit(key) {
                crate::coordinator::presentation_changed(app, &view);
            }
            Ok(owner.snapshot.as_ref().unwrap().as_ref().clone())
        }
        "get_hud" | "draft_hud" | "discard_hud_draft" | "finish_hud_edit" => {
            let snapshot = Arc::clone(snapshot);
            // The models and agents the token chart can draw, from the ledger over its
            // longest period, 30 days: what get_hud offers and a proposal may name.
            // Read before the owner lock is released; never invented from the HUD tail.
            let catalog = token_catalog(&snapshot["generatedAt"]).map(|range| {
                owner
                    .runtime
                    .local_query("statistics", range)
                    .unwrap_or_else(|error| json!({"error": error}))
            });
            drop(owner);
            if !active.load(Ordering::Acquire) {
                return Err("Local tools are disabled".into());
            }
            let presentation = app.state::<Presentation>();
            let result = presentation.tool(method, params, &snapshot, catalog.as_ref())?;
            if method != "get_hud" {
                crate::coordinator::presentation_changed(app, &presentation.view());
            }
            Ok(result)
        }
        "get_hud_screenshot" => {
            drop(owner);
            super::picture::capture(app, params)
        }
        _ => Err("Unknown local application tool".into()),
    }
}

/// What the relay asks of a product's own tool groups: the tools that are on,
/// and running one. Nothing else reaches the product from this channel.
const HOST_METHODS: [&str; 2] = ["host_tools", "host_tool"];

/// Whether the channel listens: for HUD tools while their switch is on, and
/// for the product's own tools while one of its groups is on.
pub(super) fn channel_wanted(
    hud_tools: bool,
    extension: Option<&dyn crate::extension::ProductExtension>,
) -> bool {
    hud_tools || extension.is_some_and(|product| product.host_tools_on())
}

/// A host method, handed to the product as it came. Without a product there
/// are no host tools.
fn host_request(
    extension: Option<&dyn crate::extension::ProductExtension>,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    match extension {
        Some(product) => product.request(method, params),
        None if method == "host_tools" => Ok(json!({"tools":[]})),
        None => Err("Unknown local application tool".into()),
    }
}

/// The statistics query for the token chart's catalog: the 30 days up to the
/// snapshot, the chart's longest period. Nil without a readable snapshot time.
fn token_catalog(generated_at: &Value) -> Option<Value> {
    let to = chrono::DateTime::parse_from_rfc3339(generated_at.as_str()?).ok()?;
    let from = to - chrono::Duration::days(30);
    Some(
        json!({"from":from.to_rfc3339(),"to":to.to_rfc3339(),"bucketMinutes":1440,"timeZone":"UTC"}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extension::{HostContext, ProductExtension};

    /// A product that keeps what it was asked, with one tool group whose
    /// switch the test sets.
    struct Product {
        on: AtomicBool,
        asked: Mutex<Vec<(String, Value)>>,
    }
    impl ProductExtension for Product {
        fn start(&self, _host: HostContext) -> Result<(), String> {
            Ok(())
        }
        fn request(&self, method: &str, params: Value) -> Result<Value, String> {
            self.asked
                .lock()
                .unwrap()
                .push((method.into(), params.clone()));
            Ok(json!({"method":method,"params":params}))
        }
        fn host_tools_on(&self) -> bool {
            self.on.load(Ordering::Acquire)
        }
        fn stop(&self) {}
    }
    fn product(on: bool) -> Product {
        Product {
            on: AtomicBool::new(on),
            asked: Mutex::new(Vec::new()),
        }
    }

    #[test]
    fn the_channel_listens_for_hud_tools_or_a_product_group_that_is_on() {
        let off = product(false);
        let on = product(true);
        assert!(!channel_wanted(false, None));
        assert!(!channel_wanted(false, Some(&off)));
        assert!(channel_wanted(false, Some(&on)));
        assert!(channel_wanted(true, None));
        assert!(channel_wanted(true, Some(&off)));
        on.on.store(false, Ordering::Release);
        assert!(!channel_wanted(false, Some(&on)));
    }

    #[test]
    fn host_methods_reach_the_product_as_they_came() {
        let product = product(true);
        let call = json!({"name":"some_tool","arguments":{"text":"hello"},"caller":{"client":"codex","sessionId":"t","turnId":"u"}});
        assert_eq!(
            host_request(Some(&product), "host_tool", call.clone()).unwrap(),
            json!({"method":"host_tool","params":call})
        );
        host_request(Some(&product), "host_tools", json!({})).unwrap();
        assert_eq!(
            product
                .asked
                .lock()
                .unwrap()
                .iter()
                .map(|(method, _)| method.as_str())
                .collect::<Vec<_>>(),
            ["host_tool", "host_tools"]
        );
    }

    #[test]
    fn without_a_product_there_are_no_host_tools() {
        assert_eq!(
            host_request(None, "host_tools", json!({})).unwrap(),
            json!({"tools":[]})
        );
        assert_eq!(
            host_request(None, "host_tool", json!({"name":"some_tool"})).unwrap_err(),
            "Unknown local application tool"
        );
    }

    #[test]
    fn only_the_two_host_methods_are_the_products() {
        // A product host may add its own methods; none of them comes through
        // the tools channel, where an unknown method stays HUD tools' refusal.
        for method in ["host_tools", "host_tool"] {
            assert!(HOST_METHODS.contains(&method));
        }
        for method in [
            "status",
            "set_preferences",
            "snapshot",
            "get_hud",
            "product_method",
        ] {
            assert!(!HOST_METHODS.contains(&method));
        }
    }
}
