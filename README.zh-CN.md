# dsh-git

[English](./README.md) · **中文**

`dsh-git` 让你像使用 Git 一样管理与 agent 的对话，并把上下文的选择权交还给人。

长期对话中，错误结论、过时假设、失败尝试和无关工具输出可能被后续回合持续继承。这个项目的核心目的，是让人明确选择可信且相关的回合，组成下一段对话的历史，避免默认沿用整段旧对话而造成上下文污染。

每个完整的「提问 + 回答」回合都相当于一次提交。你可以从任意会话 cherry-pick 多个回合，按指定顺序将它们重组为一段新的对话历史，再从这里继续提问。重组后的回合会作为真实、完整的 DSH 历史记录写入，而不是以一段上下文的形式附加到提示词中。因此，对 agent 而言，重组的历史与它亲历的对话没有区别。

`dsh-git` 是一款适用于 DeepSeek Harness Web 的插件。

## 操作对照

| Git | dsh-git |
| --- | --- |
| `commit` | 每个完成的「提问 + 回答」回合都是一个 `PA` 节点：原子化、可寻址，写入后不被改写。 |
| `log --graph` | 每个会话的 **分支** 标签页有一张 **Conversation Graph**，每个 Workspace 有一张项目图；两者都显示分叉、fork 副本、merge 轨道和 `HEAD`。 |
| `HEAD` | 当前会话历史里的最后一个节点。它与节点检查、上下文选择相互独立。 |
| `checkout` | 在项目图里点 **打开原会话**，跳到某个 PA 所在的会话。 |
| `cherry-pick` | 点开任意会话的 PA，用 **加入 Context** 把它放进有序的 **Context Tray**。 |
| `rebase` | 宿主端按照托盘中的顺序，把所选回合重新编号为一段连续的新历史。 |
| `branch` | 选择只来自一个会话时，托盘按钮是 **Fork**：以这段历史新建一个 Chat。 |
| `merge` | 选择来自多个会话时，按钮是 **Merge**：新 Chat 的第一个回合成为记录全部来源的多父节点。 |

## 主要功能

- **Conversation Graph：** 每个会话的 **分支** 标签页左侧是一张紧凑的对话图。点节点只是检查：打开 PA Context Window，显示它的 Prompt、Answer 和回答时使用的 Context，不改变选择，也不切换会话。
- **Chat History 预览：** 标签页右侧按托盘顺序显示当前选择合并后的完整聊天记录，包括工具调用和正在生成的回合。Fork 或 Merge 之前就能看到新 Chat 的历史会是什么样。
- **有序的 Context Tray：** 托盘停靠在官方输入框上方。只有明确加入的 PA 才会进入新历史；拖动标签可以调整发送给模型的顺序。同一个 PA 只占一格，改选它的另一个 fork 副本时原位替换。
- **Fork 与 Merge：** 选择只来自一个会话是 Fork，来自多个会话是 Merge。按钮名称、图上的父关系和连线来自同一份判定。Merge 的每条来源会话只有一条入线，其余选中的 PA 属于 Context，不成线。
- **官方 fork 去重：** 通过 Harness 官方功能创建的 fork，只要日志里记录了它来自哪个会话，就会共享继承的历史前缀。复制出的末端回合显示为带 `FORK` 徽标的副本，沿用原 PA 的编号，后续 PA 从这个副本往下延伸。Harness 从 0.2.1-rc.3 起不再记录这个来源，见「已知限制」。
- **锚定模式：** 点 **锚定** 冻结当前选择。此后从这个 Chat 发出的每个问题，都会在专用的 Anchor Workspace 里各开一个独立的子会话，以冻结的 PA 为历史。适合对同一份上下文并列地问多个问题。
- **Workspace 项目图：** 把鼠标悬停在 Workspace 行上，点图按钮查看该 Workspace 里所有已完成的 PA。项目图接管主栏、只读，不切换当前会话。底部的 **PA 时间轴** 按完成时间排列，向左拖动可以回看图是怎样长出来的。
- **宿主端持久化：** 每个 Workspace 文件夹有一份独立的图账本，随 DSH 配置保存，不依赖当前浏览器。不属于任何文件夹的会话各自使用独立账本。

