//! Engine configuration, read from a TOML file. Secrets are never in the file: it names the
//! environment variables that hold them.

use serde::Deserialize;
use std::path::PathBuf;

#[derive(Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Config {
    pub listen: String,
    pub data_dir: PathBuf,
    /// Base URL people open the console at; used in notification links.
    pub public_url: String,
    /// Base URL sandboxes use to reach the model gateway. With Firecracker this is the tap's host address.
    pub gateway_url: String,
    /// `token`: every API call needs a member token. `none`: everyone is the first admin (development only).
    pub auth: String,
    /// Directory with the console's static files.
    pub console_dir: PathBuf,
    /// Environment variable with the shared token for `POST /webhooks/issues`.
    pub issues_token_env: String,
    pub forge: ForgeCfg,
    pub sandbox: SandboxCfg,
    pub worker: WorkerCfg,
    pub feishu: FeishuCfg,
    pub standby: StandbyCfg,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(default)]
pub struct ForgeCfg {
    /// `github` or `local`.
    pub kind: String,
    pub api: String,
    pub token_env: String,
    pub webhook_secret_env: String,
    /// How often to poll open pull requests, as a fallback for webhooks.
    pub poll_seconds: u64,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(default)]
pub struct SandboxCfg {
    /// `local`, `firecracker`, or `remote` (sandbox hosts on other machines).
    pub provider: String,
    /// The local provider gives no isolation. It is refused unless this is set.
    pub allow_unisolated: bool,
    /// `host:port` pairs sandboxes may reach besides the model gateway (a package mirror, usually).
    pub egress: Vec<String>,
    pub firecracker: FirecrackerToml,
    pub remote: RemoteToml,
}

/// Machines running `acw sandbox-host`. A new sandbox goes to the one with the fewest.
#[derive(Deserialize, Clone, Debug)]
#[serde(default)]
pub struct RemoteToml {
    pub hosts: Vec<String>,
    /// Environment variable with the token shared with the sandbox hosts.
    pub token_env: String,
}

impl Default for RemoteToml {
    fn default() -> Self {
        RemoteToml { hosts: Vec::new(), token_env: "ACW_SANDBOX_TOKEN".into() }
    }
}

#[derive(Deserialize, Clone, Debug)]
#[serde(default)]
pub struct FirecrackerToml {
    pub bin: String,
    pub kernel: PathBuf,
    pub templates: PathBuf,
    pub default_template: String,
    pub ssh_key: PathBuf,
    pub vcpus: u32,
    pub mem_mib: u32,
    pub net_prefix: String,
    pub host_name: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(default)]
pub struct WorkerCfg {
    /// `codex` or `scripted` (runs `scripted_cmd`; for tests and demos).
    pub agent: String,
    pub codex_bin: String,
    pub scripted_cmd: String,
    /// One Worker run may take this long.
    pub run_minutes: u64,
    /// No output for this long counts as stuck.
    pub idle_minutes: u64,
    /// Timeout of one project command (build, test, E2E).
    pub command_minutes: u64,
    /// How long a task waits before trying an unavailable model again.
    pub retry_seconds: u64,
}

/// Hot standby. A node with `primary` set starts as a read-only follower of that address and
/// stays one until it is promoted. A primary with `peers` set watches them and stops taking
/// commands as soon as one of them reports a newer epoch.
#[derive(Deserialize, Clone, Debug)]
#[serde(default)]
pub struct StandbyCfg {
    pub primary: String,
    pub peers: Vec<String>,
    /// Environment variable with the shared token of the replication endpoints.
    pub token_env: String,
}

impl Default for StandbyCfg {
    fn default() -> Self {
        StandbyCfg { primary: String::new(), peers: Vec::new(), token_env: "ACW_REPLICA_TOKEN".into() }
    }
}

