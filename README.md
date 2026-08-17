# dsh-git

**English** · [中文](./README.zh-CN.md)

`dsh-git` lets you manage conversations with an agent the way you use Git.

Each completed Prompt + Answer turn is a commit. You can cherry-pick turns from any branch, arrange them in any order to form a new conversation history, and continue asking questions from there. The assembled turns are written as real, completed DSH history—not appended to the prompt as a context block. To the agent, the resulting history is indistinguishable from one it experienced firsthand.

`dsh-git` is a plugin for DeepSeek Harness Web.

## Operations

| Git | dsh-git |
| --- | --- |
| `commit` | Each completed Prompt + Answer turn is a `PA` node: atomic, addressable, and never rewritten in place. |
| `log --graph` | Each Session has a **Conversation Graph**, and each Workspace has a project graph. Both show forks, merge edges, and `HEAD`. |
| `HEAD` | The active node. Its state is independent of node preview and context selection. |
| `checkout` | Use **Switch to this branch** to open the DSH Session associated with a node. |
| `cherry-pick` | Select PA nodes from any branch and add them to the ordered **Context Tray**. |
| `rebase` | The Host renumbers the selected turns into one continuous history, following their order in the tray. |
| `branch` | Asking from the tray creates a new Host-side Session seeded with that history. |
| `merge` | The next Prompt and Answer become a multi-parent DAG node that records every source. |

## Key features

- **Per-Session conversation graph:** Each Session has a compact **Conversation Graph**. A fork created through the official Harness feature shares its inherited history prefix. The copied tip appears as a `PA<n> fork` branch marker, and subsequent PAs continue beneath it. A node's Prompt, Answer, and historical context appear only after you select that PA.
- **Workspace project graph:** Click the graph button beside a Workspace row to view every completed PA in that Workspace. Repeated fork history is collapsed into a `PA<n> fork` branch marker without consuming a new PA number. The project graph takes over the main column without changing the current Session.
- **PA timeline:** The project graph opens at the complete history. Drag the timeline to step backward through completed PAs; the first new PA produced by each Session is marked on the rail.
- **Ordered Context Tray:** New selections are arranged by creation time by default, and you can drag them into a custom order. That explicit order remains intact when you add more nodes.
- **Cross-branch selection:** Select PAs freely across branches. If a selected node is missing its direct predecessor, the plugin warns you but does not add the missing node automatically.
- **Host-side persistence:** Each Workspace folder has an independent graph ledger containing branch names, canonical node references, context manifests, preview state, and pending merge metadata. Sessions outside every folder each use an isolated ledger. Graph data follows the DSH profile and does not depend on the current browser.

## Install

`dsh-git` provides only the plugin; it does not include the `dsh` executable. If you use a source checkout of DeepSeek Harness, invoke the CLI from that checkout. The commands below assume it is in the sibling directory `../deepseek-harness`:

```bash
pnpm install
pnpm run build
pnpm --dir ../deepseek-harness dsh plugin --profile web add "$PWD"
pnpm --dir ../deepseek-harness dsh --profile web
```

If `dsh` is installed globally and `command -v dsh` prints its path, you can use the shorter `dsh plugin ...` and `dsh --profile web` commands instead. Do not run `pnpm dsh` inside this plugin repository: pnpm only searches for scripts and executables provided by the current project, and this project provides neither.

After opening the Web UI, enter a graph view in either of these ways:

- Once a Session has at least one completed turn, select the **Branches** tab.
- Hover over a Workspace row and click its graph button to open the complete project graph.

To uninstall the plugin:

```bash
pnpm --dir ../deepseek-harness dsh plugin --profile web remove dsh-git
```

Development dependencies currently link to a sibling `../deepseek-harness` source checkout because the public rc.1 dependency graph references an unpublished package. The built plugin does not contain that local path: its browser bundle is self-contained except for React, which DSH supplies through its client module table. The built `lib/` files ship with the package, so installing a release archive does not require a build step.

## Workflow

1. Complete one or more ordinary turns in DSH.
2. Open the **Branches** tab. The current primary line is solid, and the active node is marked `HEAD`.
3. Select any PA nodes. They enter the Context Tray in creation order.
4. Drag the chips to set the exact order sent to the model.
5. Enter the next question, then select **Create merge branch and ask**.
6. The plugin creates a new Session using the selected turns as its ordered history, opens it, and sends the question. When the answer completes, `HEAD` moves to the new node.

Clicking a node only previews its contents; it does not change the context or current Session. Use checkboxes to select context and **Switch to this branch** to check out a branch.

The project graph is read-only. Click a PA to open its detail inspector, or click **Open source Session** to close the project graph and navigate to the source Session. The bottom slider starts at the rightmost PA. Dragging it left hides every PA and edge that appeared after the selected completion point.

## Data model

DSH Session logs are append-only and ordered chronologically. `dsh-git` adds a Host-managed semantic graph on top:

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

`primaryParentId` determines the highlighted primary line, `parentIds` determines the graph edges, and `contextManifest` records the exact PA order selected when creating a new Session history.

## How graph data is stored

The Host maintains two kinds of records, separated by whether the data can change after it is written.

**The graph ledger** lives in a `dsh-storage-domain` domain named `dsh_git_graph`, with one record per scope: Sessions in a Workspace folder use `workspace:<id>`, while Sessions outside every folder use `session:<id>`. The ledger stores all mutable state, including nodes, branches and their names, Session turn references, pending merges, `HEAD`, preview state, and Context Tray order.

The browser holds the authoritative in-memory copy rendered by React. On mount, it reads the ledger once for the current scope; every subsequent state change writes the complete record back to the Host. Writes are serialized within each scope, so the persistent ledger cannot fall behind the state shown on screen. Changes made before the initial read completes are deferred rather than applied immediately, preventing an early-rendered view from creating duplicate nodes for turns the Host already knows.

