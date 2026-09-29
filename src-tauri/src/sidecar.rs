//! Bridges to the persistent Python/sympy sidecar (`sidecar/engine.py`) over
//! stdio. Kept as one long-lived process (not spawned per-request) since
//! sympy's own import cost alone is a couple hundred ms — blocks need to
//! feel live as you type, not per-keystroke laggy.
//!
//! Request/response is a single JSON line each way. `io` guards the whole
//! write-then-read round trip under one lock (not separate locks for stdin
//! and stdout) so concurrent calls from the frontend can't interleave and
//! read back someone else's response.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

pub struct SidecarIo {
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

pub struct SidecarState {
    io: Mutex<SidecarIo>,
    _child: Mutex<Child>,
    next_id: AtomicU64,
}

impl SidecarState {
    pub fn spawn() -> Self {
        // Dev-mode path resolution: the sidecar's own venv, next to this
        // crate. Production packaging will need this bundled as a real
        // Tauri sidecar binary instead of a path relative to the source tree.
        let python = concat!(env!("CARGO_MANIFEST_DIR"), "/../sidecar/.venv/bin/python");
        let script = concat!(env!("CARGO_MANIFEST_DIR"), "/../sidecar/engine.py");

        let mut child = Command::new(python)
            .arg(script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("failed to start math sidecar (python engine.py)");

        let stdin = child.stdin.take().expect("sidecar stdin");
        let stdout = BufReader::new(child.stdout.take().expect("sidecar stdout"));

        Self {
            io: Mutex::new(SidecarIo { stdin, stdout }),
            _child: Mutex::new(child),
            next_id: AtomicU64::new(1),
        }
    }

    /// Forwards the frontend's request object as-is (plus an id) — each op
    /// takes its own options (solve-for variable, factoring method, table
    /// range, ...), and Rust has no reason to know their shapes.
    pub fn request(&self, mut request: serde_json::Value) -> Result<serde_json::Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let object = request.as_object_mut().ok_or("math request must be a JSON object")?;
        object.insert("id".into(), id.into());
        let line = serde_json::to_string(&request).map_err(|e| e.to_string())? + "\n";

        let mut io = self.io.lock().map_err(|e| e.to_string())?;
        io.stdin.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        io.stdin.flush().map_err(|e| e.to_string())?;

        let mut response_line = String::new();
        io.stdout
            .read_line(&mut response_line)
            .map_err(|e| e.to_string())?;
        drop(io);

        if response_line.is_empty() {
            return Err("math sidecar closed its output (crashed?)".to_string());
        }
        let response: serde_json::Value =
            serde_json::from_str(&response_line).map_err(|e| format!("{e}: {response_line}"))?;

        if response.get("ok").and_then(|v| v.as_bool()) == Some(false) {
            let message = response
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("sidecar error")
                .to_string();
            return Err(message);
        }
        Ok(response)
    }
}

#[tauri::command]
pub fn math_eval(state: tauri::State<SidecarState>, request: serde_json::Value) -> Result<serde_json::Value, String> {
    state.request(request)
}
