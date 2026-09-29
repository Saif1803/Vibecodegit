//! Test-only helpers: throwaway repos driven by the real `git`.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

pub fn temp_dir() -> PathBuf {
    static N: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!(
        "claudegit-git-{}-{}",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

pub fn write(root: &Path, rel: &str, content: &str) {
    let file = root.join(rel);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(file, content).unwrap();
}

pub fn read(root: &Path, rel: &str) -> String {
    fs::read_to_string(root.join(rel)).unwrap()
}

/// Runs git and panics with stderr on failure.
pub fn sh(cwd: &Path, args: &[&str]) -> String {
    super::git(cwd, args).unwrap_or_else(|e| panic!("git {}: {e}", args.join(" ")))
}

/// Deterministic identity and LF endings whatever the user's global config says.
pub fn configure(dir: &Path) {
    sh(dir, &["config", "user.email", "test@example.com"]);
    sh(dir, &["config", "user.name", "Test"]);
    sh(dir, &["config", "core.autocrlf", "false"]);
    sh(dir, &["config", "commit.gpgsign", "false"]);
}

/// An empty repo on `main` with no commits.
pub fn empty_repo() -> PathBuf {
    let dir = temp_dir();
    sh(&dir, &["init", "-q", "-b", "main"]);
    configure(&dir);
    dir
}

/// A repo with one commit containing `files`.
pub fn make_repo(files: &[(&str, &str)]) -> PathBuf {
    let dir = empty_repo();
    for (rel, content) in files {
        write(&dir, rel, content);
    }
    sh(&dir, &["add", "-A"]);
    sh(&dir, &["commit", "-q", "-m", "init"]);
    dir
}

/// A bare remote seeded with `files`, plus `me` and `teammate` clones tracking origin/main.
pub struct Remote {
    pub remote: PathBuf,
    pub me: PathBuf,
    pub teammate: PathBuf,
}

pub fn with_remote(files: &[(&str, &str)]) -> Remote {
    let seed = make_repo(files);
    let remote = temp_dir().join("remote.git");
    let remote_s = remote.to_string_lossy().into_owned();
    sh(&seed, &["clone", "-q", "--bare", &seed.to_string_lossy(), &remote_s]);
    let clone = || {
        let dir = temp_dir().join("clone");
        // Set at clone time: a global core.autocrlf=true would otherwise make every file look modified.
        sh(&temp_dir(), &["clone", "-q", "-c", "core.autocrlf=false", &remote_s, &dir.to_string_lossy()]);
        configure(&dir);
        dir
    };
    Remote { me: clone(), teammate: clone(), remote }
}

/// Commit subjects on `rev`, newest first.
pub fn log(repo: &Path, rev: &str) -> Vec<String> {
    sh(repo, &["log", "--format=%s", rev]).lines().map(str::to_owned).collect()
}