**Merge provenance** is also written to the merged Session's own log as a `dsh-git/merge` event at the end of the seed. The event records the Host coordinates of every imported turn: `sessionId`, turn, boundary seq, and the turn number it occupies in the new Session. It does not depend on browser-side node ids, so a merge branch can be reconstructed from its log even if the graph ledger is lost.

The event must be marked `ignorable`. If a log contains an event type outside `KNOWN_SESSION_EVENT_TYPES` and the writer does not set that flag, `session-persistence` refuses to parse the entire log; plugins cannot extend that build-time set. Because `Session.append` does not accept the flag, the plugin constructs the event directly and places it in the seed—the only write path that supports it. This is also why the plugin cannot append graph metadata to an active Session and why mutable state lives in a storage domain instead of additional Session events.

## Host-side history composition

Through a private command, the browser sends only the selected source coordinates: `sessionId`, turn, and completed-turn boundary. The Host validates those coordinates, reads the corresponding canonical Session logs, renumbers the selected completed turns in Context Tray order, and creates a new agent from the resulting well-formed seed. Before the next question is sent normally, the new Session is added to the same Workspace as its source Session.

This process changes only the conversation history. Files remain shared across the Workspace and do not branch with the conversation.

## Project graph data loading

The Host registers a private trusted-host Connection RPC under `/dsh-git`. A project graph request carries only the Workspace id. The Host resolves every Session id registered to that Workspace, reads the complete canonical logs through `sessionQuery`, and returns normalized completed-PA records with start and completion times, fork-seed boundaries, and content fingerprints. Incomplete turns are never returned.

The browser merges that response into the existing semantic graph. Known dsh-git merge nodes retain their exact multi-parent relationships and context metadata. For an ordinary fork created through the official Harness feature, inherited turns reuse their proven parent lineage. Only the copied tip appears as a sibling `PA<n> fork` alias, and the first genuinely new PA continues beneath it. Older copied turns with unknown provenance remain separate rather than being connected by a guessed edge.

DeepSeek Harness does not currently expose project-row action or project-page slots. The project graph button and main-column takeover therefore live in a compatibility bridge built on semantic DOM attributes and a `MutationObserver`. If the Harness sidebar DOM changes, this adapter may need an update; the PA data protocol and graph page are independent of it.

## Development and testing

You can use VS Code, Cursor, WebStorm, or any IDE with TypeScript support. The project uses TypeScript in strict mode, React 18, Vitest, Testing Library, and tsdown.

```bash
pnpm run typecheck
pnpm run test
pnpm run build
pnpm pack
```

The test suite is organized as follows:

- `extract.spec.ts`: groups completed turns from raw Session logs by completion boundary.
- `repository.spec.ts`: covers linear imports, persistent tray order, child-Session merge commits, and deferring changes until the initial read completes.
- `workspace-repositories.spec.ts`: covers per-folder ledger isolation, scope ids that remain stable across browsers, and attaching new merge Sessions to their source folders.
- `graph-domain.spec.ts`: covers ledger schema round trips, scope-id validation, and ledger RPC decoders.
- `graph-medium.spec.ts`: writes, closes, and reopens the real JSON storage backend.
- `graph.spec.ts`: covers primary-line ancestry, sibling branches, merge edges, and missing-dependency warnings.
- `history.spec.ts`: covers private payload validation, the `PA1 + PA7 → Turn 1 + Turn 2 → PA9 Turn 3` regression, and the `ignorable` merge-provenance seed event.
- `components.spec.tsx`: covers separation between `HEAD`, preview, and selection, plus composer behavior when branch creation fails.
- `project-history.spec.ts`: covers completed-turn extraction, fork-seed metadata, and RPC payload validation.
- `project-graph.spec.ts`: covers fork deduplication, exact preservation of merge relationships, and timeline prefixes.
- `preview-cache.spec.ts`: covers reading each PA once, local assembly of the selected order, and cache eviction.
- `live-turn.spec.ts`: covers the Chat History live tail projected from the running turn (partial answer, running tool calls, open turns only).
- `project-page.spec.tsx` / `project-bridge.spec.tsx`: cover timeline scrubbing, detail inspection, retry, source navigation, DOM reinjection, and cleanup.

To run a smoke test without modifying the user's real DSH profile:

```bash
export DSH_HOME=/tmp/dsh-git-validation-home
cd ../deepseek-harness
pnpm dsh plugin --profile web add ../dsh-git
pnpm dsh --profile web --dump-config
pnpm dsh --profile web
```

The configuration output must end with a `# == dsh-git` layer. The browser must contain `style[data-plugin="dsh-git"]`, and the console must report no errors.

## Known limitations

- Graph data is persisted with the DSH profile. Ledgers saved by the previous `localStorage` version are not migrated. When an affected Session is viewed, its graph is re-imported from the Session log, but branch names and old merge parents stored only in the browser are lost.
- The ledger does not push changes across tabs. Two tabs open on the same scope each hold an in-memory copy, and the last write wins; `domain/changed` broadcasts only within the Host process.
- Project graph PA data is reloaded from the Host on every request. Merge Sessions created by the current version store provenance in their logs; older merge Sessions still depend on the ledger for exact multi-parent metadata. If the ledger is missing, the project graph shows only the provable primary lineage rather than guessing missing merge parents.
- Turns created before the plugin was installed are imported when their Sessions are viewed. DSH forks not created by dsh-git cannot be deduplicated into a shared PA identity.
- Only selected completed turns are written into the merge Session seed. Unselected ancestor turns are not inherited implicitly.
- Core trajectory events are copied, while source-plugin-specific log-only events are excluded from the merge seed.
