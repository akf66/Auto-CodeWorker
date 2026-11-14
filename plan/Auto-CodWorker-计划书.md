# Auto-CodWorker 计划书

写于 2026-11-14，接在 v0.2 之后。给在本地继续这个项目的人（和他用的编码助手）看：现在到哪了，怎么在本地接上，接下来做什么、按什么顺序、每件事怎么算做完。

每一项功能现在的状态以 [status.md](status.md) 为准，这里不重复。这里只写还没做的事。

## 1. 现在到哪了

v0.2 是一个能在单机上完整跑通的系统：一条消息经 Router 变成需求单，Worker（codex）在沙箱里改代码，Engine 校验五项完成条件后开 PR，人审批、人合并；合并后可以分阶段上线，问题可以回流。外围有计划与跨仓库 PR 组、项目记忆、代码索引、环境计划、评测集、飞书入站、热备、远程沙箱主机和控制台。

它有 83 个自动化测试，但这些测试用的全是替身：按规则回答的假模型、本地目录当沙箱、本地裸仓库当代码托管、本机端口上的假飞书。**没有任何一个部件接过真实的外部系统。** 所以它现在的准确描述是“逻辑完整、接线没验证”。

由此得出接下来的顺序：先把已经写好的东西接到真实环境上（第一阶段），再把做简单了的部分补到设计水平（第二阶段），最后做没做的（第三阶段）。先接真实环境的原因是，真实模型和真实 GitHub 一定会暴露出要改的地方，在那之前往上叠功能，返工的面会更大。

| 数字 | 值 |
| --- | --- |
| Rust 代码 | 约 11,400 行，另有约 1,500 行测试 |
| 控制台脚本 | 约 950 行（`console/src`） |
| 自动化测试 | 83 个，不需要网络；另有一个要装 codex CLI 的 PoC 测试 |
| clippy | `cargo clippy --workspace --all-targets` 没有警告 |
| 开发时的工具链 | Rust 1.97，codex CLI 0.169.0 |

## 2. 在本地接上

交付的包里带着 git 历史，远端已经指向 `https://github.com/akf66/Auto-CodeWorker.git`，分支是 `main`。

```sh
tar xzf auto-codworker-v0.2-repo.tar.gz
cd auto-codworker
git log --oneline            # 应该看到 v0.2 和计划书两个提交
git push -u origin main      # 开发环境里没有这个仓库的权限，所以这一步留给你

cargo test --workspace       # 83 个测试，第一次要下载依赖
cargo build --release
./target/release/acw-engine demo --console ./console    # 打开 http://127.0.0.1:8787
```

仓库名是 `Auto-CodeWorker`，项目和代码里一直叫 `Auto-CodWorker`。两个都能用，要统一的话全局替换一次，趁早。

想用真实的 codex 加真实模型在本机试一个任务（不需要 KVM 和 GitHub），用这份配置。它用本地目录当沙箱，没有隔离，只用来试你自己信得过的仓库：

```toml
# acw.local.toml
listen = "127.0.0.1:8787"
data_dir = "./data"
console_dir = "./console"
public_url = "http://127.0.0.1:8787"
gateway_url = "http://127.0.0.1:8787"
auth = "token"

[forge]
kind = "local"            # 项目卡的 repo 写一个本地裸仓库的路径

[sandbox]
provider = "local"
allow_unisolated = true

[worker]
agent = "codex"
```

```sh
./target/release/acw-engine init --config acw.local.toml --id kai --name KaifengAn   # 记下令牌
./target/release/acw-engine serve --config acw.local.toml
```

然后在控制台里：设置 → 加模型接入 → 给四个阶段选模型并填价格；项目 → 接入项目。

## 3. 路线总览

工作量是粗估，按“一个人带编码助手”算：小是一两天，中是一周以内，大是一周以上。没有实测依据，只用来排先后。

### 第一阶段：接到真实环境上

| 编号 | 做什么 | 前置 | 工作量 |
| --- | --- | --- | --- |
| B1 | 真实模型：接 OrcaRouter，跑通一个真实任务，调提示词，建评测集 | 一个模型 key | 中 |
| B2 | GitHub：开 PR、webhook、带令牌推送 | 测试仓库和令牌 | 小 |
| B3 | Firecracker 沙箱 | 一台有 KVM 的 Linux 机器 | 中 |
| B4 | 飞书：先对文档，再接真实应用 | 飞书自建应用 | 小 |
| B5 | 热备：两台机器演练切换和网络分区 | 两台机器 | 小 |
| B6 | 远程沙箱主机配 Firecracker | B3 | 小 |
| B7 | 上线条件和线上问题接真实监控 | 一个监控或错误追踪系统 | 小 |

