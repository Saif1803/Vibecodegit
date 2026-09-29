//! All git access lives here. It runs the system `git` directly, never through a shell:
//! every argument is its own argv item, so messages and paths can't be reinterpreted.
//!
//! The webview can't run git at all; it can only call the named commands in `commands.rs`.

pub mod commit;
pub mod diff;
pub mod ops;
pub mod repo;
pub mod status;
pub mod sync;
#[cfg(test)]
pub mod testutil;

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

/// On every call: unquoted UTF-8 paths, and no color codes in anything we parse.
const GLOBAL_ARGS: [&str; 4] = ["-c", "core.quotepath=off", "-c", "color.ui=false"];

pub type Result<T> = std::result::Result<T, String>;

#[derive(Debug, Clone)]
pub struct Output {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

impl Output {
    pub fn ok(&self) -> bool {
        self.code == Some(0)
    }

    /// The most useful text for a failure: stderr, else stdout, else the exit code.
    pub fn message(&self) -> String {
        let err = self.stderr.trim();
        let out = self.stdout.trim();
        if !err.is_empty() {
            err.to_owned()
        } else if !out.is_empty() {
            out.to_owned()
        } else {
            format!("git failed (exit {})", self.code.map_or("?".into(), |c| c.to_string()))
        }
    }
}

/// Runs `git <args>` in `repo` and returns the result whatever the exit code.
/// Errs only when git can't be started (missing folder, git not installed).
pub fn run(repo: &Path, args: &[&str]) -> Result<Output> {
    run_with_input(repo, args, None)
}

/// Like `run`, with `input` written to git's stdin (used for `--pathspec-from-file=-`).
pub fn run_with_input(repo: &Path, args: &[&str], input: Option<Vec<u8>>) -> Result<Output> {
    let mut cmd = Command::new("git");
    cmd.args(GLOBAL_ARGS)
        .args(args)
        .current_dir(repo)
        // Fail fast instead of hanging on a credential prompt nobody can see.
        // Git Credential Manager's own GUI prompt still works.
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| {
        if !repo.is_dir() {
            format!("Folder not found: {}", repo.display())
        } else if e.kind() == std::io::ErrorKind::NotFound {
            "Git isn't installed or isn't on PATH.".to_owned()
        } else {
            format!("Couldn't run git: {e}")
        }
    })?;

    // Write stdin on its own thread: a large input and a large output would otherwise deadlock.
    let writer = input.and_then(|bytes| {
        let mut stdin = child.stdin.take()?;
        Some(std::thread::spawn(move || {
            let _ = stdin.write_all(&bytes);
        }))
    });
    let out = child.wait_with_output().map_err(|e| format!("git didn't finish: {e}"))?;
    if let Some(w) = writer {
        let _ = w.join();
    }
    Ok(Output {
        code: out.status.code(),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    })
}

/// `run`, but a non-zero exit becomes an error carrying git's message.
pub fn git(repo: &Path, args: &[&str]) -> Result<String> {
    let out = run(repo, args)?;
    if out.ok() {
        Ok(out.stdout)
    } else {
        Err(out.message())
    }
}

/// NUL-separated path list for `--pathspec-from-file=- --pathspec-file-nul`.
/// No command-line length limit, and paths never look like options.
pub fn with_paths(repo: &Path, args: &[&str], paths: &[String]) -> Result<String> {
    let mut input = Vec::new();
    for p in paths {
        input.extend_from_slice(p.as_bytes());
        input.push(0);
    }
    // --literal-pathspecs: a file literally named `*.ts` means that file, not a glob.
    let mut full = vec!["--literal-pathspecs"];
    full.extend_from_slice(args);
    full.extend_from_slice(&["--pathspec-from-file=-", "--pathspec-file-nul"]);
    let out = run_with_input(repo, &full, Some(input))?;
    if out.ok() {
        Ok(out.stdout)
    } else {
        Err(out.message())
    }
}
