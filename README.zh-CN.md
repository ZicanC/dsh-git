# dsh-git

[English](./README.md) · **中文**

`dsh-git` 让你像使用 Git 一样管理与 agent 的对话。

每个完整的“提问 + 回答”回合都相当于一次提交。你可以从任意分支 cherry-pick 多个回合，按指定顺序将它们重组为一段新的对话历史，再从这里继续提问。重组后的回合会作为真实、完整的 DSH 历史记录写入，而不是以一段上下文的形式附加到提示词中。因此，对 agent 而言，重组的历史与它亲历的对话没有区别。

`dsh-git` 是一款适用于 DeepSeek Harness Web 的插件。

## 操作对照

| Git | dsh-git |
| --- | --- |
| `commit` | 每个完成的“提问 + 回答”回合都是一个 `PA` 节点：原子化、可寻址，且不会被原地改写。 |
| `log --graph` | 每个会话都有一张 **Conversation Graph**，每个 Workspace 都有一张项目图；两者均显示分叉、merge 边和 `HEAD`。 |
| `HEAD` | 当前活动节点；其状态与节点预览、上下文选择相互独立。 |
| `checkout` | 使用 **切换到此分支**，打开该节点对应的 DSH 会话。 |
| `cherry-pick` | 从任意分支勾选 PA 节点，并将其加入有序的 **Context Tray**。 |
| `rebase` | 宿主端按照托盘中的顺序，将所选回合重新编号为一段连续的新历史。 |
| `branch` | 从托盘发起提问时，宿主端会以这段历史为种子创建新会话。 |
| `merge` | 新一轮的 Prompt 与 Answer 会成为一个记录全部来源的多父 DAG 节点。 |

## 主要功能

- **会话级对话图：** 每个会话都有一张紧凑的 **Conversation Graph**。通过 Harness 官方功能创建的 fork 会共享继承的历史前缀；复制出的末端回合显示为 `PA<n> fork` 分支标记，后续 PA 则从该标记继续延伸。只有点击 PA 节点后，才会显示其 Prompt、Answer 和历史上下文。
- **Workspace 项目图：** 点击 Workspace 行旁的图按钮，即可查看该 Workspace 中所有已完成的 PA。重复的 fork 历史会折叠为 `PA<n> fork` 分支标记，且不占用新的 PA 编号。项目图会接管主栏，但不会切换当前会话。
- **PA 时间轴：** 项目图打开时默认显示完整历史。拖动时间轴可逐个回退已完成的 PA；每个会话产生的第一个新 PA 都会在轨道上标出。
- **有序的 Context Tray：** 新选中的节点默认按创建时间排列，也可以拖拽调整顺序。继续添加节点时，手动设定的顺序会保持不变。
- **跨分支选择：** 可以自由选择不同分支上的 PA。若所选节点缺少直接前驱，系统会发出警告，但不会自动把缺失节点加入请求。
- **宿主端持久化：** 每个 Workspace 文件夹都有独立的图账本，用于保存分支名称、规范节点引用、上下文清单、预览状态和待处理的 merge 元数据。不属于任何文件夹的会话各自使用独立账本。图数据随 DSH 配置保存，不依赖当前浏览器。

## 安装

`dsh-git` 只提供插件，不包含 `dsh` 可执行文件。如果使用 DeepSeek Harness 的源码检出，请从该检出目录调用 CLI。以下命令假设 DeepSeek Harness 位于同级目录 `../deepseek-harness`：

```bash
pnpm install
pnpm run build
pnpm --dir ../deepseek-harness dsh plugin --profile web add "$PWD"
pnpm --dir ../deepseek-harness dsh --profile web
```

如果已全局安装 `dsh`，且 `command -v dsh` 能输出其路径，也可以改用较短的 `dsh plugin ...` 和 `dsh --profile web` 命令。请勿在本插件仓库中运行 `pnpm dsh`：pnpm 只会查找当前项目提供的脚本和可执行文件，而本项目并未提供这两者。

打开 Web UI 后，可以通过以下任一方式进入图视图：

- 在会话至少完成一个回合后，选择 **分支** 标签页。
- 将鼠标悬停在 Workspace 行上，点击图按钮，打开完整的项目图。

卸载插件：

```bash
pnpm --dir ../deepseek-harness dsh plugin --profile web remove dsh-git
```

