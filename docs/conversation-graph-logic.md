# Conversation Graph 逻辑

本文描述 Conversation Graph **现在的实现**。它跟着代码走：两者不一致时以代码和测试为准，并应当回来改这份文档。

每一节末尾标出对应的源码，方便核对。

- [`Conversation Graph.html`](./Conversation%20Graph.html) 是早期的视觉稿。节点尺寸、间距和四种关系的基本画法仍然沿用它；连线粗细、merge 配色和图例已经由代码改掉，差异见 §9。

---

## 1. 基本概念

**PA**：一个完成的「提问 + 回答」回合。PA 写入后不被改写；重组历史是新建 Session，不是修改旧 PA。

**PA 身份与出现位置**是两回事：

- 一个 PA 只有一个身份（`paId`），它决定 PA 编号，也决定「是不是同一个 PA」。
- 同一个身份可以出现在多个 Session 里。第一次完成回合产生的是原出现位置；fork 之后新 Session 里的那一份是**副本出现位置**（`forkSourceId` 指向来源）。
- 一个 Session 里，同一个 PA 身份最多只有一个出现位置。

**图账本**：一个作用域一份。Workspace 文件夹里的会话共用 `workspace:<id>`，不属于任何文件夹的会话各自使用 `session:<id>`。PA 编号只在一个作用域内有意义。

源码：[`src/graph-state.ts`](../src/graph-state.ts)、[`src/client/workspace-repositories.ts`](../src/client/workspace-repositories.ts)

---

## 2. 账本里存了什么

```ts
interface TurnNode {
  id: string                 // 出现位置 id
  paId?: string              // PA 身份，定稿时写入
  ledgerOrdinal?: number     // 作用域内的永久 PA 编号
  finalOrdinal?: number      // 定稿事件序号，决定布局处理顺序
  sessionId: string          // 这个出现位置属于哪个 Session
  turn: number               // 在该 Session 里的回合号
  boundarySeq: number        // 该回合 turn/end 事件在该 Session 日志里的 seq
  prompt: string
  answer: string
  createdAt: number
  primaryParentId: string | null
  parentIds: readonly string[]
  forkSourceId?: string      // 有值表示这是一个 fork 副本
  contextManifest: readonly string[]   // 这一轮实际带的 PA（出现位置 id，有序）
  contextRefs?: readonly { paId: string, viaSessionId: string }[]
  contextKnown?: boolean     // false = 实际请求的 Context 无法还原
  displayLabel?: string      // 锚定模式保留下来的显示标签
  branchId: string
}
```

`GraphState` 除了 `nodes` 之外还有：

| 字段 | 含义 |
| --- | --- |
| `sessionTurnRefs[sessionId][turn]` | 该 Session 的第几轮对应哪个出现位置。这是 Session 历史的唯一索引。 |
| `branches` / `sessionBranches` | 每个 Session 一条 branch，`headId` 是该 Session 最新完成的节点。 |
| `pendingMerges[sessionId]` | 新 Chat 已创建、第一个新回合尚未完成时暂存的父关系和 Context。 |
| `anchors[sessionId]` | 锚定模式的绑定（§7）。 |
| `revision` | Host 用来拒绝过期写入的版本号。 |
| `ledgerSequence` / `finalSequence` | 已分配出去的最大编号和最大定稿序号。 |
| `headNodeId` / `previewNodeId` / `contextManifest` | 遗留字段。为了让已存账本继续通过校验而保留，**不再更新**：一份账本服务整个 Workspace 的所有 Chat，哪个 Chat 正在屏幕上不属于账本状态。 |

`(sessionId, turn, boundarySeq)` 是一个出现位置的 **Host 坐标**：浏览器向 Host 指定「要哪一轮」时只发这三个值，从不发节点 id。

源码：[`src/graph-state.ts`](../src/graph-state.ts)、[`src/graph-domain.ts`](../src/graph-domain.ts)

