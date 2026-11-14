//! Code index. One pass of `git grep` over the base branch, kept as a file per project:
//!
//!   symbols   function, type and class names per file
//!   access    tables, topics and HTTP routes a file touches, found as literals in the source
//!
//! It answers three questions: which modules a requirement is probably about when it names a
//! symbol or a file instead of a module; what to show the Worker as a map of the repository;
//! and how stale the picture is. It is extracted with regular expressions, not a compiler:
//! every access edge is `static` (a literal seen in the code), nothing is resolved across files.

use crate::engine::*;
use acw_core::*;
use acw_git::git;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

const SOURCES: [&str; 14] = ["*.go", "*.rs", "*.py", "*.js", "*.jsx", "*.ts", "*.tsx", "*.java", "*.kt", "*.rb", "*.php", "*.sh", "*.sql", "*.c"];
const SYMBOL: &str = r"^[[:space:]]*(export[[:space:]]+)?(default[[:space:]]+)?(pub(\([a-z]+\))?[[:space:]]+)?(async[[:space:]]+)?(func|function|def|class|fn|type|interface|struct|enum|trait)[[:space:]]+(\([^)]*\)[[:space:]]*)?[A-Za-z_][A-Za-z0-9_]*";
const ACCESS: &str = r#"(FROM|INTO|UPDATE|JOIN|TABLE)[[:space:]]+[`"]?[a-z_][a-z0-9_.]*|[Tt]opic[^"']{0,24}["'][A-Za-z0-9_.-]+["']|\.(get|post|put|delete|patch|GET|POST|PUT|DELETE|PATCH|HandleFunc|route)\(["']/[^"']*["']"#;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Access {
    pub file: String,
    /// `table`, `topic` or `route`.
    pub kind: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct CodeIndex {
    pub project: String,
    pub commit: String,
    pub built: Ms,
    /// file -> symbols defined in it
    pub symbols: BTreeMap<String, Vec<String>>,
    pub access: Vec<Access>,
}

fn symbol_name(line: &str) -> Option<String> {
    let re = regex::Regex::new(r"(?:func|function|def|class|fn|type|interface|struct|enum|trait)\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)").ok()?;
    re.captures(line).map(|c| c[1].to_owned())
}