B1 和 B2 互不依赖，可以同时做，做完就有了“真实模型在真实仓库上开出 PR”。B3 是把它放心交给别人用的前提：没有隔离的沙箱不能跑不可信的仓库。

### 第二阶段：补到设计水平

| 编号 | 做什么 | 前置 | 工作量 |
| --- | --- | --- | --- |
| C1 | 代码索引的符号层换成 SCIP，加引用和摘要层 | 无 | 大 |
| C2 | Router 自动把大需求拆成计划 | B1 | 中 |
| C3 | 多服务 VM 组、模板快照恢复 | B3 | 大 |
| C4 | 审查和写测试的评测集 | B1，积累一批真实任务 | 中 |
| C5 | 上线回退时自动开回退任务 | 无 | 小 |
| C6 | PR 组在 GitHub 上强制合并顺序 | B2 | 小 |
| C7 | 架构图的“改动前”取自代码索引 | C1 | 中 |
| C8 | 环境计划的草稿用模型生成 | B1 | 小 |
| C9 | 仓库要求 CI 时，等 CI 通过再交给人 | B2 | 小 |
| C10 | 原型里有、实现里没有的界面和功能（见 4.3） | 无 | 中 |

### 第三阶段：没做的

| 编号 | 做什么 | 前置 | 工作量 |
| --- | --- | --- | --- |
| D1 | 自动选主（Raft） | B5，第三台机器 | 大 |
| D2 | 云沙箱（E2B、Daytona） | 能读到它们的接口文档 | 中 |
| D3 | 飞书卡片、按钮、私聊通知 | B4 | 中 |
| D4 | OpenTelemetry 链路追踪 | 无 | 小 |
| D5 | 密钥表接 KMS | 选定 KMS | 小 |
| D6 | 自研 Rust Worker（工具调用层的闸门、两种消息投递） | B1 稳定之后 | 大 |

## 4. 每一项的细则

### 4.1 第一阶段

**B1 真实模型。** 这是最该先做的一件事，因为系统的价值全在模型的表现上，而现在一次都没见过。

先确认一件事：OrcaRouter 有没有 `/v1/responses`。codex 只说 Responses 接口。有的话接入类型选 Responses，网关直接转发；没有就选 Chat Completions，网关会转换，但转换有损：推理模型的思考内容被丢弃，`web_search` 和 namespace 工具被丢弃，上游用非流式。转换在 `crates/acw-engine/src/gateway.rs` 的 `responses_to_chat` 和 `chat_to_sse`。

然后按第 2 节的本机配置跑。先用一个你熟悉的小仓库，发五到十条真实需求，逐条看四件事：Router 判得对不对（路由记录页），需求单的验收标准是不是可验证的，审查发现是不是真问题，Tester 生成的测试是不是真的在验那条标准（“改动前失败、改动后通过”才算）。提示词都是常量，在 `router.rs` 顶部（路由与需求单）、`gates.rs` 顶部（`REVIEW_PROMPT`、`VERIFY_PROMPT`、`TESTER_PROMPT`）和 `memory.rs`（`MEMORY_PROMPT`）。

边跑边建评测集：路由记录页上，判对的直接“加入评测集”，判错的先标“判断有误”再加入并写上应该判成什么。攒到三十条以上，之后每次改路由提示词或换模型，先在评测集页跑一遍。

算做完：一条真实需求从消息走到开出 PR，中间没有人工修补；评测集不少于三十条，当前模型的通过数记下来作为基线；一个任务的实际花费和设置里的预算默认值（80 元）对过，不合适就改默认值。

要留意的：模型价格要自己在设置里填，没填的话预算不起作用。Worker 用哪个模型由设置决定，沙箱里的 codex 改不了。

**B2 GitHub。** 代码在 `crates/acw-git/src/forge.rs`（`GitHub`）和 `http.rs` 的 `github_webhook`，都是按文档写的，没有打过真实接口。

建一个测试仓库。令牌要有 contents 和 pull requests 的读写权限。配置里 `forge.kind = "github"`，令牌放 `GITHUB_TOKEN`。webhook 地址 `https://<域名>/webhooks/github`，内容类型 JSON，密钥同 `GITHUB_WEBHOOK_SECRET`，事件勾 Pull requests、Pull request reviews、Issue comments。本机没有公网地址时不配 webhook 也行，Engine 每分钟轮询一次 PR 状态。

