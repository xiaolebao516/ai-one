//! How words reach one of a client's sessions as its user's next message, as
//! a click on the client's own question sends them. The host carries the
//! words (core's `SessionReplies`); core decides which questions take them.

pub struct Replies {
    /// What carries the words into the session.
    pub carrier: &'static str,
    /// The setting that turns answering the client's questions here on and
    /// off; on unless it is `false`.
    pub setting: &'static str,
}
