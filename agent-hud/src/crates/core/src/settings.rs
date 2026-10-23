//! The app's settings and provider switches: defaults, validation, and the
//! settings file, which another copy of the app may have written since.
use super::*;

impl crate::AgentHudCore {
    pub fn client_hooks_enabled(&self) -> bool {
        self.settings["clientHooks"] == true
    }

    pub fn set_presentation(&mut self, key: &str, value: &Value) -> Result<Value, String> {
        let mut values = serde_json::Map::new();
        values.insert(key.into(), value.clone());
        self.set_presentation_values(&Value::Object(values))
    }

    pub fn set_presentation_values(&mut self, values: &Value) -> Result<Value, String> {
        let values = values
            .as_object()
            .ok_or("Presentation values must be an object")?;
        for (key, value) in values {
            if !matches!(
                key.as_str(),
                "appearance" | "animations" | "showMenuBarIcon" | "appearanceFollowsScreen"
            ) {
                return Err("This setting requires its dedicated host action".into());
            }
            Self::validate_setting(key, value)?;
        }
        self.reload_preferences()?;
        if values
            .iter()
            .all(|(key, value)| self.settings.get(key) == Some(value))
        {
            return Ok(self.settings.clone());
        }
        let previous = self.settings.clone();
        for (key, value) in values {
            self.settings[key] = value.clone();
        }
        if let Err(error) = self.save() {
            self.settings = previous;
            return Err(error);
        }
        Ok(self.settings.clone())
    }

    pub fn seed_initial_preferences(&mut self, values: &Value) -> Result<bool, String> {
        if fs::symlink_metadata(&self.settings_path).is_ok() {
            return Ok(false);
        }
        let values = values
            .get("settings")
            .unwrap_or(values)
            .as_object()
            .ok_or("Initial settings must be an object")?;
        let mut next = self.settings.clone();
        let mut copied = false;
        for (key, value) in values {
            if Self::validate_setting(key, value).is_ok() {
                next[key] = value.clone();
                copied = true;
            }
        }
        if !copied {
            return Ok(false);
        }
        let previous = std::mem::replace(&mut self.settings, next);
        if let Err(error) = self.save() {
            self.settings = previous;
            return Err(error);
        }
        self.requests
            .set_hold_ms(self.settings["approvalWaitMinutes"].as_u64().unwrap_or(10) * 60_000);
        Ok(true)
    }

    pub(crate) fn apply_setting(&mut self, key: &str, value: &Value) -> Result<(), String> {
        Self::validate_setting(key, value)?;
        let previous = self.settings.clone();
        self.settings[key] = value.clone();
        if let Err(error) = self.save() {
            self.settings = previous;
            return Err(error);
        }
        if key == "approvalWaitMinutes" {
            self.requests.set_hold_ms(value.as_u64().unwrap() * 60_000);
        }
        Ok(())
    }

    fn validate_setting(key: &str, value: &Value) -> Result<(), String> {
        match key {
            "appearance" if ["dark", "light", "system"].contains(&value.as_str().unwrap_or("")) => {
            }
            "language" if value.as_str().is_some_and(|s| s.len() <= 32) => {}
            "animations"
            | "showMenuBarIcon"
            | "appearanceFollowsScreen"
            | "hudTools"
            | "claudeAnswers"
            | "readCopilotQuota"
            | "clientHooks"
            | "launchAtLogin"
            | "hudVisible"
                if value.is_boolean() => {}
            "approvalWaitMinutes"
                if value
                    .as_u64()
                    .is_some_and(|v| [1, 3, 5, 10, 30, 60].contains(&v)) => {}
            _ => return Err("Unsupported setting or invalid value".into()),
        }
        Ok(())
    }

    pub(crate) fn reload_preferences(&mut self) -> Result<(), String> {
        if !self.settings_path.exists() {
            return Ok(());
        }
        let stored: Value =
            serde_json::from_slice(&fs::read(&self.settings_path).map_err(|e| e.to_string())?)
                .map_err(|e| format!("Preferences could not be read: {e}"))?;
        if let Some(values) = stored["settings"].as_object() {
            for (key, value) in values {
                if self.settings.get(key).is_some() {
                    self.settings[key] = value.clone();
                }
            }
        }
        self.requests.set_hold_ms(
            self.settings["approvalWaitMinutes"]
                .as_u64()
                .filter(|v| [1, 3, 5, 10, 30, 60].contains(v))
                .unwrap_or(10)
                * 60_000,
        );
        let enabled = serde_json::from_value(stored["providers"].clone())
            .map_err(|e| format!("Provider preferences could not be read: {e}"))?;
        if self.enabled != enabled {
            self.enabled = enabled;
            self.usage_projection = None;
            self.meters.view = None;
        }
        Ok(())
    }

    pub(crate) fn save(&self) -> Result<(), String> {
        let parent = self
            .settings_path
            .parent()
            .ok_or("Invalid settings location")?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let bytes =
            serde_json::to_vec_pretty(&json!({"settings":self.settings,"providers":self.enabled}))
                .map_err(|e| e.to_string())?;
        let temporary = self.settings_path.with_extension("json.tmp");
        fs::write(&temporary, bytes)
            .and_then(|_| fs::rename(temporary, &self.settings_path))
            .map_err(|e| e.to_string())
    }
}
