//! Generic transport port of the public CodexDesktopIPC.swift. Only framing,
//! request correlation and discovery refusal live here; callers own operations.
use serde_json::{json, Value};
use std::{
    fs,
    io::{self, Read, Write},
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::{
            fs::{FileTypeExt, MetadataExt},
            net::UnixStream,
        },
    },
    path::Path,
    time::{Duration, Instant},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum IpcError {
    Unavailable,
    TimedOut,
    Protocol,
    Rejected(String),
}
/// What a failed answer tells the person, in their language; the variant
/// itself is for the logs.
impl std::fmt::Display for IpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        use agent_hud_core::l10n::text;
        match self {
            Self::Unavailable => f.write_str(&text("无法连接 Codex", "Codex could not be reached")),
            Self::TimedOut => {
                f.write_str(&text("Codex 没有及时回应", "Codex did not answer in time"))
            }
            Self::Protocol => f.write_str(&text(
                "Codex 的回应无法识别",
                "Codex answered in a way Agent HUD cannot read",
            )),
            Self::Rejected(reason) => {
                if agent_hud_core::l10n::chinese() {
                    write!(f, "Codex 拒绝了这个回应：{reason}")
                } else {
                    write!(f, "Codex declined the answer: {reason}")
                }
            }
        }
    }
}
impl std::error::Error for IpcError {}
impl From<io::Error> for IpcError {
    fn from(e: io::Error) -> Self {
        if matches!(
            e.kind(),
            io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock
        ) {
            Self::TimedOut
        } else {
            Self::Unavailable
        }
    }
}

