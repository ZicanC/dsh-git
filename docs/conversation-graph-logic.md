# Conversation Graph 逻辑设计（定稿）

本文是 Conversation Graph 的**设计基准**。正文描述图应当是什么样，不描述代码现在是什么样；两者不一致时，以本文为准，由代码来对齐。

- 视觉定稿来源：[`Conversation Graph.html`](./Conversation%20Graph.html)（`4a`–`4d` 四种关系各一张，`4f` 同框，`4g` 点开态）。
- 这份 HTML 决定已经画出来的几何和样式；本文补充数据来源、事务边界，以及视觉稿没有覆盖的特例。两者曾有冲突的地方已经按视觉定稿更新。

---

## 0. 设计立场

四句话概括这套图要坚持的东西：

1. **非根节点之间只有四种关系**——接续、分叉、fork、merge。根节点没有入关系，不算第五种关系。
2. **上下文不成线。** 一个 PA 带了哪些 PA，是一次请求的成分清单，不是节点之间的长期关系。merge 只把每条来源谱系最后被接住的位置冻成血缘，其余 Context 成员仍然不成线。
3. **PA 身份和 Session 中的出现位置是两回事。** 原 PA 与 fork 副本共享一个 PA 身份，但属于不同的 Session 出现位置。
4. **形状只从账本字段推出来。** 渲染层不补祖先、不猜边、不用当前画面反推数据；关系说不清时先孤立显示，数据补齐后再按 §2.1 完成一次最终布局。

---

## 1. 图账本记录什么

### 1.1 PA 身份与出现位置

一个完成的「提问 + 回答」回合产生一个不可原地改写的 **PA 身份**。同一个 PA 身份可以在多个 Session 中出现：

- 第一次完成回合时产生的是**原出现位置**；
- Harness fork 后显示的是同一身份的**副本出现位置**；
- 原出现位置和全部副本出现位置组成一个**身份等价类**。

PA 内容、全局唯一 `paId` 和不可变的 `contextRefs` 属于 PA 身份；当前图作用域内的 PA 编号也绑定这个身份。列、父子连接、fork 箭头和显式副本的 Session 归属属于出现位置。副本因此可以有自己的位置和 Session，但没有新的 PA 身份、Context 或编号。

Session 可以在自己的历史中**引用**一个 PA，而不为它创建新的可视副本。普通 fork 复制的历史前缀复用既有 PA 身份和可视节点，只有 fork 断点建立显式副本。`viaSessionId` 记录的是“用户沿哪个 Session 历史选择”，不要求该 PA 在该 Session 中一定有独立副本盒子。

下文所说的**真实 PA 出现位置**，是“非 fork 副本、并且创建了一个新 PA 身份”的出现位置。一个 PA 身份只有一个真实出现位置；之后建立的 fork 出现位置都是共享该身份的副本。

### 1.2 必须持久化的语义字段

| 概念 | 回答的问题 | 图上的体现 |
| --- | --- | --- |
| **PA 身份 id** | 「哪些出现位置其实是同一个 PA」 | 编号共享、选择去重、点开等价类 |
| **显式出现位置 id / Session 归属** | 「这个可视盒子是谁、归哪个 Session」 | 父子端点、fork 来源、可视副本 |
| **Session 历史引用路径** | 「用户沿哪个 Session 历史看到并选择这个 PA」 | `ContextRef.viaSessionId`、branch 分组 |
| **Session 引用索引** | 「这个 Session 历史里的这个 PA 应落到哪个可视出现位置」 | `ContextRef` 到父端点的确定映射 |
| **Session 历史顺序** | 「该 Session 的可见历史前缀按什么顺序组成」 | Fork 复制的完整前缀、历史面板顺序 |
| **账本序号 `ledgerOrdinal`** | 「它何时在当前图作用域完成定稿」 | 作用域内的永久 PA 编号、孩子先后和确定性破平局 |
| **谱系行号 `rowOrdinal`** | 「它位于谱系的第几层」 | 同一父层的兄弟可以同行；副本与来源同行 |
| **出现位置序号 `occurrenceOrdinal`** | 「同一身份的多个显式出现位置按什么顺序建立」 | 多个副本的稳定左右顺序 |
| **临时序号 `provisionalOrdinal`** | 「关系封包第一次到达 Host 的先后」 | 临时区排序、批量补齐与行内槽事件的确定性破平局 |
| **主线父出现位置** | 「Session 语义上从哪条谱系接续」 | 单父时参与列分配；merge 时不控制 x |
| **全部父出现位置** | 「哪些谱系端点指向我」 | 血缘入线的数量和端点 |
| **上下文清单 `contextRefs`** | 「这一轮实际带了哪些 PA、按什么顺序、沿哪个 Session 历史选择」 | PA 身份的不可变成分；点开态；不直接成线 |
| **fork 来源出现位置** | 「我是不是某个 PA 身份的副本、从哪个出现位置 fork」 | 同行副本、共享编号、双向箭头 |
| **完成时间** | 「这个 PA 实际何时完成」 | 项目时间轴排序；不改变编号或谱系行 |
| **关系完整标记 `relationsComplete`** | 「当前空父列表是真的无父，还是父关系还没到」 | 决定能否把记录视为根或进入四关系判定 |
| **布局状态** | 「关系是否已经完整到可以分类」 | `provisional` 临时孤立；`final` 可进入根状态或四关系判定 |
| **行内显示槽 `displaySlotOrdinal`** | 「这一行的盒子从左到右怎样排」 | 接续优先对齐、fork 身份组紧邻、merge 开右侧新槽；由布局器确定性派生 |

