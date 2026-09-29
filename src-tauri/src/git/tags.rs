//! Tags and remotes.

use std::path::Path;

use serde::Serialize;

use super::{git, run, Result};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub name: String,
    /// The commit it points at (abbreviated).
    pub commit: String,
    /// Annotated tags carry their own message; lightweight ones show the commit subject.
    pub annotated: bool,
    pub subject: String,
    pub date_ms: u64,
}

const TAG_FORMAT: &str = "%(refname:short)%00%(objecttype)%00%(objectname:short)%00%(*objectname:short)%00%(creatordate:unix)%00%(contents:subject)";

/// Newest first.
pub fn list_tags(repo: &Path) -> Result<Vec<Tag>> {
    let fmt = format!("--format={TAG_FORMAT}");
    let out = git(repo, &["for-each-ref", "--sort=-creatordate", &fmt, "refs/tags"])?;
    Ok(out
        .lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.splitn(6, '\0').collect();
            if f.len() < 6 {
                return None;
            }
            let annotated = f[1] == "tag";
            Some(Tag {
                name: f[0].to_owned(),
                commit: if annotated { f[3] } else { f[2] }.to_owned(),
                annotated,
                subject: f[5].to_owned(),
                date_ms: f[4].parse::<u64>().unwrap_or(0) * 1000,
            })
        })
        .collect())
}

fn check_tag_name(repo: &Path, name: &str) -> Result<()> {
    let ok = !name.trim().is_empty() && !name.starts_with('-') && run(repo, &["check-ref-format", &format!("refs/tags/{name}")])?.ok();
    if ok {
        Ok(())
    } else {
        Err(format!("\"{name}\" isn't a valid tag name."))
    }
}

/// Annotated when there's a message, lightweight otherwise. `target` defaults to HEAD.
pub fn create_tag(repo: &Path, name: &str, message: &str, target: Option<&str>) -> Result<()> {
    check_tag_name(repo, name)?;
    let mut args = vec!["tag"];
    if !message.trim().is_empty() {
        args.extend(["-a", "-m", message]);
    }
    args.push(name);
    if let Some(t) = target {
        args.push(t);
    }
    git(repo, &args).map(drop)
}

pub fn delete_tag(repo: &Path, name: &str) -> Result<()> {
    git(repo, &["tag", "-d", name]).map(drop)
}

pub fn push_tag(repo: &Path, remote: &str, name: &str) -> Result<()> {
    git(repo, &["push", remote, &format!("refs/tags/{name}")]).map(drop)
}

pub fn delete_remote_tag(repo: &Path, remote: &str, name: &str) -> Result<()> {
    git(repo, &["push", remote, "--delete", &format!("refs/tags/{name}")]).map(drop)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    pub name: String,
    pub fetch_url: String,
    pub push_url: String,
}

pub fn list_remotes(repo: &Path) -> Result<Vec<Remote>> {
    let mut remotes: Vec<Remote> = Vec::new();
    // "origin\thttps://… (fetch)"
    for line in git(repo, &["remote", "-v"])?.lines() {
        let Some((name, rest)) = line.split_once('\t') else { continue };
        let Some((url, kind)) = rest.rsplit_once(' ') else { continue };
        let i = match remotes.iter().position(|r| r.name == name) {
            Some(i) => i,
            None => {
                remotes.push(Remote { name: name.to_owned(), fetch_url: String::new(), push_url: String::new() });
                remotes.len() - 1
            }
        };
        if kind == "(push)" {
            remotes[i].push_url = url.to_owned();
        } else {
            remotes[i].fetch_url = url.to_owned();
        }
    }
    Ok(remotes)
}

pub fn add_remote(repo: &Path, name: &str, url: &str) -> Result<()> {
    let bad = |s: &str| s.trim().is_empty() || s.starts_with('-') || s.chars().any(char::is_whitespace);
    if bad(name) {
        return Err(format!("\"{name}\" isn't a valid remote name."));
    }
    if bad(url) {
        return Err("That doesn't look like a repository URL.".into());
    }
    git(repo, &["remote", "add", name, url]).map(drop)
}

pub fn remove_remote(repo: &Path, name: &str) -> Result<()> {
    git(repo, &["remote", "remove", name]).map(drop)
}

pub fn fetch_remote(repo: &Path, name: &str) -> Result<()> {
    git(repo, &["fetch", "--prune", "--quiet", name]).map(drop)
}

#[cfg(test)]
mod tests {
    use super::super::testutil::*;
    use super::*;

    #[test]
    fn lightweight_and_annotated_tags_round_trip_to_the_remote() {
        let r = with_remote(&[("a.ts", "a\n")]);
        let head = sh(&r.me, &["rev-parse", "--short", "HEAD"]).trim().to_owned();
        assert!(create_tag(&r.me, "bad tag", "", None).is_err());
        create_tag(&r.me, "v1.0.0", "", None).unwrap();
        create_tag(&r.me, "v1.1.0", "Release 1.1", Some("HEAD")).unwrap();

        let tags = list_tags(&r.me).unwrap();
        let v11 = tags.iter().find(|t| t.name == "v1.1.0").unwrap();
        assert!(v11.annotated && v11.subject == "Release 1.1" && v11.commit == head);
        let v10 = tags.iter().find(|t| t.name == "v1.0.0").unwrap();
        assert!(!v10.annotated && v10.commit == head && v10.subject == "init");

        push_tag(&r.me, "origin", "v1.1.0").unwrap();
        assert_eq!(sh(&r.remote, &["tag"]).trim(), "v1.1.0");
        delete_remote_tag(&r.me, "origin", "v1.1.0").unwrap();
        assert_eq!(sh(&r.remote, &["tag"]).trim(), "");
        delete_tag(&r.me, "v1.0.0").unwrap();
        assert_eq!(list_tags(&r.me).unwrap().len(), 1);
    }

    #[test]
    fn remotes_add_list_fetch_remove() {
        let r = with_remote(&[("a.ts", "a\n")]);
        assert!(add_remote(&r.me, "-x", "u").is_err());
        assert!(add_remote(&r.me, "mirror", "--upload-pack=evil").is_err());
        add_remote(&r.me, "mirror", &r.remote.to_string_lossy()).unwrap();
        let names: Vec<_> = list_remotes(&r.me).unwrap().into_iter().map(|x| x.name).collect();
        assert_eq!(names, ["mirror", "origin"]);
        fetch_remote(&r.me, "mirror").unwrap();
        assert!(sh(&r.me, &["branch", "-r"]).contains("mirror/main"));
        remove_remote(&r.me, "mirror").unwrap();
        assert_eq!(list_remotes(&r.me).unwrap().len(), 1);
        assert!(!list_remotes(&r.me).unwrap()[0].fetch_url.is_empty());
    }
}
