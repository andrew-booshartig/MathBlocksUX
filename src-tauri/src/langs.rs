//! Code cells in any language — run the way a language plugin's manifest
//! says (`src/notebook/languages.ts`, or a plugin's `plugin.json`):
//!
//! - `once`: the cell written to a file of its own (`{file}` in its folder
//!   `{dir}`) and a command run on it — compile and run, for C++ or Rust.
//!   Each run starts fresh.
//! - `session`: one program kept running per notebook and language (Octave,
//!   node, a shell), each cell sent to it followed by a line that prints a
//!   marker, and what it prints read up to that marker — so what one cell
//!   makes, the next can use, as in Python's kernel.
//!
//! What a cell prints so far is kept for `lang_output` (shown while it runs).
//! The commands come from manifests the user installed, as VS Code's tasks
//! do — run as the user, nothing more.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::State;

#[derive(Serialize)]
pub struct Ran {
    stdout: String,
    error: Option<String>,
    seconds: f64,
    /// pictures it drew (PNG, base64): a line `__matrixlab_image__:<path>` in what it printed
    images: Vec<String>,
}

const IMAGE: &str = "__matrixlab_image__:";

impl Ran {
    /// the pictures it said it drew, read in, their lines taken out of the printout
    fn with_images(mut self) -> Self {
        if !self.stdout.contains(IMAGE) {
            return self;
        }
        let mut kept = String::new();
        for line in self.stdout.split_inclusive('\n') {
            match line.trim_end().strip_prefix(IMAGE) {
                Some(path) => {
                    if let Ok(bytes) = std::fs::read(path.trim()) {
                        self.images.push(base64(&bytes));
                        let _ = std::fs::remove_file(path.trim());
                    }
                }
                None => kept.push_str(line),
            }
        }
        self.stdout = kept;
        self
    }
}

fn base64(bytes: &[u8]) -> String {
    const ABC: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
        for k in 0..4 {
            out.push(if k <= chunk.len() { ABC[(n >> (18 - 6 * k) & 63) as usize] as char } else { '=' });
        }
    }
    out
}

struct SessionIo {
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

pub struct Session {
    pid: u32,
    io: Mutex<SessionIo>,
    live: Mutex<String>,
    child: Mutex<Child>,
}

impl Drop for Session {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// A run-once cell going: what it's printed, and its process (to stop it).
#[derive(Default)]
struct OnceRun {
    live: Mutex<String>,
    pid: Mutex<Option<u32>>,
}

#[derive(Default)]
pub struct Sessions {
    running: Mutex<HashMap<String, Arc<Session>>>,
    once: Mutex<HashMap<String, Arc<OnceRun>>>,
}

const MAX_TEXT: usize = 200_000;

/// Where programs are looked for: the PATH, and the usual places a Mac
/// keeps them (an app opened from Finder gets a bare PATH).
fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
        dirs.push(PathBuf::from(d));
    }
    dirs.push(home.join(".cargo/bin"));
    // MATLAB keeps itself in /Applications/MATLAB_R20xx.app/bin
    if let Ok(apps) = std::fs::read_dir("/Applications") {
        for app in apps.flatten() {
            if app.file_name().to_string_lossy().starts_with("MATLAB") {
                dirs.push(app.path().join("bin"));
            }
        }
    }
    dirs
}

fn which(program: &str) -> Option<PathBuf> {
    if program.contains('/') {
        let p = PathBuf::from(program);
        return p.is_file().then_some(p);
    }
    search_dirs().into_iter().map(|d| d.join(program)).find(|p| p.is_file())
}