目前，开发依赖链接到同级的 `../deepseek-harness` 源码检出，因为公开的 rc.1 依赖图引用了一个尚未发布的包。构建后的插件不包含该本地路径：除了由 DSH 通过客户端模块表提供的 React 之外，浏览器 bundle 完全自包含。构建产物 `lib/` 会随包一同发布，因此安装发布版压缩包时无需执行构建脚本。

## 使用流程

1. 在 DSH 中完成一个或多个普通回合。
2. 打开 **分支** 标签页。当前主线显示为实线，活动节点标记为 `HEAD`。
3. 勾选任意 PA 节点。节点会按创建时间进入 Context Tray。
4. 拖动标签（chip），设置发送给模型的确切顺序。
5. 输入下一个问题，然后选择 **创建 merge branch 并提问**。
6. 插件以所选回合为有序历史创建新会话，打开该会话并发送问题；回答完成后，`HEAD` 会移动到新节点。

点击节点只会预览其内容，不会改变上下文或当前会话。使用勾选框选择上下文，使用 **切换到此分支** 检出相应分支。

项目图为只读视图。点击 PA 可打开详情检查器；点击 **打开原会话**，可关闭项目图并跳转到来源会话。底部滑块默认停在最右侧的 PA；向左拖动时，所有在该完成时点之后才出现的 PA 和边都会隐藏。

## 数据模型

DSH 会话日志按时间顺序追加，已有记录不会被改写。`dsh-git` 在此基础上增加一张由宿主端管理的语义图：

```ts
interface TurnNode {
  id: string
  sessionId: string
  turn: number
  primaryParentId: string | null
  parentIds: readonly string[]
  contextManifest: readonly string[]
  prompt: string
  answer: string
  branchId: string
}
```

`primaryParentId` 决定高亮显示的主线，`parentIds` 决定图中的边，`contextManifest` 则记录创建新会话历史时所选 PA 的确切顺序。

## 图数据的存储方式

宿主端维护两类记录，并根据数据写入后是否还会变化来划分用途。

**图账本**存放在名为 `dsh_git_graph` 的 `dsh-storage-domain` 域中，每个作用域对应一条记录：Workspace 文件夹中的会话使用 `workspace:<id>`，不属于任何文件夹的会话使用 `session:<id>`。账本保存全部可变状态，包括节点、分支及其名称、会话回合引用、待处理的 merge、`HEAD`、预览状态和 Context Tray 顺序。

浏览器持有供 React 渲染的权威内存副本。组件挂载时会按作用域读取一次账本，此后每次状态变更都会将完整记录写回宿主端。写入操作在每个作用域内串行执行，因此持久化账本不会落后于屏幕中的状态。首次读取完成前产生的变更会暂存，而不会立即应用，以免提前渲染的视图为宿主端已知的回合重复创建节点。

**Merge 溯源信息**还会写入 merge 会话自身的日志，即种子末尾的一条 `dsh-git/merge` 事件。该事件记录每个导入回合的宿主端坐标，包括 `sessionId`、turn、边界 seq，以及该回合在新会话中的回合号；它不依赖浏览器端的节点 id。因此，即使图账本丢失，也能仅凭日志重建 merge 分支。

该事件必须标记为 `ignorable`。如果日志中出现 `KNOWN_SESSION_EVENT_TYPES` 以外的事件类型，而写入方没有设置该标记，`session-persistence` 会拒绝解析整份日志；插件也无法扩展这个编译期集合。由于 `Session.append` 不支持传入该标记，插件会直接构造事件并将其放入种子——这是唯一支持该标记的写入路径。这也解释了插件为何不能向活动会话追加图元数据，以及可变账本为何使用存储域，而不是更多的会话事件。

## 宿主端历史合成

浏览器通过一条私有命令，仅发送所选来源的坐标：`sessionId`、turn 和已完成回合的边界。宿主端会校验这些坐标，读取对应的规范会话日志，按照 Context Tray 中的顺序重新编号所选的已完成回合，再以这份结构完整的种子创建新 agent。在正常发送下一个问题之前，新会话会先加入来源会话所在的 Workspace。

这一过程只会改变对话历史。文件仍由整个工作区共享，不会随对话分支一同分叉。

## 项目图的数据读取

宿主端会在 `/dsh-git` 下注册一个私有的 trusted-host Connection RPC。项目图请求只携带 Workspace id。宿主端解析该 Workspace 登记的全部会话 id，通过 `sessionQuery` 读取其完整的规范日志，再返回标准化的已完成 PA 记录，其中包含开始与完成时间、fork 种子边界和内容指纹。尚未完成的回合不会返回。

