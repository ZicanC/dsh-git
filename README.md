# dsh-git

**English** · [中文](./README.zh-CN.md)

`dsh-git` lets you use an agent the way you use Git.

A completed Prompt + Answer turn is one commit. You can cherry-pick any turns from any branches, replay them in an order you choose as a new history, and keep asking from there. The replayed turns are written as real completed DSH turns — not as a context block pasted into a prompt — so to the agent, a history you assembled is indistinguishable from one it lived through.

The conversation graph is not the point of this plugin. It is the viewfinder for those operations.

`dsh-git` is an installable DeepSeek Harness Web plugin. Its UI follows the Chinese or English language selected in DSH settings.

## Operations

| Git | dsh-git |
| --- | --- |
| `commit` | One completed Prompt + Answer turn is one `PA` node: atomic, addressable, never rewritten in place. |
| `log --graph` | A per-Session **Conversation Graph** and a per-Workspace project graph, both with forks, merge edges, and a visible `HEAD`. |
| `HEAD` | The active node, kept independent from preview and from context selection. |
| `checkout` | **Switch to this branch** checks out that node's DSH Session. |
| `cherry-pick` | Tick any PA nodes, across any branches, into the ordered **Context Tray**. |
| `rebase` | The Host renumbers the picked turns into one continuous new history, in tray order. |
| `branch` | Asking from the tray creates a new Host-side Session seeded with that history. |
| `merge` | The new question's Prompt + Answer becomes a multi-parent DAG node recording every source. |