/// The PATH a cell's command runs with: the usual places, so `clang++`,
/// `octave`, `node` are found however the app was opened.
fn path_var() -> String {
    std::env::join_paths(search_dirs()).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Which of these programs are installed (each name → its path, or nothing).
#[tauri::command]
pub fn lang_which(programs: Vec<String>) -> HashMap<String, Option<String>> {
    programs.into_iter().map(|p| { let at = which(&p).map(|x| x.to_string_lossy().into_owned()); (p, at) }).collect()
}

/// Stop a run and everything it started (its process group).
fn stop_group(pid: u32) {
    let _ = Command::new("kill").arg("-KILL").arg(format!("-{pid}")).status();
}

fn fill(arg: &str, file: &str, dir: &str, marker: &str) -> String {
    arg.replace("{file}", file).replace("{dir}", dir).replace("{marker}", marker)
}

fn cell_dir() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join(format!("matrixlab-cells-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Run a cell once: written to `cell.<extension>`, the command run on it
/// (stopped after `timeout` seconds).
fn run_once(command: &[String], extension: &str, code: &str, timeout: u64, run: &OnceRun) -> Result<Ran, String> {
    let dir = cell_dir()?;
    let file = dir.join(format!("cell.{extension}"));
    std::fs::write(&file, code).map_err(|e| e.to_string())?;
    let (f, d) = (file.to_string_lossy().into_owned(), dir.to_string_lossy().into_owned());
    let args: Vec<String> = command.iter().map(|a| fill(a, &f, &d, "")).collect();
    let program = args.first().ok_or("the language says no command to run")?;
    let started = Instant::now();
    let mut child = Command::new(program)
        .args(&args[1..])
        .current_dir(&dir)
        .env("PATH", path_var())
        // its own process group, so stopping it stops what it started too (a compiler, the program)
        .process_group(0)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("couldn't start {program}: {e}"))?;
    if let Ok(mut pid) = run.pid.lock() {
        *pid = Some(child.id());
    }
    // read both as they come (a full pipe would stall the program)
    let mut out = child.stdout.take().ok_or("no stdout")?;
    let mut err = child.stderr.take().ok_or("no stderr")?;
    let errs = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = err.read_to_string(&mut s);
        s
    });
    let printed = Arc::new(Mutex::new(String::new()));
    let sink = printed.clone();
    let outs = std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while let Ok(n) = out.read(&mut buf) {
            if n == 0 {
                break;
            }
            if let Ok(mut s) = sink.lock() {
                if s.len() < MAX_TEXT {
                    s.push_str(&String::from_utf8_lossy(&buf[..n]));
                }
            }
        }
    });
    let mut stopped = false;
    loop {
        if let (Ok(mut l), Ok(p)) = (run.live.lock(), printed.lock()) {
            l.clone_from(&p);
        }
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() > Duration::from_secs(timeout) => {
                stop_group(child.id());
                stopped = true;
                break;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(30)),
            Err(e) => return Err(e.to_string()),
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    if let Ok(mut pid) = run.pid.lock() {
        *pid = None;
    }
    let _ = outs.join();
    let stderr = errs.join().unwrap_or_default();
    let stdout = printed.lock().map(|s| s.clone()).unwrap_or_default();
    let error = if stopped {
        Some(format!("Stopped after {timeout} s."))
    } else if !status.success() {
        Some(if stderr.trim().is_empty() { format!("it stopped with code {}", status.code().unwrap_or(-1)) } else { stderr.trim_end().to_string() })
    } else {
        None
    };
    // warnings on a run that worked: shown with what it printed
    let stdout = if error.is_none() && !stderr.trim().is_empty() { format!("{stdout}{stderr}") } else { stdout };
    Ok(Ran { stdout, error, seconds: started.elapsed().as_secs_f64(), images: vec![] }.with_images())
}