逐项核对：任务分支被推上去；PR 开出来，标题和正文正常；在 PR 上以审批人身份（成员的 `github` 字段要填）评论“要求修改”，任务回到运行；以没登记的账号评论，评论只当数据、安全页有记录；合并后任务结束；叠放的 PR 在下层合并后目标分支改到 main（`set_base`）。webhook 的三种事件各触发一次，对照 `parse_webhook` 里取的字段。

算做完：上面每一条在真实仓库上都发生过一次；`forge.rs` 里和实际不符的字段都改了，并把真实负载存成测试夹具。

**B3 Firecracker。** 清单在 [firecracker.md](firecracker.md)，八条，照着做。其中第 3 条（沙箱里访问外网失败、访问模型网关成功）是硬条件，没确认之前不要跑不可信的仓库。第 8 条是 codex 在虚拟机里用 `--dangerously-bypass-approvals-and-sandbox` 这条路径，PoC 没跑过。

要先备的：一个未压缩的内核镜像；一个根文件系统模板，里面有 SSH 服务、git、项目的工具链和 codex CLI，不放任何凭证。`firecracker.md` 里写了模板要有什么，但没有给出制作模板的脚本，这是 B3 的第一步，做完把脚本放进 `scripts/`。

算做完：八条都过；制作模板的脚本进了仓库；`status.md` 里这一行从“已写，未验证”挪到“已测试”，写明在什么机器上验证的。

**B4 飞书。** 入站部分（`feishu.rs`）的协议是凭记忆写的，没有对过官方文档。[feishu.md](feishu.md) 里有一张表，列了代码里的七条假设和各自的位置。第一步是拿着这张表逐条对飞书开放平台的文档，对不上的先改代码和测试里的假平台（`tests/feishu.rs` 的 `platform`），再接真实应用。

有一处是故意放宽的：地址校验请求没带签名头时只按校验令牌判断。对完文档后，如果这种请求也带签名，把 `feishu_event` 里的例外去掉。

出站通知（群机器人 webhook）也没发过真消息，一起看一眼格式和 @ 是否正常。

算做完：地址校验通过；群里 @ 机器人能开任务并收到回复；私聊能用；没登记的人只得到回答；同一事件重发不会开两个任务。

**B5 热备演练。** 步骤在 [standby.md](standby.md)。测试里主机和备机是同一个进程里的两个 Engine，没有经过真实的网络。演练三件事：正常切换（主机活着，提升后旧主机停止接受操作）；主机断电后切换（`old_primary_fenced` 为 false，旧主机再启动时自己停下）；网络分区（两边互相连不上时旧主机会继续接受操作，这是已知的，演练是为了看清楚恢复后两边日志的状态，以及怎么收拾）。

顺带决定备份：设计里写的是 Litestream 持续备份加定期恢复演练，实现里完全没有集成。热备不替代备份（误操作会被复制过去）。

算做完：三种情况各演练一次并把现象写进 `standby.md`；备份方案定下来并写进部署文档。

**B6 远程沙箱主机配 Firecracker。** B3 做完后，在那台机器上跑 `acw-engine sandbox-host`，Engine 配 `provider = "remote"`，跑一个任务。主机的接口没有 TLS，令牌是明文，放内网或者前面加反向代理。见 [sandbox-host.md](sandbox-host.md)。

**B7 接监控。** 两个入口：上线阶段的 `gate_url`（一个返回 2xx 的只读地址，返回 JSON 时还要 `"ok": true`），和 `/webhooks/issues`（请求头 `X-ACW-Token`，正文 `{project, title, file, source, url}`）。各接一个真实来源，比如把 `gate_url` 指到一条指标查询的封装，把 Sentry 的告警转成 `/webhooks/issues` 的格式。转换层不在这个仓库里，是一个小的适配脚本。

### 4.2 第二阶段

**C1 代码索引换成 SCIP。** 现在的 `index.rs` 用 `git grep` 加正则取符号和访问层，不解析引用，会误认。它被用在三处：按符号或文件名多认出模块、给 Worker 的仓库地图、落后提交数。因为会误认，现在的规则是它只能让需求多命中模块，不能放行任何检查；换成 SCIP 之后这条规则可以重新考虑，但要有预判打分的数据支持（`ModulesScored` 事件已经在记）。