#[derive(Deserialize, Clone, Debug)]
#[serde(default)]
pub struct FeishuCfg {
    /// Environment variable holding a Feishu custom-bot webhook URL (outbound notifications).
    pub webhook_env: String,
    /// Open platform address. Lark tenants use https://open.larksuite.com.
    pub base: String,
    /// Inbound messages need a self-built app: its id and secret (to reply), and the verification
    /// token and encrypt key from its event subscription page (to trust what arrives).
    pub app_id_env: String,
    pub app_secret_env: String,
    pub verify_token_env: String,
    pub encrypt_key_env: String,
    /// In a group the bot only reacts to messages that @ it. When set, the mention must carry this name.
    pub bot_name: String,
}

impl Default for FeishuCfg {
    fn default() -> Self {
        FeishuCfg {
            webhook_env: "FEISHU_WEBHOOK".into(),
            base: "https://open.feishu.cn".into(),
            app_id_env: "FEISHU_APP_ID".into(),
            app_secret_env: "FEISHU_APP_SECRET".into(),
            verify_token_env: "FEISHU_VERIFY_TOKEN".into(),
            encrypt_key_env: "FEISHU_ENCRYPT_KEY".into(),
            bot_name: String::new(),
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Config {
            listen: "127.0.0.1:8787".into(),
            data_dir: "./data".into(),
            public_url: "http://127.0.0.1:8787".into(),
            gateway_url: "http://127.0.0.1:8787".into(),
            auth: "token".into(),
            console_dir: "./console".into(),
            issues_token_env: "ACW_ISSUE_TOKEN".into(),
            forge: ForgeCfg::default(),
            sandbox: SandboxCfg::default(),
            worker: WorkerCfg::default(),
            feishu: FeishuCfg::default(),
            standby: StandbyCfg::default(),
        }
    }
}
impl Default for ForgeCfg {
    fn default() -> Self {
        ForgeCfg { kind: "github".into(), api: "https://api.github.com".into(), token_env: "GITHUB_TOKEN".into(), webhook_secret_env: "GITHUB_WEBHOOK_SECRET".into(), poll_seconds: 60 }
    }
}
impl Default for SandboxCfg {
    fn default() -> Self {
        SandboxCfg { provider: "firecracker".into(), allow_unisolated: false, egress: Vec::new(), firecracker: FirecrackerToml::default(), remote: RemoteToml::default() }
    }
}
impl Default for FirecrackerToml {
    fn default() -> Self {
        FirecrackerToml {
            bin: "firecracker".into(), kernel: "/var/lib/acw/vmlinux".into(), templates: "/var/lib/acw/templates".into(), default_template: "base".into(),
            ssh_key: "/var/lib/acw/id_ed25519".into(), vcpus: 2, mem_mib: 4096, net_prefix: "172.30".into(), host_name: "node-1".into(),
        }
    }
}
impl Default for WorkerCfg {
    fn default() -> Self {
        WorkerCfg { agent: "codex".into(), codex_bin: "codex".into(), scripted_cmd: String::new(), run_minutes: 60, idle_minutes: 15, command_minutes: 20, retry_seconds: 60 }
    }
}

impl Config {
    pub fn load(path: &std::path::Path) -> anyhow::Result<Self> {
        Ok(toml::from_str(&std::fs::read_to_string(path)?)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shipped_example_parses_and_is_safe_by_default() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../config/acw.example.toml");
        let cfg = Config::load(&path).unwrap();
        assert_eq!((cfg.auth.as_str(), cfg.sandbox.provider.as_str(), cfg.worker.agent.as_str()), ("token", "firecracker", "codex"));
        assert!(!cfg.sandbox.allow_unisolated, "the unisolated sandbox must be opted into");
        assert_eq!(cfg.forge.token_env, "GITHUB_TOKEN", "the file names where secrets are, never the secrets");
    }

    #[test]
    fn an_empty_file_gives_the_defaults() {
        let cfg: Config = toml::from_str("").unwrap();
        assert_eq!(cfg.listen, "127.0.0.1:8787");
        assert!(!cfg.sandbox.allow_unisolated);
    }
}
