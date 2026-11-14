# Firecracker 沙箱：准备和上线前的验证

`crates/acw-sandbox/src/firecracker.rs` 按 Firecracker 的 API 文档写成，没有在真实宿主机上跑过（开发环境没有 KVM）。单元测试只覆盖了请求的内容和网络地址的计算。下面是它假设的环境，和第一次上线前要逐项确认的事。

## 它怎么工作

每个任务一个 microVM，占一个槽位 N（1 到 250）：

- 宿主机上建 tap 设备 `acwtap<N>`，地址 `<net_prefix>.<N>.1/30`；虚拟机里的 eth0 是 `<net_prefix>.<N>.2`，由内核启动参数 `ip=` 配置。
- 从 `templates/<模板名>/rootfs.ext4` 复制一份根文件系统（`cp --reflink=auto`），启动 `firecracker --api-sock`，依次调用 `/machine-config`、`/boot-source`、`/drives/rootfs`、`/network-interfaces/eth0`、`/actions`（InstanceStart）。
- 命令和文件经 SSH 进出（`root@<虚拟机地址>`，用配置里的私钥）。
- 出站：`iptables` 在 FORWARD 链上默认丢弃来自 tap 的流量，只放行 `sandbox.egress` 里的 `host:port` 和模型网关。模型网关监听在宿主机上，虚拟机通过 tap 的宿主机地址访问它。
- 暂停和恢复用 `PATCH /vm`。销毁时杀进程、删 tap 和规则、删目录。

## 宿主机要求

- Linux，开了 KVM（`/dev/kvm` 可读写）。
- 装好 `firecracker`、`ip`、`iptables`、`ssh`、`git`。
- 运行 Engine 的用户能建 tap 设备和改 iptables（root，或有 `CAP_NET_ADMIN`）。
- 开了转发：`sysctl net.ipv4.ip_forward=1`。
- 一个未压缩的内核镜像（`vmlinux`），路径写在配置的 `sandbox.firecracker.kernel`。

## 模板（根文件系统）要有什么

- 一个 SSH 服务，开机自启，接受配置里那把私钥对应的公钥登录 root。
- `git`、`sh`、项目的工具链和依赖缓存。
- `codex` CLI（`npm install -g @openai/codex`），在 root 的 PATH 里。
- 不要放任何凭证。

配置里把 `gateway_url` 写成虚拟机能访问到的地址。因为每个槽位的宿主机地址不同，最简单的做法是让 Engine 监听 `0.0.0.0`，`gateway_url` 写宿主机在某个固定内网网卡上的地址，并把这个地址和端口加进 `sandbox.egress`。

## 上线前逐项验证

1. 手工用同样的内核和模板启动一台 microVM，确认能 SSH 进去、`codex --version` 能跑。
2. 起一个任务，看时间线上“沙箱已创建（firecracker）”之后的命令是否正常执行；失败时看 Engine 日志里的 Firecracker API 返回。
3. **出站默认关**：在沙箱里 `curl https://example.com` 应该失败，`curl <gateway_url>/healthz` 应该成功。这一条最重要，没确认之前不要跑不可信的仓库。
4. 任务结束或停止后，`ip link` 里没有残留的 `acwtap*`，`iptables -S FORWARD` 里没有残留规则，`data/vms/` 下没有残留目录。
5. Engine 重启后，原来的 microVM 进程成了孤儿：Engine 会在重建沙箱时按 `pid` 文件杀掉旧进程。确认没有泄漏。
6. 开 PR 后沙箱被暂停，审批人要求修改后任务能重新建沙箱继续。
7. 并发起 3 个以上任务，确认槽位分配不冲突。
8. codex 在虚拟机里用的是 `--dangerously-bypass-approvals-and-sandbox`（虚拟机本身就是边界）。PoC 只在本地沙箱里跑过 `-c sandbox_mode="workspace-write"` 那条路径，这个参数要在虚拟机里确认一次。

## 这一版没有的

- 模板快照恢复（现在是冷启动，启动时间取决于模板）。
- 多台宿主机和放置策略。
- 一个任务多台虚拟机（VM 组）。
- 磁盘配额和快照清理。
