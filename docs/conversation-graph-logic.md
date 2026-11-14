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

Branches 视图把当前 Session 已完成的回合交给 `syncSession(sessionId, turns, parents)`。`parents` 是 Harness 会话列表给出的「子 Session → 父 Session」映射。导入和 fork 识别在**同一次提交**里完成：

1. **导入**（`syncSessionTurns`）：`sessionTurnRefs` 里已有的回合只核对内容；没有的回合新建节点，父为同 Session 的上一轮。普通回合的 `contextKnown` 为 `false`——账本不从可见的父链反推「实际发出去了什么」。
2. **识别 fork**（`reconcileOfficialForks`）：对每个有父 Session 的非 dsh-git 会话，从第 1 轮起逐轮比较子、父两边同回合号的 Prompt 和 Answer，取最长的相同前缀。
   - 前缀里除最后一轮以外的回合：子 Session 的历史直接指向父 Session 的节点，子这边的复制件被收回。
   - 前缀的最后一轮：成为子 Session 的 fork 副本（`fork-<sessionId>-<turn>`），子 Session 自己的后续回合从这个副本往下接。

因为两步是一次提交，复制件在被识别之前不会先拿到编号：**fork 的复制前缀不消耗 PA 编号**。

如果子 Session 比父 Session 先被读到，复制件此时已经有了编号。之后父 Session 进来时，父的节点**接手**这些编号和 `paId`，已经显示过的标签不变，也不留空号。

收回一个节点时，`replaceNodes` 会改写账本里所有指向它的地方：边、Context、Session 历史索引、pending 配方、锚点、branch head，以及 `contextRefs` 里的 `paId`。

源码：[`src/client/ledger-transitions.ts`](../src/client/ledger-transitions.ts)、[`src/graph-ledger.ts`](../src/graph-ledger.ts)；测试：`graph-integrity.spec.ts`、`repository.spec.ts`

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

1. **先校验身份**：把每个坐标沿日志里的精确来源关系解析到它的原始回合——dsh-git 创建的 Session 沿 `dsh-git/merge` 事件，官方 fork 沿 `parentSession` 和继承边界。同一个 PA 被选了两次，或者 `viaSessionId` 的历史里并不恰好包含这个 PA 一次，整笔拒绝。
2. 读取来源 Session 的规范日志，按 Tray 顺序把选中的已完成回合重新编号成连续的 Turn 1..N。
3. 在种子末尾写入一条 `dsh-git/merge` 事件，记录每个导入回合的来源坐标、`viaSessionId` 和它在新 Session 里的回合号。
4. 用这份种子创建新 agent，并把新 Session 加入来源 Session 所在的 Workspace。

身份校验只认日志里的来源关系，不比较文本。

### 6.4 浏览器端登记

Host 成功后，`prepareMergedSession` 登记新 Session：

- 新 Session 的历史索引指向被选中的节点。
- **Fork**：Tray 末位节点在新 Session 里建立一个 fork 副本，pending 的父就是这个副本。
- **Merge**：不建副本，pending 的父是 §6.2 算出的各端点。
- 完整的 Tray 存为 pending 的 Context。

新 Session 的第一个新回合完成时，`syncSession` 用 pending 里的父关系和 Context 建立节点，并清掉 pending。在那之前图上不出现空的 merge 节点。

fork 副本登记时新 Session 还不存在，暂时带着来源的 `boundarySeq`。新 Session 的日志第一次被读到时，副本改用它在新 Session 里自己的边界——之后再选中这个副本，发给 Host 的坐标才是存在的。

源码：[`src/client/GraphView.tsx`](../src/client/GraphView.tsx)、[`src/client/graph.ts`](../src/client/graph.ts)、[`src/client/index.ts`](../src/client/index.ts)、[`src/history.ts`](../src/history.ts)、[`src/merge-lineage.ts`](../src/merge-lineage.ts)；测试：`graph.spec.ts`、`history.spec.ts`、`merge-rpc.spec.ts`、`components.spec.tsx`

