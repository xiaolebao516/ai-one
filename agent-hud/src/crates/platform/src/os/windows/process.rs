//! Windows process inspection: not implemented.
//!
//! Without it, a hook cannot tell which host launched the client (CLI, Desktop
//! or daemon), so sessions report host "unsupported" and have no navigation
//! target. A Windows adapter would walk parents with the Toolhelp snapshot API
//! and read each image path and command line of the current user's processes.
use super::super::ProcessAncestor;
use std::collections::HashMap;

pub(crate) fn parent_processes() -> Vec<ProcessAncestor> {
    Vec::new()
}

pub(crate) fn codex_cli_on_port(
    _port: u16,
    _wanted_env: &[&str],
) -> Option<(Vec<String>, HashMap<String, String>)> {
    None
}
