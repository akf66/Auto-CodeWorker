# Auto-CodWorker

把一句需求变成一个等人审批的 PR：Router 判断归属并整理需求单，Worker（codex）在沙箱里改代码，Engine 校验完成条件后开 PR，人审批、人合并。

这是 v0.2。v0.1 的核心链路之外，加了计划与跨仓库 PR 组、分阶段上线、非功能验收的证据、架构变化核对、项目记忆、代码索引、环境计划、Router 评测集、飞书入站、热备和远程沙箱主机，都有测试。

这是一个个人使用的项目：目标是自己用着顺手，不追求高并发、高可用和多租户安全。

在真实环境里跑通过的：真实 codex CLI、OrcaRouter 上的真实模型、GitHub 私有仓库，从一条消息走到 PR 合并（本机目录当沙箱）。还没接过真实环境的：飞书（协议对过官方文档）、Firecracker 沙箱。有几项做成了比设计简单的版本（代码索引是正则版不是 SCIP），有几项有意不做（自动选主、云沙箱、KMS）。每一项的状态都在 [docs/status.md](docs/status.md)。

## 一分钟跑起来

需要 Rust（开发时用的是 1.97，建议 1.90 以上）和 git。除了第一次编译要下载依赖，不需要任何 key 或网络。

```sh
cargo build --release
./target/release/acw-engine demo --console ./console
```

打开 http://127.0.0.1:8787 ，在“对话”里发：

```
给 hello 的 greet.sh 加一个 --shout 参数，验收：`sh greet.sh --shout kai | grep -q 'HELLO, KAI'`
```

会看到一个任务走完全程：开工 → 改代码 → 构建和单元测试 → 审查发现一个问题 → 修掉 → 第二轮审查通过 → E2E 和按验收标准生成的测试 → 开 PR → 你点“合并”。

演示模式用的都是替身：本地目录当沙箱（没有隔离）、本地裸仓库当代码托管、脚本当 Worker、按规则回答的假模型。它只说明流程和控制台能用，不说明真实模型的效果。加 `--with-auth` 可以试登录。

还可以在控制台里试：“计划”页提一份两个任务的计划并确认；“项目”页建代码索引、改环境计划；“路由记录”里把几条记录加入评测集，再到“设置”里换路由模型，看它被评测集拦住。

## 一个任务怎么走

```
消息 ─► Router ─► 需求单 ─(命中需确认规则)─► 审批人确认
                              │
                              ▼
   排队 ─► 准备沙箱 ─► Worker 改代码 ─► 检查 ─► 审查 ─► E2E 与验收测试 ─► 开 PR ─► 人合并
                         ▲                │        │            │
                         └──── 带着失败原因回去改 ───┴────────────┘
```

五项完成条件都在最新提交上通过，Engine 才开 PR：

1. 构建、lint、单元测试通过
2. 全量 E2E 通过，按验收标准生成的测试在新提交上通过
3. 审查没有已证实的 P0 或 P1（阻塞性发现要经过第二次独立复核）
4. 受保护的测试没有被删除，没有新增跳过标记
5. 需要人确认的事都确认了（需求单；依赖清单、CI、容器配置、需确认模块的改动）

任务会停下来等人的情况：需求单要确认、Worker 有问题要问、超出预算、审查来回改或轮数用完、有要批准的改动、有验收标准没法自动取证、失败。每件事有时限，过半提醒，到点升级。

合并之后：需求单里写了上线阶段的任务进入“上线中”，每个阶段的条件达成后由审批人推进；监控报上来的线上问题会挂回改过那个文件的任务，可以直接开修复任务；审查里被证实的问题会被提议成项目记忆。

一个 PR 装不下的需求用计划：人把它拆成有依赖的任务，审批人确认一次，任务按依赖自动开工。任务可以分在几个仓库里，这时它们的 PR 是一组，按依赖顺序合并。

## 代码结构

| 位置 | 内容 |
| --- | --- |
| `crates/acw-core` | 领域模型、事件、SQLite 事件库、投影、密钥扫描 |
| `crates/acw-llm` | OpenAI 兼容客户端（`/models`、`/chat/completions`） |
| `crates/acw-sandbox` | 沙箱接口；本地进程实现（开发用）；Firecracker 实现 |
| `crates/acw-git` | git 网关（代码只以 bundle 进出沙箱）、GitHub、本地代码托管、webhook 验签 |
| `crates/acw-engine` | 命令与权限、Router、调度、任务流水线、模型网关、计划、上线、记忆、代码索引、环境计划、评测集、飞书、热备、远程沙箱主机、HTTP 接口、CLI |
| `console/` | 控制台，接真实接口；`console/src` 是源码，`scripts/build-console.py` 拼成 `app.js` |
| `prototype/` | 设计阶段的可点击原型（示例数据），留作界面参考 |
| `config/` | 配置示例 |
| `docs/` | 状态表、架构、接口、PoC 结论、Firecracker 验证清单、热备、远程沙箱主机、飞书 |