`paId` 是跨作用域的真实身份；`ledgerOrdinal` 是**一个 Conversation Graph 作用域内**的稳定显示序号。一个 Workspace 及其 Session/Workspace 图面共享同一套编号账本；独立作用域可以给同一 `paId` 不同的本地 PA 编号。跨作用域诊断使用 `paId`，不拿本地编号冒充全局 id。

完成定稿的真实 PA 在进入当前图账本时取得下一个 `ledgerOrdinal`，之后永久不变。尚未定稿的真实 PA 不取得永久 PA 编号。迟到数据即使完成时间更早，也只会取得新的账本序号；真实时间只影响时间轴，不反向改写编号或已经 final 的谱系行。

`occurrenceOrdinal` 在原出现位置或 fork 副本第一次写入时取得，之后不变。同一个 PA 身份在同一个 Session 中最多只有一个**显式**出现位置；共享历史前缀可以只有 Session 引用而没有独立副本盒子。

图账本必须同时维护：

```ts
sessionPaRefs[sessionId][paId] = occurrenceId
sessionHistoryPaIds[sessionId] = readonly paId[]
```

前者把一条 Session 历史路径中的 PA 身份确定到可视端点，后者保存该 Session 可见历史的顺序。共享历史前缀指向被复用的既有出现位置；fork 断点在新 Session 中指向该 Session 的显式副本。即使同一身份的原节点和多个副本同时可见，每个 `paId + viaSessionId` 仍然只能解析到一个端点。

Session 从 UI 删除或归档时，只要任何 final PA 的 `contextRefs`、出现位置归属或图关系仍引用它，就必须保留只读 tombstone 及上述两份 provenance 索引，不能物理删除或复用 `sessionId`。只有确认整个图账本都不再引用时才允许垃圾回收。

上下文清单的最小条目是：

```ts
interface ContextRef {
  readonly paId: string
  readonly viaSessionId: string
}
```

- `paId` 用于判断是不是同一个 PA 身份；
- `viaSessionId` 记录用户沿哪个 Session 历史引用路径选择；
- 同一个 `paId` 在一份 Context 中最多出现一次；
- 用户改选同一身份的另一个副本时，只更新 `viaSessionId`，不增加第二份 PA，也不自动改变 Tray 顺序。

反序列化、导入和 RPC 都必须在边界检查 Context 唯一性。**最外层 mutation envelope 是唯一原子单位**：其中任一记录出现重复 `paId` 时整批拒绝；单记录调用本身就是一批。不能只留下同批的其他记录，也不能用第一项、最后一项或静默去重来猜用户意图，更不能把这种格式错误转成 `PA?`。

需要把一个 `ContextRef` 变成图上端点时，统一使用 `resolveOccurrence(ref) = sessionPaRefs[ref.viaSessionId][ref.paId]`。此外，该 `paId` 必须在 `sessionHistoryPaIds[ref.viaSessionId]` 中恰好出现一次；只有 alias 映射、却没有实际 Session 历史成员资格的引用无效。索引或历史成员资格缺失时，不在身份等价类里任选副本，也不猜端点。用户主动提交 Fork/Merge 时，这会直接阻止提交，规则见 §5.1；只有外部导入或后台发现的不完整图记录才进入 `provisional` 临时区。尚无首个 final PA 的空 Merge Session 不能充当 `viaSessionId`。

`parentIds` 是按确定顺序保存、内部不重复的出现位置 id 清单，任何记录都不能把自己列为父。非 fork 的根记录必须同时满足 `primaryParentId = null`、`parentIds = []`；非根真实 PA 的 `primaryParentId` 必须包含在非空 `parentIds` 中。fork 副本没有血缘入线，它的 `primaryParentId = null`、`parentIds = []`；`forkSourceId` 指向同身份的来源出现位置，并决定副本所在行。

### 1.3 关系封包与定稿门槛

每个新到达的出现位置记录先取得当前图作用域内唯一、单调递增的 `provisionalOrdinal`。批量载荷不能依赖对象或 `Map` 的遍历顺序：如果来源顺序有业务含义，载荷必须提供不可变 `sourceOrdinal`；否则 Host 先按 `occurrenceId` 规范排序，再一次性分配 `provisionalOrdinal`。同批新增的 fork 出现位置也在这一步按 `(paId, occurrenceId)` 规范排序后分配 `occurrenceOrdinal`。输入方还必须显式提供 `relationsComplete`：

- `relationsComplete = false` 表示父关系未知，即使 `parentIds = []` 也不能把它当成根；
- `relationsComplete = true` 表示 `primaryParentId`、`parentIds` 和 `forkSourceId` 已经是权威值，可以接受完整性校验。

一条记录只有同时满足以下条件才可以转为 `final`：

