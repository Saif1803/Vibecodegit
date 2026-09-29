//! `git status --porcelain=v2` parsing into VS Code's three lists: staged, unstaged, conflicted.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::{git, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
}

/// One side (index or working tree) of one path's change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    /// Previous path, for staged renames and copies.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub orig_path: Option<String>,
    pub kind: ChangeKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    /// None when HEAD is detached.
    pub head: Option<String>,
    /// False on an unborn branch (a fresh repo with no commits yet).
    pub has_commits: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

impl Default for BranchInfo {
    fn default() -> Self {
        BranchInfo { head: None, has_commits: true, upstream: None, ahead: 0, behind: 0 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Operation {
    Rebase,
    Merge,
    CherryPick,
    Revert,
}

impl Operation {
    fn label(self) -> &'static str {
        match self {
            Operation::Rebase => "Rebase",
            Operation::Merge => "Merge",
            Operation::CherryPick => "Cherry-pick",
            Operation::Revert => "Revert",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
pub struct ParsedStatus {
    pub branch: BranchInfo,
    /// In the index: what the next commit contains.
    pub staged: Vec<FileChange>,
    /// Working-tree edits not yet staged, plus untracked files.
    pub unstaged: Vec<FileChange>,
    /// Unmerged paths (a merge, rebase, cherry-pick or stash pop stopped on them).
    pub conflicted: Vec<FileChange>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    #[serde(flatten)]
    pub parsed: ParsedStatus,
    /// A multi-step git operation stopped midway (usually on conflicts).
    pub operation: Option<Operation>,
    /// Why committing isn't possible right now, if it isn't.
    pub blocker: Option<String>,
}

// --no-optional-locks: a background status must never hold index.lock while a commit
// (ours, Claude's, or a terminal's) needs it.
const STATUS_ARGS: [&str; 6] = ["--no-optional-locks", "status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"];

pub fn get_status(repo: &Path) -> Result<RepoStatus> {
    let parsed = parse_status(&git(repo, &STATUS_ARGS)?);
    let operation = in_progress_operation(repo)?;
    let blocker = commit_blocker(&parsed, operation);
    Ok(RepoStatus { parsed, operation, blocker })
}

/// Reads the operation markers from the (per-worktree) git dir in one git call.
pub fn in_progress_operation(repo: &Path) -> Result<Option<Operation>> {
    let git_dir = git(repo, &["rev-parse", "--absolute-git-dir"])?;
    let dir = Path::new(git_dir.trim());
    // Checked in this order; a stopped rebase can also leave other markers behind.
    let markers = [
        (Operation::Rebase, "rebase-merge"),
        (Operation::Rebase, "rebase-apply"),
        (Operation::Merge, "MERGE_HEAD"),
        (Operation::CherryPick, "CHERRY_PICK_HEAD"),
        (Operation::Revert, "REVERT_HEAD"),
    ];
    Ok(markers.iter().find(|(_, m)| dir.join(m).exists()).map(|(op, _)| *op))
}

pub fn commit_blocker(status: &ParsedStatus, operation: Option<Operation>) -> Option<String> {
    let conflicts = !status.conflicted.is_empty();
    if let Some(op) = operation {
        let with = if conflicts { " with conflicts" } else { "" };
        return Some(format!("{} in progress{with}. Finish or abort it in your editor first.", op.label()));
    }
    if conflicts {
        return Some("Resolve the conflicted files in your editor before committing.".into());
    }
    if status.branch.head.is_none() {
        return Some("Detached HEAD. Check out a branch to commit and push.".into());
    }
    None
}

/// Everything after the first `n` space-separated fields (paths may contain spaces).
fn after_fields(record: &str, n: usize) -> &str {
    let mut rest = record;
    for _ in 0..n {
        rest = rest.split_once(' ').map_or("", |(_, r)| r);
    }
    rest
}

/// One porcelain status letter (X = index, Y = worktree); M and T (type change) read as modified.
fn kind_of(letter: char) -> ChangeKind {
    match letter {
        'A' | 'C' => ChangeKind::Added,
        'D' => ChangeKind::Deleted,
        'R' => ChangeKind::Renamed,
        _ => ChangeKind::Modified,
    }
}

/// Parses `git status --porcelain=v2 --branch -z` output.
pub fn parse_status(out: &str) -> ParsedStatus {
    let mut s = ParsedStatus::default();
    let mut records = out.split('\0');

    while let Some(r) = records.next() {
        if r.is_empty() {
            continue;
        }
        if let Some(header) = r.strip_prefix("# ") {
            let (key, value) = header.split_once(' ').unwrap_or((header, ""));
            match key {
                "branch.oid" => s.branch.has_commits = value != "(initial)",
                "branch.head" => s.branch.head = (value != "(detached)").then(|| value.to_owned()),
                "branch.upstream" => s.branch.upstream = Some(value.to_owned()),
                "branch.ab" => {
                    let mut parts = value.split(' ');
                    let ahead = parts.next().and_then(|a| a.strip_prefix('+')?.parse().ok());
                    let behind = parts.next().and_then(|b| b.strip_prefix('-')?.parse().ok());
                    if let (Some(a), Some(b)) = (ahead, behind) {
                        s.branch.ahead = a;
                        s.branch.behind = b;
                    }
                }
                _ => {}
            }
            continue;
        }

        let mut chars = r.chars();
        let kind = chars.next();
        chars.next();
        let (x, y) = (chars.next().unwrap_or('.'), chars.next().unwrap_or('.'));
        match kind {
            Some(t @ ('1' | '2')) => {
                let path = after_fields(r, if t == '1' { 8 } else { 9 }).to_owned();
                // A rename/copy record is followed by its original path as the next record.
                let orig_path = if t == '2' { records.next().map(str::to_owned) } else { None };
                if x != '.' {
                    s.staged.push(FileChange { path: path.clone(), orig_path, kind: kind_of(x) });
                }
                // The worktree side of a renamed file is a plain edit of the new path.
                if y != '.' {
                    s.unstaged.push(FileChange { path, orig_path: None, kind: kind_of(y) });
                }
            }
            Some('u') => s.conflicted.push(FileChange {
                path: after_fields(r, 10).to_owned(),
                orig_path: None,
                kind: ChangeKind::Conflicted,
            }),
            Some('?') => s.unstaged.push(FileChange {
                path: r[2..].to_owned(),
                orig_path: None,
                kind: ChangeKind::Untracked,
            }),
            // "!" (ignored) isn't requested; anything else is from a newer git and skipped.
            _ => {}
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::super::testutil::*;
    use super::*;
    use ChangeKind::*;

    const H: &str = "4bcfe98e640c8284511312660fb8709b0afa888e";

    fn z(records: &[String]) -> String {
        records.iter().map(|r| format!("{r}\0")).collect()
    }
    fn fc(path: &str, kind: ChangeKind) -> FileChange {
        FileChange { path: path.into(), orig_path: None, kind }
    }

    // Captured from a real repo (git 2.51) mid-merge with every kind of change.
    fn real() -> String {
        z(&[
            "# branch.oid ca29e51f4568727cffbf60d179dabfebe8a2582f".into(),
            "# branch.head main".into(),
            "# branch.upstream origin/main".into(),
            "# branch.ab +1 -0".into(),
            format!("1 .M N... 100644 100644 100644 {H} {H} dir with space/café ü.txt"),
            format!("1 A. N... 000000 100644 100644 0000000000000000000000000000000000000000 {H} src/added.ts"),
            format!("1 .D N... 100644 100644 000000 {H} {H} src/del.ts"),
            format!("2 R. N... 100644 100644 100644 {H} {H} R100 src/new.ts"),
            "src/old.ts".into(),
            format!("1 MM N... 100644 100644 100644 {H} {H} staged_mod.ts"),
            format!("u UU N... 100644 100644 100644 100644 {H} {H} {H} both.txt"),
            "? untracked.md".into(),
        ])
    }

    #[test]
    fn parses_branch_upstream_and_ahead_behind() {
        let b = parse_status(&real()).branch;
        assert_eq!(b, BranchInfo { head: Some("main".into()), has_commits: true, upstream: Some("origin/main".into()), ahead: 1, behind: 0 });
    }

    #[test]
    fn splits_into_staged_unstaged_and_conflicted() {
        let s = parse_status(&real());
        assert_eq!(
            s.staged,
            vec![
                fc("src/added.ts", Added),
                FileChange { path: "src/new.ts".into(), orig_path: Some("src/old.ts".into()), kind: Renamed },
                fc("staged_mod.ts", Modified),
            ]
        );
        assert_eq!(
            s.unstaged,
            vec![
                fc("dir with space/café ü.txt", Modified),
                fc("src/del.ts", Deleted),
                fc("staged_mod.ts", Modified),
                fc("untracked.md", Untracked),
            ]
        );
        assert_eq!(s.conflicted, vec![fc("both.txt", Conflicted)]);
    }

    #[test]
    fn renamed_then_edited_file_is_in_both_lists() {
        let s = parse_status(&z(&[format!("2 RM N... 100644 100644 100644 {H} {H} R100 new.ts"), "old.ts".into()]));
        assert_eq!(s.staged, vec![FileChange { path: "new.ts".into(), orig_path: Some("old.ts".into()), kind: Renamed }]);
        assert_eq!(s.unstaged, vec![fc("new.ts", Modified)]);
    }

    #[test]
    fn detached_head_and_unborn_branch() {
        let d = parse_status(&z(&["# branch.oid ca29e51f".into(), "# branch.head (detached)".into()]));
        assert_eq!(d.branch.head, None);
        let u = parse_status(&z(&["# branch.oid (initial)".into(), "# branch.head main".into(), "? README.md".into()]));
        assert_eq!(u.branch, BranchInfo { head: Some("main".into()), has_commits: false, ..Default::default() });
        assert_eq!(u.unstaged, vec![fc("README.md", Untracked)]);
    }

    #[test]
    fn behind_counts_and_slashed_branch_names() {
        let s = parse_status(&z(&["# branch.head feat/x".into(), "# branch.upstream origin/feat/x".into(), "# branch.ab +0 -12".into()]));
        assert_eq!((s.branch.head.as_deref(), s.branch.ahead, s.branch.behind), (Some("feat/x"), 0, 12));
    }

    #[test]
    fn deletions_intent_to_add_copies_and_type_changes() {
        let s = parse_status(&z(&[
            format!("1 D. N... 100644 000000 000000 {H} {H} gone.ts"),
            format!("1 .A N... 000000 000000 100644 {H} {H} ita.ts"),
            format!("2 C. N... 100644 100644 100644 {H} {H} C100 copy.ts"),
            "src.ts".into(),
            format!("1 .T N... 100644 100644 120000 {H} {H} link"),
        ]));
        assert_eq!(s.staged, vec![fc("gone.ts", Deleted), FileChange { path: "copy.ts".into(), orig_path: Some("src.ts".into()), kind: Added }]);
        assert_eq!(s.unstaged, vec![fc("ita.ts", Added), fc("link", Modified)]);
    }

    #[test]
    fn empty_output_is_an_empty_status() {
        assert_eq!(parse_status(""), ParsedStatus::default());
    }

    #[test]
    fn blocker_rules() {
        let mut s = ParsedStatus { branch: BranchInfo { head: Some("main".into()), ..Default::default() }, ..Default::default() };
        assert_eq!(commit_blocker(&s, None), None);
        assert!(commit_blocker(&s, Some(Operation::Rebase)).unwrap().starts_with("Rebase in progress."));
        s.conflicted.push(fc("b", Conflicted));
        assert_eq!(commit_blocker(&s, Some(Operation::Merge)).unwrap(), "Merge in progress with conflicts. Finish or abort it in your editor first.");
        assert!(commit_blocker(&s, None).unwrap().contains("conflicted files"));
        s.conflicted.clear();
        s.branch.head = None;
        assert!(commit_blocker(&s, None).unwrap().starts_with("Detached HEAD"));
    }

    #[test]
    fn live_status_detects_a_stopped_merge() {
        let repo = make_repo(&[("a.txt", "base\n")]);
        sh(&repo, &["checkout", "-q", "-b", "other"]);
        write(&repo, "a.txt", "theirs\n");
        sh(&repo, &["commit", "-qam", "theirs"]);
        sh(&repo, &["checkout", "-q", "main"]);
        write(&repo, "a.txt", "ours\n");
        sh(&repo, &["commit", "-qam", "ours"]);
        assert!(!super::super::run(&repo, &["merge", "other"]).unwrap().ok());

        let st = get_status(&repo).unwrap();
        assert_eq!(st.operation, Some(Operation::Merge));
        assert_eq!(st.parsed.conflicted, vec![fc("a.txt", Conflicted)]);
        assert!(st.blocker.is_some());
    }

    #[test]
    fn live_status_detects_a_stopped_rebase_and_nothing_on_a_clean_repo() {
        let repo = make_repo(&[("a.txt", "base\n")]);
        assert_eq!(get_status(&repo).unwrap().operation, None);
        sh(&repo, &["checkout", "-q", "-b", "feat"]);
        write(&repo, "a.txt", "feat\n");
        sh(&repo, &["commit", "-qam", "feat"]);
        sh(&repo, &["checkout", "-q", "main"]);
        write(&repo, "a.txt", "main\n");
        sh(&repo, &["commit", "-qam", "main"]);
        sh(&repo, &["checkout", "-q", "feat"]);
        assert!(!super::super::run(&repo, &["rebase", "main"]).unwrap().ok());
        assert_eq!(get_status(&repo).unwrap().operation, Some(Operation::Rebase));
    }
}
