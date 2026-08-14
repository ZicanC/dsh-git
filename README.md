# dsh-git

`dsh-git` is an installable DeepSeek Harness Web plugin that turns linear chat history into a Git-style conversation graph. A completed Prompt + Answer turn is one `PA` node. Ordinary continuations create one-parent nodes; selecting turns from parallel lines and asking a new question creates a multi-parent merge node on a new branch.

The UI is Chinese to match the current DSH Web product surface.

## What it provides

- A compact **Conversation Graph** tree with forks, merge edges, and a visible `HEAD`; Prompt, Answer, and historical context appear only after clicking a PA node.
- Independent `HEAD`, preview, and context-selection state: clicking a node previews it; its checkbox changes the next model context; “切换到此分支” checks out its DSH session.
- An ordered **Context Tray**. New selections default to creation-time order; drag-and-drop creates an explicit order that is retained when more nodes are appended.
- Free selection across branches. Missing direct predecessors produce a warning but are not forced into the request.
- Automatic branch creation. Asking from the tray creates a new Host-side session whose seed contains every selected PA as a real completed DSH turn; the new question then becomes the next turn and its Prompt + Answer becomes a multi-parent DAG node.
- Browser persistence in `localStorage` under `dsh-git.graph.v1`, including branch names, canonical node references, context manifests, preview, and pending merge metadata.

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

Open the Web UI and select the **分支** tab after a session has at least one completed turn.

To uninstall:

```bash
pnpm --dir ../deepseek-harness dsh plugin --profile web remove dsh-git
```

The development dependencies currently link to a sibling `../deepseek-harness` checkout because the public rc.1 dependency graph references an unpublished package. The built plugin does not contain that path: its browser bundle is self-contained except for React, which DSH supplies through its client module table. Built `lib/` files are intentionally shipped, so installing a release archive does not execute a build script.

## Workflow

1. Complete one or more ordinary DSH turns.
2. Open **分支**. The current primary line is solid and the active node is marked `HEAD`.
3. Check any PA nodes. They enter Context Tray in creation order.
4. Drag chips to set the exact order sent to the model.
5. Type the next question and choose **创建 merge branch 并提问**.
6. The plugin builds a new session with the selected turns as ordered history, opens it, sends the new question, and moves `HEAD` when the answer completes.

Node clicks do not change the context or current session. Use the checkbox for context and **切换到此分支** for checkout.

## Data model

The chronological DSH session log stays append-only. `dsh-git` adds a browser-owned semantic graph:

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

## Host-side history composition

The browser sends only the selected source coordinates (`sessionId`, turn, and completed-turn boundary) through a private command. The Host validates those coordinates, reads each canonical session log, renumbers the selected completed turns in Context Tray order, and creates a new Agent from that balanced seed. The new session is attached to the source session's Workspace before the next question is sent normally.

For example, selecting PA1 and PA7 produces a new session with **Turn 1 = PA1** and **Turn 2 = PA7**. Asking the next question produces **Turn 3 = PA9**. DSH's built-in trajectory therefore shows three real turns instead of an XML context block embedded in PA9's user message. Core execution events—including user/context messages, assistant output, model request headers, and tool calls/results—are retained inside each imported turn. Unrelated plugin-owned log-only events are not copied.

This changes conversation history only. Files remain workspace-global and are not branched.

## Development and tests

VS Code, Cursor, WebStorm, or any TypeScript-capable IDE works. The project uses strict TypeScript, React 18, Vitest, Testing Library, and tsdown.

```bash
pnpm run typecheck
pnpm run test
pnpm run build
pnpm pack
```

The test layers are:

- `repository.spec.ts`: linear import, persistent tray order, child-session merge commit.
- `graph.spec.ts`: primary-line ancestry, sibling lanes, merge edges, missing-dependency warnings.
- `history.spec.ts`: private payload validation and the PA1 + PA7 → Turn 1 + Turn 2 → PA9 Turn 3 regression.
- `components.spec.tsx`: HEAD/preview/selection separation and failed-branch composer behavior.

For a real DSH smoke test without touching the user's profile:

```bash
export DSH_HOME=/tmp/dsh-git-validation-home
cd ../deepseek-harness
pnpm dsh plugin --profile web add ../dsh-git
pnpm dsh --profile web --dump-config
pnpm dsh --profile web
```

The dump must end with a `# == dsh-git` layer, and the browser must contain `style[data-plugin="dsh-git"]` with no console errors.

## Current boundaries

- Graph persistence is browser-local. Opening the same DSH profile in another browser does not transfer graph metadata.
- Turns created before the plugin is installed are imported when their session is viewed; unrelated DSH forks cannot be deduplicated into shared PA identities unless dsh-git created them.
- Only selected completed turns are seeded into a merge session; unselected ancestors are not implicitly inherited.
- Core trajectory events are copied, while source-plugin-specific log-only events are intentionally excluded from the merged seed.
- Filesystem state is not branched. A later version could pair each graph branch with a Git worktree or snapshot provider.