1. `relationsComplete = true`；
2. `primaryParentId` 与 `parentIds` 满足 §1.2 的字段约束，全部父出现位置都已是 `final`，或会在同一批拓扑处理里先于它转为 `final`；
3. 如果有 `forkSourceId`，来源出现位置已是 `final`、与副本共享 `paId`，并且该身份已经有 `ledgerOrdinal`；
4. 当前图作用域内没有第二个非副本记录使用同一 `paId`；每个副本最终都能追溯到这个唯一原出现位置，并且 `(sessionId, paId)` 没有第二个显式出现位置；
5. 该 PA 身份的每个 `ContextRef` 都在对应 `sessionHistoryPaIds` 中恰好出现一次，并能通过 Session 引用索引解析到一个 `final` 出现位置，或会在同一批拓扑处理里先于它转为 `final`；
6. 如果 `parentIds` 有两个或以上端点，按 §2.3 从 `contextRefs + sessionPaRefs` 重新计算出的有序 `parentIds` 和 `primaryParentId` 必须与载荷完全一致；
7. `parentIds`、`forkSourceId` 和已解析的 Context 引用共同组成的定稿依赖无环；Context 依赖只控制定稿先后，仍然不画线。

批量补齐时对上述全部定稿依赖使用稳定的 Kahn 拓扑排序。当前可处理记录按 `(provisionalOrdinal, paId, occurrenceId)` 升序选择；处理真实 PA 出现位置时依次分配新的 `ledgerOrdinal` 和 §2.1 的 `rowOrdinal`，处理 fork 副本时只继承身份已有的编号和来源行。这样，同一批数据无论容器遍历顺序如何，都会得到同样的编号、行和左右顺序。

尚未满足条件的记录按 `provisionalOrdinal` 放在最终图下方的独立临时区，显示为 `PA?`，不画任何推测出的关系线。缺少引用的记录等待补齐；检测到循环或字段自相矛盾的记录标记为 validation error，也保留为 `PA?`，直到导入源修正。临时记录可以在定稿前修正；一旦成为 `final`，身份、Context、血缘关系、永久编号和谱系行不可原地改写。为了始终让 fork 身份组保持紧邻，后来的 fork 出现位置可以使右侧列整体平移；这种只改 x 的确定性重排不改变任何身份、关系、行号或左右相对顺序。

---

## 2. 根状态与四种关系

图上只有两种结构线：**黑色血缘线**和**淡紫 merge 线**。fork 使用双向箭头表达身份相等；它不是血缘线。下表只分类 `final` 记录；`provisional` 记录统一留在临时区，不根据已知一半的数据猜关系。

| 状态 / 关系 | 稳定判定 | 画法 |
| --- | --- | --- |
| **根状态** | 非副本，父出现位置为 0 个 | 独立开列，没有入线 |
| **接续** | 单父，并且是该父按 `ledgerOrdinal` 排序的第一个**单父普通真实孩子** | 优先对齐父槽，通常退化为直竖线 |
| **分叉** | 单父，并且是该父的第二个或以后**单父普通真实孩子** | 开右侧新槽，线走「下 → 横 → 下」 |
| **fork** | `forkSourceId` 有值 | 与同身份出现位置同行，以双向箭头串成身份等价类；没有血缘入线 |
| **merge** | 去重后有两个或以上父出现位置 | 每条来源 branch 一条淡紫线，汇入 merge 节点 |

判定顺序：

0. 不是 `final` → provisional，不进入根状态或四关系分类；
1. 有 `forkSourceId` → fork；
2. 父出现位置为 0 个 → 根状态；
3. 父出现位置为 2 个以上 → merge；
4. 单父 → 只在该父的 `parentIds.length === 1` 普通真实孩子中，按永久先后判定接续或分叉。

这里的“第一个孩子”在孩子写入账本时就确定，后来新增普通孩子不会改变旧孩子的关系类型。merge 永远不消耗任何来源的 ordinary continuation slot；因此一个 PA 先参与 merge，之后仍可有一个直向下的第一个普通孩子。

### 2.1 稳定行列与普通血缘线

`ledgerOrdinal` 决定 PA 编号，不直接决定 y。真实 PA 的 `rowOrdinal` 表示谱系层级，同一行可以有多个真实 PA：

```
根节点          → 0（多个独立根允许同行）
单父真实孩子    → parent.rowOrdinal + 1
fork 副本       → forkSource.rowOrdinal
merge 真实节点  → max(parent.rowOrdinal) + 1
```

因此，兄弟分叉同行；一条 branch 继续向下才增加一行。记录成为 `final` 时冻结 `rowOrdinal`，后来新增后代不会把旧节点换行。

盒子的 x 使用**每行独立**的 `displaySlotOrdinal`。布局器按 Host 持久化的拓扑定稿事件序号 `finalOrdinal` 处理 final 出现位置（包括 fork 副本）。`provisionalOrdinal` 只用于等待区及可定稿记录的破平局；迟到依赖补齐后，在现有定稿事件之后追加，不插回到达时的位置。这样父端点先于孩子定位，补齐普通记录也不会重排已有行内槽。每一行维护自己的已占槽。无冲突时使用以下期望槽：

```
根节点                    → 开当前行最右侧新槽
第一个单父普通真实孩子    → 优先使用父的显示槽
第二个及以后普通孩子      → 从父槽右侧起找当前行最近空槽
merge                     → 从最右父槽右侧起找当前行最近空槽
```