/// UID-owned Unix socket with a single operation deadline. Also useful for a
/// different framing protocol without another copy of OS connection handling.
pub struct LocalSocket {
    stream: UnixStream,
    deadline: Instant,
}
impl LocalSocket {
    pub fn connect(path: &Path, timeout: Duration) -> Result<Self, IpcError> {
        use std::os::unix::ffi::OsStrExt;
        if timeout.is_zero() {
            return Err(IpcError::TimedOut);
        }
        let info = fs::symlink_metadata(path).map_err(|_| IpcError::Unavailable)?;
        if !info.file_type().is_socket() || info.uid() != unsafe { libc::getuid() } {
            return Err(IpcError::Unavailable);
        }
        let bytes = path.as_os_str().as_bytes();
        let mut address: libc::sockaddr_un = unsafe { std::mem::zeroed() };
        if bytes.is_empty() || bytes.contains(&0) || bytes.len() >= address.sun_path.len() {
            return Err(IpcError::Unavailable);
        }
        address.sun_family = libc::AF_UNIX as _;
        crate::os::prepare_socket_address(&mut address);
        for (target, byte) in address.sun_path.iter_mut().zip(bytes) {
            *target = *byte as _;
        }
        let fd = unsafe { libc::socket(libc::AF_UNIX, libc::SOCK_STREAM, 0) };
        if fd < 0 {
            return Err(IpcError::Unavailable);
        }
        let stream = unsafe { UnixStream::from_raw_fd(fd) };
        stream.set_nonblocking(true)?;
        unsafe {
            libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC);
        }
        crate::os::suppress_sigpipe(fd);
        let socket = Self {
            stream,
            deadline: Instant::now() + timeout,
        };
        let status = unsafe {
            libc::connect(
                fd,
                (&address as *const libc::sockaddr_un).cast(),
                std::mem::size_of_val(&address) as _,
            )
        };
        if status != 0 {
            if io::Error::last_os_error().raw_os_error() != Some(libc::EINPROGRESS) {
                return Err(IpcError::Unavailable);
            }
            socket.wait(libc::POLLOUT)?;
            if socket.stream.take_error()?.is_some() {
                return Err(IpcError::Unavailable);
            }
        }
        Ok(socket)
    }
    pub fn renew(&mut self, timeout: Duration) {
        self.deadline = Instant::now() + timeout;
    }
    pub fn remaining(&self) -> Duration {
        self.deadline.saturating_duration_since(Instant::now())
    }
    pub fn wait_for_message(&self, timeout: Duration) -> Result<bool, IpcError> {
        let until = Instant::now() + timeout;
        loop {
            let left = until.saturating_duration_since(Instant::now());
            let mut entry = libc::pollfd {
                fd: self.stream.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            };
            let status =
                unsafe { libc::poll(&mut entry, 1, left.as_millis().min(i32::MAX as u128) as i32) };
            if status < 0 && io::Error::last_os_error().kind() == io::ErrorKind::Interrupted {
                continue;
            }
            if status == 0 {
                return Ok(false);
            }
            if status > 0 && entry.revents & libc::POLLIN != 0 {
                return Ok(true);
            }
            return Err(IpcError::Unavailable);
        }
    }
    fn wait(&self, events: i16) -> io::Result<()> {
        loop {
            let left = self.remaining();
            if left.is_zero() {
                return Err(io::ErrorKind::TimedOut.into());
            }
            let mut entry = libc::pollfd {
                fd: self.stream.as_raw_fd(),
                events,
                revents: 0,
            };
            let status = unsafe {
                libc::poll(
                    &mut entry,
                    1,
                    (left.as_millis() + 1).min(i32::MAX as u128) as i32,
                )
            };
            if status < 0 && io::Error::last_os_error().kind() == io::ErrorKind::Interrupted {
                continue;
            }
            if status == 0 {
                return Err(io::ErrorKind::TimedOut.into());
            }
            if status > 0 && entry.revents & events != 0 {
                return Ok(());
            }
            return Err(io::ErrorKind::ConnectionAborted.into());
        }
    }
}
impl Read for LocalSocket {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        loop {
            self.wait(libc::POLLIN)?;
            match self.stream.read(bytes) {
                Err(e)
                    if matches!(
                        e.kind(),
                        io::ErrorKind::Interrupted | io::ErrorKind::WouldBlock
                    ) =>
                {
                    continue
                }
                result => return result,
            }
        }
    }
}
impl Write for LocalSocket {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        loop {
            self.wait(libc::POLLOUT)?;
            let flags = crate::os::SOCKET_SEND_FLAGS;
            let count = unsafe {
                libc::send(
                    self.stream.as_raw_fd(),
                    bytes.as_ptr().cast(),
                    bytes.len(),
                    flags,
                )
            };
            if count < 0 {
                let error = io::Error::last_os_error();
                if matches!(
                    error.kind(),
                    io::ErrorKind::Interrupted | io::ErrorKind::WouldBlock
                ) {
                    continue;
                }
                return Err(error);
            }
            return Ok(count as usize);
        }
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

pub struct DesktopIpc {
    socket: LocalSocket,
}
impl DesktopIpc {
    pub fn connect(path: &Path, timeout: Duration) -> Result<Self, IpcError> {
        Ok(Self {
            socket: LocalSocket::connect(path, timeout)?,
        })
    }
    pub fn renew(&mut self, timeout: Duration) {
        self.socket.renew(timeout);
    }
    pub fn shutdown_handle(&self) -> Result<UnixStream, IpcError> {
        Ok(self.socket.stream.try_clone()?)
    }
    pub fn wait_for_message(&self, timeout: Duration) -> Result<bool, IpcError> {
        self.socket.wait_for_message(timeout)
    }
    pub fn request(
        &mut self,
        method: &str,
        version: i64,
        source: &str,
        target: Option<&str>,
        params: Value,
        on_write: Option<&mut dyn FnMut()>,
    ) -> Result<Value, IpcError> {
        let request_id = request_id()?;
        let mut message = json!({"type":"request","requestId":request_id,"sourceClientId":source,"version":version,"method":method,"params":params,
            "timeoutMs":self.socket.remaining().as_millis().clamp(1,i32::MAX as u128) as u64});
        if let Some(target) = target {
            message["targetClientId"] = json!(target);
        }
        self.post_with_write(message, on_write)?;
        loop {
            let response = self.receive()?;
            if self.decline_discovery(&response)? {
                continue;
            }
            if response["type"] != "response" || response["requestId"] != request_id {
                continue;
            }
            return match response["resultType"].as_str() {
                Some("success") => Ok(response),
                Some("error") => Err(IpcError::Rejected(
                    response["error"]
                        .as_str()
                        .unwrap_or("unknown-ipc-error")
                        .into(),
                )),
                _ => Err(IpcError::Protocol),
            };
        }
    }
    pub fn post(&mut self, message: Value) -> Result<(), IpcError> {
        self.post_with_write(message, None)
    }
    pub fn post_with_write(
        &mut self,
        message: Value,
        mut on_write: Option<&mut dyn FnMut()>,
    ) -> Result<(), IpcError> {
        let bytes = serde_json::to_vec(&message).map_err(|_| IpcError::Protocol)?;
        if bytes.len() > 64 * 1024 * 1024 {
            return Err(IpcError::Protocol);
        }
        let frame = [
            (bytes.len() as u32).to_le_bytes().as_slice(),
            bytes.as_slice(),
        ]
        .concat();
        let mut offset = 0;
        while offset < frame.len() {
            let count = self.socket.write(&frame[offset..])?;
            if count == 0 {
                return Err(IpcError::Unavailable);
            }
            if offset == 0 {
                if let Some(callback) = on_write.as_mut() {
                    callback();
                }
            }
            offset += count;
        }
        Ok(())
    }
    pub fn receive(&mut self) -> Result<Value, IpcError> {
        self.receive_with_limit(64 * 1024 * 1024)
    }
    pub fn receive_with_limit(&mut self, limit: usize) -> Result<Value, IpcError> {
        let bytes = self.receive_frame(limit)?;
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| IpcError::Protocol)?;
        if !value.is_object() {
            return Err(IpcError::Protocol);
        }
        Ok(value)
    }
    /// Like the source stream reader, omit oversized leaf strings while decoding,
    /// rather than first retaining copies of screenshots/tool dumps in a Value tree.
    pub fn receive_trimmed(
        &mut self,
        limit: usize,
        string_limit: usize,
    ) -> Result<Value, IpcError> {
        use serde::de::DeserializeSeed;
        let bytes = self.receive_frame(limit)?;
        let mut decoder = serde_json::Deserializer::from_slice(&bytes);
        let value = TrimStrings(string_limit)
            .deserialize(&mut decoder)
            .map_err(|_| IpcError::Protocol)?;
        decoder.end().map_err(|_| IpcError::Protocol)?;
        if !value.is_object() {
            return Err(IpcError::Protocol);
        }
        Ok(value)
    }
    fn receive_frame(&mut self, limit: usize) -> Result<Frame, IpcError> {
        let mut header = [0; 4];
        self.socket.read_exact(&mut header)?;
        let length = u32::from_le_bytes(header) as usize;
        if length == 0 || length > limit {
            return Err(IpcError::Protocol);
        }
        let mut bytes = Frame::new(length)?;
        for chunk in bytes.bytes_mut().chunks_mut(1024 * 1024) {
            self.socket.read_exact(chunk)?;
        }
        Ok(bytes)
    }
    pub fn decline_discovery(&mut self, message: &Value) -> Result<bool, IpcError> {
        if message["type"] != "client-discovery-request" {
            return Ok(false);
        }
        // A discovery request without its id is not one to answer; it is
        // ignored as Open ignores it, and the connection stays.
        let Some(id) = message["requestId"].as_str() else {
            return Ok(false);
        };
        self.post(json!({"type":"client-discovery-response","requestId":id,"response":{"canHandle":false}}))?;
        Ok(true)
    }
}
// Keep large, one-shot snapshots out of the general allocator, just as the
// public Swift source does. Dropping a frame returns its mapping immediately.
enum Frame {
    Small(Vec<u8>),
    Mapped {
        memory: std::ptr::NonNull<u8>,
        length: usize,
    },
}
impl Frame {
    fn new(length: usize) -> Result<Self, IpcError> {
        if length < 1024 * 1024 {
            return Ok(Self::Small(vec![0; length]));
        }
        let memory = unsafe {
            libc::mmap(
                std::ptr::null_mut(),
                length,
                libc::PROT_READ | libc::PROT_WRITE,
                libc::MAP_ANON | libc::MAP_PRIVATE,
                -1,
                0,
            )
        };
        if memory == libc::MAP_FAILED {
            return Err(IpcError::Unavailable);
        }
        let memory = std::ptr::NonNull::new(memory.cast()).ok_or(IpcError::Unavailable)?;
        Ok(Self::Mapped { memory, length })
    }
    fn bytes_mut(&mut self) -> &mut [u8] {
        match self {
            Self::Small(bytes) => bytes,
            Self::Mapped { memory, length } => unsafe {
                std::slice::from_raw_parts_mut(memory.as_ptr(), *length)
            },
        }
    }
}
impl std::ops::Deref for Frame {
    type Target = [u8];
    fn deref(&self) -> &[u8] {
        match self {
            Self::Small(bytes) => bytes,
            Self::Mapped { memory, length } => unsafe {
                std::slice::from_raw_parts(memory.as_ptr(), *length)
            },
        }
    }
}
impl Drop for Frame {
    fn drop(&mut self) {
        if let Self::Mapped { memory, length } = self {
            unsafe {
                libc::munmap(memory.as_ptr().cast(), *length);
            }
        }
    }
}
#[derive(Clone, Copy)]
struct TrimStrings(usize);
impl<'de> serde::de::DeserializeSeed<'de> for TrimStrings {
    type Value = Value;
    fn deserialize<D: serde::Deserializer<'de>>(self, decoder: D) -> Result<Value, D::Error> {
        decoder.deserialize_any(self)
    }
}
impl<'de> serde::de::Visitor<'de> for TrimStrings {
    type Value = Value;
    fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("JSON value")
    }
    fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<Value, E> {
        Ok(Value::Bool(v))
    }
    fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<Value, E> {
        Ok(v.into())
    }
    fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<Value, E> {
        Ok(v.into())
    }
    fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<Value, E> {
        Ok(serde_json::Number::from_f64(v)
            .map(Value::Number)
            .unwrap_or(Value::Null))
    }
    fn visit_unit<E: serde::de::Error>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }
    fn visit_none<E: serde::de::Error>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }
    fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Value, E> {
        Ok(if v.len() > self.0 {
            Value::Null
        } else {
            Value::String(v.into())
        })
    }
    fn visit_borrowed_str<E: serde::de::Error>(self, v: &'de str) -> Result<Value, E> {
        self.visit_str(v)
    }
    fn visit_string<E: serde::de::Error>(self, v: String) -> Result<Value, E> {
        Ok(if v.len() > self.0 {
            Value::Null
        } else {
            Value::String(v)
        })
    }
    fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut seq: A) -> Result<Value, A::Error> {
        let mut values = Vec::new();
        while let Some(value) = seq.next_element_seed(self)? {
            values.push(value);
        }
        Ok(Value::Array(values))
    }
    fn visit_map<A: serde::de::MapAccess<'de>>(self, mut map: A) -> Result<Value, A::Error> {
        let mut members = serde_json::Map::new();
        while let Some(key) = map.next_key::<String>()? {
            members.insert(key, map.next_value_seed(self)?);
        }
        Ok(Value::Object(members))
    }
}
pub fn request_id() -> Result<String, IpcError> {
    let mut random = [0u8; 16];
    fs::File::open("/dev/urandom")?.read_exact(&mut random)?;
    random[6] = (random[6] & 0x0f) | 0x40;
    random[8] = (random[8] & 0x3f) | 0x80;
    let hex = random
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    ))
}
