//! The notebook's kernels: one long-lived Python (`sidecar/kernel.py`) per
//! open notebook, so what one cell makes the next can use — the way a
//! Jupyter kernel works. Each runs apart from the math engine, so a cell
//! that takes a minute never holds up the calculator, and a run is waited
//! on off the main thread, so the window stays live while it runs.
//!
//! One JSON line each way, the round trip under one lock — except that a
//! cell running sends what it prints as it goes ({"stream": …} lines before
//! its answer), kept for `kernel_output` to show while it runs. Stop sends the
//! kernel an interrupt (what Ctrl-C does); Restart ends it, and the next
//! run starts a fresh one.

use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::State;

struct KernelIo {
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

pub struct Kernel {
    pid: u32,
    io: Mutex<KernelIo>,
    /// what the cell running has printed so far
    live: Mutex<String>,
    child: Mutex<Child>,
}

#[derive(Default)]
pub struct Kernels(Mutex<HashMap<String, Arc<Kernel>>>);

impl Kernel {
    fn spawn() -> Result<Self, String> {
        let python = concat!(env!("CARGO_MANIFEST_DIR"), "/../sidecar/.venv/bin/python");
        let script = concat!(env!("CARGO_MANIFEST_DIR"), "/../sidecar/kernel.py");
        let mut child = Command::new(python)
            .arg(script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("couldn't start Python for the notebook: {e}"))?;
        let stdin = child.stdin.take().ok_or("no kernel stdin")?;
        let stdout = BufReader::new(child.stdout.take().ok_or("no kernel stdout")?);
        Ok(Self { pid: child.id(), io: Mutex::new(KernelIo { stdin, stdout }), live: Mutex::new(String::new()), child: Mutex::new(child) })
    }

    fn ask(&self, request: &Value) -> Result<Value, String> {
        let mut io = self.io.lock().map_err(|_| "the kernel is stuck")?;
        writeln!(io.stdin, "{request}").map_err(|e| e.to_string())?;
        io.stdin.flush().map_err(|e| e.to_string())?;
        if let Ok(mut live) = self.live.lock() {
            live.clear();
        }
        loop {
            let mut line = String::new();
            let read = io.stdout.read_line(&mut line).map_err(|e| e.to_string())?;
            if read == 0 {
                return Err("the kernel stopped (it starts again on the next run)".into());
            }
            let reply: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
            // printed so far, while the cell runs: kept to show, and on to the next line
            if let Some(text) = reply.get("stream").and_then(Value::as_str) {
                if let Ok(mut live) = self.live.lock() {
                    live.push_str(text);
                }
                continue;
            }
            return Ok(reply);
        }
    }
}

impl Drop for Kernel {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Kernels {
    fn get(&self, notebook: &str) -> Result<Arc<Kernel>, String> {
        let mut all = self.0.lock().map_err(|_| "the kernels are stuck")?;
        if let Some(k) = all.get(notebook) {
            return Ok(k.clone());
        }
        let k = Arc::new(Kernel::spawn()?);
        all.insert(notebook.to_string(), k.clone());
        Ok(k)
    }

    fn forget(&self, notebook: &str) {
        if let Ok(mut all) = self.0.lock() {
            all.remove(notebook);
        }
    }
}

/// Ask a notebook's kernel something (starting it first when it isn't
/// running), waited on off the main thread.
async fn ask(kernels: &Kernels, notebook: String, request: Value) -> Result<Value, String> {
    let kernel = kernels.get(&notebook)?;
    let reply = tauri::async_runtime::spawn_blocking(move || kernel.ask(&request)).await.map_err(|e| e.to_string())?;
    if reply.is_err() {
        kernels.forget(&notebook);
    }
    reply
}

/// Run a cell — the calculator's variables (numbers) come along, as `calc`,
/// and the notebook's variables blocks', as names of their own.
#[tauri::command]
pub async fn kernel_run(kernels: State<'_, Kernels>, notebook: String, code: String, calc: Option<Value>, vars: Option<Value>) -> Result<Value, String> {
    ask(&kernels, notebook, serde_json::json!({ "op": "run", "code": code, "calc": calc, "vars": vars })).await
}

/// What could finish the word the code (up to the cursor) ends with.
#[tauri::command]
pub async fn kernel_complete(kernels: State<'_, Kernels>, notebook: String, code: String) -> Result<Value, String> {
    ask(&kernels, notebook, serde_json::json!({ "op": "complete", "code": code })).await
}

/// What the cell running has printed so far (empty when none is running).
#[tauri::command]
pub fn kernel_output(kernels: State<'_, Kernels>, notebook: String) -> Result<String, String> {
    let kernel = kernels.0.lock().map_err(|_| "the kernels are stuck")?.get(&notebook).cloned();
    Ok(kernel.and_then(|k| k.live.lock().ok().map(|s| s.clone())).unwrap_or_default())
}

#[tauri::command]
pub async fn kernel_vars(kernels: State<'_, Kernels>, notebook: String) -> Result<Value, String> {
    ask(&kernels, notebook, serde_json::json!({ "op": "vars" })).await
}

#[tauri::command]
pub async fn kernel_names(kernels: State<'_, Kernels>, notebook: String, codes: Vec<String>) -> Result<Value, String> {
    ask(&kernels, notebook, serde_json::json!({ "op": "names", "codes": codes })).await
}

/// Stop the cell running (an interrupt, as Ctrl-C sends) — the kernel and its variables stay.
#[tauri::command]
pub fn kernel_interrupt(kernels: State<'_, Kernels>, notebook: String) -> Result<(), String> {
    let pid = kernels.0.lock().map_err(|_| "the kernels are stuck")?.get(&notebook).map(|k| k.pid);
    if let Some(pid) = pid {
        Command::new("kill").arg("-INT").arg(pid.to_string()).status().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// A fresh start: the kernel ends (its variables with it); the next run starts a new one.
#[tauri::command]
pub fn kernel_restart(kernels: State<'_, Kernels>, notebook: String) -> Result<(), String> {
    let gone = kernels.0.lock().map_err(|_| "the kernels are stuck")?.remove(&notebook);
    if let Some(kernel) = gone {
        // a run still waiting on it holds it too: stop that run so it lets go
        let _ = Command::new("kill").arg("-INT").arg(kernel.pid.to_string()).status();
        if let Ok(mut child) = kernel.child.lock() {
            let _ = child.kill();
        }
    }
    Ok(())
}
