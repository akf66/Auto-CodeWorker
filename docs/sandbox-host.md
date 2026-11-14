# 远程沙箱主机

Engine 和沙箱可以不在一台机器上。每台有沙箱能力的机器跑一个沙箱主机，Engine 用 `remote` 提供方把沙箱分到这些机器上。

这不是云沙箱（E2B、Daytona 之类）的适配：那些服务的接口这一版没有写。这里的协议是本项目自己的，文档在 `crates/acw-engine/src/sandbox_host.rs` 开头。要接一个托管的沙箱服务，照着 `RemoteProvider` 再实现一个 `SandboxProvider` 就可以。

## 怎么跑

沙箱机器上，配置里写这台机器自己的提供方（`firecracker`，或者开发时用 `local`），然后：

```sh
ACW_SANDBOX_TOKEN=<共用的令牌> acw-engine sandbox-host --config acw.toml --listen 0.0.0.0:8790
```

Engine 的配置：

```toml
[sandbox]
provider = "remote"
allow_unisolated = false          # 主机用的提供方没有隔离时拒绝使用；只在开发时改成 true

[sandbox.remote]
hosts = ["http://10.0.1.11:8790", "http://10.0.1.12:8790"]
token_env = "ACW_SANDBOX_TOKEN"
```

`gateway_url` 要写沙箱机器能访问到的 Engine 地址：沙箱里的 Worker 通过它访问模型网关。

## 行为

- 新沙箱放到当前沙箱最少的、连得上的主机上。
- 命令的输出一行一行流回来，时间线是实时的。
- Engine 这边取消（停止任务、超预算、排空）就是断开连接，主机发现连接断了会杀掉那条命令的整个进程组。
- Engine 重启后不记得沙箱在哪台主机上，会挨个问一遍。
- 主机报告自己用的提供方没有隔离、而 Engine 的配置不允许时，这台主机不会被选中。

## 要注意的

- 主机的接口没有 TLS，令牌是明文传的。放在内网，或者前面加一层反向代理。
- 拿到令牌就能在那台机器的沙箱里执行任意命令。它和 root 密码是一个级别的东西。
- 主机不限制自己上面的沙箱数量。总量由 Engine 的 Worker 槽位数控制。

## 验证过什么，没验证什么

`crates/acw-engine/tests/remote.rs`：建沙箱并分摊到两台主机；文件进出、环境变量、退出码、标准输入、流式输出、超时；取消后命令确实停了；重启后的 Engine 能找回沙箱；令牌不对被拒；没有隔离的主机默认被拒；一个任务在远程沙箱里从消息走到开出 PR。

测试里的主机用的是本地沙箱、跑在本机端口上。配 Firecracker 的主机没有跑过（开发环境没有 KVM）。