## 版本要求

本插件对接 **DeepSeek Harness 0.2.2-rc.3**，即 Harness `master` 分支上的提交 `39163dd30f`。类型检查、测试和 `lib/` 的构建都以这个提交为准。标签 `dsh-v0.2.2-rc.3` 比它早 608 个提交；本插件用到的 Harness 接口在两处相同，但没有针对该标签构建或运行过。

不再支持 Harness 0.1.2：插件现在依赖会话格式 v4 的事件、浏览器端 Session Controller 的会话引用（retain），以及 `@deepseek-ai/dsh-agent-preset-registry` 包，这些在 0.1.2 里都不存在。最后一个能针对 `dsh-v0.1.2-rc.1` 构建的提交是 `3c468a3`。

需要 Node `^22.19.0 || >=24.0.0`。Harness 的这个版本固定使用 pnpm 11.28.5，下面的命令通过 `corepack` 调用它。

## 安装

`dsh-git` 只提供插件，不包含 `dsh` 可执行文件。开发依赖链接到同级目录的 Harness 源码检出，所以先准备好它：

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git ../deepseek-harness
git -C ../deepseek-harness checkout 39163dd30f
corepack pnpm --dir ../deepseek-harness install
corepack pnpm --dir ../deepseek-harness run build:native-system
corepack pnpm --dir ../deepseek-harness run build:lib
corepack pnpm --dir ../deepseek-harness run build:web
```

`build:native-system` 编译 Harness 在运行回合时加载的文件锁原生模块，需要 C 编译器和 Node 头文件；不构建它的话每个回合都会以 `Cannot find module … system.node` 失败。`build:lib` 生成插件链接所指向的各个包；`build:web` 生成网页前端，不构建它的话 Web UI 首页是 404。

把已有的 Harness 检出从别的版本切换过来时，构建前先删掉旧的 `lib/` 目录和残留的包目录，否则打包器会出错。

然后构建并安装插件：

```bash
pnpm install
pnpm run build
corepack pnpm --dir ../deepseek-harness dsh plugin --profile web add "$PWD"
corepack pnpm --dir ../deepseek-harness dsh --profile web
```

如果已全局安装 `dsh`，且 `command -v dsh` 能输出其路径，也可以改用较短的 `dsh plugin ...` 和 `dsh --profile web`。请勿在本插件仓库中运行 `pnpm dsh`：pnpm 只会查找当前项目提供的脚本和可执行文件，而本项目两者都没有。

构建后的插件不包含本地路径：除了由 DSH 通过客户端模块表提供的 React 之外，浏览器 bundle 完全自包含。构建产物 `lib/` 随包一同发布，安装发布版压缩包时无需再构建。

卸载插件：

```bash
corepack pnpm --dir ../deepseek-harness dsh plugin --profile web remove dsh-git
```

## 使用流程

当前会话已经混入错误假设、失败尝试或无关内容时，不必继续沿用整段历史。

1. 在 DSH 中完成一个或多个普通回合。
2. 打开 **分支** 标签页。当前会话的历史默认全部选中，显示为蓝色，最后一个节点标着 `HEAD`。
3. 点任意节点检查它；在 PA Context Window 里点 **加入 Context** 或 **移出 Context**。
4. 在输入框上方的 Context Tray 里拖动标签，设置发送给模型的顺序。右侧的 Chat History 会跟着更新。
5. 在官方输入框里写下一个问题，然后点托盘上的 **Fork** 或 **Merge**。
6. 插件以所选回合为有序历史创建新 Chat，把草稿转移过去并打开它。发送后，回答完成时新节点出现在图上。

选择被改动、还没有 Fork 或 Merge 时，输入框照常可以打字，但回车和发送按钮会被拦下，避免把问题发进旧会话。想放弃改动，点输入框旁的 **放弃更改并发送**：选择恢复为当前会话的完整历史，问题发往原会话。

### 锚定模式

1. 选好 PA，点 Conversation Graph 标题栏的 **锚定**。
2. 插件在当前 Workspace 目录下创建一个 `dsh-git-anchors-…` 子目录，并把它登记为 Anchor Workspace。
3. 之后从这个 Chat 发出的每个问题，都在 Anchor Workspace 里各开一个独立子会话。原会话不变。
4. 再点一次按钮取消锚定。Anchor Workspace 会保留；再次锚定同一组 PA 时继续使用它。

Anchor Workspace 的项目图里，冻结的 PA 保留原编号，各子会话自己的回合标为 `S<n>.<m>`。

## 数据模型

DSH 会话日志按时间顺序追加，已有记录不会被改写。`dsh-git` 在此基础上增加一张语义图。几个关键概念：

- **PA 身份与出现位置：** 同一个 PA 可以出现在多个会话里（原出现位置和 fork 副本）。身份决定编号，出现位置决定它画在哪、属于哪个会话。
- **PA 编号：** 在一个账本作用域内分配，显示之后永不改变。fork 副本不占编号。
- **父关系：** `parentIds` 决定图上的线。普通回合的父是同会话的上一轮；Merge 节点每条来源会话一个父。
- **Context：** `contextRefs` 记录一个回合实际带了哪些 PA、什么顺序、沿哪个会话的历史选中。它只用于点开节点时的高亮，不画成线。

完整的字段、判定规则和不变量见 [`docs/conversation-graph-logic.md`](./docs/conversation-graph-logic.md)。

## 图数据的存储方式

**图账本**存放在名为 `dsh_git_graph` 的 `dsh-storage-domain` 域中，每个作用域一条记录：Workspace 文件夹中的会话使用 `workspace:<id>`，不属于任何文件夹的会话使用 `session:<id>`。账本保存节点、分支、会话回合索引、待处理的 merge 配方和锚定绑定。选择、检查和托盘顺序属于视图，不写进账本。

浏览器持有内存里的账本副本。挂载时按作用域读取一次，此后每次变更把完整记录写回宿主端，同一作用域的写入串行执行。首次读取完成前产生的变更会暂存，以免提前渲染的视图为宿主端已知的回合重复创建节点。在已经记录过的会话之间切换不会产生写入。

宿主端在写入时把关：

- **版本检查：** 每次写入都带着它所基于的版本号，与已存版本不一致就拒绝，已存账本保持不变。
- **语义校验：** 有环、悬空引用、同一个会话里同一个 PA 出现两次、Merge 父关系与 Context 不一致等情况，整份写入被拒绝。

早期版本写下的账本可能把同一个回合存在两个 id 下。读取时会自动修复，不需要手动处理。

**Merge 溯源信息**还会写入新会话自身的日志，即种子末尾的一条 `dsh-git/merge` 事件。它记录每个导入回合的宿主端坐标——`sessionId`、回合号、边界 seq、选中时所沿的会话，以及该回合在新会话中的回合号——不依赖浏览器端的节点 id。因此，即使图账本丢失，项目图也能仅凭日志还原 merge 的父关系。

该事件必须标记为 `ignorable`。如果日志中出现 `KNOWN_SESSION_EVENT_TYPES` 以外的事件类型，而写入方没有设置该标记，`session-persistence` 会拒绝解析整份日志；插件也无法扩展这个编译期集合。由于 `Session.append` 不支持传入该标记，插件直接构造事件并放入种子——这是唯一支持该标记的写入路径。这也是插件不能向活动会话追加图元数据、可变账本使用存储域的原因。

## 宿主端历史合成

浏览器通过私有 RPC 只发送所选来源的坐标：`sessionId`、回合号和已完成回合的边界，外加选中时所沿的会话。宿主端先沿日志里的精确来源关系核对每个坐标的身份——同一个 PA 被选了两次，或者某个坐标并不属于它声称的会话历史，都会整笔拒绝，不创建任何东西。通过之后，宿主端读取规范会话日志，按托盘顺序重新编号所选回合，以这份结构完整的种子创建新 agent，并把新会话加入来源会话所在的 Workspace。

这一过程只改变对话历史。文件仍由整个 Workspace 共享，不随对话分支一同分叉。

## 项目图的数据读取

宿主端在 `/dsh-git` 下注册一个私有的 trusted-host Connection RPC。项目图请求只携带 Workspace id。宿主端读取该 Workspace 登记的全部会话的完整规范日志，返回标准化的已完成 PA 记录：开始与完成时间、fork 种子边界、内容指纹和 merge 溯源。尚未完成的回合不会返回。

浏览器把响应与账本拼成一张图并并入账本。dsh-git 创建的会话按日志里的精确坐标还原父关系；官方 fork 的继承回合并入父会话的节点，末位显示为 fork 副本；来源不明的旧复制回合保持独立，不猜边。

DeepSeek Harness 目前没有开放项目行操作或项目页插槽，因此项目图按钮与主栏接管集中在一个兼容桥里，通过语义化 DOM 属性和 `MutationObserver` 实现。输入框发送拦截同理，工作在输入框卡片的 DOM 边缘。如果 Harness 的侧边栏或输入框 DOM 发生变化，这两处适配可能需要更新；PA 数据协议和图页面不受影响。

## 开发与测试

项目采用 TypeScript 严格模式、React 18、Vitest、Testing Library 和 tsdown。

```bash
pnpm run typecheck
pnpm run test
pnpm run build
pnpm pack
```

源码结构：

- `src/index.ts`：宿主端插件，注册 RPC、合成会话种子、读写账本。
- `src/graph-ledger.ts`：两端共用的账本逻辑——身份、编号定稿、语义校验、节点替换与修复。
- `src/history.ts`、`src/merge-lineage.ts`、`src/project-history.ts`、`src/history-preview.ts`：宿主端的历史合成、溯源事件和日志投影。
- `src/protocol.ts`：RPC 端点和严格解码器。
- `src/client/repository.ts`：浏览器端账本的读取、写入队列和订阅。
- `src/client/ledger-transitions.ts`：账本的纯状态转换——导入会话、识别官方 fork、登记新 Chat、并入项目图。
- `src/client/project-graph.ts`：项目图的组装。
- `src/client/draft-attachments.ts`：草稿转移到另一个会话时，为它重新上传附件。
- `src/client/GraphView.tsx`、`GraphCanvas.tsx`、`ContextTray.tsx`、`ChatHistoryPreview.tsx` 等：界面。

测试按层分布：

- **账本：** `graph-integrity.spec.ts`（fork 编号、一个会话一个出现位置、旧账本修复、无谓写入）、`graph-correctness.spec.ts`（定稿顺序、Context 引用、版本检查）、`repository.spec.ts`、`workspace-repositories.spec.ts`、`graph-domain.spec.ts`、`graph-medium.spec.ts`（真实 JSON 存储后端的读写往返）、`graph.spec.ts`、`labels.spec.ts`。
- **宿主端：** `history.spec.ts`（种子合成、身份校验、`ignorable` 溯源事件）、`merge-rpc.spec.ts`（Fork、Merge 和锚定的 RPC 全流程）、`project-history.spec.ts`、`history-preview.spec.ts`、`seed-head.spec.ts`（种子必须以系统提示词开头，日志才能读回）。
- **项目图：** `project-graph.spec.ts`、`project-page.spec.tsx`、`project-bridge.spec.tsx`。
- **界面：** `components.spec.tsx`、`graph-canvas-design.spec.tsx`、`graph-canvas-selection.spec.tsx`、`graph-canvas-zoom.spec.tsx`、`history-rail.spec.tsx`、`chat-history-preview.spec.tsx`、`preview-markdown.spec.tsx`、`preview-cache.spec.ts`、`live-turn.spec.ts`、`extract.spec.ts`。
- **输入框与托盘：** `composer-send-guard.spec.ts`、`composer-discard-action.spec.tsx`、`composer-block-lease.spec.ts`、`context-tray-channel.spec.ts`、`context-tray-dock.spec.tsx`、`context-tray-slot.spec.ts`、`anchor-client.spec.ts`、`merge-client.spec.ts`（在会话引用上创建新 Chat 并转移草稿）、`draft-attachments.spec.ts`。

如需在不修改真实 DSH 配置的情况下冒烟测试，把 `DSH_HOME` 指到一个临时目录：

```bash
export DSH_HOME=/tmp/dsh-git-validation-home
corepack pnpm --dir ../deepseek-harness dsh plugin --profile web add "$PWD"
corepack pnpm --dir ../deepseek-harness dsh --profile web --dump-config
corepack pnpm --dir ../deepseek-harness dsh --profile web --port 0
```

配置输出必须以 `# == dsh-git` 层结尾；打开的页面里必须存在 `style[data-plugin="dsh-git"]`，且控制台没有报错。

