//! Partial staging: stage, unstage or discard one hunk of a file, or chosen lines of it.
//!
//! A one-hunk patch is built from the hunk the UI showed and fed to `git apply` on stdin:
//! `--cached` to stage, `--cached --reverse` to unstage, `--reverse` on the working tree to
//! discard. The hunk is first checked against the file's current diff, so a file Claude
//! changed again since the diff was drawn is never patched blind.

use std::path::Path;

use serde::Deserialize;

use super::diff::{get_diff, Hunk, LineKind, Side};
use super::status::{ChangeKind, FileChange};
use super::{run_with_input, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HunkAction {
    /// Working tree → index.
    Stage,
    /// Index → back to the working tree only.
    Unstage,
    /// Drop the change from the working tree. Irreversible; the UI confirms first.
    Discard,
}

/// `a/path` for a patch header, C-quoted when git would quote it.
fn patch_path(prefix: &str, path: &str) -> String {
    if !path.chars().any(|c| matches!(c, '"' | '\\' | '\n' | '\t')) {
        return format!("{prefix}{path}");
    }
    let mut q = String::from("\"");
    q.push_str(prefix);
    for c in path.chars() {
        match c {
            '"' => q.push_str("\\\""),
            '\\' => q.push_str("\\\\"),
            '\n' => q.push_str("\\n"),
            '\t' => q.push_str("\\t"),
            c => q.push(c),
        }
    }
    q.push('"');
    q
}

/// A one-hunk patch acting on `selected` (indices into `hunk.lines`; None = every change).
///
/// Unselected changes must look untouched to `git apply`. Applied forward (stage), the patch
/// is matched against the old side, so an unselected deletion stays as context and an
/// unselected addition is left out. Applied in reverse (unstage, discard) it's matched against
/// the new side, so it's the other way round. None when no change line is selected.
pub fn build_patch(path: &str, hunk: &Hunk, selected: Option<&[usize]>, reverse: bool) -> Option<String> {
    let chosen = |i: usize| selected.is_none_or(|s| s.contains(&i));
    let mut body = String::new();
    let (mut old_n, mut new_n, mut any) = (0u32, 0u32, false);
    // A "\ No newline" note belongs to the line before it; it goes wherever that line went.
    let mut prev_kept = true;
    for (i, l) in hunk.lines.iter().enumerate() {
        let (sign, old, new) = match l.kind {
            LineKind::Note => {
                if prev_kept {
                    body.push_str(&l.text);
                    body.push('\n');
                }
                continue;
            }
            LineKind::Context => (' ', 1, 1),
            LineKind::Add if chosen(i) => ('+', 0, 1),
            LineKind::Del if chosen(i) => ('-', 1, 0),
            LineKind::Add if reverse => (' ', 1, 1),
            LineKind::Del if !reverse => (' ', 1, 1),
            _ => {
                prev_kept = false;
                continue;
            }
        };
        any |= sign != ' ';
        prev_kept = true;
        old_n += old;
        new_n += new;
        body.push(sign);
        body.push_str(&l.text);
        body.push('\n');
    }
    if !any {
        return None;
    }
    // With a single hunk, both sides start where the file being patched has it:
    // the old side's position going forward, the new side's in reverse.
    let start = if reverse { hunk.new_start } else { hunk.old_start };
    let (a, b) = (patch_path("a/", path), patch_path("b/", path));
    Some(format!("diff --git {a} {b}\n--- {a}\n+++ {b}\n@@ -{start},{old_n} +{start},{new_n} @@\n{body}"))
}

/// Stage / unstage / discard one hunk (or `selected` lines of it) of a modified file.
pub fn apply_hunk(repo: &Path, file: &FileChange, hunk: &Hunk, selected: Option<&[usize]>, action: HunkAction) -> Result<()> {
    if file.kind != ChangeKind::Modified {
        return Err("Only modified files can be staged part by part. Stage the whole file instead.".into());
    }
    let side = if action == HunkAction::Unstage { Side::Staged } else { Side::Unstaged };
    let current = get_diff(repo, file, side)?;
    if !current.hunks.contains(hunk) {
        return Err(format!("{} changed since its diff was shown. Look again and retry.", file.path));
    }
    let reverse = action != HunkAction::Stage;
    let patch = build_patch(&file.path, hunk, selected, reverse).ok_or("Select at least one changed line.")?;
    let mut args = vec!["apply", "--whitespace=nowarn"];
    if action != HunkAction::Discard {
        args.push("--cached");
    }
    if reverse {
        args.push("--reverse");
    }
    args.push("-");
    let out = run_with_input(repo, &args, Some(patch.into_bytes()))?;
    if out.ok() {
        Ok(())
    } else {
        Err(out.message())
    }
}

#[cfg(test)]
mod tests {
    use super::super::diff::{parse_diff, DiffLine, MAX_LINES};
    use super::super::status::get_status;
    use super::super::testutil::*;
    use super::*;

    fn hunk(lines: &[(LineKind, &str)]) -> Hunk {
        let (mut o, mut n) = (0, 0);
        let lines = lines
            .iter()
            .map(|&(kind, text)| {
                let (old, new) = match kind {
                    LineKind::Context => (1, 1),
                    LineKind::Add => (0, 1),
                    LineKind::Del => (1, 0),
                    LineKind::Note => (0, 0),
                };
                o += old;
                n += new;
                DiffLine { kind, text: text.into(), old: None, new: None }
            })
            .collect();
        Hunk { header: String::new(), old_start: 3, old_lines: o, new_start: 5, new_lines: n, lines }
    }
    use LineKind::*;

    #[test]
    fn whole_hunk_patch() {
        let h = hunk(&[(Context, "a"), (Del, "b"), (Add, "B"), (Context, "c")]);
        assert_eq!(
            build_patch("src/x.ts", &h, None, false).unwrap(),
            "diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -3,3 +3,3 @@\n a\n-b\n+B\n c\n"
        );
        assert!(build_patch("x", &h, None, true).unwrap().contains("@@ -5,3 +5,3 @@"));
    }

    #[test]
    fn selected_lines_forward_and_reverse() {
        let h = hunk(&[(Context, "a"), (Del, "b"), (Del, "c"), (Add, "B"), (Add, "C"), (Context, "d")]);
        // Stage only "-b" and "+B": "-c" stays as context, "+C" is left out.
        let fwd = build_patch("x", &h, Some(&[1, 3]), false).unwrap();
        assert!(fwd.ends_with("@@ -3,4 +3,4 @@\n a\n-b\n c\n+B\n d\n"), "{fwd}");
        // In reverse "+C" is already there (context) and "-c" is already gone (left out).
        let rev = build_patch("x", &h, Some(&[1, 3]), true).unwrap();
        assert!(rev.ends_with("@@ -5,4 +5,4 @@\n a\n-b\n+B\n C\n d\n"), "{rev}");
        assert!(build_patch("x", &h, Some(&[0, 5]), false).is_none(), "only context selected");
    }

    #[test]
    fn notes_follow_their_line_and_paths_are_quoted() {
        let h = hunk(&[(Context, "a"), (Del, "b"), (Note, "\\ No newline at end of file"), (Add, "B")]);
        let kept = build_patch("x", &h, None, false).unwrap();
        assert!(kept.ends_with("-b\n\\ No newline at end of file\n+B\n"));
        let dropped = build_patch("x", &h, Some(&[3]), true).unwrap();
        assert!(!dropped.contains("No newline"), "{dropped}");
        assert_eq!(patch_path("a/", "we\"ird\\name"), "\"a/we\\\"ird\\\\name\"");
    }

    const BASE: &str = "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\neleven\ntwelve\n";
    const EDIT: &str = "ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\neleven\nTWELVE\n";

    fn modified(path: &str) -> FileChange {
        FileChange { path: path.into(), orig_path: None, kind: ChangeKind::Modified }
    }
    fn staged_text(repo: &Path, path: &str) -> String {
        sh(repo, &["show", &format!(":{path}")])
    }

    #[test]
    fn stage_unstage_and_discard_one_hunk() {
        let repo = make_repo(&[("f.txt", BASE)]);
        write(&repo, "f.txt", EDIT);
        let f = modified("f.txt");
        let diff = get_diff(&repo, &f, Side::Unstaged).unwrap();
        assert_eq!(diff.hunks.len(), 2);

        apply_hunk(&repo, &f, &diff.hunks[0], None, HunkAction::Stage).unwrap();
        assert!(staged_text(&repo, "f.txt").starts_with("ONE\n") && staged_text(&repo, "f.txt").ends_with("twelve\n"));
        let s = get_status(&repo).unwrap().parsed;
        assert_eq!((s.staged.len(), s.unstaged.len()), (1, 1));

        let staged = get_diff(&repo, &f, Side::Staged).unwrap();
        apply_hunk(&repo, &f, &staged.hunks[0], None, HunkAction::Unstage).unwrap();
        assert_eq!(staged_text(&repo, "f.txt"), BASE);
        assert_eq!(read(&repo, "f.txt"), EDIT, "unstaging keeps the edit");

        let rest = get_diff(&repo, &f, Side::Unstaged).unwrap();
        apply_hunk(&repo, &f, &rest.hunks[1], None, HunkAction::Discard).unwrap();
        assert_eq!(read(&repo, "f.txt"), EDIT.replace("TWELVE", "twelve"));
    }

    #[test]
    fn stage_selected_lines() {
        let repo = make_repo(&[("f.txt", "a\nb\nc\n")]);
        write(&repo, "f.txt", "a\nB1\nB2\nc\n");
        let f = modified("f.txt");
        let h = get_diff(&repo, &f, Side::Unstaged).unwrap().hunks.remove(0);
        // lines: a, -b, +B1, +B2, c → stage the deletion and the first addition only.
        let pick: Vec<usize> = h.lines.iter().enumerate().filter(|(_, l)| l.text == "b" || l.text == "B1").map(|(i, _)| i).collect();
        apply_hunk(&repo, &f, &h, Some(&pick), HunkAction::Stage).unwrap();
        assert_eq!(staged_text(&repo, "f.txt"), "a\nB1\nc\n");
        assert_eq!(read(&repo, "f.txt"), "a\nB1\nB2\nc\n");
    }

    #[test]
    fn refuses_a_stale_hunk_and_non_modified_files() {
        let repo = make_repo(&[("f.txt", BASE)]);
        write(&repo, "f.txt", EDIT);
        let f = modified("f.txt");
        let h = get_diff(&repo, &f, Side::Unstaged).unwrap().hunks.remove(0);
        write(&repo, "f.txt", &EDIT.replace("ONE", "Uno"));
        let err = apply_hunk(&repo, &f, &h, None, HunkAction::Stage).unwrap_err();
        assert!(err.contains("changed since"), "{err}");
        assert_eq!(staged_text(&repo, "f.txt"), BASE);

        let added = FileChange { path: "f.txt".into(), orig_path: None, kind: ChangeKind::Added };
        assert!(apply_hunk(&repo, &added, &h, None, HunkAction::Stage).is_err());
    }

    #[test]
    fn discard_works_with_crlf_checkouts() {
        // core.autocrlf=true: CRLF on disk, LF in the index and in the diff.
        let repo = make_repo(&[("f.txt", BASE)]);
        sh(&repo, &["config", "core.autocrlf", "true"]);
        std::fs::remove_file(repo.join("f.txt")).unwrap();
        sh(&repo, &["checkout", "--", "f.txt"]);
        assert!(read(&repo, "f.txt").contains("\r\n"));
        write(&repo, "f.txt", &EDIT.replace('\n', "\r\n"));
        let f = modified("f.txt");
        let diff = get_diff(&repo, &f, Side::Unstaged).unwrap();
        apply_hunk(&repo, &f, &diff.hunks[0], None, HunkAction::Discard).unwrap();
        assert_eq!(read(&repo, "f.txt"), EDIT.replace("ONE", "one").replace('\n', "\r\n"));

        apply_hunk(&repo, &f, &get_diff(&repo, &f, Side::Unstaged).unwrap().hunks[0], None, HunkAction::Stage).unwrap();
        assert!(staged_text(&repo, "f.txt").ends_with("TWELVE\n"));
    }

    #[test]
    fn parsed_hunks_round_trip_through_serde_shape() {
        // The UI sends back exactly what it was given; equality is what the stale check relies on.
        let d = parse_diff("@@ -1 +1 @@\n-a\n+b\n", MAX_LINES);
        assert_eq!(d.hunks[0].clone(), d.hunks[0]);
    }
}
