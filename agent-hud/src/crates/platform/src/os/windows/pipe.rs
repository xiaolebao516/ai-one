//! Per-user local-only Windows IPC. Async I/O owns cancellation/deadlines; all
//! provider decisions stay in the same portable Requests/coordinator.
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    ffi::{c_void, OsStr},
    io,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::windows::named_pipe::{ClientOptions, NamedPipeServer, ServerOptions},
    sync::watch,
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, LocalFree, HANDLE},
    Security::{
        Authorization::{
            ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
            GetNamedSecurityInfoW, SE_FILE_OBJECT,
        },
        GetTokenInformation, SetFileSecurityW, TokenUser, DACL_SECURITY_INFORMATION,
        OWNER_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION, SECURITY_ATTRIBUTES,
        TOKEN_QUERY, TOKEN_USER,
    },
    System::Threading::{GetCurrentProcess, OpenProcessToken},
};
fn wide(value: &OsStr) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    value.encode_wide().chain(Some(0)).collect()
}
struct Local(*mut c_void);
impl Drop for Local {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { LocalFree(self.0) };
        }
    }
}
fn sid() -> Result<String, String> {
    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err("Current-user token unavailable".into());
        }
        let mut bytes = 0;
        GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut bytes);
        let mut buffer = vec![0usize; (bytes as usize).div_ceil(size_of::<usize>())];
        let ok = GetTokenInformation(
            token,
            TokenUser,
            buffer.as_mut_ptr().cast(),
            bytes,
            &mut bytes,
        );
        CloseHandle(token);
        if ok == 0 {
            return Err("Current-user identity unavailable".into());
        }
        let user = &*buffer.as_ptr().cast::<TOKEN_USER>();
        let mut text = std::ptr::null_mut();
        if ConvertSidToStringSidW(user.User.Sid, &mut text) == 0 {
            return Err("Current-user identity unavailable".into());
        }
        let text = Local(text.cast());
        let mut count = 0;
        while *text.0.cast::<u16>().add(count) != 0 {
            count += 1;
        }
        Ok(String::from_utf16_lossy(std::slice::from_raw_parts(
            text.0.cast::<u16>(),
            count,
        )))
    }
}
fn security(inherit: bool) -> Result<Local, String> {
    let sid = sid()?;
    let flags = if inherit { "OICI" } else { "" };
    let sddl = wide(OsStr::new(&format!(
        "D:P(A;{flags};GA;;;{sid})(A;{flags};GA;;;SY)"
    )));
    let mut descriptor = std::ptr::null_mut();
    if unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            1,
            &mut descriptor,
            std::ptr::null_mut(),
        )
    } == 0
    {
        return Err("Per-user IPC access control unavailable".into());
    }
    Ok(Local(descriptor))
}
pub(crate) fn owned_path(path: &Path) -> bool {
    let mut owner = std::ptr::null_mut();
    let mut descriptor = std::ptr::null_mut();
    let path = wide(path.as_os_str());
    let status = unsafe {
        GetNamedSecurityInfoW(
            path.as_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION,
            &mut owner,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut descriptor,
        )
    };
    let _descriptor = Local(descriptor);
    if status != 0 || owner.is_null() {
        return false;
    }
    let mut text = std::ptr::null_mut();
    if unsafe { ConvertSidToStringSidW(owner, &mut text) } == 0 {
        return false;
    }
    let text = Local(text.cast());
    let mut count = 0;
    unsafe {
        while *text.0.cast::<u16>().add(count) != 0 {
            count += 1;
        }
    }
    let owner = unsafe {
        String::from_utf16_lossy(std::slice::from_raw_parts(text.0.cast::<u16>(), count))
    };
    sid().is_ok_and(|sid| sid == owner)
}
pub(crate) fn private_directory(path: &Path) -> Result<(), String> {
    std::fs::create_dir_all(path).map_err(|_| "The private IPC directory is unavailable")?;
    let metadata =
        std::fs::symlink_metadata(path).map_err(|_| "The private IPC directory is unavailable")?;
    use std::os::windows::fs::MetadataExt;
    if !metadata.is_dir() || metadata.file_attributes() & 0x400 != 0 {
        return Err("The IPC directory cannot be a reparse point".into());
    }
    if !owned_path(path) {
        return Err("The IPC directory must belong to the current user".into());
    }
    let descriptor = security(true)?;
    let path = wide(path.as_os_str());
    if unsafe {
        SetFileSecurityW(
            path.as_ptr(),
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            descriptor.0,
        )
    } == 0
    {
        return Err("The private IPC directory ACL could not be set".into());
    }
    Ok(())
}
pub(crate) fn name(data: &Path, channel: &str) -> Result<String, String> {
    let mut hash = Sha256::new();
    hash.update(sid()?.as_bytes());
    hash.update([0]);
    let path = std::fs::canonicalize(data).unwrap_or_else(|_| data.to_owned());
    hash.update(path.as_os_str().to_string_lossy().as_bytes());
    Ok(format!(
        "\\\\.\\pipe\\agenthud-next-{channel}-{:x}",
        hash.finalize()
    ))
}
fn pipe(name: &str, first: bool) -> Result<NamedPipeServer, String> {
    let descriptor = security(false)?;
    let attributes = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor.0,
        bInheritHandle: 0,
    };
    unsafe {
        ServerOptions::new()
            .first_pipe_instance(first)
            .reject_remote_clients(true)
            .max_instances(64)
            .create_with_security_attributes_raw(
                name,
                (&attributes as *const SECURITY_ATTRIBUTES)
                    .cast_mut()
                    .cast(),
            )
    }
    .map_err(|_| "The local named-pipe endpoint is occupied or unavailable".into())
}
pub(crate) type Handler = Arc<dyn Fn(Value, &AtomicBool) -> Option<Value> + Send + Sync>;
pub(crate) struct Server {
    running: Arc<AtomicBool>,
    stop: watch::Sender<bool>,
    thread: Option<JoinHandle<()>>,
}
impl Server {
    pub fn start(
        data: &Path,
        channel: &str,
        request_limit: usize,
        response_limit: usize,
        handler: Handler,
    ) -> Result<Self, String> {
        private_directory(data)?;
        let name = name(data, channel)?;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .max_blocking_threads(64)
            .build()
            .map_err(|_| "The named-pipe runtime is unavailable")?;
        let initial = {
            let _entered = runtime.enter();
            pipe(&name, true)?
        };
        let running = Arc::new(AtomicBool::new(true));
        let active = running.clone();
        let (stop, mut stopped) = watch::channel(false);
        let thread=std::thread::Builder::new().name(format!("agenthud-{channel}-pipe")).spawn(move||{
            runtime.block_on(async move{
                let mut listener=initial;let mut jobs=tokio::task::JoinSet::new();
                loop{
                    let connected=tokio::select!{_ = stopped.changed()=>break,result=listener.connect()=>result};
                    if connected.is_err()||!active.load(Ordering::Acquire){break;}
                    while jobs.try_join_next().is_some(){}
                    if jobs.len()>=63{
                        let _ = jobs.join_next().await;
                        while jobs.try_join_next().is_some(){}
                    }
                    let next=match pipe(&name,false){Ok(next)=>next,Err(_)=>break};let stream=std::mem::replace(&mut listener,next);
                    jobs.spawn(serve(stream,request_limit,response_limit,handler.clone(),active.clone(),stopped.clone()));
                }
                active.store(false,Ordering::Release);jobs.abort_all();while jobs.join_next().await.is_some(){}
            });runtime.shutdown_timeout(Duration::from_secs(2));
        }).map_err(|_|"The named-pipe worker could not start")?;
        Ok(Self {
            running,
            stop,
            thread: Some(thread),
        })
    }
    pub fn is_listening(&self) -> bool {
        self.running.load(Ordering::Acquire)
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Release);
        let _ = self.stop.send(true);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
struct ConnectionAlive(Arc<AtomicBool>);
impl Drop for ConnectionAlive {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
async fn serve(
    mut stream: NamedPipeServer,
    request_limit: usize,
    response_limit: usize,
    handler: Handler,
    running: Arc<AtomicBool>,
    mut stopped: watch::Receiver<bool>,
) {
    let read = async {
        let mut bytes = Vec::new();
        loop {
            let mut chunk = [0u8; 8192];
            let n = stream.read(&mut chunk).await?;
            if n == 0 {
                return Err(io::Error::from(io::ErrorKind::UnexpectedEof));
            }
            bytes.extend_from_slice(&chunk[..n]);
            if bytes.len() > request_limit {
                return Err(io::Error::from(io::ErrorKind::InvalidData));
            }
            if let Some(at) = bytes.iter().position(|b| *b == b'\n') {
                if at + 1 != bytes.len() {
                    return Err(io::Error::from(io::ErrorKind::InvalidData));
                }
                return Ok(bytes);
            }
        }
    };
    let bytes = tokio::select! {_ = stopped.changed()=>return,read=tokio::time::timeout(Duration::from_secs(2),read)=>match read{Ok(Ok(bytes))=>bytes,_=>return}};
    let Ok(request) = serde_json::from_slice(&bytes) else {
        return;
    };
    let alive = Arc::new(AtomicBool::new(true));
    let _lifetime = ConnectionAlive(alive.clone());
    let callback_alive = alive.clone();
    let callback_running = running.clone();
    let mut result = tokio::task::spawn_blocking(move || {
        if !callback_running.load(Ordering::Acquire) {
            None
        } else {
            handler(request, &callback_alive)
        }
    });
    let mut extra = [0u8; 1];
    let response = tokio::select! {_ = stopped.changed()=>None,_ = stream.read(&mut extra)=>None,response=&mut result=>response.ok().flatten()};
    alive.store(false, Ordering::Release);
    if !running.load(Ordering::Acquire) {
        return;
    }
    if let Some(response) = response {
        if let Ok(mut bytes) = serde_json::to_vec(&response) {
            bytes.push(b'\n');
            if bytes.len() <= response_limit {
                let _ =
                    tokio::time::timeout(Duration::from_secs(5), stream.write_all(&bytes)).await;
            }
        }
    }
}
pub(crate) fn request(
    data: &Path,
    channel: &str,
    message: &Value,
    limit: usize,
    timeout: Duration,
    mut settled: impl FnMut() -> bool,
) -> Result<Option<Value>, String> {
    let mut bytes = serde_json::to_vec(message).map_err(|_| "Invalid local IPC request")?;
    bytes.push(b'\n');
    if bytes.len()
        > if channel == "tools" {
            crate::local_tools::REQUEST_LIMIT as usize
        } else {
            1024 * 1024
        }
    {
        return Err("The local IPC request is too large".into());
    }
    let name = name(data, channel)?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| "The local IPC runtime is unavailable")?;
    runtime.block_on(async {
        let mut stream = ClientOptions::new().open(&name).map_err(|_| {
            "Agent HUD Next is not listening; enable the requested local service in Settings"
        })?;
        tokio::time::timeout(Duration::from_secs(2), stream.write_all(&bytes))
            .await
            .map_err(|_| "The local IPC request timed out")?
            .map_err(|_| "The local IPC request failed")?;
        let deadline = Instant::now() + timeout;
        let mut response = Vec::new();
        loop {
            if settled() || Instant::now() >= deadline {
                return Ok(None);
            }
            let mut chunk = [0; 8192];
            match tokio::time::timeout(Duration::from_millis(100), stream.read(&mut chunk)).await {
                Err(_) => continue,
                Ok(Err(_)) => return Err("The local IPC response failed".into()),
                Ok(Ok(0)) => {
                    return if response.is_empty() {
                        Ok(None)
                    } else {
                        serde_json::from_slice(&response)
                            .map(Some)
                            .map_err(|_| "The local IPC response is invalid".into())
                    }
                }
                Ok(Ok(n)) => {
                    response.extend_from_slice(&chunk[..n]);
                    if response.len() > limit {
                        return Err("The local IPC response is too large".into());
                    }
                    if response.last() == Some(&b'\n') {
                        return serde_json::from_slice(&response)
                            .map(Some)
                            .map_err(|_| "The local IPC response is invalid".into());
                    }
                }
            }
        }
    })
}