---

## 3. 编号与定稿

`finalizeGraph` 在每次提交前运行，浏览器和 Host 用的是同一个函数：

1. 尚未定稿的记录按 `(createdAt, id)` 排队；
2. 一条记录的全部依赖——`parentIds`、`forkSourceId`、以及 `contextKnown === true` 时的 `contextManifest`——都已定稿后，它才定稿；
3. 定稿时写入 `paId`、分配下一个 `finalOrdinal`；
4. 真实 PA 分配下一个 `ledgerOrdinal`；fork 副本沿用来源的 `ledgerOrdinal`，不占新编号。

由此得到的规则：

- **PA 编号一旦显示就不再改变。** 迟到的数据即使时间更早，也只会拿到更大的编号。
- **fork 副本不占编号。** 显示为来源的编号加 `FORK` 徽标。
- 依赖没到齐的记录保持未定稿，等依赖补齐后排在已有定稿事件之后。

节点标签由 `nodeLabelMap` 生成：有 `displayLabel` 用它，否则是 `PA<ledgerOrdinal>`；fork 副本是「来源标签 + fork」。

源码：[`src/graph-ledger.ts`](../src/graph-ledger.ts)、[`src/client/labels.ts`](../src/client/labels.ts)；测试：`graph-correctness.spec.ts`、`labels.spec.ts`

---

## 4. 四种关系

非根节点之间只有四种关系，判定顺序如下：

| 关系 | 判定 | 画法 |
| --- | --- | --- |
| **fork** | `forkSourceId` 有值 | 与同身份的出现位置同行，身份组之间用连接线相连；没有血缘入线，带 `FORK` 徽标 |
| **根** | 父为 0 个 | 独立开列，没有入线 |
| **merge** | 去重后父 ≥ 2 | 每个父一条彩色轨道汇入，带 `MERGE·n` 徽标 |
| **接续 / 分叉** | 单父 | 该父的第一个单父孩子接续（优先对齐父列），之后的孩子分叉（开右侧新列） |

**Context 不成线。** 一个 PA 带了哪些 PA 是一次请求的成分清单，只在点开节点时用来高亮，不画成边。merge 的父也不是 Context 里的全部 PA，而是每条来源 Session 在 Tray 里的最后一项（§6）。

---

## 5. 导入会话与识别官方 fork

Branches 视图把当前 Session 已完成的回合交给 `syncSession(sessionId, turns, parents)`。`parents` 是「官方 fork → 它的来源 Session」的映射，有两个出处：Harness 会话列表里记录的父 Session（0.2.1-rc.3 之前创建的 fork），以及 Host 随项目图报告的来源。导入和 fork 识别在**同一次提交**里完成。

**来源是从日志里找回来的。** Harness 从 0.2.1-rc.3 起不再给官方 fork 记录父 Session。但 fork 的种子仍然是来源日志一段前缀的逐事件拷贝——相同的 seq、时间和消息 id——后面跟一条 `session/end-seed` 标记。Host 据此在同一个 Workspace 的 Session 里找来源（`forkOrigin`）：日志开头与这段继承前缀逐事件相同，并且前缀的最后一个事件是它自己写下的那个 Session。后一个条件排除了「兄弟 fork」：它们也持有同一段前缀，但那是继承来的。比较的是事件而不是文字，所以两个 Session 问过同样的话不算共享历史。来源已经不在这个 Workspace 里、或者日志读不出来时，fork 仍作为独立 Session 导入。

**先并入项目图，再导入回合。** 视图打开时先读项目图并把它并入账本（§8），然后才导入当前 Chat 的回合：项目图知道哪些回合是从别的 Session 复制来的，先并入，这些复制件就不会被当成新的 PA 拿到编号。项目图读不到（Host 报错，或者 Chat 不属于任何 Workspace）时照常导入。