`primaryParentId` 保留为 Session/账本的主父语义，但不控制 merge 的 x。每一行独立维护占用集合，其他行曾经使用过某个槽不会阻止本行复用；只有目标槽在**当前行**确实被占用时，才继续向右寻找或按 §2.2 打开插槽。黑线照常按最终端点重算为肘线。`displaySlotOrdinal` 是确定性派生的展示位置，不是 PA 身份或永久账本字段；后加 fork 可以按 §2.2 使 x 重排，但不能改变编号、关系或 `rowOrdinal`。

普通接续或分叉要求单父孩子与父出现位置属于同一个 Session。跨 Session 的单父关系必须先出现一个显式 fork 副本作为断点；否则记录不能 final。

普通血缘线固定使用父行下方的走线层，不取父子几何中点：

```
M 父中心x 父底y
V 父底y + 29px
H 子中心x
V 子顶y
```

- 父子同列时，横段长度为 0，自动退化成直竖线；
- 新分叉列在分配前必须保证从该走线层到子节点之间没有节点占用；
- 允许结构线彼此交叉，但不允许结构线穿过节点盒子。

从同一个父出现位置出发的黑线路径可以共享到首次分歧为止的**最大公共前缀**，这是同一父节点的真实分流。除此之外，两条黑线的几何交叉不是连接；子节点 `ledgerOrdinal` 较大的那条路径在点交叉处留 4px 断口，另一条连续。非共享路径如果出现非零长度的共线重合，按全局线优先级分配稳定 `overlapRank`，第 `rank` 条沿整个重合区间平行偏移 `4px × rank`，并在两端用短 dogleg 接回；黑线优先于紫线，同色线按目标 `ledgerOrdinal` 较小者优先。偏移空间会进入节点盒时，改走 §2.3 的外侧避障 fallback。

如果一个导入或后台发现的节点尚未满足 §1.3 的定稿门槛，它以 **`PA?` 临时孤立状态**保留在最终图下方的独立临时区，不占最终行列，也不取得 `ledgerOrdinal`。临时节点按 `provisionalOrdinal` 形成单列清单，不画已知一半的父线或 fork 箭头。依赖关系补齐后，按 §1.3 的稳定拓扑顺序完成一次最终布局并冻结其编号和谱系行。没有引用依据的关系永远不猜。

### 2.2 fork：副本组成身份等价类

Harness fork 会复制历史。图只为 fork 断点创建副本出现位置：

- 副本与同一 PA 身份的其他出现位置同行；
- `occurrenceOrdinal` 由 Host 串行分配，在 `(graphScopeId, paId)` 内唯一且单调递增；
- 同一身份的显式出现位置按**当前空间顺序**用相邻双向箭头串联，每两项之间一根 1.1px 箭头，箭头头 4px；
- 使用相邻箭头而不是让原节点直连每个副本，避免长箭头穿过中间副本；
- 副本沿用原 PA 编号和该身份原有的 `contextRefs`，并带 10px 等宽 `FORK` 徽标；
- 副本不占 PA 编号、不占时间轴，不会在 Context 中形成第二份 `paId`，也没有血缘入线。

#### 紧邻插槽与碰撞

视觉定稿要求第一个 fork 副本**强制位于身份组右边第一格**，盒子之间保持 24px 净空。`forkSourceId` 只记录 provenance，不单独决定 x；已有副本后无论再次从原位置还是某个副本 fork，新出现位置都按 `occurrenceOrdinal` 追加在整个身份组的右边界，形成：

```
原出现位置 ↔ fork 1 ↔ fork 2 ↔ …
```

身份组的每个出现位置都可以成为后续真实 PA 的父。若待插入格已被当前行的其他盒子占用，布局器只把**当前行**从该格开始的显示槽后缀整体右移；其他行和已经放置的后代不因这个插槽移动。所有相连边必须从移动后的端点坐标重新路由，不能把旧 path 整体平移。这个动作可以改变屏幕 x 和既有接续线是否退化为直线，但不能改变盒子的行内左右相对顺序、任何 `rowOrdinal`、PA 编号或关系类型。

同一批增加多个副本时，先按 §1.3 规范化并分配 `occurrenceOrdinal`，再把整个身份组作为一个连续行内 block 求解；不能边遍历边抢位。身份组之外的新增根、分叉和 merge 按 §2.1 从各自关系锚点向右寻找当前行最近空槽，不插入已有身份组内部。

fork 身份箭头与黑色血缘线或紫色 merge 线发生几何交叉时永远不表示连接；身份箭头在交点留 4px 断口，结构线保持连续。

### 2.3 merge：每条来源 branch 只有一条紫线

一个 Merge 的父出现位置不是 Context 中的全部 PA，而是每条来源 branch 的**Tray 末位节点**：

1. 按 `viaSessionId` 将 Context 分组；
2. 每组取它在 Tray 顺序里最后出现的 `ContextRef`，各组再按这项在 Tray 中的位置升序排列；
3. 通过 `resolveOccurrence(ref)` 取得这些末位 PA 的可视端点，并按上述组顺序组成 `parentIds`；
4. Tray 全局最后一项所在分组的末位出现位置成为 `primaryParentId`。

因此，Tray 选择 5 个 PA、来自 2 条 branch 时：

- Context 仍然完整保存 5 个 PA 和顺序；
- 图上只有 2 条淡紫入线；
- 徽标显示 `MERGE·2`；
- 其余 3 个 PA 是 Context 成员，不是 merge 血缘端点，不成线。