约 11,400 行 Rust（另有约 1,500 行测试），950 行控制台脚本，85 个自动化测试，另有一个用真实 codex CLI 的 PoC 测试。

## 几条设计上的硬规则

- **事件日志是唯一事实来源。** 任务、待处理、成本、设置都是事件的投影，`acw rebuild` 可以从日志重建，重建不会重发通知。
- **沙箱里没有任何凭证。** 模型请求走 Engine 的模型网关（每个任务一个令牌，网关注入真正的 key 并计费、卡预算）；代码只以 git bundle 进出，Engine 只接受并只推送 `acw/T-<编号>…` 分支。
- **权限在 Engine 里检查。** 访客只能得到回答；需求单要不要审批由项目卡的规则决定，不由模型决定；被拒绝的操作记进安全日志。
- **来源决定是不是指令。** 成员的消息、确认过的需求单是指令；PR 上没有权限的人写的评论只当数据传给 Worker，并标记任务“读过外部内容”。
- **不自动合并。**

## 自己用（真实模型和 GitHub）

需要装好 codex CLI 和 gh（或者自己准备一个有仓库读写权限的 GitHub 令牌）。

```sh
cargo build --release
export GITHUB_TOKEN=$(gh auth token)
./target/release/acw-engine serve --config config/acw.personal.toml
```

打开 http://127.0.0.1:8787 ，不用登录（第一次启动会自动建一个管理员 `me`）：

1. 设置 → 模型接入：加接入（Base URL 写到 `/v1`，填 key，接口类型选接入支持的那种，OrcaRouter 选 Responses），再给“路由、开发、审查、写测试”各选模型。想让预算和成本页起作用，把模型价格也填上。
2. 项目 → 接入项目：填项目卡（仓库的 https 克隆地址、`owner/name`、构建和测试命令、受保护的测试目录）。
3. 在“对话”里发需求。任务走到“等你审批”后去 GitHub 上看 PR、合并，Engine 半分钟内会发现并结束任务。

这种配法的沙箱是本机上的一个目录，没有隔离，只用在自己的机器和自己信任的仓库上。

## 部署成多人用的服务

1. 写配置：复制 `config/acw.example.toml`，按注释改。密钥放环境变量（`GITHUB_TOKEN`、`GITHUB_WEBHOOK_SECRET`、`FEISHU_WEBHOOK` 等），不写进文件。
2. 建第一个管理员：`acw-engine init --config acw.toml --id kai --name KaifengAn --github akf66`，记下打印的令牌。
3. 启动：`acw-engine serve --config acw.toml`，打开控制台，用令牌登录。
4. 设置 → 模型接入：加接入（https 的 Base URL 和 key），再给“路由、开发、审查、写测试”各选模型，填模型价格。
5. 项目 → 接入项目：填项目卡（仓库、别名、模块与需确认规则、沙箱里跑的命令、受保护的测试目录）。
6. GitHub 仓库加 webhook：地址 `https://<你的域名>/webhooks/github`，内容类型 JSON，密钥同 `GITHUB_WEBHOOK_SECRET`，事件勾 Pull requests、Pull request reviews、Issue comments。没配 webhook 也能用，Engine 每分钟轮询一次 PR 状态。
7. 沙箱：要隔离就用 Firecracker，准备方法和要验证的事在 [docs/firecracker.md](docs/firecracker.md)。沙箱放在别的机器上见 [docs/sandbox-host.md](docs/sandbox-host.md)。
8. 可选：在飞书里提需求（[docs/feishu.md](docs/feishu.md)）；一台只读备机（[docs/standby.md](docs/standby.md)）；监控把线上问题报到 `/webhooks/issues`；Prometheus 抓 `/metrics`。

Worker 用 codex CLI，要装在沙箱模板里。codex 只说 Responses 接口：接入支持就直接转发，只支持 Chat Completions 的接入由网关转换，细节见 [docs/poc.md](docs/poc.md)。

## 测试

```sh
cargo test --workspace                 # 85 个测试，不需要网络
ACW_CODEX_POC=1 cargo test -p acw-engine --test codex -- --nocapture   # 需要装 codex CLI
```

`crates/acw-engine/tests/` 是端到端场景，读它最快知道系统保证了什么：`flow.rs`（一个任务的全程）、`engine.rs`（调度、设置、恢复、索引、评测集）、`plans.rs`（计划和跨仓库 PR 组）、`env.rs`、`feishu.rs`、`standby.rs`、`remote.rs`。

## 还没做的

以后可能做的：Router 自动拆计划、编译器级的代码索引、用模型做环境规划、审查和写测试的评测集、飞书卡片。有意不做的：自动选主（Raft）、云沙箱、密钥表接 KMS、OpenTelemetry、多服务 VM 组。完整列表和原因在 [docs/status.md](docs/status.md)。