1. **导入**（`syncSessionTurns`）：`sessionTurnRefs` 里已有的回合只核对内容；没有的回合新建节点，父为同 Session 的上一轮。普通回合的 `contextKnown` 为 `false`——账本不从可见的父链反推「实际发出去了什么」。
2. **识别 fork**（`reconcileOfficialForks`）：对 `parents` 里每个非 dsh-git 会话，从第 1 轮起逐轮比较子、父两边同回合号的 Prompt 和 Answer，取最长的相同前缀。
   - 前缀里除最后一轮以外的回合：子 Session 的历史直接指向父 Session 的节点，子这边的复制件被收回。
   - 前缀的最后一轮：成为子 Session 的 fork 副本（`fork-<sessionId>-<turn>`），子 Session 自己的后续回合从这个副本往下接。

因为两步是一次提交，复制件在被识别之前不会先拿到编号：**fork 的复制前缀不消耗 PA 编号**。

如果子 Session 比父 Session 先被读到，复制件此时已经有了编号。之后父 Session 进来时，父的节点**接手**这些编号和 `paId`，已经显示过的标签不变，也不留空号。

收回一个节点时，`replaceNodes` 会改写账本里所有指向它的地方：边、Context、Session 历史索引、pending 配方、锚点、branch head，以及 `contextRefs` 里的 `paId`。

源码：[`src/fork-origin.ts`](../src/fork-origin.ts)、[`src/client/ledger-transitions.ts`](../src/client/ledger-transitions.ts)、[`src/client/use-project-graph.ts`](../src/client/use-project-graph.ts)、[`src/graph-ledger.ts`](../src/graph-ledger.ts)；测试：`fork-origin.spec.ts`、`fork-lineage-client.spec.tsx`、`graph-integrity.spec.ts`、`repository.spec.ts`

---

## 6. 从 Context 创建新 Chat：Fork 或 Merge

### 6.1 选择

选择状态属于 Branches 视图本身，不写进账本：

- 默认选中当前 Session 的完整历史（蓝色）。
- 点节点只是**检查**：打开 PA Context Window，不改选择，不切 Session。
- 在检查窗口里点「加入 Context」才把节点加入选择；「移出 Context」把它拿掉。
- 同一个 PA 身份在选择里只占一格。改选同一身份的另一个出现位置时替换原位，不新增。
- Context Tray 里拖动标签决定发送给模型的顺序。

每个选中项冻结成一个 `ContextRef { paId, viaSessionId }`：`viaSessionId` 记录用户是沿哪个 Session 的历史选中它的。

### 6.2 Fork 还是 Merge

按钮名称、父关系和画出来的线用的是同一套判定（`joinsLineages`、`lineageParentPlan`）：

- 选择的 `viaSessionId` 去重后**只有一个** → **Fork**。删掉中间几轮或者重排顺序都还是 Fork。
- **两个及以上** → **Merge**。

父端点的算法：按 `viaSessionId` 分组，每组取 Tray 里最后出现的一项，各组按这一项在 Tray 中的位置排序，得到 `parentIds`；Tray 全局最后一项所在组的端点是 `primaryParentId`。

所以选了 5 个 PA、来自 2 个 Session 时：Context 仍是完整有序的 5 项，图上只有 2 条入线，徽标是 `MERGE·2`。

### 6.3 Host 端合成历史

浏览器通过私有 RPC 只发送每个选中项的 Host 坐标和 `viaSessionId`。Host（`buildMergedSessionSeed`）：