merge 的所有入线一律全紫，包括 `primaryParentId` 对应的入线。主线父只保留 Session/账本语义，不制造黑色主次关系，也不决定 merge 的 x。`LATEST` 徽标取消：每条紫线的起点本身就是该 branch 的 Tray 末位节点。

merge 首次布局时，从所有父端点中最右槽的下一格开始，选择目标行最近空槽；`primaryParentId` 不让它继承任何来源槽。这样 merge 明确落在当时全部来源右侧，同时不同谱系层仍可复用其他行的空槽，不会因历史上出现过更多列而无故拉宽画布。后来新增 fork 时仍以 §2.2 的“只移动当前行后缀”为准：既有 merge 不跨行追随重排，但所有相关连线必须从移动后的来源端点重新路由。

#### merge 直连与避障 fallback

定稿的默认路径不是外侧持久 rail，而是每个来源直接接到 merge 中心竖干：

- 如果来源还有一个黑色普通孩子，紫线从来源底边中心向右偏 8px 出发；否则从正中心出发；
- 先落到来源底部下方 29px 的走线层，再水平走到 merge 中心 x；
- merge 中心竖干从最上方来源的走线层连续落到目标顶部；不同高度的来源横线分别接入这根竖干；
- 多个来源同行时，它们共享同一条目标上方母线；这只表示它们汇入同一个 merge；
- 结构线 1px 实线，不使用虚线，不显示 `LATEST`。

直连路径如果会穿过节点盒子，才启用局部避障 fallback：在阻挡盒外保留至少 4px 安全距离，从正交候选中依次按「总长度、转弯数、优先向右绕、waypoint 的 `(x,y)` 字典序」选唯一最小项。fallback 不写入持久 rail，也不改变节点显示槽。

所有紫色路径段使用全图稳定优先级 `(target.ledgerOrdinal, sourceIndex, segmentKind)`；`sourceIndex` 是来源在目标 `parentIds` 中的位置，`segmentKind` 顺序为来源 stem、水平段、目标 trunk。不同 merge 实例相交时也用这组全局键，较大的路径段留 4px 断口；同一目标的合法 trunk/母线汇合不留断口。紫线与黑线点交叉时紫线留断口。非零长度共线重合按 §2.1 分配唯一 `overlapRank`，不能让第三条线与第二条都只偏移同一个 4px。

淡紫色只用于 merge，不复用于 branch 身份、选择或其他关系。

---

## 3. 点开一个节点

点开只读地检查这个 PA 带了什么：**不改 Context、不切 Session、不动 HEAD，也不改变勾选。** 节点盒本身只显示 PA 标签和关系徽标；问题正文与其他详情进入点开后的 Inspector，不使用会遮挡画布、且不随缩放的原生 `title` tooltip。

临时区的 `PA?` 不参加本节交互，也不能加入 Context。点击它只打开缺失字段或 validation error 详情，不触发全图变淡。

点开态按 PA 身份计算：

- 被点开的 PA 身份，其全部可见出现位置保持 100%；
- 该节点 Context 中每个 `paId` 的全部可见出现位置保持 100%；
- 只有实际被点击的那个出现位置换点开底色（浅 `#f4f5f9` / 暗 `#26262b`）；
- 其余节点的不透明度降到 24%（`opacity: 0.24`）；
- 所有黑色血缘线和紫色 merge 线保持原色和 100% 不透明度，让图的整体骨架仍可读；
- fork 身份箭头跟随它所代表的 PA 身份：该身份保持 100% 时使用正常色；否则不改 opacity，而换成 muted 色（浅 `#d6d6dc` / 暗 `#4a4a51`）；
- 不出现虚线、上下文序号或额外关系线。

因此，保持原色的集合是：

```
被检查的 PA 身份等价类
∪
Context 中 PA 身份的等价类
```

被检查节点用独有底色与 Context 成员区分。即使根 PA 的 Context 为空，被点击节点仍然保持 100%，不会变成 24%。

| 被点开的是 | 保持原色的内容 |
| --- | --- |
| **常规 PA** | 被点开身份的全部出现位置 + 它的 Context 身份 |
| **fork 副本或原 PA** | 同一身份的原出现位置和全部副本 + 相邻身份箭头链 + 同一份 Context 身份 |
| **merge 节点** | merge 节点身份 + 完整 Context 身份；全部结构线仍保持原色 |

图只表达 Context 的成员集合，不表达顺序和 `viaSessionId`；准确顺序与选择来源属于 Context Tray 和详情面板。

`HEAD`、点开预览、Context 选择三种状态彼此独立：点节点不改变选择，勾选不移动 HEAD。

---

## 4. 编号、行号与时间轴

| 对象 | 规则 |
| --- | --- |
| PA 编号 | 由持久化 `ledgerOrdinal` 产生，节点转为 `final` 后永久不变 |
| 图中行号 | 由谱系层级 `rowOrdinal` 决定；兄弟可同行，副本与来源同行 |
| fork 副本 | 沿用 PA 编号 + `FORK` 徽标 |
| `MERGE·n` | `n` = 去重后的来源端点数（在当前模型中即 branch 数和紫线数） |
| 项目时间轴 | 按完成时间排列已定稿的真实 PA；同刻以 `ledgerOrdinal` 破平局 |
| 时间轴格子 | 只排真实 PA 身份，副本不占格 |

