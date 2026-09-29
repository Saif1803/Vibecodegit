//! History: the commit graph, commit details and comparisons, commit actions (revert,
//! cherry-pick, reset), a file's timeline, and blame.
//!
//! Commits are always named by full hashes the UI got from us; `check_hash` rejects anything
//! else, so a "hash" can never be read as an option or a range.

use std::collections::HashSet;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::diff::{parse_diff, FileDiff, MAX_LINES};
use super::status::{in_progress_operation, ChangeKind, FileChange, Operation};
use super::sync::upstream_of;
use super::{git, run, run_with_input, Outcome, Result};

/// Commits per page of the History tab.
pub const PAGE: usize = 200;

// ---- The lane graph ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Lane {
    pub col: u16,
    /// Index into the UI's palette (it wraps).
    pub color: u16,
}

/// How to draw one row of the graph. Rows are stacked with no gaps, so a lane drawn to the
/// bottom of one row continues from the top of the next.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
pub struct GraphRow {
    /// The commit's dot.
    pub col: u16,
    pub color: u16,
    /// Lanes passing straight through this row (top to bottom, same column).
    pub through: Vec<Lane>,
    /// Lanes ending at the dot: from the top of `col` to the dot (children above).
    pub up: Vec<Lane>,
    /// Lanes leaving the dot: from the dot to the bottom of `col` (one per parent).
    pub down: Vec<Lane>,
}

/// Assigns lanes to commits listed children-before-parents (`--date-order`), like
/// `git log --graph`. Lanes never shift sideways: a freed column is reused by the next
/// new lane, so pass-through lines are always vertical.
pub fn layout<'a>(commits: impl IntoIterator<Item = (&'a str, &'a [String])>) -> Vec<GraphRow> {
    // Each lane waits for the commit it will reach next.
    let mut lanes: Vec<Option<(&'a str, u16)>> = Vec::new();
    let mut next_color = 0u16;
    let mut new_color = || {
        next_color += 1;
        next_color - 1
    };
    fn free_slot(lanes: &mut Vec<Option<(&str, u16)>>) -> usize {
        lanes.iter().position(Option::is_none).unwrap_or_else(|| {
            lanes.push(None);
            lanes.len() - 1
        })
    }
    let lane = |i: usize, color: u16| Lane { col: i as u16, color };

    let mut rows = Vec::new();
    for (hash, parents) in commits {
        let waiting: Vec<usize> = (0..lanes.len()).filter(|&i| matches!(lanes[i], Some((h, _)) if h == hash)).collect();
        let (col, color) = match waiting.first() {
            Some(&i) => (i, lanes[i].unwrap().1),
            None => (free_slot(&mut lanes), new_color()),
        };
        let up = waiting.iter().map(|&i| lane(i, lanes[i].unwrap().1)).collect();
        let through = (0..lanes.len())
            .filter(|i| !waiting.contains(i))
            .filter_map(|i| lanes[i].map(|(_, c)| lane(i, c)))
            .collect();
        for &i in &waiting {
            lanes[i] = None;
        }

        let mut down = Vec::new();
        for (n, p) in parents.iter().enumerate() {
            // A parent some other lane already waits for: join that lane.
            if let Some(k) = lanes.iter().position(|l| matches!(l, Some((h, _)) if h == p)) {
                down.push(lane(k, lanes[k].unwrap().1));
                continue;
            }
            let (slot, c) = if n == 0 { (col, color) } else { (free_slot(&mut lanes), new_color()) };
            lanes[slot] = Some((p.as_str(), c));
            down.push(lane(slot, c));
        }
        while matches!(lanes.last(), Some(None)) {
            lanes.pop();
        }
        rows.push(GraphRow { col: col as u16, color, through, up, down });
    }
    rows
}

