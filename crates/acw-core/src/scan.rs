//! Secret scanning. Every piece of text that leaves a sandbox passes through `redact`
//! before it is stored or shown.

use regex::Regex;
use std::sync::OnceLock;

fn patterns() -> &'static Vec<(&'static str, Regex)> {
    static P: OnceLock<Vec<(&'static str, Regex)>> = OnceLock::new();
    P.get_or_init(|| {
        [
            ("private key", r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
            ("AWS access key", r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
            ("GitHub token", r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b"),
            ("API key", r"\bsk-[A-Za-z0-9_\-]{20,}\b"),
            ("Slack token", r"\bxox[abprs]-[A-Za-z0-9\-]{10,}\b"),
            ("JWT", r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b"),
            ("credential in URL", r"://[^/\s:@]+:[^/\s:@]{4,}@"),
            (
                "password assignment",
                r#"(?i)\b[A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY)[A-Z0-9_]*\s*[=:]\s*["']?[^\s"']{6,}"#,
            ),
        ]
        .into_iter()
        .map(|(n, p)| (n, Regex::new(p).expect("valid pattern")))
        .collect()
    })
}

/// Returns the text with secrets replaced, and the kinds that were found.
pub fn redact(text: &str) -> (String, Vec<&'static str>) {
    let mut out = text.to_owned();
    let mut found = Vec::new();
    for (name, re) in patterns() {
        if re.is_match(&out) {
            found.push(*name);
            out = re
                .replace_all(&out, |c: &regex::Captures| {
                    let m = &c[0];
                    // keep the variable name of an assignment so the log still reads
                    match m.find(['=', ':']) {
                        Some(i) if *name == "password assignment" => format!("{}=[已打码]", m[..i].trim_end()),
                        _ if *name == "credential in URL" => "://[已打码]@".to_owned(),
                        _ => "[已打码]".to_owned(),
                    }
                })
                .into_owned();
        }
    }
    (out, found)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_common_secrets() {
        let (t, kinds) = redact("export CLICKHOUSE_PASSWORD=hunter2hunter2 and key sk-abcdefghijklmnopqrstuvwx");
        assert!(!t.contains("hunter2"), "{t}");
        assert!(!t.contains("sk-abcdefghijklmnopqrstuvwx"));
        assert!(t.contains("CLICKHOUSE_PASSWORD=[已打码]"));
        assert!(kinds.contains(&"API key") && kinds.contains(&"password assignment"));
    }

    #[test]
    fn leaves_ordinary_text_alone() {
        let src = "cargo test passed: 42 tests, token bucket refill ok";
        let (t, kinds) = redact(src);
        assert_eq!(t, src);
        assert!(kinds.is_empty());
    }

    #[test]
    fn redacts_url_credentials_and_keys() {
        let (t, _) = redact("git clone https://bot:ghp_0123456789abcdefghijklmnopqrstuv@github.com/a/b");
        assert!(!t.contains("ghp_"), "{t}");
    }
}