Git verbs that do **not** exist yet — `diff`, `revert`, `blame`, `worktree`, `clone`/`push`/`pull` — are covered under [Roadmap](#roadmap).

## Why the replay is real

Selecting PA1 and PA7 produces a new Session with **Turn 1 = PA1** and **Turn 2 = PA7**. Asking the next question produces **Turn 3 = PA9**. DSH's built-in trajectory therefore shows three real turns, instead of an XML context block embedded in PA9's user message.

Core execution events — user/context messages, assistant output, model request headers, and tool calls and results — are retained inside each imported turn. Unrelated plugin-owned log-only events are not copied.

This is the line between a real rebase and prompt concatenation, and it is what makes every other operation on this page worth trusting.

## What it provides

- A compact per-Session **Conversation Graph** tree. An official Harness fork shares its inherited prefix, renders the copied tip as `PA<n> fork`, and continues new PAs beneath that marker. Prompt, Answer, and historical context appear only after clicking a PA node.
- A project-level **Conversation Graph** opened from the graph button beside each Workspace row. It reads every completed PA in that Workspace, collapses copied fork history into one `PA<n> fork` branch-point alias that does not consume a new PA number, and takes over the main column without changing the selected Session.
- A Fusion-style PA timeline. It opens at the complete graph and scrubs left one completed PA at a time; each Session's first new PA is marked on the rail.
- An ordered **Context Tray**. New selections default to creation-time order; drag-and-drop creates an explicit order that is retained when more nodes are appended.
- Free selection across branches. Missing direct predecessors produce a warning but are not forced into the request.
- Host-side persistence in a separate ledger for each Workspace folder, including branch names, canonical node references, context manifests, preview, and pending merge metadata. Sessions outside every folder receive their own isolated ledger. The graph follows the DSH profile, not the browser.

## Install

`dsh-git` is a plugin and does not provide the `dsh` executable. When using a
source checkout of DeepSeek Harness, run the CLI from that checkout (the
commands below assume it is the sibling directory `../deepseek-harness`):

```bash
pnpm install
pnpm run build
pnpm --dir ../deepseek-harness dsh plugin --profile web add "$PWD"
pnpm --dir ../deepseek-harness dsh --profile web
```

If `dsh` has been installed globally and `command -v dsh` prints its path, the
shorter `dsh plugin ...` and `dsh --profile web` forms work as well. Running
`pnpm dsh` inside this plugin repository does not: pnpm only looks for scripts
and executables supplied by the current project, and this project intentionally
has neither.

Open the Web UI and either select the **Branches** tab after a session has at least one completed turn, or hover a Workspace row and click its graph button to open the complete project graph.

To uninstall:

```bash
pnpm --dir ../deepseek-harness dsh plugin --profile web remove dsh-git
```

The development dependencies currently link to a sibling `../deepseek-harness` checkout because the public rc.1 dependency graph references an unpublished package. The built plugin does not contain that path: its browser bundle is self-contained except for React, which DSH supplies through its client module table. Built `lib/` files are intentionally shipped, so installing a release archive does not execute a build script.

## Workflow

1. Complete one or more ordinary DSH turns.
2. Open **Branches**. The current primary line is solid and the active node is marked `HEAD`.
3. Check any PA nodes. They enter the Context Tray in creation order.
4. Drag chips to set the exact order sent to the model.
5. Type the next question and choose **Create merge branch and ask**.
6. The plugin builds a new session with the selected turns as ordered history, opens it, sends the new question, and moves `HEAD` when the answer completes.

Node clicks do not change the context or current session. Use the checkbox for context and **Switch to this branch** for checkout.

The project graph is read-only. Click a PA to open its detail inspector, or use **Open source Session** to close the project page and navigate to the source Session. The bottom slider defaults to the rightmost PA; moving it left hides every PA and edge that had not appeared by that completion step.

## Data model

The chronological DSH session log stays append-only. `dsh-git` adds a Host-owned semantic graph:

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

`primaryParentId` controls the highlighted line. `parentIds` controls graph edges. `contextManifest` records the exact selected PA order used to construct the new session history.

## Where the graph is stored

Two Host-side records, chosen by whether the data can change after it is written.

**The ledger** lives in a `dsh-storage-domain` domain named `dsh_git_graph`, one record per scope — `workspace:<id>` for a folder member, `session:<id>` for a Session in no folder. It holds the whole mutable state: nodes, branches and their names, session turn refs, pending merges, `HEAD`, preview, and the Context Tray order. The browser keeps the authoritative in-memory copy React renders from, reads it once per scope on mount, and pushes the complete record back after every mutation; writes are serialized per scope so the durable ledger cannot fall behind the one on screen. Mutations raised before the first read lands are deferred, not applied, so a view that renders early cannot mint duplicate nodes for turns the Host already knows.

**Merge provenance** is additionally written into the merged Session's own log, as one `dsh-git/merge` event at the tail of the seed. It records the Host coordinates each imported turn came from (`sessionId`, turn, boundary seq, and the turn number it occupies), never browser node ids, so a merge branch stays reconstructible from the log alone if the ledger is lost. It is marked `ignorable`: `session-persistence` refuses to interpret any log holding an event type outside `KNOWN_SESSION_EVENT_TYPES` unless the writer set that flag, and a plugin cannot extend that build-time set. That flag cannot be passed through `Session.append`, so the event is constructed directly and placed in the seed — the only write path that accepts it. This is also why a plugin cannot append graph metadata to a live Session, and why the mutable ledger is a storage domain rather than more session events.

## Host-side history composition

The browser sends only the selected source coordinates (`sessionId`, turn, and completed-turn boundary) through a private command. The Host validates those coordinates, reads each canonical session log, renumbers the selected completed turns in Context Tray order, and creates a new Agent from that balanced seed. The new session is attached to the source session's Workspace before the next question is sent normally.

This changes conversation history only. Files remain workspace-global and are not branched.

## Project graph read path

The Host half registers a private trusted-host Connection RPC under `/dsh-git`. A project-page request carries only the Workspace id. The Host resolves that Workspace's accounted Session ids, reads their complete canonical logs through `sessionQuery`, and returns normalized completed PA records with start/completion times, fork-seed boundaries, and content fingerprints. Open turns are never returned.

The browser combines that response with its existing semantic graph. Known dsh-git merge nodes retain their exact multi-parent and Context metadata. For an ordinary official fork, inherited turns reuse the proven parent lineage and only the terminal copied PA is rendered as a sibling `PA<n> fork` alias; the first genuinely new PA continues beneath it. Ambiguous old copied turns remain distinct instead of guessing an incorrect edge.

DeepSeek Harness does not currently expose project-row action or project-page slots. The project button and main-column takeover therefore live in one compatibility bridge that uses semantic DOM attributes and a `MutationObserver`. A future Harness sidebar DOM change may require updating that adapter; the PA data protocol and graph page are independent of it.

## Development and tests

VS Code, Cursor, WebStorm, or any TypeScript-capable IDE works. The project uses strict TypeScript, React 18, Vitest, Testing Library, and tsdown.

```bash
pnpm run typecheck
pnpm run test
pnpm run build
pnpm pack
```

The test layers are:

- `extract.spec.ts`: completed-turn boundary grouping from a raw session log.
- `repository.spec.ts`: linear import, persistent tray order, child-session merge commit, and the hydration gate.
- `workspace-repositories.spec.ts`: per-folder ledger isolation, scope ids that stay stable across browsers, and pinning a new merge Session to its source folder.
- `graph-domain.spec.ts`: ledger schema round-trip, scope-id validation, and the ledger RPC decoders.
- `graph-medium.spec.ts`: write, close, and reopen against the real JSON storage backend.
- `graph.spec.ts`: primary-line ancestry, sibling lanes, merge edges, missing-dependency warnings.
- `history.spec.ts`: private payload validation, the PA1 + PA7 → Turn 1 + Turn 2 → PA9 Turn 3 regression, and the ignorable merge-lineage seed event.
- `components.spec.tsx`: HEAD/preview/selection separation and failed-branch composer behavior.
- `project-history.spec.ts`: completed-turn extraction, fork seed metadata, and RPC payload validation.
- `project-graph.spec.ts`: fork deduplication, exact merge preservation, and timeline prefixes.
- `project-page.spec.tsx` / `project-bridge.spec.tsx`: scrubbing, inspection, retry, source navigation, DOM reinjection, and cleanup.

For a real DSH smoke test without touching the user's profile:

```bash
export DSH_HOME=/tmp/dsh-git-validation-home
cd ../deepseek-harness
pnpm dsh plugin --profile web add ../dsh-git
pnpm dsh --profile web --dump-config
pnpm dsh --profile web
```

The dump must end with a `# == dsh-git` layer, and the browser must contain `style[data-plugin="dsh-git"]` with no console errors.

## Roadmap

These are the Git operations the current model implies but does not yet implement.

- **`worktree` — make checkout complete.** Today `dsh-git` branches conversation history only. When an agent has edited files on one branch, checking out another returns the conversation to a different point but leaves the filesystem where it was. Pairing each graph branch with a Git worktree or a snapshot provider is the largest single gap between this plugin and the workflow it is named after.
- **`diff`.** Compare two PA nodes: their prompts, their answers, and the file changes each produced.
- **`revert` / `reset`.** Discard everything after a chosen PA, or undo one PA's effect, as an explicit operation rather than by abandoning a branch.
- **`blame`.** Trace a file's current state back to the PA nodes that produced it.
- **`clone` / `push` / `pull`.** The ledger now follows the DSH profile, so a graph survives the browser — but it lives on one Host, with no export and no sharing across machines or people. `dsh-git` is a local-first version control layer for agent work, not yet a collaboration system.

## Current boundaries

- Graph persistence follows the DSH profile. Ledgers written by the previous `localStorage` build are not migrated; those graphs re-import from the session logs when their sessions are viewed, but branch names and old merge parents recorded only in the browser are lost.
- The ledger has no cross-tab change push. Two tabs open on the same scope each hold their own in-memory copy, and the last write wins; `domain/changed` is in-process only on the Host.
- Project graph PA data is read fresh from the Host. Merge sessions created by this build carry their lineage in the log; for merge sessions created before it, exact multi-parent metadata still depends on the ledger, and without it the page shows the provable primary lineage rather than inventing missing merge parents.
- Turns created before the plugin is installed are imported when their session is viewed; unrelated DSH forks cannot be deduplicated into shared PA identities unless dsh-git created them.
- Only selected completed turns are seeded into a merge session; unselected ancestors are not implicitly inherited.
- Core trajectory events are copied, while source-plugin-specific log-only events are intentionally excluded from the merged seed.