// ---- Log ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RefKind {
    /// The checked-out branch (or "HEAD" when detached).
    Head,
    Branch,
    Remote,
    Tag,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RefLabel {
    pub name: String,
    pub kind: RefKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub hash: String,
    pub short: String,
    pub parents: Vec<String>,
    pub author: String,
    pub date_ms: u64,
    pub subject: String,
    pub refs: Vec<RefLabel>,
    pub is_head: bool,
    /// On the upstream but not in HEAD yet (a pull brings it in).
    pub incoming: bool,
    /// In HEAD but not on the upstream yet (a push sends it).
    pub outgoing: bool,
    pub graph: GraphRow,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct History {
    pub commits: Vec<Commit>,
    /// More commits exist past `limit`.
    pub more: bool,
    pub upstream: Option<String>,
}

/// `%D` with `--decorate=full`: "HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1".
pub fn parse_refs(decorations: &str) -> Vec<RefLabel> {
    decorations
        .split(", ")
        .filter_map(|d| {
            let (kind, full) = if let Some(b) = d.strip_prefix("HEAD -> ") {
                (RefKind::Head, b)
            } else if d == "HEAD" {
                return Some(RefLabel { name: "HEAD".into(), kind: RefKind::Head });
            } else if let Some(t) = d.strip_prefix("tag: ") {
                (RefKind::Tag, t)
            } else if d.starts_with("refs/remotes/") {
                (RefKind::Remote, d)
            } else if d.starts_with("refs/heads/") {
                (RefKind::Branch, d)
            } else {
                return None; // refs/stash, notes, …
            };
            let name = ["refs/heads/", "refs/remotes/", "refs/tags/"].iter().find_map(|p| full.strip_prefix(p)).unwrap_or(full);
            // origin/HEAD just points at another remote branch.
            (!(kind == RefKind::Remote && name.ends_with("/HEAD"))).then(|| RefLabel { name: name.to_owned(), kind })
        })
        .collect()
}

const LOG_FORMAT: &str = "--format=%H%x00%h%x00%P%x00%an%x00%at%x00%D%x00%s";

/// The newest `limit` commits of HEAD and its upstream (or of every branch, remote and tag
/// when `all`), newest first, with the graph laid out.
pub fn history(repo: &Path, limit: usize, all: bool) -> Result<History> {
    let upstream = upstream_of(repo)?;
    let head = run(repo, &["rev-parse", "-q", "--verify", "HEAD"])?;
    if !head.ok() && !all {
        return Ok(History { commits: Vec::new(), more: false, upstream }); // unborn branch
    }
    let head = head.stdout.trim().to_owned();

    let n = format!("-n{}", limit + 1);
    let mut args = vec!["log", "--date-order", "--decorate=full", LOG_FORMAT, &n];
    if all {
        args.extend(["--branches", "--remotes", "--tags"]);
    }
    if !head.is_empty() {
        args.push("HEAD");
    }
    if upstream.is_some() && !all {
        args.push("@{u}");
    }
    args.push("--");
    let out = git(repo, &args)?;

    let mut commits: Vec<Commit> = out
        .lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.splitn(7, '\0').collect();
            (f.len() == 7).then(|| Commit {
                hash: f[0].to_owned(),
                short: f[1].to_owned(),
                parents: f[2].split_whitespace().map(str::to_owned).collect(),
                author: f[3].to_owned(),
                date_ms: f[4].parse::<u64>().unwrap_or(0) * 1000,
                refs: parse_refs(f[5]),
                subject: f[6].to_owned(),
                is_head: f[0] == head,
                incoming: false,
                outgoing: false,
                graph: GraphRow::default(),
            })
        })
        .collect();
    let more = commits.len() > limit;
    commits.truncate(limit);

    if upstream.is_some() {
        let set = |range: &str| -> Result<HashSet<String>> {
            Ok(git(repo, &["rev-list", "--max-count=5000", range, "--"])?.lines().map(str::to_owned).collect())
        };
        let (incoming, outgoing) = (set("HEAD..@{u}")?, set("@{u}..HEAD")?);
        for c in &mut commits {
            c.incoming = incoming.contains(&c.hash);
            c.outgoing = outgoing.contains(&c.hash);
        }
    }

    let rows = layout(commits.iter().map(|c| (c.hash.as_str(), c.parents.as_slice())));
    for (c, row) in commits.iter_mut().zip(rows) {
        c.graph = row;
    }
    Ok(History { commits, more, upstream })
}

// ---- One commit, and comparisons ----

/// A full hash (or a unique abbreviation) we handed out; never an option, range or ref name.
fn check_hash(hash: &str) -> Result<()> {
    if (4..=64).contains(&hash.len()) && hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(format!("\"{hash}\" isn't a commit hash."))
    }
}

/// The empty tree's id in this repo's hash format: the "parent" of a root commit.
pub(crate) fn empty_tree(repo: &Path) -> Result<String> {
    let out = run_with_input(repo, &["hash-object", "-t", "tree", "--stdin"], Some(Vec::new()))?;
    if out.ok() {
        Ok(out.stdout.trim().to_owned())
    } else {
        Err(out.message())
    }
}

