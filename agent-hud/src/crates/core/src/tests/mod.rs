//! Core tests that drive `AgentHudCore` through its logs, settings and requests,
//! grouped by what they cover.
use super::*;

mod claude_desktop;
mod ingestion;
mod sessions;
mod workbuddy;

fn fixture(home: &Path) -> AgentHudCore {
    let mut backend = AgentHudCore::new(vec![], home.join("app"));
    backend.provider_roots = vec![
        (home.join(".claude/projects"), "claude"),
        (home.join(".codex/sessions"), "codex"),
    ];
    backend
}
