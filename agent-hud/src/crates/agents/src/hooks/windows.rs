//! Windows launch forms with explicit documented argv/shell contracts. A client
//! whose Windows launch is unsupported is refused instead of getting a POSIX
//! command there.
use super::configuration::{configuration, patch_configuration};
use super::{hooks_of, Launch};
use serde_json::{json, Value};
pub fn patch_configuration_for_windows(
    source: &str,
    flag: &str,
    current: &Value,
    executable: Option<&str>,
) -> Result<Value, String> {
    let description = configuration(source, flag)?;
    let source = description.source.as_str();
    let (_, hooks) = hooks_of(source)?;
    let launch = hooks.launch.windows.value();
    if launch.is_none() && executable.is_some() {
        return Err(format!("{source} has no verified Windows hook launch contract; its configuration was not changed"));
    }
    // A client launched with `exec` lists its handlers under the event; the
    // others group them.
    let exec = matches!(launch, Some(Launch::ExecArgs));
    let mut current = current.clone();
    // Reduce only our exact exec+args handlers to the same owned-command model
    // used for install/update/uninstall. Foreign exec handlers stay untouched.
    for event in &description.events {
        if let Some(groups) = current
            .get_mut("hooks")
            .and_then(|h| h.get_mut(event))
            .and_then(Value::as_array_mut)
        {
            if exec {
                for handler in groups {
                    normalize(handler, source, flag, "bash");
                }
            } else {
                for group in groups {
                    if let Some(handlers) = group.get_mut("hooks").and_then(Value::as_array_mut) {
                        for handler in handlers {
                            normalize(handler, source, flag, "command");
                        }
                    }
                }
            }
        }
    }
    let marker =
        executable.map(|path| format!("'{}' {flag} {source}", path.replace('\'', "'\\''")));
    let mut updated = patch_configuration(source, flag, &current, marker.as_deref())?;
    let Some(executable) = executable else {
        return Ok(updated);
    };
    if executable.is_empty() || executable.contains(['\r', '\n', '\0']) {
        return Err("The Windows hook executable path is invalid".into());
    }
    for event in &description.events {
        if let Some(groups) = updated
            .get_mut("hooks")
            .and_then(|h| h.get_mut(event))
            .and_then(Value::as_array_mut)
        {
            if exec {
                for handler in groups {
                    if handler["bash"].as_str() == marker.as_deref() {
                        let fields = handler.as_object_mut().unwrap();
                        fields.remove("bash");
                        fields.remove("powershell");
                        fields.remove("command");
                        fields.insert("exec".into(), json!(executable));
                        fields.insert("args".into(), json!([flag, source]));
                    }
                }
            } else {
                for group in groups {
                    if let Some(handlers) = group.get_mut("hooks").and_then(Value::as_array_mut) {
                        for handler in handlers {
                            if handler["command"].as_str() != marker.as_deref() {
                                continue;
                            }
                            if let Some(Launch::CommandArgs) = launch {
                                handler["command"] = json!(executable);
                                handler["args"] = json!([flag, source]);
                            } else {
                                handler["commandWindows"] =
                                    json!(powershell(executable, flag, source));
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(updated)
}
fn normalize(handler: &mut Value, source: &str, flag: &str, key: &str) {
    if handler["args"] != json!([flag, source]) {
        return;
    }
    let path = handler[if key == "bash" { "exec" } else { "command" }]
        .as_str()
        .filter(|p| !p.is_empty())
        .map(str::to_owned);
    let Some(path) = path else {
        return;
    };
    let Some(fields) = handler.as_object_mut() else {
        return;
    };
    fields.remove("exec");
    fields.remove("args");
    fields.insert(key.into(), json!(format!("'{path}' {flag} {source}")));
}
fn powershell(executable: &str, flag: &str, source: &str) -> String {
    use base64::Engine;
    let script = format!(
        "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); & '{}' {flag} {source}",
        executable.replace('\'', "''")
    );
    let bytes = script
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect::<Vec<_>>();
    format!(
        "powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand {}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}