impl Session {
    fn spawn(command: &[String], init: &[String]) -> Result<Self, String> {
        let program = command.first().ok_or("the language says no command to run")?;
        // stderr folded into stdout, so errors come in order with what was printed
        let line = command.iter().map(|a| format!("'{}'", a.replace('\'', "'\\''"))).collect::<Vec<_>>().join(" ");
        let mut child = Command::new("/bin/sh")
            .arg("-c")
            .arg(format!("exec {line} 2>&1"))
            .current_dir(cell_dir()?)
            .env("PATH", path_var())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("couldn't start {program}: {e}"))?;
        let mut stdin = child.stdin.take().ok_or("no stdin")?;
        for l in init {
            writeln!(stdin, "{l}").map_err(|e| e.to_string())?;
        }
        let stdout = BufReader::new(child.stdout.take().ok_or("no stdout")?);
        Ok(Self { pid: child.id(), io: Mutex::new(SessionIo { stdin, stdout }), live: Mutex::new(String::new()), child: Mutex::new(child) })
    }

    /// The cell, then the line that prints the marker; what comes back up to it.
    fn run(&self, code: &str, done: &str) -> Result<Ran, String> {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let marker = format!("__matrixlab_done_{nanos:x}__");
        let started = Instant::now();
        let mut io = self.io.lock().map_err(|_| "the session is stuck")?;
        if let Ok(mut l) = self.live.lock() {
            l.clear();
        }
        writeln!(io.stdin, "{code}").map_err(|e| e.to_string())?;
        writeln!(io.stdin, "{}", fill(done, "", "", &marker)).map_err(|e| e.to_string())?;
        io.stdin.flush().map_err(|e| e.to_string())?;
        let mut printed = String::new();
        loop {
            let mut line = String::new();
            let read = io.stdout.read_line(&mut line).map_err(|e| e.to_string())?;
            if read == 0 {
                return Ok(Ran { stdout: printed, error: Some("it stopped (it starts again on the next run)".into()), seconds: started.elapsed().as_secs_f64(), images: vec![] });
            }
            if line.contains(&marker) {
                // whatever came before the marker on its line was printed too
                let before = &line[..line.find(&marker).unwrap_or(0)];
                printed.push_str(before);
                break;
            }
            if printed.len() < MAX_TEXT {
                printed.push_str(&line);
            }
            if let Ok(mut l) = self.live.lock() {
                l.clone_from(&printed);
            }
        }
        Ok(Ran { stdout: printed, error: None, seconds: started.elapsed().as_secs_f64(), images: vec![] }.with_images())
    }
}

#[derive(serde::Deserialize)]
pub struct RunSpec {
    /// run once: compile and run the cell's file
    once: Option<Vec<String>>,
    /// a program kept running: its command, lines sent first, the line that prints `{marker}`
    session: Option<Vec<String>>,
    init: Option<Vec<String>>,
    done: Option<String>,
    extension: Option<String>,
    timeout: Option<u64>,
}

fn key(notebook: &str, lang: &str) -> String {
    format!("{notebook}\u{1f}{lang}")
}

/// Run a cell in its language (as its manifest's `run` says), off the main thread.
#[tauri::command]
pub async fn lang_run(sessions: State<'_, Sessions>, notebook: String, lang: String, spec: RunSpec, code: String) -> Result<Ran, String> {
    if let Some(command) = spec.session.clone() {
        let k = key(&notebook, &lang);
        let session = {
            let mut all = sessions.running.lock().map_err(|_| "the sessions are stuck")?;
            match all.get(&k) {
                Some(s) => s.clone(),
                None => {
                    let s = Arc::new(Session::spawn(&command, &spec.init.clone().unwrap_or_default())?);
                    all.insert(k.clone(), s.clone());
                    s
                }
            }
        };
        let done = spec.done.clone().ok_or("a session language needs a `done` line that prints {marker}")?;
        let ran = tauri::async_runtime::spawn_blocking(move || session.run(&code, &done)).await.map_err(|e| e.to_string())??;
        if ran.error.is_some() {
            if let Ok(mut all) = sessions.running.lock() {
                all.remove(&k);
            }
        }
        return Ok(ran);
    }
    let command = spec.once.ok_or("the language says neither `once` nor `session`")?;
    let extension = spec.extension.unwrap_or_else(|| "txt".into());
    let timeout = spec.timeout.unwrap_or(60);
    let run = {
        let mut all = sessions.once.lock().map_err(|_| "the runs are stuck")?;
        all.entry(key(&notebook, &lang)).or_default().clone()
    };
    tauri::async_runtime::spawn_blocking(move || run_once(&command, &extension, &code, timeout, &run)).await.map_err(|e| e.to_string())?
}