编号是**身份标签**，时间轴位置是**时间位置**，两者不再共用同一种排序。

- 后来发现一个完成时间更早的 PA，可以把它插入项目时间轴的更早位置；
- 它不能让已有 PA 改编号，也不能让 Session/Workspace 图中的已定稿节点换行；只有后加 fork 紧邻插槽可以按 §2.2 重算行内显示槽和相关边；
- 一个 PA 已经在当前 Workspace 图作用域中有持久化编号时，项目图沿用它；从另一个作用域首次进入时，在当前作用域取得下一个可用编号。

---

## 5. 从 Context 选择写入 Fork 或 Merge

Context Tray 的按钮名称、待创建 Session 的关系计划和第一个新 PA 的父关系使用同一套算法，不再分别判断。点击按钮时冻结规范化后的 `pendingContextRefs`；它是 Session 的待提交配方，不是 PA 身份，也不是图节点。第一个新回合真正完成时，这份清单才成为新 PA 身份不可变的 `contextRefs`。

本文的当前模型中，一个 Session 对应图上的一条来源 branch；因此下面用 `viaSessionId` 分组，也就是按来源 branch 分组。如果未来允许一个 Session 内存在多条独立 branch，字段应升级为显式 `viaBranchId`，算法本身不变。

### 5.1 先规范化选择

1. 候选 PA 计入即将提交的选择；
2. UI 编辑状态始终保证同一个 `paId` 只有一个 `ContextRef`；
3. 用户改选该身份的另一个副本时，更新 `viaSessionId`，不重复添加；
4. Context 为空时不能创建 Fork 或 Merge；
5. 缺少直接前驱只发警告，不自动补入 Context；
6. 提交前，每个 `ContextRef` 的 `paId` 都必须在对应 `sessionHistoryPaIds[viaSessionId]` 中恰好出现一次，并经 `resolveOccurrence(ref)` 解析到一个 `final` 出现位置；任一引用缺失、来自空 Merge Session 或仍为 `provisional` 时，按钮禁用并显示对应验证错误；
7. 如果判定为 Fork，Tray 末位 `paId` 还必须能在这份历史中确定完整前缀的唯一截止点；
8. Host 对持久化或 RPC 载荷再次检查唯一性。发现重复 `paId` 时拒绝整个载荷，不采用“第一项优先”“最后一项优先”或静默去重。

以上校验必须先全部通过，再原子地创建新 Session、引用索引和待提交配方。失败时不创建新 Session、fork 副本、pending 关系记录或 `PA?`；`PA?` 只用于 §1.3 所述的外部不完整记录。

### 5.2 全部来自一个 Session → Fork

- 按 `viaSessionId` 去重后只有一个 Session；
- Tray 最后一项经 `resolveOccurrence(ref)` 得到 fork 来源出现位置；
- Tray 中更早的 PA 只属于 Context，不成为额外父节点；
- 新 Session 在这个末位 PA 身份上建立副本 F：`F.forkSourceId` 指向来源出现位置，`F.primaryParentId = null`，`F.parentIds = []`，并按 §2.2 追加到整个身份组右边界；
- F 共享来源 PA 身份原本的内容和 `contextRefs`，不会取得当前 Tray 的完整清单；
- 当前 Tray 被保存为 `pendingContextRefs`。之后第一个新 PA 完成时，它取得这份 Context，并以 F 为唯一父：`primaryParentId = F.id`，`parentIds = [F.id]`。

Fork 的**可见历史前缀**和**实际请求 Context**是两份不同数据。新 Session 的可见历史完整复制来源 Session 从开头到 fork 来源 PA 的前缀；用户在 Tray 删除或重排只改变 `pendingContextRefs`，不会从可见历史和 provenance 索引里删掉中间 PA。若重排使某个 Context 成员位于 fork 截止点之后，它仍作为 Context 引用写入新 Session 的索引，但不会被伪装成截止点之前的可见历史。

因此，同一 Session 选择多个 PA、删除中间项或重排顺序，仍然是 Fork，不会因为 Context 项数大于 1 变成多父 merge，也不会让未选中的历史中间项失去引用索引。

### 5.3 来自两个及以上 Session → Merge

- 按 `viaSessionId` 分组；
- 每个 Session 取 Tray 中最后出现的 PA，并经 `resolveOccurrence(ref)` 取得一个父端点；
- 第一个新 PA 完成时，`parentIds` = 所有 Session 的末位父端点；
- 它的 `primaryParentId` = Tray 全局最后一项所在 Session 的末位父端点；
- 每个父端点向这个新 PA 画一条紫线；
- 完整 Tray 先保存为 `pendingContextRefs`，再作为这个新 PA 身份的有序 `contextRefs` 写入。

Merge 创建新 Session 时不复制任何 PA，也不提前制造一个空的 merge 节点。第一个新 PA 完成之前，只有 Session 的 pending 配方和关系计划；它们不参加编号、行列、点开态或时间轴。

由于同一 `paId` 不能重复选择，“跨两个 Session 但去重后只剩一个 PA 身份”的伪 Merge 不会进入账本。

这里的 **Fork 操作**指“用一个 Session 的重组 Context 新建 Session”；图上的 **fork 关系**指新 Session 在断点产生的身份副本。两者名称相同，但前者是操作，后者是可视关系。

### 5.4 新 Session 的引用索引事务