fn access_of(file: &str, line: &str) -> Vec<Access> {
    let mut out = Vec::new();
    let table = regex::Regex::new(r#"\b(?:FROM|INTO|UPDATE|JOIN|TABLE)\s+[`"]?([a-z_][a-z0-9_.]*)"#).expect("valid");
    let topic = regex::Regex::new(r#"[Tt]opic[^"']{0,24}["']([A-Za-z0-9_.-]+)["']"#).expect("valid");
    let route = regex::Regex::new(r#"\.(?:get|post|put|delete|patch|GET|POST|PUT|DELETE|PATCH|HandleFunc|route)\(["'](/[^"']*)["']"#).expect("valid");
    const NOT_TABLES: [&str; 8] = ["set", "select", "where", "values", "table", "if", "the", "exists"];
    for c in table.captures_iter(line) {
        if !NOT_TABLES.contains(&&c[1]) {
            out.push(Access { file: file.to_owned(), kind: "table".into(), name: c[1].to_owned() });
        }
    }
    for c in topic.captures_iter(line) {
        out.push(Access { file: file.to_owned(), kind: "topic".into(), name: c[1].to_owned() });
    }
    for c in route.captures_iter(line) {
        out.push(Access { file: file.to_owned(), kind: "route".into(), name: c[1].to_owned() });
    }
    out
}

/// `git grep` prints `<rev>:<path>:<line>`; a rev is a hex commit here, so the first two colons delimit.
fn split_grep(line: &str) -> Option<(&str, &str)> {
    let rest = line.split_once(':')?.1;
    rest.split_once(':')
}

impl CodeIndex {
    /// Modules a text is probably about: it names a symbol defined in the module, or one of its files.
    pub fn modules_for(&self, p: &Project, text: &str) -> Vec<String> {
        let words: BTreeSet<&str> = text.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '/' || c == '-')).filter(|w| w.len() >= 4).collect();
        let mut out: Vec<String> = Vec::new();
        for (file, symbols) in &self.symbols {
            let base = file.rsplit('/').next().unwrap_or(file);
            let named = words.contains(file.as_str()) || words.contains(base) || symbols.iter().any(|s| s.len() >= 4 && words.contains(s.as_str()));
            if named {
                for m in p.modules_of_path(file) {
                    if !out.contains(&m.name) {
                        out.push(m.name.clone());
                    }
                }
            }
        }
        out
    }

    /// A short map of the repository for the Worker: per module, its files and what they define and touch.
    pub fn repo_map(&self, p: &Project, max_lines: usize) -> String {
        let mut lines = Vec::new();
        for m in &p.modules {
            let files: Vec<(&String, &Vec<String>)> = self.symbols.iter().filter(|(f, _)| m.paths.iter().any(|pre| f.starts_with(pre.as_str()))).collect();
            if files.is_empty() {
                continue;
            }
            lines.push(format!("模块“{}”{}", m.name, m.confirm.as_ref().map(|r| format!("（改动要确认：{r}）")).unwrap_or_default()));
            for (f, syms) in files.iter().take(8) {
                let touches: Vec<String> = self.access.iter().filter(|a| &&a.file == f).map(|a| format!("{} {}", a.kind, a.name)).collect::<BTreeSet<_>>().into_iter().collect();
                lines.push(format!("  {f}：{}{}", syms.iter().take(8).cloned().collect::<Vec<_>>().join("、"), if touches.is_empty() { String::new() } else { format!("；访问 {}", touches.join("、")) }));
            }
        }
        lines.truncate(max_lines);
        lines.join("\n")
    }
}

impl Engine {
    fn index_path(&self, project: &str) -> std::path::PathBuf {
        self.cfg.data_dir.join("index").join(format!("{project}.json"))
    }

    pub fn load_index(&self, project: &str) -> Option<CodeIndex> {
        serde_json::from_slice(&std::fs::read(self.index_path(project)).ok()?).ok()
    }

    /// Build the index of a project's base branch as the mirror has it now.
    pub async fn build_index(&self, project: &str) -> Result<IndexInfo> {
        let p = self.project(project)?;
        self.git.sync(&p.id, &self.forge.remote(&p.repo)).await?;
        let commit = self.git.base_tip(&p.id, &p.base_branch).await?.ok_or_else(|| not_found(format!("仓库里没有分支 {}", p.base_branch)))?;
        let dir = self.git.mirror(&p.id);
        let grep = |pattern: &'static str| {
            let (dir, commit) = (dir.clone(), commit.clone());
            async move {
                let mut args: Vec<&str> = vec!["grep", "-I", "-h", "--full-name", "-n", "-E", pattern, &commit, "--"];
                args.extend(SOURCES);
                // -h drops the file name, which we need: run without it
                args.retain(|a| *a != "-h" && *a != "-n");
                Ok::<String, anyhow::Error>(git(&dir, &args).await.unwrap_or_default())
            }
        };
        let mut idx = CodeIndex { project: p.id.clone(), commit: commit.clone(), built: now_ms(), ..Default::default() };
        for line in grep(SYMBOL).await?.lines() {
            if let Some((file, code)) = split_grep(line) {
                if let Some(name) = symbol_name(code) {
                    let list = idx.symbols.entry(file.to_owned()).or_default();
                    if !list.contains(&name) && list.len() < 200 {
                        list.push(name);
                    }
                }
            }
        }
        for line in grep(ACCESS).await?.lines() {
            if let Some((file, code)) = split_grep(line) {
                for a in access_of(file, code) {
                    if !idx.access.contains(&a) {
                        idx.access.push(a);
                    }
                }
            }
        }
        tokio::fs::create_dir_all(self.cfg.data_dir.join("index")).await?;
        tokio::fs::write(self.index_path(&p.id), serde_json::to_vec(&idx)?).await?;
        let info = IndexInfo { project: p.id.clone(), commit, built: idx.built, files: idx.symbols.len() as u32, symbols: idx.symbols.values().map(|v| v.len() as u32).sum(), access: idx.access.len() as u32 };
        self.store.write(|tx| tx.emit("engine", None, Event::IndexBuilt { info: info.clone() }).map(|_| ()))?;
        Ok(info)
    }

    /// Modules the index associates with a text. Empty when there is no index.
    pub fn hint_modules(&self, project: &str, text: &str) -> Vec<String> {
        match (self.load_index(project), self.store.read(|v| v.project(project)).ok().flatten()) {
            (Some(idx), Some(p)) => idx.modules_for(&p, text),
            _ => Vec::new(),
        }
    }

    /// How many commits the base branch has moved since the index was built. Past 20 the index is
    /// treated as unreliable and says so.
    pub async fn index_behind(&self, project: &str) -> Result<Option<u32>> {
        let Some(info) = self.store.read(|v| v.index_info(project))? else { return Ok(None) };
        let p = self.project(project)?;
        let Some(tip) = self.git.base_tip(&p.id, &p.base_branch).await? else { return Ok(None) };
        let n = git(&self.git.mirror(&p.id), &["rev-list", "--count", &format!("{}..{tip}", info.commit)]).await.ok().and_then(|s| s.trim().parse().ok());
        Ok(n)
    }

    /// Precision and recall of module prediction over the pull requests opened so far.
    pub fn index_quality(&self) -> Result<(u32, u32, u32)> {
        let (mut hit, mut predicted, mut actual) = (0u32, 0u32, 0u32);
        for e in self.store.read(|v| v.events_of_kind("modules_scored", 2000))? {
            if let Event::ModulesScored { predicted: p, actual: a } = e.event {
                hit += p.iter().filter(|m| a.contains(m)).count() as u32;
                predicted += p.len() as u32;
                actual += a.len() as u32;
            }
        }
        Ok((hit, predicted, actual))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn symbols_and_access_are_read_from_source_lines() {
        assert_eq!(symbol_name("func (w *Wallet) Deduct(ctx context.Context, n int64) error {").as_deref(), Some("Deduct"));
        assert_eq!(symbol_name("export async function loadUsage(id) {").as_deref(), Some("loadUsage"));
        assert_eq!(symbol_name("    pub fn open(path: &Path) -> Result<Self> {").as_deref(), Some("open"));
        assert_eq!(symbol_name("class BillingService:").as_deref(), Some("BillingService"));
        let a = access_of("billing/wallet.go", r#"db.Exec("UPDATE wallets SET balance = balance - ? WHERE uid = ?", n, uid)"#);
        assert_eq!(a, [Access { file: "billing/wallet.go".into(), kind: "table".into(), name: "wallets".into() }]);
        let a = access_of("web/server.js", "app.get('/api/wallet', handler); producer.send({ topic: 'usage.events' })");
        let kinds: Vec<(&str, &str)> = a.iter().map(|x| (x.kind.as_str(), x.name.as_str())).collect();
        assert!(kinds.contains(&("route", "/api/wallet")) && kinds.contains(&("topic", "usage.events")), "{kinds:?}");
        assert_eq!(split_grep("5f79eed0:billing/wallet.go:func Deduct() {"), Some(("billing/wallet.go", "func Deduct() {")));
    }
}
