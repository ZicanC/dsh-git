# dsh-git

[English](./README.md) · **中文**

`dsh-git` 是一个可安装的 DeepSeek Harness Web 插件，把线性的聊天历史变成 Git 风格的对话图。一个完成"提问 + 回答"的回合就是一个 `PA` 节点；普通续聊产生单父节点，而从平行分支中挑选若干回合再提出新问题，会在新分支上产生一个多父的 merge 节点。

界面语言跟随 DSH 设置中选择的中文或英文。

## 提供的功能

- 每个会话一张紧凑的 **Conversation Graph** 树，带分叉、merge 边和可见的 `HEAD`；官方的 Harness fork 共享其继承前缀，把被复制的末端回合渲染为 `PA<n> fork` 标记，新的 PA 在该标记下继续。Prompt、Answer 与历史上下文在点击 PA 节点后才显示。
- 项目级 **Conversation Graph**，从每个 Workspace 行旁边的图按钮打开。它读取该 Workspace 中所有已完成的 PA，把被复制的 fork 历史折叠成一个不占用新 PA 编号的 `PA<n> fork` 分支点别名，并接管主栏而不改变当前选中的会话。
- Fusion 风格的 PA 时间轴。打开时显示完整图，可一次向左回退一个已完成 PA；每个会话的第一个新 PA 会在轨道上做标记。
- `HEAD`、预览与上下文选择三者状态独立：点击节点只预览；其勾选框决定下一个模型上下文；"切换到此分支"检出其对应的 DSH 会话。
- 有序的 **Context Tray**。新选中默认按创建时间排序；拖拽产生显式顺序，追加更多节点后顺序仍然保留。
- 可跨分支自由选择。缺少直接前驱节点时给出警告，但不会被强行加入请求。
- 自动建分支。从托盘提问会在宿主侧创建一个新会话，其种子把每个选中的 PA 作为真实的已完成 DSH 回合写入；新问题成为下一回合，其 Prompt + Answer 成为多父 DAG 节点。
- 图数据按 Workspace 文件夹在独立的 `localStorage` 账本中持久化，包括分支名、规范节点引用、上下文清单、预览与待合并元数据。不属于任何文件夹的会话拥有各自隔离的账本。

## 安装

`dsh-git` 是一个插件，不提供 `dsh` 可执行文件。使用 DeepSeek Harness 源码检出时，请从该检出目录运行 CLI（以下命令假设其位于同级目录 `../deepseek-harness`）：

```bash
pnpm install
pnpm run build
pnpm --dir ../deepseek-harness dsh plugin --profile web add "$PWD"
pnpm --dir ../deepseek-harness dsh --profile web
```

如果 `dsh` 已全局安装且 `command -v dsh` 能打印其路径，也可以使用更简短的 `dsh plugin ...` 与 `dsh --profile web` 形式。在本插件仓库内运行 `pnpm dsh` 无效：pnpm 只会查找当前项目提供的脚本和可执行文件，而本项目刻意两者皆无。

打开 Web UI：会话至少有一步已完成回合后，选择 **分支** 标签页；或将鼠标悬停在 Workspace 行上点击其图按钮，打开完整的项目图。

卸载：

```bash
pnpm --dir ../deepseek-harness dsh plugin --profile web remove dsh-git
```

开发依赖目前链接到同级 `../deepseek-harness` 检出，因为公开的 rc.1 依赖图引用了一个未发布的包。构建出的插件不包含该路径：其浏览器 bundle 除了 React（由 DSH 通过客户端模块表提供）外完全自包含。构建产物 `lib/` 是刻意随包发布的，因此安装发布压缩包时不会执行任何构建脚本。

## 使用流程

1. 完成一个或多个普通 DSH 回合。
2. 打开 **分支**。当前主线为实线，活动节点标记为 `HEAD`。
3. 勾选任意 PA 节点，它们按创建顺序进入 Context Tray。
4. 拖动标签（chip）设置发送给模型的确切顺序。
5. 输入下一个问题，选择 **创建 merge branch 并提问**。
6. 插件以选中回合为有序历史构建新会话，打开它、发送新问题，并在回答完成时移动 `HEAD`。

点击节点不会改变上下文或当前会话。用勾选框选择上下文，用 **切换到此分支** 检出分支。

项目图只读。点击 PA 打开详情检查器，或用 **打开原会话** 关闭项目页并跳转到来源会话。底部滑块默认位于最右端的 PA；向左拖动会隐藏该完成时点之前尚未出现的所有 PA 与边。

## 数据模型

DSH 会话日志按时间顺序只增不改。`dsh-git` 在其上增加一份由浏览器持有的语义图：

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