做法：`build_index` 里符号那一遍换成跑各语言的 SCIP 索引器并读它的输出，`CodeIndex` 加上引用关系；访问层（表、主题、路由）SCIP 给不了，保留正则那一遍，但每条边标上来源（`static`、`inferred`、`observed`）。摘要层是按引用图排序后给 Worker 的仓库地图，替换现在的 `repo_map`。索引器要在沙箱或专门的环境里跑，不在 Engine 进程里跑。

没定的事：Go 用哪个索引器。设计阶段查 SCIP 首页时索引器列表里没有 Go，这一条当时就列成了待查。你的后端是 Go，所以这是 C1 开工前要先解决的。

算做完：一个真实仓库上，“查某个函数被谁调用”有正确答案；模块预判的命中情况比正则版好（用 `/api/projects/{id}/index` 里的 `quality` 对比）。

**C2 Router 拆计划。** 现在计划要人写成任务列表，通过控制台或 `POST /api/plans` 提交。设计里的触发条件是：涉及多个仓库、三个以上模块、有架构变化、验收标准超过六条、或估计超过 800 行或 20 个文件。

做法：`router.rs` 的 `decide` 增加一种判定 `new_plan`，输出里带任务列表；`route` 里对应调 `create_plan`。Engine 已经有的校验（每条验收标准至少有一个任务覆盖、依赖不成环）照常生效，模型拆得不对会被拒。评测集里加上“应该拆成计划”的用例。

**C3 VM 组和模板快照。** 现在环境计划里的服务是同一个沙箱里的后台进程（`env.rs` 的 `prepare_env`），Firecracker 是冷启动。设计是每个服务一个 microVM、每个任务一个网段，模板带快照，启动时从快照恢复。这是 `firecracker.rs` 里的大改动，也要改 `SandboxProvider` 接口（一个任务对应一组沙箱）。等 B3 跑通、并且真的遇到“冷启动太慢”或“服务必须隔离”再做。

**C4 审查和写测试的评测集。** `eval.rs` 现在只评 Router。审查的用例来自已合并任务的 diff，加上人标过的“误报”和合并后回流的问题（漏报）；写测试的用例看生成的测试能不能分辨改动前后。先要有一批真实任务，所以排在 B1 之后一段时间。

**C5 回退任务。** `rollout_back` 现在只记录回退。改成同时开一个任务，需求单是“撤销某个任务的改动”，和 `fix_issue` 开修复任务是同一个模式（`rollout.rs`）。

**C6 PR 组强制顺序。** 现在乱序合并只记安全日志并通知。在 GitHub 上可以给每个 PR 的头提交写一个状态检查，依赖的 PR 没合并时是 pending，再把这个检查设成分支保护的必需项。`Forge` 接口加一个写状态的方法。

**C7 架构图的“改动前”。** 现在前后两张图的结构都是 Worker 提交的，Engine 只核对“新增和移除的组件在 diff 里有对应的文件改动”。设计是“改动前”取自代码索引。依赖 C1。

**C8 环境计划草稿用模型。** `detect_env` 现在按仓库根目录的依赖清单用规则生成。设置里的“环境规划”阶段留着没用，可以让它读仓库后给出草稿（包括服务）。草稿仍然要审批人保存才生效，这一点不变。

**C9 等 CI。** 设计里写了“仓库要求 CI 时等 CI 通过再交给人”，实现里没有：PR 一开出来就进审批人的待处理。`Forge::pr_status` 加上检查状态，`pr_open` 阶段在 CI 通过前不开待处理，CI 失败时把失败原因作为输入发回给 Worker。

### 4.3 C10：原型里有、实现里没有的

设计原型（`prototype/`，示例数据）比实现多出下面这些。它们没有列在 v0.2 之前的状态表里，这次补上了。

| 功能 | 原型里的样子 | 实现要动哪里 |
| --- | --- | --- |
| 总览上的代码地图 | 所有项目并排，一个模块一行，任务是模块行上的编号标签 | 只是界面：数据已经有（项目卡的模块、任务的 `modules`） |
| 批量处理 | 勾选几件待处理，一起批准或转给别人 | 界面，加一个批量接口 |
| 每日汇总 | 低优先级的通知攒到每天一次 | `background.rs` 的通知，成员上加设置 |
| 常设规则 | 同类中风险动作批准三次后，提议变成不再问的规则 | `gates.rs` 的 `classify_risks`，加规则的事件和审批 |
| 质量周报 | 路由被改过的比例、一次确认率、合并率、审查证实率等 | 从事件算的只读投影，加一页 |
| 证据报告页 | 性能和并发各一页完整报告 | 现在证据直接显示在“检查与测试”页签里，够用的话可以不做 |
| 全局月总额 | 项目额度之上的一层 | `scheduler.rs` 的 `admit` |
| 单项目最多占一半槽位 | 防止一个项目占满 | `scheduler.rs` |
| 开工前的成本估算 | 需求单上显示估算 | 要有历史任务的花费才估得准 |
| 模型列表每小时自动刷新 | 现在只能手动“重新拉取” | `background.rs` 的 `clock` |
| 路由记录按提示词版本批量重放 | “用新提示词重放今天的全部记录” | 评测集已经覆盖了主要用途 |

