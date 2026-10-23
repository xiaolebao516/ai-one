//! Antigravity's quota (Open's AntigravityService and AntigravityClient):
//! only an already-running, signed-in language server is asked, for
//! GetUserStatus over a fixed loopback URL. Platform finds and calls it.
use super::{AGENT, LOCAL_SERVICE};
use crate::account::{account_id, legacy_account, legacy_unresolved, status, Host, Reading};
use crate::l10n;
use crate::naming::{vendor_windows, window_names};
use chrono::Utc;
use serde_json::{json, Value};
use std::{collections::BTreeMap, path::Path};

fn parse(home: &Path, body: &Value) -> Result<Reading, String> {
    let user = &body["userStatus"];
    let configs = user["cascadeModelConfigData"]["clientModelConfigs"]
        .as_array()
        .ok_or_else(|| {
            l10n::text(
                "Antigravity 本地服务返回的额度格式无法识别",
                "Antigravity local service returned an unsupported quota format.",
            )
        })?;
    let email = user["email"]
        .as_str()
        .filter(|value| !value.trim().is_empty());
    let lower_email = email.map(|email| email.to_lowercase());
    let scope = home.to_string_lossy();
    let id = if let Some(email) = lower_email.as_deref() {
        account_id(
            "antigravity",
            &[email, user["teamId"].as_str().unwrap_or("")],
        )
    } else {
        account_id("antigravity", &[&scope])
    };
    let account_identity = legacy_account(
        "Antigravity",
        lower_email.as_deref().unwrap_or(""),
        user["teamId"].as_str().unwrap_or(""),
    )
    .unwrap_or_else(|| legacy_unresolved("Antigravity", &scope));
    let mut pools = BTreeMap::<String, Value>::new();
    for config in configs {
        let Some(fraction) = config["quotaInfo"]["remainingFraction"]
            .as_f64()
            .filter(|fraction| fraction.is_finite() && (0.0..=1.0).contains(fraction))
        else {
            continue;
        };
        let model = config["modelOrAlias"]["model"].as_str().unwrap_or("");
        let label = config["label"].as_str().unwrap_or(model);
        let lower = format!("{model} {label}").to_lowercase();
        if ["lite", "autocomplete", "image"]
            .iter()
            .any(|word| lower.contains(word))
        {
            continue;
        }
        let family = if lower.contains("gemini") {
            "gemini"
        } else if lower.contains("claude") || lower.contains("gpt") {
            "claude-gpt"
        } else {
            model
        };
        if family.is_empty() {
            continue;
        }
        let name = match family {
            "gemini" => "Gemini Models",
            "claude-gpt" => "Claude and GPT models",
            _ => label,
        };
        let used = (1.0 - fraction) * 100.0;
        if pools
            .get(family)
            .is_some_and(|row| row["usedPercent"].as_f64().unwrap_or(0.0) >= used)
        {
            continue;
        }
        let reset = config["quotaInfo"]["resetTime"]
            .as_str()
            .filter(|value| chrono::DateTime::parse_from_rfc3339(value).is_ok());
        // Gemini, third-party for Claude and GPT as Antigravity's plans call
        // them, and any other model by its word.
        let short = match family {
            "gemini" => "Gemini".to_owned(),
            "claude-gpt" => vendor_windows::antigravity_group_word(name),
            _ => window_names::word(label),
        };
        let mut quota = json!({"id":format!("{id}:legacy:{family}"),"vendor":"antigravity","name":name,"shortLabel":short,
            "usedPercent":used,"resetAt":reset,"status":status(used),"account":email,"accountId":account_identity});
        match family {
            "gemini" => quota["modelFamilies"] = json!(["gemini"]),
            "claude-gpt" => quota["modelFamilies"] = json!(["claude", "gpt"]),
            _ => {}
        }
        // GetUserStatus supplies a reset, but no window length or native token
        // capacity. Keep those unknown rather than inferring a five-hour cycle.
        pools.insert(family.into(), quota);
    }
    let all_models = pools.len() == 1;
    let quotas = pools
        .into_values()
        .map(|mut quota| {
            quota["allModels"] = json!(all_models);
            quota
        })
        .collect::<Vec<_>>();
    let notice = quotas.is_empty().then(|| {
        l10n::text(
            "Antigravity 已连接，但本地服务未提供额度比例",
            "Antigravity is connected; its local service reports no quota percentage.",
        )
    });
    Ok(Reading {
        provider: "antigravity",
        quotas,
        billing: Vec::new(),
        notice,
        additional_accounts: Vec::new(),
        session_records: Vec::new(),
        services: Vec::new(),
        account: Some(
            json!({"id":account_identity,"provider":"antigravity","label":email,
            "identity":if email.is_some(){"account"}else{"local-home"},
            "plan":user["userTier"]["name"].as_str().or_else(||user["planStatus"]["planInfo"]["planName"].as_str()),
            "checkedAt":Utc::now().to_rfc3339()}),
        ),
    })
}

