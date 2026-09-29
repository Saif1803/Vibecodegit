//! A pre-commit look for secrets in what's about to be committed: file names that are
//! usually private (`.env`, keys) and added lines that look like keys or tokens.
//! It only warns (the UI offers "Commit anyway"); it never blocks. Hand-written matchers,
//! so there's no regex dependency.

use std::path::Path;

use serde::Serialize;

use super::history::empty_tree;
use super::{git, run, Result};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SecretFinding {
    pub path: String,
    /// Line in the new file, for a line match; None for a file-name match.
    pub line: Option<u32>,
    /// What it looks like ("AWS access key", "Environment file", …).
    pub what: String,
    /// The start of the match, the rest masked.
    pub preview: String,
}

const MAX_FINDINGS: usize = 30;
const MAX_LINES: usize = 50_000;
/// Untracked files bigger than this aren't read (smart commit case).
const MAX_FILE: u64 = 1024 * 1024;

/// A name that usually holds secrets. Examples and templates are fine.
pub fn secret_file(path: &str) -> Option<&'static str> {
    let name = path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase();
    let template = ["example", "sample", "template", "dist", "defaults"].iter().any(|t| name.ends_with(t));
    if (name == ".env" || name.starts_with(".env.")) && !template {
        return Some("Environment file");
    }
    if ["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"].iter().any(|k| name.starts_with(k)) && !name.ends_with(".pub") {
        return Some("SSH private key");
    }
    if [".pem", ".key", ".p12", ".pfx", ".jks", ".keystore"].iter().any(|e| name.ends_with(e)) {
        return Some("Key or certificate file");
    }
    if ["credentials.json", ".netrc", "_netrc", ".pypirc", ".git-credentials"].contains(&name.as_str()) {
        return Some("Credentials file");
    }
    None
}

fn mask(s: &str) -> String {
    let head: String = s.chars().take(6).collect();
    format!("{head}… ({} chars)", s.chars().count())
}

/// `prefix` followed by at least `min` chars accepted by `ok`, not glued to a word before it.
fn token<'a>(line: &'a str, prefix: &str, ok: fn(u8) -> bool, min: usize) -> Option<&'a str> {
    for (i, _) in line.match_indices(prefix) {
        if i > 0 && line.as_bytes()[i - 1].is_ascii_alphanumeric() {
            continue;
        }
        let rest = &line.as_bytes()[i + prefix.len()..];
        let n = rest.iter().take_while(|&&b| ok(b)).count();
        if n >= min {
            return Some(&line[i..i + prefix.len() + n]);
        }
    }
    None
}

const ALNUM: fn(u8) -> bool = |b| b.is_ascii_alphanumeric();
const UPPER_NUM: fn(u8) -> bool = |b| b.is_ascii_uppercase() || b.is_ascii_digit();
const WORDISH: fn(u8) -> bool = |b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-';

/// (what it is, prefix, allowed chars after it, minimum count)
type TokenRule = (&'static str, &'static str, fn(u8) -> bool, usize);

const TOKENS: &[TokenRule] = &[
    ("AWS access key", "AKIA", UPPER_NUM, 16),
    ("AWS access key", "ASIA", UPPER_NUM, 16),
    ("GitHub token", "ghp_", ALNUM, 36),
    ("GitHub token", "gho_", ALNUM, 36),
    ("GitHub token", "ghu_", ALNUM, 36),
    ("GitHub token", "ghs_", ALNUM, 36),
    ("GitHub token", "ghr_", ALNUM, 36),
    ("GitHub token", "github_pat_", WORDISH, 22),
    ("Slack token", "xoxb-", WORDISH, 10),
    ("Slack token", "xoxp-", WORDISH, 10),
    ("Slack token", "xoxa-", WORDISH, 10),
    ("Stripe live key", "sk_live_", ALNUM, 16),
    ("Stripe live key", "rk_live_", ALNUM, 16),
    ("Google API key", "AIza", WORDISH, 35),
    ("Anthropic API key", "sk-ant-", WORDISH, 20),
    ("OpenAI API key", "sk-proj-", WORDISH, 20),
    ("OpenAI API key", "sk-", ALNUM, 32),
];

const SECRET_KEYS: &[&str] = &["password", "passwd", "secret", "api_key", "apikey", "api-key", "access_token", "auth_token", "private_key"];
const PLACEHOLDERS: &[&str] = &[
    "xxx", "your", "example", "changeme", "change_me", "placeholder", "dummy", "sample", "redacted", "<", "${", "{{", "process.env", "os.environ",
    "getenv", "env(", "***",
];