`primaryParentId` 决定高亮的主线；`parentIds` 决定图的边；`contextManifest` 记录构建新会话历史时选中的确切 PA 顺序。

## 宿主侧历史合成

浏览器仅通过一条私有命令发送选中的来源坐标（`sessionId`、turn 与已完成回合边界）。宿主校验这些坐标，读取各规范会话日志，按 Context Tray 顺序为选中的已完成回合重新编号，并以这份平衡的种子创建新 Agent。在正常发送下一个问题之前，新会话会被挂到来源会话所在的 Workspace。

例如，选中 PA1 与 PA7 会生成一个新会话，其中 **Turn 1 = PA1**、**Turn 2 = PA7**；提出下一个问题后产生 **Turn 3 = PA9**。因此 DSH 内置的轨迹显示的是三个真实回合，而不是嵌在 PA9 用户消息里的一段 XML 上下文块。核心执行事件——包括用户/上下文消息、助手输出、模型请求头与工具调用/结果——都保留在每个导入回合内。其他插件自有、仅用于日志的事件不会被复制。

这只会改变对话历史。文件仍是工作区全局的，不会被分支化。

## 项目图读取路径

宿主侧在 `/dsh-git` 下注册一条私有的 trusted-host Connection RPC。项目页请求只携带 Workspace id。宿主解析该 Workspace 登记的所有会话 id，通过 `sessionQuery` 读取其完整规范日志，返回规范化后的已完成 PA 记录，附开始/完成时间、fork 种子边界与内容指纹。未完成的回合绝不返回。

浏览器把该响应与已有的语义图合并。已知的 dsh-git merge 节点保留其精确的多父与上下文元数据。对于普通的官方 fork，继承的回合沿用已证实的父系谱，只有被复制的末端 PA 渲染为并列的 `PA<n> fork` 别名；第一个真正的新 PA 在其下继续。来源不明的旧复制回合保持独立，而不是猜测一条可能错误的边。

DeepSeek Harness 目前没有开放项目行操作或项目页插槽，因此项目按钮与主栏接管放在一个兼容桥里，依赖语义化 DOM 属性与 `MutationObserver`。未来 Harness 侧边栏 DOM 若变化，可能需要更新这个适配器；PA 数据协议与图页面与之相互独立。

## 开发与测试

VS Code、Cursor、WebStorm 或任何支持 TypeScript 的 IDE 均可。项目使用严格模式的 TypeScript、React 18、Vitest、Testing Library 与 tsdown。

```bash
pnpm run typecheck
pnpm run test
pnpm run build
pnpm pack
```

测试分层如下：

- `repository.spec.ts`：线性导入、托盘顺序持久化、子会话 merge 提交。
- `graph.spec.ts`：主线谱系、兄弟分支、merge 边、缺失依赖警告。
- `history.spec.ts`：私有载荷校验，以及 PA1 + PA7 → Turn 1 + Turn 2 → PA9 Turn 3 回归。
- `components.spec.tsx`：HEAD/预览/选择三态分离与失败分支的输入框行为。
- `project-history.spec.ts`：已完成回合提取、fork 种子元数据与 RPC 载荷校验。
- `project-graph.spec.ts`：fork 去重、merge 精确保留与时间轴前缀。
- `project-page.spec.tsx` / `project-bridge.spec.tsx`：时间轴回放、检查、重试、来源导航、DOM 重新注入与清理。

不触碰用户配置的真实 DSH 冒烟测试：

```bash
export DSH_HOME=/tmp/dsh-git-validation-home
cd ../deepseek-harness
pnpm dsh plugin --profile web add ../dsh-git
pnpm dsh --profile web --dump-config
pnpm dsh --profile web
```

配置 dump 必须以 `# == dsh-git` 层结尾，浏览器中必须存在 `style[data-plugin="dsh-git"]` 且控制台无报错。

## 当前边界

- 图持久化只在浏览器本地。在另一个浏览器打开同一 DSH 配置不会迁移图元数据。
- 项目图 PA 数据每次从宿主重新读取。旧 dsh-git merge 会话的精确多父元数据仍依赖创建它们的浏览器图；没有它时，页面只展示可证实的主线谱系，不会凭空捏造缺失的 merge 父节点。
- 插件安装之前创建的回合会在其会话被查看时导入；非 dsh-git 创建的无关 DSH fork 无法去重为共享的 PA 身份。
- 只有选中的已完成回合会被种入 merge 会话；未选中的祖先不会被隐式继承。
- 核心轨迹事件会被复制，而源插件特有的仅日志事件则被刻意排除在 merge 种子之外。
- 文件系统状态不参与分支。后续版本可以把每个图分支与 Git worktree 或快照提供者配对。