---

## 7. 锚定模式

锚定用来对同一份 Context 并列地问多个问题，并且让这些问题彼此隔离：

1. 在 Conversation Graph 标题栏点「锚定」，当前蓝色选择被冻结。
2. Host 在来源 Workspace 目录下创建（或复用）一个专用的 **Anchor Workspace**：目录名 `dsh-git-anchors-…`，内含 `.dsh-git-anchor` 标记文件。同一组来源坐标总是复用同一个 Anchor Workspace。
3. 锚定期间，从来源 Chat 的输入框发送的每个问题都不进入来源 Session，而是在 Anchor Workspace 里各开一个独立的子 Session（id 以 `dsh-git-anchor-` 开头），以冻结的 PA 为历史。
4. 再点一次按钮取消锚定。Anchor Workspace 保留，下次选中同一组来源时继续使用。

Anchor Workspace 有自己的账本作用域。它的项目图里，被冻结的来源 PA 保留原来的编号，各个子 Session 自己的回合标为 `S<n>.<m>`（第 n 个子 Session 的第 m 轮）。

源码：[`src/index.ts`](../src/index.ts)、[`src/client/index.ts`](../src/client/index.ts)、[`src/client/project-graph.ts`](../src/client/project-graph.ts)；测试：`anchor-client.spec.ts`、`merge-rpc.spec.ts`

---

## 8. 项目图

项目图展示一个 Workspace 里所有已完成的 PA，只读。

Host 读取该 Workspace 登记的全部 Session 的完整日志，返回每个 Session 的已完成回合：起止时间、边界 seq、是否继承自种子、内容指纹，以及 `dsh-git/merge` 来源记录。`assembleProjectGraph` 把它和本地账本拼成一张图：

- 账本里已有的节点沿用原 id；
- dsh-git 创建的 Session 按 `dsh-git/merge` 的精确坐标还原父关系和 Context；
- 官方 fork 的继承前缀并入父 Session 的节点，末位显示为 fork 副本。账本里已经有这个副本时沿用它的 id；
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
| 选择状态 | 已加入（蓝）、候选预览（绿色虚线）、未加入 |

与早期视觉稿的差别：线从 1px 加粗到 2.5px 并改为圆角；merge 不再统一淡紫，而是按 merge 实例配色并带图例；fork 连接线两端是圆点而不是箭头。

**点开一个节点**时，被点开的 PA 身份的全部出现位置，以及它 Context 里每个 PA 身份的全部出现位置保持原样，其余节点变淡。结构线不变淡。点开不改选择、不切 Session、不动 `HEAD`。

`HEAD` 是当前 Session 历史里的最后一个节点，由视图计算。

源码：[`src/client/GraphCanvas.tsx`](../src/client/GraphCanvas.tsx)、[`src/client/styles.ts`](../src/client/styles.ts)；测试：`graph-canvas-design.spec.tsx`、`graph-canvas-selection.spec.tsx`、`graph-canvas-zoom.spec.tsx`

---

## 10. 输入框规则

选择被改动、还没有 Fork/Merge 时：

- 官方输入框照常可以打字——草稿是要带进新 Chat 的；
- 回车和发送按钮被拦下，避免把问题发进旧 Session；
- 出路只有两个：点 Tray 上的 **Fork / Merge**，或者点输入框旁的 **放弃更改并发送**（恢复为当前 Session 的完整历史，再发送到原 Session）。

Fork/Merge 会把草稿文字和图片转移到新 Chat。草稿里有 `@` 引用等结构化内容时不能转移，操作会被拒绝。

锚定期间，发送手势改为向 Anchor Workspace 派发（§7）。

拦截发生在输入框卡片的 DOM 边缘，因为 Harness 没有提供「否决提交」的接口。

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