1. **先校验身份**：把每个坐标沿日志里的精确来源关系解析到它的原始回合——dsh-git 创建的 Session 沿 `dsh-git/merge` 事件（Harness 把旧日志迁移到格式 v4 后，这个事件的类型是 `plugin:dsh-git/merge`，两种都读），官方 fork 沿它的来源和继承边界：来源取日志头里记录的 `parentSession`，没有记录时按 §5 从日志里找回。来源找不回来的官方 fork 无法继续解析，它的继承回合被当作各自独立的身份。同一个 PA 被选了两次，或者 `viaSessionId` 的历史里并不恰好包含这个 PA 一次，整笔拒绝。
2. 读取来源 Session 的规范日志，按 Tray 顺序把选中的已完成回合重新编号成连续的 Turn 1..N。复制的是回合本身的事件：回合与步骤边界、用户消息、`assistant/message`、没有产生消息的 `assistant/attempt`、工具调用与结果、请求头。来源 Session 的 `system/message` 和 `developer/message` 不随回合复制——它们描述的是来源自己的系统提示词和工具表。
3. 种子的第一个 surface 节点是一条 `system/message`：取 Tray 末位来源在被选回合结束时生效的那条系统提示词（新 Session 继承的正是这个来源的 preset），来源日志里没有系统提示词时写一条空的。Harness 读回已存日志时要求：surface 非空之后出现的任何 `system/message`，前面必须有一条位于 surface 首位的 `system/message`；而新 Session 第一次请求时 Harness 会在历史之后写入自己的系统提示词。没有这个首节点，新 Session 跑过一轮之后日志就读不回来了。首节点与新 Session 渲染出的提示词相同时，Harness 什么都不用再写。
4. 在种子末尾写入一条 `dsh-git/merge` 事件，记录每个导入回合的来源坐标、`viaSessionId` 和它在新 Session 里的回合号。
5. 用这份种子创建新 agent，并把新 Session 加入来源 Session 所在的 Workspace。响应里带回每个种子回合在新 Session 日志里的结束位置（`turnBoundaries`）。

身份校验只认日志里的来源关系，不比较文本。

### 6.4 浏览器端登记

Host 成功后，`prepareMergedSession` 登记新 Session：

- 新 Session 的历史索引指向被选中的节点。
- **Fork**：Tray 末位节点在新 Session 里建立一个 fork 副本，pending 的父就是这个副本。
- **Merge**：不建副本，pending 的父是 §6.2 算出的各端点。
- 完整的 Tray 存为 pending 的 Context。

新 Session 的第一个新回合完成时，`syncSession` 用 pending 里的父关系和 Context 建立节点，并清掉 pending。在那之前图上不出现空的 merge 节点。

fork 副本属于新 Session，要从新 Session 的日志里读。合成种子会重新编号事件，还在开头多写一条系统提示词，所以副本的 `boundarySeq` 取自 Host 响应里的 `turnBoundaries`，而不是来源的：来源的那个 seq 在新 Session 的日志里不是这一轮的结尾，拿它去读会被 Host 拒绝。新 Session 的日志被读到时再核对一次。

源码：[`src/client/merged-chat.ts`](../src/client/merged-chat.ts)、[`src/client/use-context-selection.ts`](../src/client/use-context-selection.ts)、[`src/client/graph.ts`](../src/client/graph.ts)、[`src/client/session-handoff.ts`](../src/client/session-handoff.ts)、[`src/history.ts`](../src/history.ts)、[`src/merge-lineage.ts`](../src/merge-lineage.ts)；测试：`graph.spec.ts`、`history.spec.ts`、`merge-rpc.spec.ts`、`merge-client.spec.ts`、`components.spec.tsx`

---

## 7. 锚定模式

锚定用来对同一份 Context 并列地问多个问题，并且让这些问题彼此隔离：

1. 在 Conversation Graph 标题栏点「锚定」，当前蓝色选择被冻结。
2. Host 在来源 Workspace 目录下创建（或复用）一个专用的 **Anchor Workspace**：目录名 `dsh-git-anchors-…`，内含 `.dsh-git-anchor` 标记文件。同一组来源坐标总是复用同一个 Anchor Workspace。
3. 锚定期间，从来源 Chat 的输入框发送的每个问题都不进入来源 Session，而是在 Anchor Workspace 里各开一个独立的子 Session（id 以 `dsh-git-anchor-` 开头），以冻结的 PA 为历史。
4. 再点一次按钮取消锚定。Anchor Workspace 保留，下次选中同一组来源时继续使用。