/// `password = "…"`, `apiKey: '…'`: a secret-sounding name assigned a quoted literal.
fn assigned_secret(line: &str) -> Option<&str> {
    let lower = line.to_ascii_lowercase();
    for key in SECRET_KEYS {
        for (i, _) in lower.match_indices(key) {
            let b = lower.as_bytes();
            // The rest of the identifier (secret_key, passwordHash…), a closing quote, then := or :.
            let mut j = i + key.len();
            while j < b.len() && (b[j].is_ascii_alphanumeric() || b[j] == b'_') {
                j += 1;
            }
            while j < b.len() && matches!(b[j], b'"' | b'\'' | b' ' | b'\t') {
                j += 1;
            }
            if j >= b.len() || !matches!(b[j], b'=' | b':') {
                continue;
            }
            j += 1;
            while j < b.len() && matches!(b[j], b'=' | b' ' | b'\t') {
                j += 1;
            }
            let Some(&quote) = b.get(j) else { continue };
            if !matches!(quote, b'"' | b'\'' | b'`') {
                continue;
            }
            let start = j + 1;
            let Some(len) = b[start..].iter().position(|&c| c == quote) else { continue };
            let value = &line[start..start + len];
            let lv = value.to_ascii_lowercase();
            let repeated = value.chars().all(|c| value.starts_with(c));
            if value.len() >= 8 && !repeated && !PLACEHOLDERS.iter().any(|p| lv.contains(p)) {
                return Some(value);
            }
        }
    }
    None
}

/// What an added line looks like it leaks, with a masked preview.
pub fn scan_line(line: &str) -> Option<(&'static str, String)> {
    if line.contains("-----BEGIN ") && line.contains("PRIVATE KEY") {
        return Some(("Private key", "-----BEGIN … PRIVATE KEY-----".into()));
    }
    for &(what, prefix, ok, min) in TOKENS {
        if let Some(t) = token(line, prefix, ok, min) {
            return Some((what, mask(t)));
        }
    }
    assigned_secret(line).map(|v| ("Hard-coded password or secret", mask(v)))
}

/// Unified `-U0` diff → added lines with their new line numbers, checked one by one.
fn scan_diff(diff: &str, findings: &mut Vec<SecretFinding>) {
    let (mut path, mut line_no, mut scanned) = (String::new(), 0u32, 0usize);
    for line in diff.split('\n') {
        if let Some(p) = line.strip_prefix("+++ ") {
            path = p.trim_matches('"').strip_prefix("b/").unwrap_or("").to_owned();
        } else if let Some(h) = line.strip_prefix("@@ ") {
            // "@@ -a,b +c,d @@" → c
            line_no = h.split(' ').nth(1).and_then(|n| n.trim_start_matches('+').split(',').next()?.parse().ok()).unwrap_or(0);
        } else if let Some(added) = line.strip_prefix('+') {
            scanned += 1;
            if scanned > MAX_LINES || findings.len() >= MAX_FINDINGS {
                return;
            }
            if let Some((what, preview)) = scan_line(added) {
                if !path.is_empty() && !findings.iter().any(|f| f.path == path && f.what == what) {
                    findings.push(SecretFinding { path: path.clone(), line: Some(line_no), what: what.into(), preview });
                }
            }
            line_no += 1;
        }
    }
}

/// Secrets in the next commit: the staged changes, or with `stage_all` (smart commit)
/// every tracked change plus untracked files.
pub fn check_secrets(repo: &Path, stage_all: bool) -> Result<Vec<SecretFinding>> {
    let head = run(repo, &["rev-parse", "-q", "--verify", "HEAD"])?;
    let base = if head.ok() { head.stdout.trim().to_owned() } else { empty_tree(repo)? };
    let mut args = vec!["diff", "--no-ext-diff", "--no-textconv", "-U0"];
    let mut names = vec!["diff", "--name-only", "-z", "--diff-filter=AMR"];
    if stage_all {
        args.push(&base);
        names.push(&base);
    } else {
        args.push("--cached");
        names.push("--cached");
    }
    args.push("--");
    names.push("--");

    let mut findings = Vec::new();
    let mut files: Vec<String> = git(repo, &names)?.split('\0').filter(|p| !p.is_empty()).map(str::to_owned).collect();
    let untracked: Vec<String> = if stage_all {
        git(repo, &["ls-files", "--others", "--exclude-standard", "-z"])?.split('\0').filter(|p| !p.is_empty()).map(str::to_owned).collect()
    } else {
        Vec::new()
    };
    files.extend(untracked.iter().cloned());
    for f in &files {
        if let Some(what) = secret_file(f) {
            findings.push(SecretFinding { path: f.clone(), line: None, what: what.into(), preview: String::new() });
        }
    }

    scan_diff(&git(repo, &args)?, &mut findings);
    for path in &untracked {
        let full = repo.join(path);
        if std::fs::metadata(&full).map_or(true, |m| m.len() > MAX_FILE) {
            continue;
        }
        let Ok(bytes) = std::fs::read(&full) else { continue };
        if bytes.contains(&0) {
            continue; // binary
        }
        let text = String::from_utf8_lossy(&bytes);
        let as_diff: String = text.lines().map(|l| format!("+{l}\n")).collect();
        scan_diff(&format!("+++ b/{path}\n@@ -0,0 +1 @@\n{as_diff}"), &mut findings);
    }
    findings.truncate(MAX_FINDINGS);
    Ok(findings)
}