这些互相独立，按用到的先后做。代码地图和批量处理是每天都会用到的。

### 4.4 第三阶段

**D1 Raft。** 设计是三节点、openraft 加 SQLite 状态机、仍然单写者。热备（`standby.rs`）已经有了复制日志、任期、只读和隔离这几块，Raft 要加的是选举和多数派确认。做之前先看 B5 演练的结果：手动切换够不够用。如果一年切不了一次，Raft 的复杂度不值。

**D2 云沙箱。** 没写的原因是开发环境里读不到 E2B 和 Daytona 的接口文档。接的时候实现 `SandboxProvider` 这一个接口（十个方法），`sandbox_host.rs` 里的 `RemoteProvider` 是一个完整的远程实现，照着写。项目卡上已经有“沙箱只用自建”的开关（`sandbox.self_hosted_only`），但现在没有任何地方读它，接云沙箱时要在选提供方的地方用上。

**D3 飞书卡片。** 入站只收文字、回复是文字，出站通知走群机器人 webhook。卡片和按钮（在飞书里直接点“确认需求单”）要用应用身份发消息并处理卡片回调。

**D4 OpenTelemetry。** 现在有 `/metrics` 和日志。加追踪主要是为了看一个任务在各阶段的耗时，时间线已经能看个大概。

**D5 KMS。** 密钥表是 SQLite 里的明文，备机还会复制整张表。接 KMS 后表里存密文。

**D6 自研 Worker。** 设计里放在最后一个里程碑。现在用 codex，所以中风险改动只能在 diff 层面判断（开 PR 前拦），做不到在工具调用那一刻拦；Worker 正在跑的时候发来的消息要等这一轮跑完才处理。自研 Worker 能解决这两点，协议形状可以参考 pi 的 RPC（见项目决策文档）。这是一个独立的大项目，等 codex 这条路跑稳之后再评估值不值。

## 5. 已知的限制里值得排进来的

[status.md](status.md) 的“已知的限制”里有几条会在真实使用中先碰到，不属于上面任何一项，单独列出来：

| 限制 | 什么时候会疼 | 怎么改 |
| --- | --- | --- |
| 任何成员都能看到全部项目的任务和时间线 | 有不该互相看到的项目时 | 视图接口按项目角色过滤（`views.rs`） |
| 客户端提前断开时，模型网关不记这一次的用量 | 任务被频繁停止时成本会少记 | `gateway.rs` 在连接断开的路径上也读已收到的用量 |
| 热备不复制副作用队列 | 切换时丢通知、留下没销毁的沙箱 | 副作用入队也写成事件，或者切换后按投影重新生成 |
| 性能证据在沙箱里测，噪声大 | 性能类验收多的项目 | 专门的压测环境，证据命令指过去 |
| 控制台的计划和环境计划是直接编辑 JSON | 给不写代码的人用时 | 做成表单 |

## 6. 代码约定和速查

接着写代码时用得上的约定。不遵守的话测试会告诉你，但知道了省时间。

**写入只有一条路。** 所有状态变化都是 `eng.store.write(|tx| { … })` 里发事件：读投影（`tx.view()`），校验，`tx.emit(actor, Some(ticket_id), Event::X { … })`，需要副作用就 `tx.effect(Effect::…)`。闭包返回错误时什么都不会写下。不要绕过它直接改表。

**加一种事件要改三处。** `acw-core/src/event.rs`（枚举）、`acw-core/src/projection.rs`（`apply`，怎么折进投影）、`acw-engine/src/views.rs`（`timeline_entry`，时间线上怎么显示；不想显示就不加）。事件一旦发布就要一直能读：新加的字段带 `#[serde(default)]`，不要改已有字段的名字和含义。

**投影是文档。** `get_doc / put_doc / del_doc / list_docs(conn, kind, id)`，在 `View` 上加一个读取方法。`acw-engine rebuild` 会清空投影重放日志，所以投影里不能有日志推不出来的东西。