子 Session 不上屏，所以问题发出之后，来源输入框里的文字要等 Host 收下才清空。Host 拒收时，问题留在原输入框里，已经交给子 Session 的附件交还给来源 Session，输入框提示没有发出去。一个 Chat 同一时间只派发一个问题：前一个还没被收下时再按发送不会再开一个子 Session。

Anchor Workspace 有自己的账本作用域。它的项目图里，被冻结的来源 PA 保留原来的编号，各个子 Session 自己的回合标为 `S<n>.<m>`（第 n 个子 Session 的第 m 轮）。

源码：[`src/index.ts`](../src/index.ts)、[`src/client/anchor-mode.ts`](../src/client/anchor-mode.ts)、[`src/client/session-handoff.ts`](../src/client/session-handoff.ts)、[`src/client/project-graph.ts`](../src/client/project-graph.ts)；测试：`anchor-client.spec.ts`、`merge-rpc.spec.ts`

---

## 8. 项目图

项目图展示一个 Workspace 里所有已完成的 PA，只读。

Host 读取该 Workspace 登记的全部 Session 的完整日志，返回每个 Session 的已完成回合：起止时间、边界 seq、是否继承自种子、内容指纹、`dsh-git/merge` 来源记录，以及官方 fork 的来源 Session（§5）。某个 Session 的日志读不出来时，它被跳过并记入 Host 日志，其余 Session 照常返回。`assembleProjectGraph` 把它和本地账本拼成一张图：

- 账本里已有的节点沿用原 id；
- dsh-git 创建的 Session 按 `dsh-git/merge` 的精确坐标还原父关系和 Context；
- 找得到来源的官方 fork，继承前缀并入来源 Session 的节点，末位显示为 fork 副本。账本里已经有这个副本时沿用它的 id；
- 来源说不清的继承回合保持独立，不猜边。

拼好的图会并入账本（`adoptObservedGraph`），这样还没打开过的 Session 的回合也能被选中。并入时如果账本已经在另一个 id 下持有同一个回合，以账本自己的记录为准，观察到的那条折叠进去。

底部时间轴按**完成时间**排列真实 PA（fork 副本不占格），向左拖动会隐藏之后才出现的 PA 和边。编号是身份标签，时间轴是时间位置，两者互不改写。

源码：[`src/project-history.ts`](../src/project-history.ts)、[`src/client/project-graph.ts`](../src/client/project-graph.ts)、[`src/client/ProjectGraphPage.tsx`](../src/client/ProjectGraphPage.tsx)；测试：`project-graph.spec.ts`、`project-history.spec.ts`、`project-page.spec.tsx`

---

## 9. 画布

**行和列都是从账本关系现算出来的，不持久化。**

行：

```
根                → 0
单父孩子、merge   → max(父的行) + 1
fork 副本         → 与来源同行
```

列（每一行独立记录占用）：

```
第一个单父孩子    → 从父列起找本行最近空列
之后的单父孩子    → 从父列右侧起找
merge             → 从最右父列的右侧起找
fork 副本         → 紧挨来源右侧；该格被占时，只把本行这一格及其右侧的节点右移
```

节点按 `finalOrdinal` 的顺序处理，所以父总是先于孩子定位。

| 元素 | 规格 |
| --- | --- |
| 节点 | 132×42，列间净空 24，行间净空 58；左侧 2px 竖线承担强调色 |
| 血缘线 | 2.5px，圆角折线「下 → 横 → 下」，在父行下方 29px 处转弯；父子同列时是直竖线 |
| merge 轨道 | 2.5px 彩色线。每个 merge 节点一种颜色（三色循环），来源各自走到目标左侧的竖干再汇入；来源底部有出发圆点，目标左侧有到达圆点 |
| 图例 | 画布顶部列出每个 merge 的颜色、血缘线和 merge 总数 |
| 徽标 | `FORK`、`MERGE·n`（n = 去重后的父数）、`HEAD` |
| 选择状态 | 已加入（蓝）、未加入。画布还能画「候选预览」（绿色虚线），Branches 视图目前不产生这个状态 |