浏览器会将响应与现有语义图合并。已知的 dsh-git merge 节点会保留精确的多父关系和上下文元数据。对于通过官方功能创建的普通 fork，继承的回合会沿用已经证实的父系谱；只有被复制的末端 PA 会显示为并列的 `PA<n> fork` 别名，第一个真正新增的 PA 则从该别名继续延伸。来源不明的旧复制回合会保持独立，系统不会猜测可能错误的边。

DeepSeek Harness 目前没有开放项目行操作或项目页插槽，因此，项目图按钮与主栏接管逻辑集中在一个兼容桥中，通过语义化 DOM 属性和 `MutationObserver` 实现。如果 Harness 的侧边栏 DOM 发生变化，可能需要更新这一适配器；PA 数据协议和图页面不受其影响。

## 开发与测试

可以使用 VS Code、Cursor、WebStorm 或任何支持 TypeScript 的 IDE。项目采用 TypeScript 严格模式、React 18、Vitest、Testing Library 和 tsdown。

```bash
pnpm run typecheck
pnpm run test
pnpm run build
pnpm pack
```

测试分层如下：

- `extract.spec.ts`：从原始会话日志中按已完成回合的边界进行分组。
- `repository.spec.ts`：线性导入、托盘顺序持久化、子会话 merge 提交，以及首次读取完成前的变更暂存机制。
- `workspace-repositories.spec.ts`：按文件夹隔离账本、跨浏览器保持稳定的作用域 id，以及将新的 merge 会话固定到来源文件夹。
- `graph-domain.spec.ts`：账本 schema 往返转换、作用域 id 校验和账本 RPC 解码器。
- `graph-medium.spec.ts`：使用真实 JSON 存储后端执行写入、关闭和重新打开测试。
- `graph.spec.ts`：主线谱系、同级分支、merge 边和缺失依赖警告。
- `history.spec.ts`：私有载荷校验、`PA1 + PA7 → Turn 1 + Turn 2 → PA9 Turn 3` 回归，以及标记为 `ignorable` 的 merge 溯源种子事件。
- `components.spec.tsx`：`HEAD`、预览与选择三种状态的相互独立，以及分支创建失败时输入框的行为。
- `project-history.spec.ts`：已完成回合提取、fork 种子元数据和 RPC 载荷校验。
- `project-graph.spec.ts`：fork 去重、精确保留 merge 关系和时间轴前缀。
- `preview-cache.spec.ts`：每个 PA 只读取一次、在本地按所选顺序组装，以及缓存淘汰。
- `live-turn.spec.ts`：由进行中回合投影出的 Chat History 实时片段（流式回答、运行中的工具调用，且只投影未结束的回合）。
- `project-page.spec.tsx` / `project-bridge.spec.tsx`：时间轴回放、详情检查、重试、来源导航、DOM 重新注入和清理。

如需在不修改用户真实 DSH 配置的情况下进行冒烟测试：

```bash
export DSH_HOME=/tmp/dsh-git-validation-home
cd ../deepseek-harness
pnpm dsh plugin --profile web add ../dsh-git
pnpm dsh --profile web --dump-config
pnpm dsh --profile web
```

配置输出必须以 `# == dsh-git` 层结尾；浏览器中必须存在 `style[data-plugin="dsh-git"]`，且控制台没有报错。

## 已知限制

- 图数据随 DSH 配置持久化。旧版通过 `localStorage` 保存的账本不会迁移：查看相应会话时，系统会根据会话日志重新导入图数据，但仅保存在浏览器中的分支名称和旧 merge 父节点会丢失。
- 账本不支持跨标签页推送变更。同一作用域下打开的两个标签页各自持有一份内存副本，并以最后一次写入为准；`domain/changed` 只在宿主端进程内广播。
- 项目图的 PA 数据每次都会从宿主端重新读取。当前版本创建的 merge 会话会将溯源信息写入日志；更早版本创建的 merge 会话仍依赖账本保存精确的多父元数据。账本缺失时，项目图只显示能够证实的主线谱系，不会推测缺失的 merge 父节点。
- 安装插件前创建的回合会在相应会话被查看时导入。并非由 dsh-git 创建的 DSH fork 无法去重为共享的 PA 身份。
- 只有选中的已完成回合会写入 merge 会话的种子；未选中的祖先回合不会被隐式继承。
- 核心轨迹事件会被复制；来源插件特有、仅用于日志的事件则会从 merge 种子中排除。