#[cfg(test)]
mod tests {
    use super::super::testutil::*;
    use super::*;

    #[test]
    fn names_that_usually_hold_secrets() {
        for p in [".env", "app/.env.local", "certs/server.key", "id_rsa", "deploy/id_ed25519", "creds/credentials.json", "tls.pem"] {
            assert!(secret_file(p).is_some(), "{p}");
        }
        for p in [".env.example", ".env.sample", "id_rsa.pub", "src/env.ts", "keyboard.ts", "README.md"] {
            assert!(secret_file(p).is_none(), "{p}");
        }
    }

    #[test]
    fn token_shapes() {
        let hit = |l: &str| scan_line(l).map(|(w, _)| w);
        assert_eq!(hit("aws_access_key_id = AKIAIOSFODNN7EXAMPLE"), Some("AWS access key"));
        assert_eq!(hit(&format!("token: ghp_{}", "a".repeat(36))), Some("GitHub token"));
        assert_eq!(hit(&format!("SLACK=xoxb-{}", "1234567890-abc")), Some("Slack token"));
        assert_eq!(hit(&format!("key = \"sk_live_{}\"", "Z".repeat(24))), Some("Stripe live key"));
        assert_eq!(hit(&format!("AIza{}", "B".repeat(35))), Some("Google API key"));
        assert_eq!(hit(&format!("ANTHROPIC_API_KEY=sk-ant-api03-{}", "x_Y-".repeat(10))), Some("Anthropic API key"));
        assert_eq!(hit(&format!("OPENAI_API_KEY=sk-{}", "Ab1".repeat(16))), Some("OpenAI API key"));
        assert_eq!(hit("-----BEGIN OPENSSH PRIVATE KEY-----"), Some("Private key"));
        // Not glued to a word, and long enough.
        assert_eq!(hit("const STACKIA = 1; // AKIA123"), None);
        assert_eq!(hit("task-ant-1"), None);
    }

    #[test]
    fn assigned_secrets_but_not_placeholders_or_types() {
        let hit = |l: &str| scan_line(l).map(|(w, _)| w);
        assert_eq!(hit(r#"const password = "hunter2hunter2";"#), Some("Hard-coded password or secret"));
        assert_eq!(hit(r#"  "client_secret": "9f8e7d6c5b4a3921","#), Some("Hard-coded password or secret"));
        assert_eq!(hit("DB_PASSWORD='s3cr3t-pa55'"), Some("Hard-coded password or secret"));
        for l in [
            "password: string;",
            r#"password = "changeme""#,
            r#"apiKey: process.env.API_KEY"#,
            r#"secret = "${SECRET}""#,
            r#"password = "short""#,
            r#"api_key = "your-api-key-here""#,
        ] {
            assert_eq!(hit(l), None, "{l}");
        }
        assert!(scan_line("AKIAIOSFODNN7EXAMPLE").unwrap().1.starts_with("AKIAIO…"));
    }

    #[test]
    fn checks_the_staged_changes_or_everything_for_smart_commit() {
        let repo = make_repo(&[("config.ts", "export const region = \"eu\";\n")]);
        write(&repo, "config.ts", "export const region = \"eu\";\nexport const key = \"AKIAIOSFODNN7EXAMPLE\";\n");
        write(&repo, ".env", "DB_PASSWORD=hunter2hunter2\n");
        write(&repo, ".env.example", "DB_PASSWORD=\n");

        // Nothing staged yet: the staged check is clean, the smart-commit check sees everything.
        assert!(check_secrets(&repo, false).unwrap().is_empty());
        let all = check_secrets(&repo, true).unwrap();
        let got: Vec<_> = all.iter().map(|f| (f.path.as_str(), f.line, f.what.as_str())).collect();
        assert_eq!(got, [(".env", None, "Environment file"), ("config.ts", Some(2), "AWS access key")]);

        sh(&repo, &["add", "config.ts"]);
        let staged = check_secrets(&repo, false).unwrap();
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0].line, Some(2));

        let fresh = empty_repo();
        write(&fresh, "k.txt", "-----BEGIN RSA PRIVATE KEY-----\n");
        sh(&fresh, &["add", "-A"]);
        assert_eq!(check_secrets(&fresh, false).unwrap()[0].what, "Private key");
    }
}