Fork/Merge 创建新 Session 时，Host 在同一事务中按以下顺序写入：

1. 对每个 `pendingContextRefs` 条目执行 §5.1 的验证，并缓存唯一的 `resolveOccurrence(ref)` 结果；
2. 创建 `newSessionId`；
3. 如果是 Fork，从 `sessionHistoryPaIds[sourceSessionId]` 复制截至来源 `paId` 的完整前缀，并复制前缀内每个 `paId` 的既有 `sessionPaRefs` 映射；随后为全部 `pendingContextRefs` 补写第 1 步解析出的映射，以覆盖可能位于该前缀之外但仍被选为 Context 的 PA；
4. Fork 接着创建显式副本 F，并把来源身份在新 Session 中的映射覆盖为 `sessionPaRefs[newSessionId][source.paId] = F.id`；
5. 如果是 Merge，将 `sessionHistoryPaIds[newSessionId]` 初始化为空，不复制任何来源 Session 的可见历史；只为全部 `pendingContextRefs` 写入第 1 步解析出的既有端点；
6. 保存 `pendingContextRefs` 和由同一快照算出的 pending 父关系计划。

第一个新 PA 完成时，Host 在创建其真实出现位置的同一事务中追加 `newPaId` 到 `sessionHistoryPaIds[newSessionId]`，并写入 `sessionPaRefs[newSessionId][newPaId] = newOccurrenceId`。该 Session 后续每个新 PA 也执行同样的追加和自映射。任何一步失败都回滚整笔创建，不留下无法解析的 Session 或半个图关系。

---

## 6. 视觉规格

| 元素 | 浅色 | 暗色 |
| --- | --- | --- |
| 节点 | 132×42，圆角 8px，底 `#fff`，边 `#ececef`，左竖线 2px `#4d6bfe` | 底 `#202023`，边 `#2e2e32`，左竖线 2px `#7b96ff` |
| 节点文字 | JetBrains Mono 500 13/20，`#4d6bfe`，左 padding 11px，内部 gap 8px | `#9db0ff`，其余同 |
| `FORK` / `MERGE·n` 徽标 | JetBrains Mono 500 10/16，letter-spacing `.06em`，`#8f9099` | `#8b8b93` |
| 列间净空 / 行间净空 | 24px / 58px，均指盒子边缘到盒子边缘 | 同 |
| 列中心步长 / 行顶步长 | 156px / 100px | 同 |
| 普通走线层 | 父节点底部下方 29px | 同 |
| 血缘线 | 1px `#e2e2e7` | 1px `#333338` |
| merge 线 | 1px `#a374d1` | 1px `#b492e0` |
| fork 双向箭头 | 1.1px `#8f9099` | 1.1px `#8b8b93` |
| 非关联 fork 箭头 | 1.1px `#d6d6dc` | 1.1px `#4a4a51` |
| fork 箭头头 | 4px | 同 |
| 非关联节点 | 24% 不透明度（`opacity: 0.24`）；结构线不变淡 | 同 |
| 点开节点底色 | `#f4f5f9` | `#26262b` |
| 临时孤立节点 | 最终图下方单列，按 `provisionalOrdinal` 排序；标签 `PA?`，不占永久行列 | 同 |

`156px = 132px + 24px`，`100px = 42px + 58px`。29px 是相邻两行之间 58px 净空的中线，因此“父底 + 29px”和“子顶 − 29px”在相邻行是同一条走线层。

节点是可读文本块，不是 chip：重色只出现在 2px 左竖线上，盒子本身在静止状态下就要认得出标签。

颜色不承担 branch 身份或 merge 实例编号。淡紫色只表达“这是 merge 线”；来源通过各自的直连横段和共同目标竖干保持可追踪，多个 merge 通过目标节点区分。

---

## 7. 不变量

1. 一个 PA 身份写入后不被改写；重组历史是新建 Session，不是修改旧 PA。
2. `contextRefs` 属于 PA 身份；fork 副本共享原身份的内容、Context 和编号，不占时间轴格子。
3. 同一个 PA 身份在同一个 Session 中最多有一个显式出现位置；共享历史引用不强制创建副本盒子。
4. 每个 `paId + viaSessionId` 必须通过 Session 引用索引唯一确定到一个出现位置；只有 final PA 的 Context 和用户主动提交才进一步要求目标已经 `final`。
5. Context 只记录实际发出去的 PA、顺序和 `viaSessionId`，不做祖先补全，同一 `paId` 不重复；持久化载荷有重复项时整笔拒绝。
6. `relationsComplete = false` 的空父列表不是根；只有通过 §1.3 全部门槛的记录才进入根状态或四关系判定。
7. 临时记录以 `PA?` 孤立显示，不占永久编号和行列；补齐时使用稳定拓扑排序，循环或矛盾字段不会被强行定稿。
8. 已 final 的 PA 不改编号、关系或谱系行；fork 紧邻插槽只重算受影响行的显示槽及相关边，不得改变该行已有盒子的左右相对顺序。
9. fork 出现位置与来源同行、共享编号、没有血缘入线，并在身份组中按 `occurrenceOrdinal` 占用连续相邻列。
10. Fork/Merge 的按钮名称、pending Context、fork 来源、`primaryParentId`、`parentIds` 和紫线端点必须全部由 §5 的同一份已验证快照产生。
11. 新 Session、显式副本、Session 引用索引和 pending 关系计划原子写入；失败时不能留下半成品。
12. merge 每条来源 branch 只有一个父端点和一条紫线；所有入线包括主父入线都为紫色，merge 首次布局时从最右父槽右侧选择目标行最近空槽。
13. 线可以交叉但不能穿过节点盒子；只有同父黑线的最大公共前缀和同目标 merge 的竖干/母线表示共享连接。其他点交叉以断口表示，非零长度的意外共线重合按唯一 `overlapRank` 以平行 dogleg 分开。
14. 图中的编号和行列属于持久身份/布局；项目时间轴属于完成时间，两套顺序互不改写。
15. 被 final 记录引用的 Session 可以从 UI 归档，但其 tombstone、历史顺序和引用映射不能物理删除或复用。

