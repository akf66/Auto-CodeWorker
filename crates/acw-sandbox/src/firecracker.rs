//! Firecracker provider: one microVM per sandbox, managed directly through Firecracker's API
//! socket. No Docker, no Kubernetes.
//!
//! STATUS: written against the Firecracker API as documented, NOT yet run on a real host
//! (the development environment has no KVM). `docs/firecracker.md` lists what to verify.
//!
//! Each sandbox gets a slot N (1..=250):
//!   tap device  acwtap<N>          host side  <prefix>.<N>.1/30
//!   guest       eth0               guest side <prefix>.<N>.2
//! Commands and files go over SSH to the guest; the template's root filesystem must contain an
//! SSH server that accepts the configured key for root, plus git and the project's toolchain.
//! Outbound traffic from the guest is dropped except to the `egress` allowlist. The model gateway
//! and the package mirror listen on the host, so they are reached at the tap's host address.

use crate::*;
use anyhow::{anyhow, bail, Context};
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::io::AsyncReadExt;
use tokio::net::UnixStream;
use tokio::sync::Mutex;

#[derive(Clone, Debug)]
pub struct FirecrackerCfg {
    pub bin: String,
    pub kernel: PathBuf,
    /// `<templates>/<name>/rootfs.ext4`
    pub templates: PathBuf,
    pub default_template: String,
    pub run_dir: PathBuf,
    pub ssh_key: PathBuf,
    pub vcpus: u32,
    pub mem_mib: u32,
    /// First two octets of the sandbox networks, for example `172.30`.
    pub net_prefix: String,
    pub host_name: String,
}

pub struct FirecrackerProvider {
    cfg: FirecrackerCfg,
    vms: Mutex<HashMap<String, tokio::process::Child>>,
}

pub(crate) fn slot_net(prefix: &str, slot: u8) -> (String, String, String, String) {
    (format!("acwtap{slot}"), format!("{prefix}.{slot}.1"), format!("{prefix}.{slot}.2"), format!("06:00:AC:1E:{:02X}:02", slot))
}

pub(crate) fn boot_requests(cfg: &FirecrackerCfg, rootfs: &str, slot: u8) -> Vec<(&'static str, &'static str, serde_json::Value)> {
    let (tap, host_ip, guest_ip, mac) = slot_net(&cfg.net_prefix, slot);
    let boot_args = format!("console=ttyS0 reboot=k panic=1 pci=off ip={guest_ip}::{host_ip}:255.255.255.252::eth0:off");
    vec![
        ("PUT", "/machine-config", json!({ "vcpu_count": cfg.vcpus, "mem_size_mib": cfg.mem_mib })),
        ("PUT", "/boot-source", json!({ "kernel_image_path": cfg.kernel, "boot_args": boot_args })),
        ("PUT", "/drives/rootfs", json!({ "drive_id": "rootfs", "path_on_host": rootfs, "is_root_device": true, "is_read_only": false })),
        ("PUT", "/network-interfaces/eth0", json!({ "iface_id": "eth0", "host_dev_name": tap, "guest_mac": mac })),
        ("PUT", "/actions", json!({ "action_type": "InstanceStart" })),
    ]
}

