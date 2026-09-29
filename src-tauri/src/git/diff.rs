//! File diffs for the detail pane: git's unified diff parsed into hunks and numbered lines.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::status::{ChangeKind, FileChange};
use super::{run, Result};

/// Which list the file was clicked in; picks the comparison.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    /// HEAD → index.
    Staged,
    /// Index → working tree (or nothing → file, for untracked).
    Unstaged,
    /// The working file as it is, conflict markers included.
    Conflicted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LineKind {
    Context,
    Add,
    Del,
    /// "\ No newline at end of file".
    Note,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DiffLine {
    pub kind: LineKind,
    pub text: String,
    /// Line number in the old / new file, where the line exists there.
    pub old: Option<u32>,
    pub new: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    pub header: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
pub struct FileDiff {
    pub binary: bool,
    /// Stopped after `MAX_LINES`; the rest isn't shown.
    pub truncated: bool,
    pub hunks: Vec<Hunk>,
}

pub const MAX_LINES: usize = 5_000;

/// `-M` pairs a staged rename's two sides; --no-ext-diff / --no-textconv keep the output parseable.
pub fn diff_args(file: &FileChange, side: Side) -> Vec<String> {
    let mut args: Vec<String> = ["diff", "--no-ext-diff", "--no-textconv"].map(String::from).to_vec();
    let untracked_like = file.kind == ChangeKind::Untracked || side == Side::Conflicted;
    if untracked_like {
        args.extend(["--no-index", "--", "/dev/null", &file.path].map(String::from));
        return args;
    }
    if side == Side::Staged {
        args.extend(["--cached", "-M"].map(String::from));
    }
    args.push("--".into());
    if side == Side::Staged {
        if let Some(orig) = &file.orig_path {
            args.push(orig.clone());
        }
    }
    args.push(file.path.clone());
    args
}

pub fn get_diff(repo: &Path, file: &FileChange, side: Side) -> Result<FileDiff> {
    let args = diff_args(file, side);
    let argv: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = run(repo, &argv)?;
    // `--no-index` exits 1 when the files differ, which is the normal case here.
    let ok = out.ok() || (argv.contains(&"--no-index") && out.code == Some(1));
    if !ok {
        return Err(out.message());
    }
    Ok(parse_diff(&out.stdout, MAX_LINES))
}

/// `@@ -a,b +c,d @@ …` → (a, b, c, d); a missing count means 1.
fn parse_range(header: &str) -> Option<(u32, u32, u32, u32)> {
    let inner = header.strip_prefix("@@ ")?.split(" @@").next()?;
    let (old, new) = inner.split_once(' ')?;
    let range = |s: &str| -> Option<(u32, u32)> {
        let (start, count) = s.split_once(',').unwrap_or((s, "1"));
        Some((start.parse().ok()?, count.parse().ok()?))
    };
    let (a, b) = range(old.strip_prefix('-')?)?;
    let (c, d) = range(new.strip_prefix('+')?)?;
    Some((a, b, c, d))
}

/// Parses the first file of a unified diff. File headers before the first hunk are skipped.
pub fn parse_diff(text: &str, max_lines: usize) -> FileDiff {
    let mut diff = FileDiff::default();
    let (mut old_no, mut new_no, mut count) = (0u32, 0u32, 0usize);

    for line in text.split('\n') {
        if line.starts_with("diff --git") && !diff.hunks.is_empty() {
            break; // a second file; we only ever ask for one
        }
        if line.starts_with("Binary files ") || line == "GIT binary patch" {
            diff.binary = true;
            break;
        }
        if line.starts_with("@@ ") {
            if let Some((a, b, c, d)) = parse_range(line) {
                diff.hunks.push(Hunk { header: line.to_owned(), old_start: a, old_lines: b, new_start: c, new_lines: d, lines: Vec::new() });
                (old_no, new_no) = (a, c);
            }
            continue;
        }
        let Some(hunk) = diff.hunks.last_mut() else { continue };
        let (kind, rest) = match line.chars().next() {
            Some(' ') => (LineKind::Context, &line[1..]),
            Some('+') => (LineKind::Add, &line[1..]),
            Some('-') => (LineKind::Del, &line[1..]),
            Some('\\') => (LineKind::Note, line),
            _ => continue, // the trailing empty string after the final newline
        };
        if count >= max_lines {
            diff.truncated = true;
            break;
        }
        count += 1;
        let (old, new) = match kind {
            LineKind::Context => (Some(old_no), Some(new_no)),
            LineKind::Add => (None, Some(new_no)),
            LineKind::Del => (Some(old_no), None),
            LineKind::Note => (None, None),
        };
        if old.is_some() {
            old_no += 1;
        }
        if new.is_some() {
            new_no += 1;
        }
        hunk.lines.push(DiffLine { kind, text: rest.to_owned(), old, new });
    }
    diff
}

#[cfg(test)]
mod tests {
    use super::super::testutil::*;
    use super::*;

    fn fc(path: &str, kind: ChangeKind) -> FileChange {
        FileChange { path: path.into(), orig_path: None, kind }
    }

    const SAMPLE: &str = "diff --git a/a.ts b/a.ts\nindex 1..2 100644\n--- a/a.ts\n+++ b/a.ts\n@@ -1,3 +1,3 @@ fn x\n one\n-two\n+TWO\n three\n@@ -10 +10,2 @@\n ten\n+eleven\n\\ No newline at end of file\n";

    #[test]
    fn parses_hunks_with_line_numbers() {
        let d = parse_diff(SAMPLE, MAX_LINES);
        assert!(!d.binary && !d.truncated);
        assert_eq!(d.hunks.len(), 2);
        assert_eq!((d.hunks[0].old_start, d.hunks[0].old_lines, d.hunks[0].new_start, d.hunks[0].new_lines), (1, 3, 1, 3));
        let nums: Vec<_> = d.hunks[0].lines.iter().map(|l| (l.kind, l.old, l.new)).collect();
        assert_eq!(
            nums,
            vec![
                (LineKind::Context, Some(1), Some(1)),
                (LineKind::Del, Some(2), None),
                (LineKind::Add, None, Some(2)),
                (LineKind::Context, Some(3), Some(3)),
            ]
        );
        assert_eq!((d.hunks[1].old_lines, d.hunks[1].new_lines), (1, 2));
        assert_eq!(d.hunks[1].lines.last().unwrap().kind, LineKind::Note);
        assert_eq!(d.hunks[0].lines[2].text, "TWO");
    }

    #[test]
    fn detects_binary_and_truncates() {
        assert!(parse_diff("diff --git a/x b/x\nBinary files a/x and b/x differ\n", MAX_LINES).binary);
        let d = parse_diff(SAMPLE, 3);
        assert!(d.truncated);
        assert_eq!(d.hunks[0].lines.len(), 3);
    }

    #[test]
    fn builds_args_per_side() {
        let renamed = FileChange { path: "new.ts".into(), orig_path: Some("old.ts".into()), kind: ChangeKind::Renamed };
        assert_eq!(diff_args(&renamed, Side::Staged)[3..], ["--cached", "-M", "--", "old.ts", "new.ts"]);
        assert_eq!(diff_args(&fc("a", ChangeKind::Modified), Side::Unstaged)[3..], ["--", "a"]);
        assert_eq!(diff_args(&fc("n", ChangeKind::Untracked), Side::Unstaged)[3..], ["--no-index", "--", "/dev/null", "n"]);
    }

    #[test]
    fn live_diffs_for_each_side() {
        let repo = make_repo(&[("a.txt", "one\ntwo\n"), ("old.txt", "keep\n")]);
        write(&repo, "a.txt", "one\n2\n");
        sh(&repo, &["add", "a.txt"]);
        write(&repo, "a.txt", "one\n2\nthree\n");
        write(&repo, "new.txt", "fresh\n");
        sh(&repo, &["mv", "old.txt", "moved.txt"]);
        std::fs::write(repo.join("bin.dat"), [0u8, 1, 2, 0, 255]).unwrap();

        let staged = get_diff(&repo, &fc("a.txt", ChangeKind::Modified), Side::Staged).unwrap();
        let texts = |d: &FileDiff| d.hunks.iter().flat_map(|h| h.lines.iter().map(|l| (l.kind, l.text.clone()))).collect::<Vec<_>>();
        assert_eq!(texts(&staged), vec![(LineKind::Context, "one".into()), (LineKind::Del, "two".into()), (LineKind::Add, "2".into())]);

        let unstaged = get_diff(&repo, &fc("a.txt", ChangeKind::Modified), Side::Unstaged).unwrap();
        assert_eq!(texts(&unstaged).last().unwrap(), &(LineKind::Add, "three".to_string()));

        let untracked = get_diff(&repo, &fc("new.txt", ChangeKind::Untracked), Side::Unstaged).unwrap();
        assert_eq!(texts(&untracked), vec![(LineKind::Add, "fresh".into())]);

        let renamed = FileChange { path: "moved.txt".into(), orig_path: Some("old.txt".into()), kind: ChangeKind::Renamed };
        assert!(get_diff(&repo, &renamed, Side::Staged).unwrap().hunks.is_empty(), "a pure rename has no hunks");

        assert!(get_diff(&repo, &fc("bin.dat", ChangeKind::Untracked), Side::Unstaged).unwrap().binary);
    }
}