fn base_of(repo: &Path, parents: &[String]) -> Result<String> {
    match parents.first() {
        Some(p) => Ok(p.clone()),
        None => empty_tree(repo),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub hash: String,
    pub short: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub date_ms: u64,
    pub committer: String,
    pub commit_date_ms: u64,
    /// The full message: subject, blank line, body.
    pub message: String,
    pub refs: Vec<RefLabel>,
    /// What the files are compared against: the first parent, or the empty tree for a root commit.
    pub base: String,
    pub files: Vec<FileChange>,
}

pub fn commit_detail(repo: &Path, hash: &str) -> Result<CommitDetail> {
    check_hash(hash)?;
    let out = git(repo, &["show", "-s", "--decorate=full", "--format=%H%x00%h%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ct%x00%D%x00%B", hash, "--"])?;
    let f: Vec<&str> = out.splitn(10, '\0').collect();
    if f.len() < 10 {
        return Err(format!("Couldn't read commit {hash}."));
    }
    let parents: Vec<String> = f[2].split_whitespace().map(str::to_owned).collect();
    let base = base_of(repo, &parents)?;
    let files = compare_files(repo, &base, Some(f[0]))?;
    Ok(CommitDetail {
        hash: f[0].to_owned(),
        short: f[1].to_owned(),
        parents,
        author: f[3].to_owned(),
        email: f[4].to_owned(),
        date_ms: f[5].parse::<u64>().unwrap_or(0) * 1000,
        committer: f[6].to_owned(),
        commit_date_ms: f[7].parse::<u64>().unwrap_or(0) * 1000,
        refs: parse_refs(f[8]),
        message: f[9].trim_end().to_owned(),
        base,
        files,
    })
}

/// `--name-status -z` output: "M\0path\0", "R087\0old\0new\0", …
pub fn parse_name_status(out: &str) -> Vec<FileChange> {
    let mut files = Vec::new();
    let mut f = out.split('\0');
    while let Some(status) = f.next() {
        let Some(letter) = status.chars().next() else { continue };
        let two_paths = matches!(letter, 'R' | 'C');
        let (orig, path) = if two_paths { (f.next(), f.next()) } else { (None, f.next()) };
        let Some(path) = path else { break };
        let kind = match letter {
            'A' | 'C' => ChangeKind::Added,
            'D' => ChangeKind::Deleted,
            'R' => ChangeKind::Renamed,
            'U' => ChangeKind::Conflicted,
            _ => ChangeKind::Modified,
        };
        files.push(FileChange { path: path.to_owned(), orig_path: orig.map(str::to_owned), kind });
    }
    files
}

/// Files that differ between `base` and `target` (a commit, or the working tree when None).
pub fn compare_files(repo: &Path, base: &str, target: Option<&str>) -> Result<Vec<FileChange>> {
    check_hash(base)?;
    let mut args = vec!["diff", "--name-status", "-z", "-M", "--no-ext-diff", base];
    if let Some(t) = target {
        check_hash(t)?;
        args.push(t);
    }
    args.push("--");
    Ok(parse_name_status(&git(repo, &args)?))
}

/// One file's diff between `base` and `target` (or the working tree).
pub fn compare_file_diff(repo: &Path, base: &str, target: Option<&str>, file: &FileChange) -> Result<FileDiff> {
    check_hash(base)?;
    let mut args = vec!["--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", "-M", base];
    if let Some(t) = target {
        check_hash(t)?;
        args.push(t);
    }
    args.push("--");
    if let Some(orig) = &file.orig_path {
        args.push(orig);
    }
    args.push(&file.path);
    Ok(parse_diff(&git(repo, &args)?, MAX_LINES))
}

// ---- Commit actions ----

fn parents_of(repo: &Path, hash: &str) -> Result<Vec<String>> {
    let line = git(repo, &["rev-list", "--parents", "-n1", hash, "--"])?;
    Ok(line.split_whitespace().skip(1).map(str::to_owned).collect())
}

/// Revert or cherry-pick one commit. Conflicts leave the operation in progress (resolve or
/// abort it from the banner); an empty result is undone so nothing is left half-finished.
fn apply_commit(repo: &Path, hash: &str, revert: bool) -> Result<Outcome> {
    check_hash(hash)?;
    let short = &hash[..hash.len().min(7)];
    let (cmd, op, verb) = if revert { ("revert", Operation::Revert, "Reverting") } else { ("cherry-pick", Operation::CherryPick, "Cherry-picking") };
    let mut args = vec![cmd, "--no-edit"];
    // A merge commit needs to know which side it's relative to: its first parent (mainline).
    if parents_of(repo, hash)?.len() > 1 {
        args.extend(["-m", "1"]);
    }
    args.push(hash);
    let out = run(repo, &args)?;
    if out.ok() {
        let done = if revert { format!("Reverted {short} with a new commit.") } else { format!("Cherry-picked {short}.") };
        return Ok(Outcome::ok(done, None));
    }
    if in_progress_operation(repo)? == Some(op) {
        let unmerged = git(repo, &["diff", "--name-only", "--diff-filter=U"])?;
        if unmerged.trim().is_empty() {
            // Nothing left to commit: the change is already here.
            run(repo, &[cmd, "--abort"])?;
            let why = if revert { "is already undone here" } else { "is already here" };
            return Ok(Outcome::fail(format!("Nothing to do: {short} {why}.")));
        }
        return Ok(Outcome::fail(format!(
            "{verb} {short} stopped on conflicts. Resolve them in your editor and stage the files, or abort the {cmd}."
        )));
    }
    Ok(Outcome::fail(out.message()))
}

pub fn revert_commit(repo: &Path, hash: &str) -> Result<Outcome> {
    apply_commit(repo, hash, true)
}

pub fn cherry_pick(repo: &Path, hash: &str) -> Result<Outcome> {
    apply_commit(repo, hash, false)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResetMode {
    /// Move the branch; the undone commits' changes stay staged.
    Soft,
    /// Move the branch; their changes stay in the working tree, unstaged.
    Mixed,
    /// Move the branch and make the working tree match. Uncommitted changes are lost.
    Hard,
}

/// Commits on HEAD that resetting to `hash` takes off the branch.
pub fn reset_impact(repo: &Path, hash: &str) -> Result<u32> {
    check_hash(hash)?;
    let range = format!("{hash}..HEAD");
    Ok(git(repo, &["rev-list", "--count", &range, "--"])?.trim().parse().unwrap_or(0))
}

pub fn reset_to(repo: &Path, hash: &str, mode: ResetMode) -> Result<Outcome> {
    check_hash(hash)?;
    let flag = match mode {
        ResetMode::Soft => "--soft",
        ResetMode::Mixed => "--mixed",
        ResetMode::Hard => "--hard",
    };
    git(repo, &["reset", "-q", flag, hash, "--"])?;
    let branch = git(repo, &["rev-parse", "--abbrev-ref", "HEAD"])?.trim().to_owned();
    let short = &hash[..hash.len().min(7)];
    let rest = match mode {
        ResetMode::Soft => " Changes from the undone commits are staged.",
        ResetMode::Mixed => " Changes from the undone commits are in your working tree.",
        ResetMode::Hard => "",
    };
    Ok(Outcome::ok(format!("Reset {branch} to {short}.{rest}"), None))
}

// ---- A file's timeline ----

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEntry {
    pub hash: String,
    pub short: String,
    pub author: String,
    pub date_ms: u64,
    pub subject: String,
    /// What to diff against: the first parent, or the empty tree.
    pub base: String,
    /// The file as it was in this commit (its path then, and what happened to it).
    pub file: FileChange,
}

/// Commits that changed `path`, newest first, following renames.
pub fn file_timeline(repo: &Path, path: &str, limit: usize) -> Result<Vec<TimelineEntry>> {
    if run(repo, &["rev-parse", "-q", "--verify", "HEAD"])?.stdout.trim().is_empty() {
        return Ok(Vec::new());
    }
    let n = format!("-n{limit}");
    let out = git(
        repo,
        &["--literal-pathspecs", "log", "--follow", "-M", "--format=%x1e%H%x00%h%x00%P%x00%an%x00%at%x00%s", "--name-status", "-z", &n, "--", path],
    )?;
    let empty = empty_tree(repo)?;
    Ok(parse_timeline(&out, &empty))
}

/// Records start with \x1e; the header's fields are NUL-separated and end at a newline,
/// then comes the `--name-status -z` part. Merges show no file part and are skipped.
pub fn parse_timeline(out: &str, empty_tree: &str) -> Vec<TimelineEntry> {
    out.split('\x1e')
        .filter_map(|rec| {
            let (head, body) = rec.split_once('\n')?;
            let f: Vec<&str> = head.trim_end_matches('\0').splitn(6, '\0').collect();
            if f.len() < 6 {
                return None;
            }
            let file = parse_name_status(body).into_iter().next()?;
            let base = f[2].split_whitespace().next().unwrap_or(empty_tree).to_owned();
            Some(TimelineEntry {
                hash: f[0].to_owned(),
                short: f[1].to_owned(),
                author: f[3].to_owned(),
                date_ms: f[4].parse::<u64>().unwrap_or(0) * 1000,
                subject: f[5].to_owned(),
                base,
                file,
            })
        })
        .collect()
}

// ---- Blame ----

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameCommit {
    pub hash: String,
    pub short: String,
    pub author: String,
    pub date_ms: u64,
    pub summary: String,
    /// The line is only in the working tree ("Not Committed Yet").
    pub uncommitted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BlameLine {
    /// Index into `Blame::commits`.
    pub commit: u32,
    /// Line number in the working file.
    pub line: u32,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
pub struct Blame {
    pub commits: Vec<BlameCommit>,
    pub lines: Vec<BlameLine>,
    /// Stopped after `MAX_LINES`.
    pub truncated: bool,
}

/// Who last changed each line of the working-tree file.
pub fn blame_file(repo: &Path, path: &str) -> Result<Blame> {
    Ok(parse_blame(&git(repo, &["blame", "--porcelain", "--", path])?, MAX_LINES))
}

/// `git blame --porcelain`: per line a header "<hash> <orig> <final> [<count>]", the commit's
/// details the first time that commit appears, then the line itself after a tab.
pub fn parse_blame(text: &str, max_lines: usize) -> Blame {
    let mut blame = Blame::default();
    let mut current: Option<(usize, u32)> = None;
    for line in text.split('\n') {
        if let Some(content) = line.strip_prefix('\t') {
            let Some((commit, final_line)) = current.take() else { continue };
            if blame.lines.len() >= max_lines {
                blame.truncated = true;
                break;
            }
            blame.lines.push(BlameLine { commit: commit as u32, line: final_line, text: content.to_owned() });
            continue;
        }
        let mut words = line.split(' ');
        let first = words.next().unwrap_or("");
        if first.len() >= 40 && first.bytes().all(|b| b.is_ascii_hexdigit()) {
            let final_line = words.nth(1).and_then(|n| n.parse().ok()).unwrap_or(0);
            let idx = blame.commits.iter().position(|c| c.hash == first).unwrap_or_else(|| {
                blame.commits.push(BlameCommit {
                    hash: first.to_owned(),
                    short: first[..7].to_owned(),
                    author: String::new(),
                    date_ms: 0,
                    summary: String::new(),
                    uncommitted: first.bytes().all(|b| b == b'0'),
                });
                blame.commits.len() - 1
            });
            current = Some((idx, final_line));
            continue;
        }
        let Some((idx, _)) = current else { continue };
        let c = &mut blame.commits[idx];
        let rest = line.split_once(' ').map_or("", |(_, r)| r);
        match first {
            "author" => c.author = rest.to_owned(),
            "author-time" => c.date_ms = rest.parse::<u64>().unwrap_or(0) * 1000,
            "summary" => c.summary = rest.to_owned(),
            _ => {}
        }
    }
    blame
}

#[cfg(test)]
mod tests {
    use super::super::status::get_status;
    use super::super::testutil::*;
    use super::*;

    fn rows(list: &[(&str, &[&str])]) -> Vec<GraphRow> {
        let owned: Vec<(String, Vec<String>)> = list.iter().map(|(h, p)| (h.to_string(), p.iter().map(|s| s.to_string()).collect())).collect();
        layout(owned.iter().map(|(h, p)| (h.as_str(), p.as_slice())))
    }
    fn l(col: u16, color: u16) -> Lane {
        Lane { col, color }
    }
    fn row(col: u16, color: u16, through: &[Lane], up: &[Lane], down: &[Lane]) -> GraphRow {
        GraphRow { col, color, through: through.to_vec(), up: up.to_vec(), down: down.to_vec() }
    }

    #[test]
    fn layout_of_a_straight_line() {
        let r = rows(&[("c", &["b"]), ("b", &["a"]), ("a", &[])]);
        assert_eq!(r[0], row(0, 0, &[], &[], &[l(0, 0)]));
        assert_eq!(r[1], row(0, 0, &[], &[l(0, 0)], &[l(0, 0)]));
        assert_eq!(r[2], row(0, 0, &[], &[l(0, 0)], &[]));
    }

    #[test]
    fn layout_of_a_branch_and_merge() {
        // m merges c (side branch) into b; both come from a.
        let r = rows(&[("m", &["b", "c"]), ("c", &["a"]), ("b", &["a"]), ("a", &[])]);
        assert_eq!(r[0], row(0, 0, &[], &[], &[l(0, 0), l(1, 1)]));
        assert_eq!(r[1], row(1, 1, &[l(0, 0)], &[l(1, 1)], &[l(1, 1)]));
        // b's parent a is already awaited in lane 1, so b's line joins it.
        assert_eq!(r[2], row(0, 0, &[l(1, 1)], &[l(0, 0)], &[l(1, 1)]));
        assert_eq!(r[3], row(1, 1, &[], &[l(1, 1)], &[]));
    }

    #[test]
    fn layout_of_two_tips_and_lane_reuse() {
        // x and y both branch off a; later z starts a fresh history in the freed lane.
        let r = rows(&[("x", &["a"]), ("y", &["a"]), ("a", &[]), ("z", &[])]);
        assert_eq!(r[0], row(0, 0, &[], &[], &[l(0, 0)]));
        assert_eq!(r[1], row(1, 1, &[l(0, 0)], &[], &[l(0, 0)]));
        assert_eq!(r[2], row(0, 0, &[], &[l(0, 0)], &[]));
        assert_eq!(r[3], row(0, 2, &[], &[], &[]));
    }

    #[test]
    fn layout_keeps_lanes_open_past_the_page() {
        // The parent isn't loaded yet: its lane runs off the bottom.
        let r = rows(&[("b", &["a"]), ("x", &["w"])]);
        assert_eq!(r[1], row(1, 1, &[l(0, 0)], &[], &[l(1, 1)]));
    }

    #[test]
    fn parses_decorations() {
        let r = parse_refs("HEAD -> refs/heads/main, refs/remotes/origin/main, refs/remotes/origin/HEAD, tag: refs/tags/v1.0, refs/heads/feat/x, refs/stash");
        let got: Vec<_> = r.iter().map(|x| (x.name.as_str(), x.kind)).collect();
        assert_eq!(got, [("main", RefKind::Head), ("origin/main", RefKind::Remote), ("v1.0", RefKind::Tag), ("feat/x", RefKind::Branch)]);
        assert_eq!(parse_refs("HEAD")[0].kind, RefKind::Head);
        assert!(parse_refs("").is_empty());
    }

    const BLAME: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 2\nauthor Ada\nauthor-mail <a@x>\nauthor-time 1700000000\nsummary first\nfilename f.txt\n\tone\naaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 2 2\n\ttwo\n0000000000000000000000000000000000000000 3 3 1\nauthor Not Committed Yet\nauthor-time 1700000100\nsummary Version of f.txt from f.txt\nprevious aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa f.txt\nfilename f.txt\n\t\tindented\n";

    #[test]
    fn parses_blame_porcelain() {
        let b = parse_blame(BLAME, MAX_LINES);
        assert_eq!(b.commits.len(), 2);
        assert_eq!((b.commits[0].author.as_str(), b.commits[0].date_ms, b.commits[0].summary.as_str()), ("Ada", 1_700_000_000_000, "first"));
        assert!(!b.commits[0].uncommitted && b.commits[1].uncommitted);
        let lines: Vec<_> = b.lines.iter().map(|x| (x.commit, x.line, x.text.as_str())).collect();
        assert_eq!(lines, [(0, 1, "one"), (0, 2, "two"), (1, 3, "\tindented")]);
        let cut = parse_blame(BLAME, 2);
        assert!(cut.truncated && cut.lines.len() == 2);
    }

    #[test]
    fn parses_name_status_with_renames() {
        let f = parse_name_status("M\0a.ts\0R087\0old.ts\0new.ts\0A\0b c.ts\0D\0gone.ts\0");
        let got: Vec<_> = f.iter().map(|x| (x.path.as_str(), x.orig_path.as_deref(), x.kind)).collect();
        assert_eq!(
            got,
            [
                ("a.ts", None, ChangeKind::Modified),
                ("new.ts", Some("old.ts"), ChangeKind::Renamed),
                ("b c.ts", None, ChangeKind::Added),
                ("gone.ts", None, ChangeKind::Deleted)
            ]
        );
    }

    #[test]
    fn rejects_anything_but_a_hash() {
        let repo = make_repo(&[("a.ts", "a\n")]);
        for bad in ["--all", "HEAD", "main..x", "abc"] {
            assert!(commit_detail(&repo, bad).is_err(), "{bad}");
            assert!(reset_to(&repo, bad, ResetMode::Hard).is_err(), "{bad}");
        }
    }

    fn commit_file(repo: &Path, rel: &str, content: &str, msg: &str) -> String {
        write(repo, rel, content);
        sh(repo, &["add", "-A"]);
        sh(repo, &["commit", "-q", "-m", msg]);
        sh(repo, &["rev-parse", "HEAD"]).trim().to_owned()
    }

    #[test]
    fn history_marks_incoming_and_outgoing_and_pages() {
        let r = with_remote(&[("a.ts", "a\n")]);
        commit_file(&r.teammate, "t.ts", "t\n", "theirs");
        sh(&r.teammate, &["push", "-q"]);
        commit_file(&r.me, "m.ts", "m\n", "mine");
        sh(&r.me, &["fetch", "-q"]);

        let h = history(&r.me, PAGE, false).unwrap();
        assert_eq!(h.upstream.as_deref(), Some("origin/main"));
        let by: std::collections::HashMap<_, _> = h.commits.iter().map(|c| (c.subject.as_str(), c)).collect();
        assert!(by["mine"].outgoing && by["mine"].is_head && !by["mine"].incoming);
        assert!(by["theirs"].incoming && !by["theirs"].outgoing);
        assert!(!by["init"].incoming && !by["init"].outgoing);
        assert!(by["mine"].refs.iter().any(|x| x.kind == RefKind::Head && x.name == "main"));
        assert!(by["theirs"].refs.iter().any(|x| x.kind == RefKind::Remote && x.name == "origin/main"));
        // Two tips over one root: two lanes that meet at init.
        assert_eq!(h.commits.last().unwrap().subject, "init");
        assert_eq!(h.commits.iter().map(|c| c.graph.col).max(), Some(1));
        assert!(!h.more);

        let page = history(&r.me, 2, false).unwrap();
        assert!(page.more && page.commits.len() == 2);

        sh(&r.me, &["tag", "v1", "HEAD~1"]);
        sh(&r.me, &["branch", "side", "HEAD~1"]);
        let all = history(&r.me, PAGE, true).unwrap();
        assert_eq!(all.commits.len(), 3);
        assert!(all.commits.iter().any(|c| c.refs.iter().any(|x| x.kind == RefKind::Tag && x.name == "v1")));

        let fresh = empty_repo();
        assert!(history(&fresh, PAGE, false).unwrap().commits.is_empty());
    }

    #[test]
    fn commit_detail_and_comparisons() {
        let repo = make_repo(&[("a.ts", "one\ntwo\nthree\nfour\nfive\n"), ("keep.ts", "k\n")]);
        let root = sh(&repo, &["rev-parse", "HEAD"]).trim().to_owned();
        sh(&repo, &["mv", "a.ts", "b.ts"]);
        write(&repo, "b.ts", "one\ntwo\nthree\nfour\nfive\nsix\n");
        write(&repo, "new.ts", "n\n");
        sh(&repo, &["add", "-A"]);
        sh(&repo, &["commit", "-q", "-m", "move\n\nWith a body."]);
        let second = sh(&repo, &["rev-parse", "HEAD"]).trim().to_owned();

        let d = commit_detail(&repo, &second).unwrap();
        assert_eq!((d.message.as_str(), d.author.as_str(), d.base.as_str()), ("move\n\nWith a body.", "Test", root.as_str()));
        let files: Vec<_> = d.files.iter().map(|f| (f.path.as_str(), f.orig_path.as_deref(), f.kind)).collect();
        assert_eq!(files, [("b.ts", Some("a.ts"), ChangeKind::Renamed), ("new.ts", None, ChangeKind::Added)]);
        let diff = compare_file_diff(&repo, &d.base, Some(&d.hash), &d.files[0]).unwrap();
        let added: Vec<_> = diff.hunks.iter().flat_map(|h| &h.lines).filter(|l| l.kind == super::super::diff::LineKind::Add).map(|l| l.text.as_str()).collect();
        assert_eq!(added, ["six"]);

        // A root commit compares against the empty tree.
        let r = commit_detail(&repo, &root).unwrap();
        assert_eq!(r.files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), ["a.ts", "keep.ts"]);
        assert_eq!(compare_file_diff(&repo, &r.base, Some(&root), &r.files[1]).unwrap().hunks[0].lines[0].text, "k");

        // Commit ↔ working tree.
        write(&repo, "keep.ts", "changed\n");
        let wt = compare_files(&repo, &root, None).unwrap();
        assert!(wt.iter().any(|f| f.path == "keep.ts" && f.kind == ChangeKind::Modified));
        let kd = compare_file_diff(&repo, &root, None, &FileChange { path: "keep.ts".into(), orig_path: None, kind: ChangeKind::Modified }).unwrap();
        assert_eq!(kd.hunks[0].lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>(), ["k", "changed"]);
    }

    #[test]
    fn revert_and_cherry_pick() {
        let repo = make_repo(&[("a.ts", "a\n")]);
        let bad = commit_file(&repo, "a.ts", "oops\n", "bad change");
        let r = revert_commit(&repo, &bad).unwrap();
        assert!(r.ok, "{r:?}");
        assert_eq!(read(&repo, "a.ts"), "a\n");
        assert!(log(&repo, "HEAD")[0].starts_with("Revert \"bad change\""));
        // Reverting it again finds nothing to undo and leaves no revert in progress.
        let again = revert_commit(&repo, &bad).unwrap();
        assert!(!again.ok, "{again:?}");
        assert_eq!(in_progress_operation(&repo).unwrap(), None);

        sh(&repo, &["switch", "-q", "-c", "side"]);
        let pick = commit_file(&repo, "b.ts", "b\n", "useful");
        sh(&repo, &["switch", "-q", "main"]);
        assert!(cherry_pick(&repo, &pick).unwrap().ok);
        assert_eq!(read(&repo, "b.ts"), "b\n");
        assert_eq!(log(&repo, "HEAD")[0], "useful");
        let dup = cherry_pick(&repo, &pick).unwrap();
        assert!(!dup.ok && dup.message.contains("already here"), "{dup:?}");
        assert_eq!(in_progress_operation(&repo).unwrap(), None);
    }

    #[test]
    fn a_conflicting_cherry_pick_stays_in_progress() {
        let repo = make_repo(&[("a.ts", "a\n")]);
        sh(&repo, &["switch", "-q", "-c", "side"]);
        let theirs = commit_file(&repo, "a.ts", "theirs\n", "side edit");
        sh(&repo, &["switch", "-q", "main"]);
        commit_file(&repo, "a.ts", "ours\n", "main edit");
        let r = cherry_pick(&repo, &theirs).unwrap();
        assert!(!r.ok && r.message.contains("conflicts"), "{r:?}");
        assert_eq!(in_progress_operation(&repo).unwrap(), Some(Operation::CherryPick));
        assert_eq!(get_status(&repo).unwrap().parsed.conflicted.len(), 1);
        super::super::branches::abort_operation(&repo).unwrap();
        assert_eq!(read(&repo, "a.ts"), "ours\n");
    }

    #[test]
    fn reset_modes() {
        let repo = make_repo(&[("a.ts", "a\n")]);
        let base = sh(&repo, &["rev-parse", "HEAD"]).trim().to_owned();
        commit_file(&repo, "a.ts", "a2\n", "two");
        commit_file(&repo, "b.ts", "b\n", "three");
        assert_eq!(reset_impact(&repo, &base).unwrap(), 2);

        let r = reset_to(&repo, &base, ResetMode::Soft).unwrap();
        assert_eq!(r.message, "Reset main to ".to_owned() + &base[..7] + ". Changes from the undone commits are staged.");
        let s = get_status(&repo).unwrap().parsed;
        assert_eq!((s.staged.len(), s.unstaged.len()), (2, 0));

        sh(&repo, &["commit", "-q", "-m", "again"]);
        reset_to(&repo, &base, ResetMode::Mixed).unwrap();
        let s = get_status(&repo).unwrap().parsed;
        assert_eq!((s.staged.len(), s.unstaged.len()), (0, 2));

        sh(&repo, &["add", "-A"]);
        sh(&repo, &["commit", "-q", "-m", "again"]);
        write(&repo, "a.ts", "dirty\n");
        reset_to(&repo, &base, ResetMode::Hard).unwrap();
        assert_eq!(read(&repo, "a.ts"), "a\n");
        assert!(!repo.join("b.ts").exists());
        assert_eq!(log(&repo, "HEAD"), ["init"]);
    }

    #[test]
    fn timeline_follows_renames() {
        let body = "line one\nline two\nline three\nline four\nline five\n";
        let repo = make_repo(&[("old.ts", body), ("other.ts", "x\n")]);
        commit_file(&repo, "old.ts", &format!("{body}six\n"), "edit old");
        sh(&repo, &["mv", "old.ts", "new.ts"]);
        sh(&repo, &["commit", "-q", "-m", "rename"]);
        commit_file(&repo, "other.ts", "y\n", "unrelated");
        commit_file(&repo, "new.ts", &format!("{body}six\nseven\n"), "edit new");

        let t = file_timeline(&repo, "new.ts", 50).unwrap();
        let got: Vec<_> = t.iter().map(|e| (e.subject.as_str(), e.file.path.as_str(), e.file.kind)).collect();
        assert_eq!(
            got,
            [
                ("edit new", "new.ts", ChangeKind::Modified),
                ("rename", "new.ts", ChangeKind::Renamed),
                ("edit old", "old.ts", ChangeKind::Modified),
                ("init", "old.ts", ChangeKind::Added)
            ]
        );
        assert_eq!(t[1].file.orig_path.as_deref(), Some("old.ts"));
        // Each entry's diff is that commit's change to the file, at its path then.
        let d = compare_file_diff(&repo, &t[2].base, Some(&t[2].hash), &t[2].file).unwrap();
        assert_eq!(d.hunks[0].lines.last().unwrap().text, "six");
        let first = compare_file_diff(&repo, &t[3].base, Some(&t[3].hash), &t[3].file).unwrap();
        assert_eq!(first.hunks[0].lines[0].text, "line one");

        assert!(file_timeline(&empty_repo(), "x", 50).unwrap().is_empty());
    }

    #[test]
    fn blame_includes_uncommitted_lines() {
        let repo = make_repo(&[("f.txt", "one\n")]);
        commit_file(&repo, "f.txt", "one\ntwo\n", "add two");
        write(&repo, "f.txt", "one\ntwo\nthree\n");
        let b = blame_file(&repo, "f.txt").unwrap();
        let who: Vec<_> = b.lines.iter().map(|l| {
            let c = &b.commits[l.commit as usize];
            (l.text.as_str(), if c.uncommitted { "uncommitted" } else { c.summary.as_str() })
        }).collect();
        assert_eq!(who, [("one", "init"), ("two", "add two"), ("three", "uncommitted")]);
    }
}