pub(crate) fn http_request(method: &str, path: &str, body: &str) -> String {
    format!("{method} {path} HTTP/1.1\r\nHost: localhost\r\nAccept: application/json\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
}

async fn api(sock: &PathBuf, method: &str, path: &str, body: &serde_json::Value) -> Result<()> {
    let mut s = UnixStream::connect(sock).await.with_context(|| format!("连接 Firecracker API {}", sock.display()))?;
    s.write_all(http_request(method, path, &body.to_string()).as_bytes()).await?;
    let mut buf = Vec::new();
    let _ = tokio::time::timeout(Duration::from_secs(15), s.read_to_end(&mut buf)).await;
    let text = String::from_utf8_lossy(&buf);
    let status: u16 = text.split_whitespace().nth(1).and_then(|c| c.parse().ok()).unwrap_or(0);
    if !(200..300).contains(&status) {
        bail!("Firecracker {method} {path} 返回 {status}：{}", text.lines().last().unwrap_or_default());
    }
    Ok(())
}

async fn sh(cmd: &str) -> Result<()> {
    let out = Command::new("sh").arg("-c").arg(cmd).output().await?;
    if !out.status.success() {
        bail!("`{cmd}` 失败：{}", String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(())
}

impl FirecrackerProvider {
    pub fn new(cfg: FirecrackerCfg) -> Result<Self> {
        std::fs::create_dir_all(&cfg.run_dir)?;
        Ok(FirecrackerProvider { cfg, vms: Mutex::new(HashMap::new()) })
    }
    fn dir(&self, id: &str) -> Result<PathBuf> {
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            bail!("沙箱编号不合法：{id}");
        }
        Ok(self.cfg.run_dir.join(id))
    }
    async fn slot(&self, id: &str) -> Result<u8> {
        let text = tokio::fs::read_to_string(self.dir(id)?.join("slot")).await.with_context(|| format!("沙箱 {id} 不存在"))?;
        text.trim().parse().map_err(|_| anyhow!("沙箱 {id} 的槽位记录损坏"))
    }
    async fn free_slot(&self) -> Result<u8> {
        let mut used = Vec::new();
        let mut rd = tokio::fs::read_dir(&self.cfg.run_dir).await?;
        while let Some(e) = rd.next_entry().await? {
            if let Ok(t) = tokio::fs::read_to_string(e.path().join("slot")).await {
                if let Ok(n) = t.trim().parse::<u8>() {
                    used.push(n);
                }
            }
        }
        (1..=250u8).find(|n| !used.contains(n)).ok_or_else(|| anyhow!("这台宿主机的沙箱槽位用完了"))
    }
    fn ssh(&self, guest_ip: &str) -> Command {
        let mut c = Command::new("ssh");
        c.args(["-i", &self.cfg.ssh_key.to_string_lossy(), "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR", "-o", "ConnectTimeout=5"]);
        c.arg(format!("root@{guest_ip}"));
        c
    }
    async fn guest(&self, id: &str) -> Result<String> {
        Ok(slot_net(&self.cfg.net_prefix, self.slot(id).await?).2)
    }
    /// Default-deny for traffic leaving the guest, then the allowlist on top.
    async fn open_network(&self, slot: u8, egress: &[String]) -> Result<()> {
        let (tap, host_ip, _, _) = slot_net(&self.cfg.net_prefix, slot);
        sh(&format!("ip tuntap add dev {tap} mode tap && ip addr add {host_ip}/30 dev {tap} && ip link set {tap} up")).await?;
        sh(&format!("iptables -A FORWARD -i {tap} -j DROP && iptables -I FORWARD -o {tap} -m state --state RELATED,ESTABLISHED -j ACCEPT")).await?;
        for allow in egress {
            let (host, port) = allow.rsplit_once(':').ok_or_else(|| anyhow!("出站白名单要写成 host:port：{allow}"))?;
            sh(&format!("iptables -I FORWARD -i {tap} -p tcp -d {host} --dport {port} -j ACCEPT")).await?;
        }
        if !egress.is_empty() {
            sh(&format!("iptables -t nat -A POSTROUTING -s {host_ip}/30 -j MASQUERADE")).await?;
        }
        Ok(())
    }
    async fn close_network(&self, slot: u8) {
        let (tap, host_ip, _, _) = slot_net(&self.cfg.net_prefix, slot);
        let _ = sh(&format!(
            "iptables-save | grep -- '-i {tap} \\|-o {tap} ' | sed 's/^-A/iptables -D/' | sh; iptables -t nat -D POSTROUTING -s {host_ip}/30 -j MASQUERADE; ip link del {tap}"
        ))
        .await;
    }
}

#[async_trait]
impl SandboxProvider for FirecrackerProvider {
    fn name(&self) -> &'static str {
        "firecracker"
    }
    fn isolated(&self) -> bool {
        true
    }
    async fn create(&self, spec: &SandboxSpec) -> Result<Created> {
        let dir = self.dir(&spec.id)?;
        if dir.exists() {
            self.destroy(&spec.id).await?;
        }
        let template = spec.template.clone().unwrap_or_else(|| self.cfg.default_template.clone());
        let src = self.cfg.templates.join(&template).join("rootfs.ext4");
        if !src.exists() {
            bail!("模板 {template} 没有 rootfs.ext4（{}）", src.display());
        }
        tokio::fs::create_dir_all(&dir).await?;
        let slot = self.free_slot().await?;
        tokio::fs::write(dir.join("slot"), slot.to_string()).await?;
        let rootfs = dir.join("rootfs.ext4");
        sh(&format!("cp --reflink=auto --sparse=always {} {}", sh_quote(&src.to_string_lossy()), sh_quote(&rootfs.to_string_lossy()))).await?;
        self.open_network(slot, &spec.egress).await?;

        let sock = dir.join("api.sock");
        let child = Command::new(&self.cfg.bin).arg("--api-sock").arg(&sock).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).kill_on_drop(true).spawn().context("启动 firecracker")?;
        if let Some(pid) = child.id() {
            tokio::fs::write(dir.join("pid"), pid.to_string()).await?;
        }
        self.vms.lock().await.insert(spec.id.clone(), child);
        for _ in 0..50 {
            if sock.exists() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        for (method, path, body) in boot_requests(&self.cfg, &rootfs.to_string_lossy(), slot) {
            api(&sock, method, path, &body).await?;
        }
        let guest_ip = slot_net(&self.cfg.net_prefix, slot).2;
        let mut up = false;
        for _ in 0..60 {
            let mut c = self.ssh(&guest_ip);
            c.arg("mkdir -p /acw/repo /acw/io /acw/home");
            if c.output().await.map(|o| o.status.success()).unwrap_or(false) {
                up = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        if !up {
            self.destroy(&spec.id).await?;
            bail!("microVM 启动后 30 秒内 SSH 没有就绪");
        }
        Ok(Created { host: self.cfg.host_name.clone(), template })
    }
    async fn exists(&self, id: &str) -> bool {
        self.vms.lock().await.contains_key(id)
    }
    async fn exec(&self, id: &str, spec: ExecSpec, sink: Option<LineSink>, cancel: CancellationToken) -> Result<ExecResult> {
        let ip = self.guest(id).await?;
        let envs: String = spec.env.iter().map(|(k, v)| format!("{k}={} ", sh_quote(v))).collect();
        let remote = format!("cd /acw/{} && env HOME=/acw/home {envs}sh -c {}", safe_rel(&spec.cwd)?, sh_quote(&spec.cmd));
        let mut cmd = self.ssh(&ip);
        cmd.arg(remote);
        run_process(cmd, &spec, sink, cancel).await
    }
    async fn put_file(&self, id: &str, path: &str, data: &[u8]) -> Result<()> {
        let ip = self.guest(id).await?;
        let full = format!("/acw/{}", safe_rel(path)?);
        let mut cmd = self.ssh(&ip);
        cmd.arg(format!("mkdir -p \"$(dirname {0})\" && cat > {0}", sh_quote(&full))).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped());
        let mut child = cmd.spawn()?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(data).await?;
            stdin.shutdown().await?;
        }
        let out = child.wait_with_output().await?;
        if !out.status.success() {
            bail!("写入沙箱文件 {path} 失败：{}", String::from_utf8_lossy(&out.stderr).trim());
        }
        Ok(())
    }
    async fn get_file(&self, id: &str, path: &str) -> Result<Vec<u8>> {
        let ip = self.guest(id).await?;
        let mut cmd = self.ssh(&ip);
        cmd.arg(format!("cat {}", sh_quote(&format!("/acw/{}", safe_rel(path)?))));
        let out = cmd.output().await?;
        if !out.status.success() {
            bail!("读取沙箱文件 {path} 失败：{}", String::from_utf8_lossy(&out.stderr).trim());
        }
        Ok(out.stdout)
    }
    async fn pause(&self, id: &str) -> Result<()> {
        api(&self.dir(id)?.join("api.sock"), "PATCH", "/vm", &json!({ "state": "Paused" })).await
    }
    async fn resume(&self, id: &str) -> Result<()> {
        api(&self.dir(id)?.join("api.sock"), "PATCH", "/vm", &json!({ "state": "Resumed" })).await
    }
    async fn destroy(&self, id: &str) -> Result<()> {
        let dir = self.dir(id)?;
        if let Some(mut child) = self.vms.lock().await.remove(id) {
            let _ = child.kill().await;
        } else if let Ok(pid) = tokio::fs::read_to_string(dir.join("pid")).await {
            // the Engine restarted: the VM is still running but we no longer hold its handle
            let _ = sh(&format!("kill -KILL {}", pid.trim())).await;
        }
        if let Ok(slot) = self.slot(id).await {
            self.close_network(slot).await;
        }
        if dir.exists() {
            tokio::fs::remove_dir_all(&dir).await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> FirecrackerCfg {
        FirecrackerCfg {
            bin: "firecracker".into(), kernel: "/var/lib/acw/vmlinux".into(), templates: "/var/lib/acw/templates".into(), default_template: "base".into(),
            run_dir: "/tmp/acw-fc-test".into(), ssh_key: "/var/lib/acw/id_ed25519".into(), vcpus: 2, mem_mib: 4096, net_prefix: "172.30".into(), host_name: "node-1".into(),
        }
    }

    #[test]
    fn each_slot_has_its_own_network() {
        let (tap, host, guest, mac) = slot_net("172.30", 7);
        assert_eq!((tap.as_str(), host.as_str(), guest.as_str()), ("acwtap7", "172.30.7.1", "172.30.7.2"));
        assert_eq!(mac, "06:00:AC:1E:07:02");
    }

    #[test]
    fn boot_sequence_configures_then_starts() {
        let reqs = boot_requests(&cfg(), "/run/sb/rootfs.ext4", 3);
        let paths: Vec<&str> = reqs.iter().map(|r| r.1).collect();
        assert_eq!(paths, ["/machine-config", "/boot-source", "/drives/rootfs", "/network-interfaces/eth0", "/actions"]);
        assert_eq!(reqs[3].2["host_dev_name"], "acwtap3");
        assert!(reqs[1].2["boot_args"].as_str().unwrap().contains("ip=172.30.3.2::172.30.3.1:255.255.255.252::eth0:off"));
        assert_eq!(reqs[4].2["action_type"], "InstanceStart");
    }

    #[test]
    fn api_requests_are_well_formed_http() {
        let r = http_request("PUT", "/actions", "{\"a\":1}");
        assert!(r.starts_with("PUT /actions HTTP/1.1\r\n"));
        assert!(r.contains("Content-Length: 7\r\n") && r.ends_with("\r\n\r\n{\"a\":1}"));
    }
}