pub fn read(host: &dyn Host) -> Result<Reading, String> {
    if !LOCAL_SERVICE.runs_on(host.os()) {
        let mut reading = Reading::empty("antigravity");
        reading.notice = Some(format!(
            "{} ({})",
            l10n::text(
                "此系统暂不支持查找 Antigravity 本地服务",
                "Antigravity local-service discovery is not implemented here"
            ),
            host.os().name()
        ));
        return Ok(reading);
    }
    let body = host.native(
        AGENT.id,
        "GetUserStatus",
        &json!({"metadata":{"ideName":"antigravity","extensionName":"antigravity","locale":"en","ideVersion":"unknown"}}),
    )?;
    parse(host.home(), &body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::account::fake::FakeHost;
    use crate::Os;

    fn status_body() -> Value {
        json!({"userStatus": {
            "email": "Me@Example.com",
            "userTier": {"name": "Pro"},
            "cascadeModelConfigData": {"clientModelConfigs": [
                {"label": "Gemini 3 Pro", "modelOrAlias": {"model": "gemini-3-pro"},
                 "quotaInfo": {"remainingFraction": 0.25, "resetTime": "2026-10-23T00:00:00Z"}},
                {"label": "Gemini 3 Flash", "modelOrAlias": {"model": "gemini-3-flash"},
                 "quotaInfo": {"remainingFraction": 0.5}},
                {"label": "Claude Sonnet", "modelOrAlias": {"model": "claude-sonnet"},
                 "quotaInfo": {"remainingFraction": 1.0}},
                {"label": "Gemini Lite", "modelOrAlias": {"model": "gemini-lite"},
                 "quotaInfo": {"remainingFraction": 0.0}},
            ]},
        }})
    }

    fn answering(body: Result<Value, String>) -> FakeHost {
        let mut host = FakeHost::new("/u");
        host.natives
            .insert(("antigravity".into(), "GetUserStatus".into()), body);
        host
    }

    #[test]
    fn families_keep_their_most_used_model() {
        let reading = read(&answering(Ok(status_body()))).unwrap();
        let identity = legacy_account("Antigravity", "me@example.com", "").unwrap();
        assert_eq!(reading.quotas.len(), 2);
        let gemini = &reading.quotas[1];
        assert_eq!(gemini["name"], "Gemini Models");
        assert_eq!(gemini["usedPercent"], 75.0);
        assert_eq!(gemini["status"], "warning");
        assert_eq!(gemini["resetAt"], "2026-10-23T00:00:00Z");
        assert_eq!(gemini["accountId"], identity.as_str());
        assert_eq!(gemini["allModels"], false);
        let id = account_id("antigravity", &["me@example.com", ""]);
        assert_eq!(gemini["id"], format!("{id}:legacy:gemini"));
        assert_eq!(reading.quotas[0]["modelFamilies"], json!(["claude", "gpt"]));
        let account = reading.account.unwrap();
        assert_eq!(account["plan"], "Pro");
        assert_eq!(account["identity"], "account");
    }

    #[test]
    fn without_an_email_the_account_is_the_home() {
        let mut body = status_body();
        body["userStatus"]["email"] = json!(" ");
        let reading = read(&answering(Ok(body))).unwrap();
        let account = reading.account.unwrap();
        assert_eq!(account["identity"], "local-home");
        assert_eq!(
            account["id"],
            legacy_unresolved("Antigravity", "/u").as_str()
        );
    }

    #[test]
    fn windows_is_not_asked() {
        let mut host = answering(Ok(status_body()));
        host.os = Os::Windows;
        let reading = read(&host).unwrap();
        assert_eq!(
            reading.notice.as_deref(),
            Some("Antigravity local-service discovery is not implemented here (windows)")
        );
        assert!(reading.quotas.is_empty());
    }

    #[test]
    fn a_service_error_or_odd_answer_is_an_error() {
        assert_eq!(
            read(&answering(Err("no service".into()))).err().unwrap(),
            "no service"
        );
        assert!(read(&answering(Ok(json!({"userStatus": {}})))).is_err());
    }
}