**命令先查角色。** `actor.require(Role::Approver, Some(project), "做什么")`，或者任务上的命令用 `self.on_ticket(actor, id, Role::Approver, "做什么", |tx, t| { … })`。错误用 `invalid()`、`conflict()`、`not_found()`、`forbidden()`，HTTP 层会映射成 400、409、404、403。

**任务的阶段。** 改阶段用 `set_stage(tx, "engine", id, Stage::X, 状态文字, 原因, 恢复到哪)`；流水线里用 `advance()`，它会拒绝给已经不在活动阶段的任务写入（人的命令优先）。要等人：`self.block(&t, kind, 文字, 选项, 恢复阶段, 需要的角色)`。待处理：`open_queue` / `close_queue`。

**流水线。** 阶段函数返回 `StageResult`：`pipeline.rs` 里的 `provision`、`work`、`open_pr`，`gates.rs` 里的 `check`、`review`、`test`。在沙箱里跑命令用 `self.sb(t, ExecSpec::new(cmd).cwd("repo").timeout(…), cancel)`，它会带上环境计划里的变量。文件进出用 `self.sandbox.put_file / get_file(sid, "io/…")`。

**Worker 只能提议。** Worker 和 Engine 之间靠沙箱里 `io/` 下的文件：`progress.md`（进度）、`question.md`（提问）、`arch.json`（架构变化）、`replan.json`（改计划）、`env.json`（改环境计划）。Engine 读出来、校验、按规则处理。加新的通道时沿用这个方式，并在 `agent.rs` 的 `compose_prompt` 里告诉 Worker。

**模型调用。** Engine 侧的阶段用 `self.stage_chat("reviewer", Some(id), &[Msg::system(…), Msg::user(…)], true, None)`，它处理备用模型、计费和“不可用就等待”。

**测试。** 夹具在 `crates/acw-engine/tests/common/mod.rs`：`Harness::new(worker 脚本)` 或 `Harness::with(脚本, |cfg| …)` 起一个真的 Engine（临时目录、本地代码托管、本地沙箱、脚本 Worker、规则模型），`h.say(成员, 文字)` 发消息，`h.until(id, 秒, 说明, 条件)` 等任务到某个状态，等不到时会把时间线打出来。规则模型在 `devllm.rs`，按系统提示里的关键词分流；要让它表现出新的行为就在那里加规则。

**控制台。** 源码在 `console/src`，改完跑 `python3 scripts/build-console.py` 拼成 `console/app.js`（这个生成的文件也提交）。v0.2 的页面在 `v2.js`，其余在 `app.body.js`。没有打包工具，没有依赖。

**提交前。** `cargo test --workspace` 和 `cargo clippy --workspace --all-targets` 都要干净。改了行为就改 `docs/status.md` 里对应的那一行。

## 7. 已经定下来的事

下面这些是设计阶段和两轮实现里定的。除非有新的事实，不要在接着做的时候悄悄推翻；要改就明确地改，并更新文档。

事件日志是唯一事实来源，投影可以随时重建，重建不重放副作用。沙箱里没有任何凭证：模型请求走 Engine 的网关（每任务一个令牌），代码只以 git bundle 进出，Engine 只接受并只推送 `acw/T-<编号>…` 分支。权限在 Engine 里检查；需求单要不要审批由项目卡的规则在代码里决定，不取模型的输出；访客只得到回答。成员的消息和确认过的需求单是指令，PR 上没有权限的人写的内容只当数据。不自动合并。

模型按阶段配置，不绑定某一家；接入只支持外部的 OpenAI 兼容服务（https 加 key），不支持内网 vLLM；模型名从接入的 `/models` 拉取，不手填。Worker 现阶段用 codex，不换。沙箱自建用 Firecracker，不用 Docker，不基于 k8s。E2E 只用 Playwright 加 Chromium。金额单位是元，一天按 UTC+8 切。

## 8. 需要你定的事

接着做之前或做的过程中，下面几件事要你拿主意，我替不了：

OrcaRouter 有没有 `/v1/responses`（决定 B1 走哪条路）。第一个接入的真实项目是哪个仓库，它的构建、测试、E2E 命令是什么（决定 B1、B2 的试跑对象）。有没有带 KVM 的机器（决定 B3 什么时候能开始）。仓库名和项目名用哪个拼写。热备之外要不要 Raft（等 B5 演练之后再定）。