与早期视觉稿的差别：线从 1px 加粗到 2.5px 并改为圆角；merge 不再统一淡紫，而是按 merge 实例配色并带图例；fork 连接线两端是圆点而不是箭头。

**点开一个节点**时，被点开的 PA 身份的全部出现位置，以及它 Context 里每个 PA 身份的全部出现位置保持原样，其余节点变淡。结构线不变淡。点开不改选择、不切 Session、不动 `HEAD`。

`HEAD` 是当前 Session 历史里的最后一个节点，由视图计算。

源码：[`src/client/tree-layout.ts`](../src/client/tree-layout.ts)（行列与连线）、[`src/client/pan-zoom.ts`](../src/client/pan-zoom.ts)（平移缩放）、[`src/client/GraphCanvas.tsx`](../src/client/GraphCanvas.tsx)（渲染）、[`src/client/styles.ts`](../src/client/styles.ts)；测试：`tree-layout.spec.ts`、`graph-canvas-design.spec.tsx`、`graph-canvas-selection.spec.tsx`、`graph-canvas-zoom.spec.tsx`

---

## 10. 输入框规则

选择被改动、还没有 Fork/Merge 时：

- 官方输入框照常可以打字——草稿是要带进新 Chat 的；
- 回车和发送按钮被拦下，避免把问题发进旧 Session；
- 出路只有两个：点 Tray 上的 **Fork / Merge**，或者点输入框旁的 **放弃更改并发送**（恢复为当前 Session 的完整历史，再发送到原 Session）。

Fork/Merge 会把草稿文字、图片和上传的文件转移到新 Chat。草稿里有 `@` 引用等结构化内容时不能转移，操作会被拒绝。

Harness 里一个会话只有被引用（retain）时才在浏览器里有输入框，最后一个引用释放时它的未发送草稿随之丢弃。所以创建新 Chat 时，插件先自己引用新会话，放好草稿，交给主视图打开，然后才释放自己的引用；锚定模式下子会话不上屏，引用一直持有到宿主端收下问题为止。图片和文件是按会话上传的，转移时要为新会话重新上传（[`src/client/draft-attachments.ts`](../src/client/draft-attachments.ts)）；这一步用到 Harness 公开接口之外的成员，缺少它时带附件的草稿会被拒绝并留在原处。

锚定期间，发送手势改为向 Anchor Workspace 派发（§7）。

拦截发生在输入框卡片的 DOM 边缘，因为 Harness 没有提供「否决提交」的接口。Harness 0.2 起输入框是富文本编辑器而不是 `<textarea>`，回车事件来自可编辑元素或它内部的节点，两种形态都拦。

源码：[`src/client/composer-send-guard.ts`](../src/client/composer-send-guard.ts)、[`src/client/ComposerDiscardAction.tsx`](../src/client/ComposerDiscardAction.tsx)、[`src/client/ContextTray.tsx`](../src/client/ContextTray.tsx)；测试：`composer-send-guard.spec.ts`、`composer-discard-action.spec.tsx`、`context-tray-dock.spec.tsx`

---

## 11. 持久化与一致性

**浏览器持有内存里的账本，Host 负责存储和把关。**

- 首次读取（hydrate）完成前，所有变更先排队，不直接应用——否则空账本上的导入会给 Host 已经认识的回合再造一批节点。读取失败时闸门保持关闭，之后重试。
- 读取到的账本先经过 `repairOccurrences`：早期版本可能把同一个回合存在两个 id 下。被 Session 历史引用的那条保留，另一条折叠进去并改写所有引用。健康的账本原样返回。
- 每次变更把整份账本写回 Host，同一作用域的写入串行执行。
- **导入一个已经记录过的会话不产生写入。** 在已记录的 Chat 之间切换不会重写账本。