## 已知限制

- `dsh-git` 不会自动判断某段历史是否正确、可信或有用。它提供上下文的可视化、溯源、选择和重组能力，最终判断仍由使用者完成。
- 只支持 Harness 0.2.2-rc.3，见「版本要求」。
- 从 Harness 0.2.1-rc.3 起，官方 fork 不再记录它是从哪个会话 fork 出来的，日志里也没有任何字段指向来源。这样的 fork 在图上是一个独立的会话，继承来的回合各自占用 PA 编号，宿主端也无法判断其中一个和它的原件是同一个 PA。旧版 Harness 创建的官方 fork 保留了来源记录，仍然会被折叠。通过 dsh-git 创建的 Fork 和 Merge 不受影响：它们自己写入来源。
- 没有测试过带着 Harness 0.1.2 时期的 dsh-git 数据升级配置目录。Harness 会把旧会话日志迁移到格式 v4 并在迁移中重新编号事件，而账本和 `dsh-git/merge` 事件保存的是事件位置。
- 账本不支持跨标签页同步。同一个 Workspace 开两个标签页时，后写入的那个会被宿主端拒绝，页面顶部提示重新加载；重新加载后恢复正常。
- 普通回合的 PA Context Window 显示「实际请求 Context 未知」。账本只记录 Fork 或 Merge 时明确选中的 Context，不从可见的父链反推普通回合实际带了什么。
- 记录了来源的官方 fork，识别依靠子、父会话同回合号的 Prompt 和 Answer 文本一致。子会话比父会话先被读到时，要等父会话也进入账本才会折叠。
- 新会话由宿主端创建，图账本由浏览器随后登记，两步之间没有事务。浏览器登记丢失时，项目图仍能从日志里的 `dsh-git/merge` 事件还原父关系。早于该事件引入的旧 merge 会话只能依赖账本。
- 只有选中的已完成回合会写入新会话的种子；未选中的祖先回合不会被隐式继承。核心轨迹事件会被复制，来源插件特有、仅用于日志的事件会被排除。种子以一条系统提示词开头，取最后一个选中回合当时生效的那条；其余来源的系统提示词和工具变更通知不会重放。
- 草稿里含有 `@` 引用等结构化内容时不能 Fork、Merge 或发送锚定问题。
- Harness 把草稿里的图片和附带的文件上传到添加它们的那个会话。把它们带进新 Chat 时，要通过 Harness Conversation 服务上一个不在公开接口里的成员为新会话重新上传。Harness 构建里没有这个成员时，带附件的草稿会被拒绝并留在原处；纯文字草稿仍然可以转移。
- 图上的连线可以交叉，也可能穿过节点；没有避障。