/// What the cell running has printed so far.
#[tauri::command]
pub fn lang_output(sessions: State<'_, Sessions>, notebook: String, lang: String) -> String {
    let k = key(&notebook, &lang);
    if let Some(s) = sessions.running.lock().ok().and_then(|all| all.get(&k).cloned()) {
        return s.live.lock().map(|l| l.clone()).unwrap_or_default();
    }
    sessions.once.lock().ok().and_then(|all| all.get(&k).cloned()).and_then(|r| r.live.lock().ok().map(|l| l.clone())).unwrap_or_default()
}

/// Stop the cell running (an interrupt); a session's variables stay.
#[tauri::command]
pub fn lang_stop(sessions: State<'_, Sessions>, notebook: String, lang: String) {
    let k = key(&notebook, &lang);
    if let Some(s) = sessions.running.lock().ok().and_then(|all| all.get(&k).cloned()) {
        // the shell's child is the language itself
        let _ = Command::new("pkill").arg("-INT").arg("-P").arg(s.pid.to_string()).status();
        let _ = Command::new("kill").arg("-INT").arg(s.pid.to_string()).status();
    }
    if let Some(pid) = sessions.once.lock().ok().and_then(|all| all.get(&k).cloned()).and_then(|r| r.pid.lock().ok().and_then(|p| *p)) {
        stop_group(pid);
    }
}

/// A fresh start: the session ends, its variables with it.
#[tauri::command]
pub fn lang_restart(sessions: State<'_, Sessions>, notebook: String, lang: String) {
    if let Ok(mut all) = sessions.running.lock() {
        all.remove(&key(&notebook, &lang));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_cell_compiled_and_run_once() {
        let run = OnceRun::default();
        let cmd = strings(&["sh", "-c", "clang++ -std=c++17 -w {file} -o {dir}/cell && {dir}/cell"]);
        let ran = run_once(&cmd, "cpp", "#include <iostream>\nint main(){ std::cout << 6 * 7 << \"\\n\"; }", 60, &run).unwrap();
        assert_eq!(ran.stdout, "42\n");
        assert!(ran.error.is_none());
        let bad = run_once(&cmd, "cpp", "int main(){ return nope; }", 60, &run).unwrap();
        assert!(bad.error.unwrap().contains("nope"));
    }

    #[test]
    fn a_session_keeps_what_one_cell_made_for_the_next() {
        let s = Session::spawn(&strings(&["sh"]), &[]).unwrap();
        let a = s.run("x=41", "echo {marker}").unwrap();
        assert_eq!(a.stdout, "");
        let b = s.run("echo $((x + 1)); echo oops >&2", "echo {marker}").unwrap();
        assert_eq!(b.stdout, "42\noops\n");
    }

    #[test]
    fn base64_as_everyone_writes_it() {
        assert_eq!(base64(b"Man"), "TWFu");
        assert_eq!(base64(b"Ma"), "TWE=");
        assert_eq!(base64(b"M"), "TQ==");
    }

    #[test]
    fn a_picture_it_drew_comes_back_as_an_image() {
        let dir = cell_dir().unwrap();
        let png = dir.join("drawn.png");
        std::fs::write(&png, b"PNG!").unwrap();
        let ran = Ran { stdout: format!("before\n{IMAGE}{}\nafter\n", png.display()), error: None, seconds: 0.0, images: vec![] }.with_images();
        assert_eq!(ran.stdout, "before\nafter\n");
        assert_eq!(ran.images, vec![base64(b"PNG!")]);
    }

    #[test]
    fn a_run_that_takes_too_long_is_stopped() {
        let run = OnceRun::default();
        let ran = run_once(&strings(&["sh", "{file}"]), "sh", "sleep 5", 1, &run).unwrap();
        assert_eq!(ran.error.as_deref(), Some("Stopped after 1 s."));
    }
}