---

## 8. 视觉定稿未覆盖的边界逻辑与已知文案例外

`Conversation Graph.html` 已经定稿四种基本关系、同框状态和点开态的几何与样式；不要求为了本文重画这些画面。下面是实现仍必须处理、但视觉样例没有展示的特例，以及一处明确的计数文案错误：

1. **同一身份有多个 fork 副本：** 使用相邻双向箭头链；新增副本按 §2.2 插入紧邻格并右移当前行的显示槽后缀。
2. **长距离线或阻挡：** 默认保持定稿中的直连；只有路径会穿节点时才启用局部避障，交叉和共线重合按 §2.1、§2.3 处理。
3. **临时孤立记录：** 父关系缺失时在图下方按 `provisionalOrdinal` 显示 `PA?`；补齐后按稳定拓扑顺序进入最终行列，循环记录保持错误态。
4. **空 Merge Session：** 点击 Merge 后、首个新 PA 完成前，图中不提前出现空节点；它也不能伪装成其他 Context 的来源 branch。
5. **计数文案已知例外：** `4f` 标题写成 `9 PA · 1 fork`，但画面只有 PA1–PA8 八个身份和一个副本；这是视觉文件的 copy typo，不是计数规则。实现应显示 `8 PA · 1 fork`。PA 数量只计算唯一身份，fork 副本另计出现位置。

---

## 9. 已决边界规则索引

| 原矛盾 | 最终决定 | 正文 |
| --- | --- | --- |
| 根节点无法归入四种关系 | 根是无入关系状态，不是第五种关系 | §0、§2 |
| 接续身份会被后来孩子改变 | 第一个孩子按永久账本顺序确定 | §2、§2.1 |
| 普通线跨行穿节点 | 固定在父底 + 29px 转弯 | §2.1 |
| fork 副本右边第一格已被占用 | 按行内 slot 插入身份组，右移当前行后缀并从新端点重算边 | §2.1、§2.2 |
| 五项字段推不出稳定顺序 | 增加持久化 `ledgerOrdinal` | §1、§4 |
| 副本规范化后丢失 Session 来源 | Context 使用 `paId + viaSessionId` | §1、§5 |
| 多父 Merge 与跨 Session Merge 冲突 | 每个 Session 只取 Tray 末位父端点 | §2.3、§5 |
| 多个 fork 副本时“两端”不唯一 | 全部出现位置组成相邻箭头等价类 | §2.2、§3 |
| 被点开节点是否变淡 | 被点击身份始终保持 100% | §3 |
| 时间排序改变已有编号 | 编号用账本序号，时间轴单独按完成时间 | §4 |
| PA 编号顺序不能表达视觉层级 | `ledgerOrdinal` 只管编号；`rowOrdinal` 按谱系深度，同层兄弟同行 | §1、§2.1、§4 |
| merge 继承主父槽不符合定稿 | merge 首次布局时从最右父槽右侧找目标行最近空槽；主父只保留语义作用 | §2.1、§2.3 |
| merge 长线穿过节点 | 默认直连目标中心竖干；只在实际阻挡时使用局部避障 | §2.3 |
| 线交叉或共线看起来像连接 | 点交叉用 4px 断口；意外共线段用平行 dogleg 分开 | §2.1、§2.3、§7 |
| 点开后是否淡化结构线 | 只淡化非关联节点；黑/紫线保持原色，非关联 fork 箭头换 muted 色 | §3、§6 |
| 缺失关系补齐后顺序不确定 | 持久化 `provisionalOrdinal`；稳定拓扑排序只冻结身份、关系、编号和行，x 可按 fork 插槽规则重排 | §1.3、§2.1 |
| 空父列表到底是根还是未知 | 用权威 `relationsComplete` 显式区分 | §1.3、§2 |
| fork 副本错误继承当前 Tray Context | Context 属于 PA 身份；当前 Tray 只写给首个新 PA | §1、§5 |
| 引用失败仍生成半个 Session | 先解析全部 ContextRef，再原子写入 Session、索引和关系计划 | §5.1、§5.4 |
| 批量导入依赖容器遍历顺序 | 先按来源序或不可变 id 规范化，再分配 provisional/occurrence 序号 | §1.3 |
| 空 Merge Session 伪装成来源 branch | 每个 ContextRef 必须实际属于对应 Session 历史；空 Session 不合格 | §1.2、§5.1 |
| 同一批重复 Context 是局部失败还是整批失败 | 最外层 mutation envelope 是唯一原子单位，任一重复即整批拒绝 | §1.2、§5.1 |