Host 在写入时做两件事：

1. **版本检查**：请求带着它所基于的 `revision`，与已存版本不一致就拒绝，已存账本保持不变。同一个 Workspace 开了两个标签页时，后写的那个会被拒绝，页面顶部提示重新加载。
2. **语义校验**（`assertGraphSemantics`），任何一条不满足都拒绝整份写入：
   - 节点 key 与 `id` 一致；父列表、Context 内部不重复，不自引用；
   - 无父 ⇔ `primaryParentId` 为空；有父时主父必须在父列表里；
   - fork 副本没有父；
   - 所有引用都指向存在的节点；
   - `parentIds`、`forkSourceId`、Context 组成的依赖无环；
   - 定稿序号不重复，真实 PA 的编号不重复；
   - 同一个 Session 里同一个 PA 身份只有一个出现位置；一个 PA 身份只有一个原出现位置；
   - fork 副本与来源的身份和编号一致；
   - Context 里同一个 PA 身份只出现一次；每个 `ContextRef` 在它的 `viaSessionId` 历史里恰好对应一个出现位置；
   - merge 节点的 `parentIds` 和主父必须等于按 §6.2 从 `contextRefs` 重新算出的结果。

已存的旧记录读取时只检查形状，不做语义校验，所以旧账本读得出来；它在浏览器端修复后，下一次写入才接受完整校验。

源码：[`src/client/repository.ts`](../src/client/repository.ts)、[`src/client/graph-transport.ts`](../src/client/graph-transport.ts)、[`src/graph-ledger.ts`](../src/graph-ledger.ts)、[`src/graph-domain.ts`](../src/graph-domain.ts)、[`src/index.ts`](../src/index.ts)；测试：`graph-integrity.spec.ts`、`graph-correctness.spec.ts`、`graph-domain.spec.ts`、`graph-medium.spec.ts`

---

## 12. 不变量

1. PA 写入后不被改写；重组历史是新建 Session。
2. PA 编号一旦显示就不再改变；fork 副本不占编号。
3. 同一个 Session 里，同一个 PA 身份最多一个出现位置。
4. Context 记录实际选中的 PA 和顺序，不做祖先补全，同一个 PA 身份不重复；Context 不成线。
5. Fork/Merge 的按钮名称、pending 父关系和画出来的线来自同一份选择快照。
6. merge 每条来源 Session 只有一个父端点和一条入线。
7. 浏览器发给 Host 的只有坐标，Host 按日志里的来源关系校验身份，不比较文本。
8. 账本只记录图的事实，不记录哪个 Chat 正在屏幕上。
9. 不满足 §11 语义校验的账本不会被写入存储。

---

## 13. 尚未实现

下面这些出现在更早的设计稿里，**代码里没有**，这里列出来以免误会：

- 持久化的 `rowOrdinal`、`occurrenceOrdinal`、`provisionalOrdinal`、`relationsComplete`、`sessionPaRefs`、`sessionHistoryPaIds`：行列是现算的，Session 历史只有 `sessionTurnRefs` 一份索引。
- `PA?` 临时区：依赖没到齐的记录只是暂不编号，没有单独的展示区。
- 连线避障、交叉断口和共线偏移：线可以交叉，也可能穿过节点。
- Host 端的原子事务：新 Session 由 Host 创建，图账本由浏览器随后登记，两步之间没有回滚。Host 创建成功而浏览器登记丢失时，项目图仍能从 `dsh-git/merge` 事件还原父关系。
- 多标签页同步：过期的标签页需要手动重新加载。
- 分支改名、缺少直接前驱时的警告：早期界面有，后来移除了。
