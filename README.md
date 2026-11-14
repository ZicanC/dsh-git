# dsh-git

**English** · [中文](./README.zh-CN.md)

`dsh-git` lets you manage conversations with an agent the way you use Git, putting context selection back under human control.

In long-running conversations, incorrect conclusions, outdated assumptions, failed approaches, and irrelevant tool output can continue propagating into later turns. This project lets people explicitly select the trustworthy, relevant turns that should form the next conversation history instead of inheriting an entire polluted thread by default.

Each completed Prompt + Answer turn is a commit. You can cherry-pick turns from any Session, arrange them in any order to form a new conversation history, and continue asking questions from there. The assembled turns are written as real, completed DSH history—not appended to the prompt as a context block. To the agent, the resulting history is indistinguishable from one it experienced firsthand.

`dsh-git` is a plugin for DeepSeek Harness Web.

## Operations

| Git | dsh-git |
| --- | --- |
| `commit` | Each completed Prompt + Answer turn is a `PA` node: atomic, addressable, and never rewritten once written. |
| `log --graph` | Each Session's **Branches** tab has a **Conversation Graph**, and each Workspace has a project graph. Both show branches, fork copies, merge tracks, and `HEAD`. |
| `HEAD` | The last node in the current Session's history. It is independent of node inspection and context selection. |
| `checkout` | In the project graph, **Open source Session** jumps to the Session that holds a PA. |
| `cherry-pick` | Open a PA from any Session and use **Add to Context** to put it in the ordered **Context Tray**. |
| `rebase` | The Host renumbers the selected turns into one continuous history, following their order in the tray. |
| `branch` | When the selection comes from one Session, the tray button reads **Fork**: a new Chat is created from that history. |
| `merge` | When the selection spans Sessions, the button reads **Merge**: the new Chat's first turn becomes a multi-parent node that records every source. |

## Key features

- **Conversation Graph:** The left side of each Session's **Branches** tab is a compact conversation graph. Clicking a node only inspects it: the PA Context Window opens with its Prompt, Answer, and the Context used for that answer. The selection and the current Session do not change.
- **Chat History preview:** The right side shows the complete chat history the current selection would produce, in tray order, including tool calls and the turn that is still streaming. You see what the new Chat's history will be before you Fork or Merge. Each PA is read from the Host once; when one cannot be read, only that PA shows an error and the rest still appear.
- **Ordered Context Tray:** The tray docks above the official composer. Only PAs you explicitly add enter the new history, and dragging the chips sets the order sent to the model. One PA takes one slot; choosing another fork copy of it replaces that slot in place.
- **Fork and Merge:** A selection from one Session is a Fork; a selection that spans Sessions is a Merge. The button label, the parent relations in the graph, and the lines drawn all come from the same decision. A Merge has one incoming line per source Session; the other selected PAs are Context and draw no line.
- **Official fork deduplication:** A fork created through the official Harness feature shares the history prefix it inherited with the Session it came from. The copied tip appears as a copy with a `FORK` badge that keeps the original PA number, and later PAs continue beneath it. Harness stopped recording a fork's source in 0.2.1-rc.3, so the plugin finds it again by comparing the logs event by event; the source has to be in the same Workspace, see "Known limitations".
- **Anchor mode:** **Anchor** freezes the current selection. From then on, every question sent from this Chat opens its own independent child Session in a dedicated Anchor Workspace, seeded with the frozen PAs. Use it to ask several parallel questions against one context.
- **Workspace project graph:** Hover over a Workspace row and click its graph button to view every completed PA in that Workspace. The project graph takes over the main column, is read-only, and does not change the current Session. The **PA timeline** at the bottom is ordered by completion time; drag it left to watch the graph grow.
- **Host-side persistence:** Each Workspace folder has an independent graph ledger that follows the DSH profile and does not depend on the current browser. Sessions outside every folder each use an isolated ledger.

## Version requirements

This plugin targets **DeepSeek Harness 0.2.2-rc.3**, as found on the Harness `master` branch at commit `39163dd30f`. Type checking, tests, and the `lib/` build are all made against that commit. The tag `dsh-v0.2.2-rc.3` is 608 commits older; the Harness interfaces this plugin uses are the same there, but nothing has been built or run against the tag.

Harness 0.1.2 is no longer supported: the plugin now relies on Session format v4 events, the retained Session references of the browser Session Controller, and the `@deepseek-ai/dsh-agent-preset-registry` package, none of which exist there. The last commit that builds against `dsh-v0.1.2-rc.1` is `3c468a3`.

Node `^22.19.0 || >=24.0.0` is required. This Harness version pins pnpm 11.28.5; the commands below call it through `corepack`.

## Install

`dsh-git` provides only the plugin; it does not include the `dsh` executable. Development dependencies link to a sibling Harness source checkout, so prepare that first:

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git ../deepseek-harness
git -C ../deepseek-harness checkout 39163dd30f
corepack pnpm --dir ../deepseek-harness install
corepack pnpm --dir ../deepseek-harness run build:native-system
corepack pnpm --dir ../deepseek-harness run build:lib
corepack pnpm --dir ../deepseek-harness run build:web
```

`build:native-system` compiles the file-lock addon Harness loads when a turn runs; it needs a C compiler and the Node headers, and without it every turn fails with `Cannot find module … system.node`. `build:lib` produces the packages the plugin's links point at. `build:web` produces the web frontend; without it the Web UI serves a 404.

When switching an existing Harness checkout from another version, remove its stale `lib/` directories and leftover package folders before building; they break the bundler.

Then build and install the plugin:

```bash
pnpm install
pnpm run build
corepack pnpm --dir ../deepseek-harness dsh plugin --profile web add "$PWD"
corepack pnpm --dir ../deepseek-harness dsh --profile web
```

If `dsh` is installed globally and `command -v dsh` prints its path, you can use the shorter `dsh plugin ...` and `dsh --profile web` instead. Do not run `pnpm dsh` inside this plugin repository: pnpm only searches for scripts and executables provided by the current project, and this project provides neither.

The built plugin does not contain the local path: its browser bundle is self-contained except for React, which DSH supplies through its client module table. The built `lib/` files ship with the package, so installing a release archive needs no build step.

To uninstall the plugin:

```bash
corepack pnpm --dir ../deepseek-harness dsh plugin --profile web remove dsh-git
```

## Workflow

When the current Session has accumulated incorrect assumptions, failed approaches, or irrelevant material, you do not need to keep inheriting its complete history.

1. Complete one or more ordinary turns in DSH.
2. Open the **Branches** tab. The current Session's history is selected by default and shown in blue; its last node is marked `HEAD`.
3. Click any node to inspect it, then use **Add to Context** or **Remove from Context** in the PA Context Window.
4. Drag the chips in the Context Tray above the composer to set the order sent to the model. The Chat History on the right follows.
5. Write the next question in the official composer, then click **Fork** or **Merge** on the tray.
6. The plugin creates a new Chat with the selected turns as its ordered history, moves the draft into it, and opens it. After you send, the new node appears in the graph when the answer completes.

While the selection has been changed and not yet forked or merged, the composer still accepts typing, but Enter and the send button are refused so the question cannot go into the old Session. To drop the changes, click **Discard changes and send** beside the composer: the selection returns to the current Session's complete history and the question goes to the original Session.

### Anchor mode

1. Select the PAs, then click **Anchor** in the Conversation Graph header.
2. The plugin creates a `dsh-git-anchors-…` subdirectory inside the current Workspace directory and registers it as the Anchor Workspace.
3. Every question sent from this Chat afterwards opens its own child Session in the Anchor Workspace. The original Session is unchanged. A question leaves the composer only once the Host has taken it; a refused question stays where it was typed, with its attachments, and the composer says so.
4. Click the button again to cancel. The Anchor Workspace is kept, and anchoring the same PAs again resumes it.

In the Anchor Workspace's project graph, the frozen PAs keep their original numbers and each child Session's own turns are labelled `S<n>.<m>`.

## Data model

DSH Session logs are append-only and ordered chronologically. `dsh-git` adds a semantic graph on top. The key ideas:

- **PA identity and occurrence:** One PA can appear in several Sessions (its original occurrence and its fork copies). Identity decides the number; an occurrence decides where it is drawn and which Session owns it.
- **PA numbers:** Assigned within one ledger scope, and never changed once shown. Fork copies take no number.
- **Parents:** `parentIds` decides the lines in the graph. An ordinary turn's parent is the previous turn of its Session; a Merge node has one parent per source Session.
- **Context:** `contextRefs` records which PAs a turn actually carried, in what order, and through which Session's history each was selected. It is used only to highlight nodes when one is inspected, and draws no line.

The complete fields, decision rules, and invariants are in [`docs/conversation-graph-logic.md`](./docs/conversation-graph-logic.md).

## How graph data is stored

**The graph ledger** lives in a `dsh-storage-domain` domain named `dsh_git_graph`, with one record per scope: Sessions in a Workspace folder use `workspace:<id>`, while Sessions outside every folder use `session:<id>`. The ledger stores nodes, branches, Session turn references, pending merge recipes, and anchor bindings. Selection, inspection, and tray order belong to the view and are not written to the ledger.

The browser holds an in-memory copy of the ledger. On mount it reads the ledger once for the current scope; every later change writes the complete record back to the Host, serialized within each scope. Changes made before the initial read completes are deferred, so an early-rendered view cannot create duplicate nodes for turns the Host already knows. Switching between Sessions that are already recorded produces no write.

The Host guards every write:

- **Revision check:** Each write carries the revision it was based on. If that differs from the stored revision the write is refused and the stored ledger is left as it was.
- **Semantic validation:** Cycles, dangling references, the same PA appearing twice in one Session, Merge parents that disagree with the Context, and similar faults cause the whole write to be refused.

Ledgers written by earlier versions can hold the same turn under two ids. They are repaired automatically when read; nothing needs to be done by hand.

**Merge provenance** is also written to the new Session's own log as a `dsh-git/merge` event at the end of the seed. It records the Host coordinates of every imported turn—`sessionId`, turn, boundary seq, the Session it was selected through, and the turn number it occupies in the new Session—and does not depend on browser-side node ids. The project graph can therefore restore a merge's parents from the log alone, even if the graph ledger is lost.

The event must be marked `ignorable`. If a log contains an event type outside `KNOWN_SESSION_EVENT_TYPES` and the writer does not set that flag, `session-persistence` refuses to parse the entire log; plugins cannot extend that build-time set. Because `Session.append` does not accept the flag, the plugin constructs the event directly and places it in the seed—the only write path that supports it. This is also why the plugin cannot append graph metadata to an active Session and why the mutable ledger lives in a storage domain.

## Host-side history composition

Through a private RPC, the browser sends only the selected source coordinates: `sessionId`, turn, and completed-turn boundary, plus the Session each was selected through. The Host first checks the identity of every coordinate along the exact provenance recorded in the logs. If the same PA is selected twice, or a coordinate does not belong to the Session history it claims, the whole request is refused and nothing is created. In that check, a turn an official fork inherited counts as the same PA as in the Session it was forked from. Otherwise the Host reads the canonical Session logs, renumbers the selected turns in tray order, creates a new agent from the resulting well-formed seed, adds the new Session to the Workspace of its source Session, and tells the browser where each turn sits in the new Session's log.

This process changes only the conversation history. Files remain shared across the Workspace and do not branch with the conversation.

## Project graph data loading

The Host registers a private trusted-host Connection RPC under `/dsh-git`. A project graph request carries only the Workspace id. The Host reads the complete canonical logs of every Session registered to that Workspace and returns normalized completed-PA records: start and completion times, fork-seed boundaries, content fingerprints, merge provenance, and the source Session of each official fork. Incomplete turns are never returned; when one Session's log cannot be read, only that Session is left out.

An official fork's source is worked out by comparison: a fork's seed is an event-for-event copy of a prefix of the source log, so the Host looks in the same Workspace for the Session whose log begins with exactly that prefix and which wrote the prefix's last event itself. Events are compared, not wording.

The browser assembles that response and the ledger into one graph and adopts it into the ledger, and only then imports the current Chat's own turns, so the turns a fork copied are not numbered as new PAs first. Sessions created by dsh-git have their parents restored from the exact coordinates in their logs. Inherited turns of an official fork fold into the source Session's nodes, with the tip shown as a fork copy. Copied turns with unknown provenance remain separate rather than being connected by a guessed edge.

DeepSeek Harness does not currently expose project-row action or project-page slots. The project graph button and main-column takeover therefore live in a compatibility bridge built on semantic DOM attributes and a `MutationObserver`. The composer send guard works the same way, at the DOM edge of the composer card; it recognises the rich-text composer of Harness 0.2 as well as the earlier `<textarea>`. If the Harness sidebar or composer DOM changes, these two adapters may need an update; the PA data protocol and graph page are independent of them.

## Development and testing

The project uses TypeScript in strict mode, React 18, Vitest, Testing Library, and tsdown.

```bash
pnpm run typecheck
pnpm run test
pnpm run build
pnpm pack
```

Source layout:

Host and shared:

- `src/index.ts`: the Host plugin. It registers the RPCs, composes Session seeds, and reads and writes the ledger.
- `src/graph-ledger.ts`: ledger logic shared by both halves—identity, number finalization, semantic validation, node replacement, and repair.
- `src/history.ts`, `src/merge-lineage.ts`, `src/project-history.ts`, `src/history-preview.ts`: Host-side history composition, the provenance event, and log projections.
- `src/fork-origin.ts`: finding an official fork's source Session from the logs.
- `src/protocol.ts`: RPC endpoints and strict decoders.

Browser data and workflows:

- `src/client/index.ts`: the plugin entry, wiring only—it registers a component with each slot and hands it the ledger and the Host.
- `src/client/repository.ts`: the browser ledger's read, write queue, and subscription.
- `src/client/ledger-transitions.ts`: pure ledger transitions—importing a Session, recognising official forks, registering a new Chat, and adopting the project graph.
- `src/client/host-rpc.ts`, `workspace-graph.ts`: one typed call per Host endpoint, and the project graph read.
- `src/client/merged-chat.ts`: creating a new Chat (Fork or Merge) and moving the draft into it.
- `src/client/anchor-mode.ts`: anchoring, cancelling, and dispatching an anchored question.
- `src/client/session-handoff.ts`, `draft-attachments.ts`: holding a just-created Session, moving a draft's attachments and staging their uploads for it, and waiting for the Host to take a send.
- `src/client/project-graph.ts`: project graph assembly.

Interface:

- `src/client/GraphView.tsx`: the Branches view, composed from four hooks—`use-project-graph.ts` (the project graph), `use-context-selection.ts` (the Context selection), `use-history-preview.ts` (reading and caching Chat History), and `use-busy-action.ts` (abortable actions).
- `src/client/GraphCanvas.tsx`, `tree-layout.ts`, `pan-zoom.ts`: rendering the conversation graph, its row-and-lane layout and connectors, and pan and zoom.
- `src/client/ChatHistoryPreview.tsx`, `PreviewRecords.tsx`, `preview-text.ts`, `stick-to-bottom.ts`: the Chat History panel, the row component for each kind of record, summary text, and stick-to-bottom scrolling.
- `src/client/ContextTray.tsx`, `ComposerDiscardAction.tsx`, `composer-send-guard.ts`, `HistoryRail.tsx`, `ProjectGraphPage.tsx`, and the rest: the tray, the composer action and send guard, the history rail, and the project graph page.

Tests by layer:

- **Ledger:** `graph-integrity.spec.ts` (fork numbering, one occurrence per Session, legacy-ledger repair, needless writes), `graph-correctness.spec.ts` (finalization order, Context references, the revision check), `repository.spec.ts`, `workspace-repositories.spec.ts`, `graph-domain.spec.ts`, `graph-medium.spec.ts` (a round trip through the real JSON storage backend), `graph.spec.ts`, `labels.spec.ts`.
- **Host:** `history.spec.ts` (seed composition, identity checks, the `ignorable` provenance event), `merge-rpc.spec.ts` (the Fork, Merge, and anchor RPC flows end to end), `fork-origin.spec.ts` (finding an official fork's source, a PA selected through a fork, an unreadable Session), `project-history.spec.ts`, `history-preview.spec.ts`, `seed-head.spec.ts` (the system prompt a seed must open with to stay readable).
- **Project graph:** `project-graph.spec.ts`, `project-page.spec.tsx`, `project-bridge.spec.tsx`.
- **Interface:** `components.spec.tsx` (selection, Fork/Merge, anchoring, reading Chat History), `fork-lineage-client.spec.tsx` (the project graph is adopted before turns are imported), `tree-layout.spec.ts`, `preview-text.spec.ts`, `graph-canvas-design.spec.tsx`, `graph-canvas-selection.spec.tsx`, `graph-canvas-zoom.spec.tsx`, `history-rail.spec.tsx`, `chat-history-preview.spec.tsx`, `preview-markdown.spec.tsx`, `preview-cache.spec.ts`, `live-turn.spec.ts`, `extract.spec.ts`.
- **Composer and tray:** `composer-send-guard.spec.ts`, `composer-discard-action.spec.tsx`, `composer-block-lease.spec.ts`, `context-tray-channel.spec.ts`, `context-tray-dock.spec.tsx`, `context-tray-slot.spec.ts`, `anchor-client.spec.ts` (anchoring and dispatch, including a refused question), `merge-client.spec.ts` (creating a Chat on retained Session references and moving its draft), `draft-attachments.spec.ts`, `host-rpc.spec.ts`.

To run a smoke test without touching your real DSH profile, point `DSH_HOME` at a temporary directory:

```bash
export DSH_HOME=/tmp/dsh-git-validation-home
corepack pnpm --dir ../deepseek-harness dsh plugin --profile web add "$PWD"
corepack pnpm --dir ../deepseek-harness dsh --profile web --dump-config
corepack pnpm --dir ../deepseek-harness dsh --profile web --port 0
```

The configuration output must end with a `# == dsh-git` layer. The page that opens must contain `style[data-plugin="dsh-git"]`, and the console must report no errors.

## Known limitations

- `dsh-git` does not automatically decide whether a piece of history is correct, trustworthy, or useful. It provides context visualization, provenance, selection, and composition; the final judgment remains with the user.
- Only Harness 0.2.2-rc.3 is supported; see "Version requirements".
- An official fork's source is looked for only in the same Workspace. When the source Session has been moved or deleted, or its log cannot be read, the fork appears in the graph as an independent Session whose inherited turns carry their own PA numbers. Forks and Merges created through dsh-git are unaffected: they write their own provenance.
- Sessions that dsh-git created under Harness 0.1.2 are not carried over to the new version. As the Harness migration code reads, a format-v0 log holding an event type it does not know is refused, even when the event is marked `ignorable`, and those Sessions' logs hold `dsh-git/merge`; this has not been run. An old ledger itself can still be read, but the event positions it records no longer match the migrated logs.
- The ledger does not synchronize across tabs. With two tabs open on one Workspace, the later writer is refused by the Host and the page shows a notice asking for a reload; reloading restores it.
- The PA Context Window of an ordinary turn reads "Actual request Context is unknown". The ledger records only the Context explicitly selected for a Fork or Merge, and does not infer what an ordinary turn carried from its visible parent chain.
- The Host finds an official fork's source by comparing events, which is exact. But when the browser folds copies that are already in the ledger into the source, it counts the inherited turns by matching Prompt and Answer text at the same turn numbers in the fork and the source. A fork whose first own turn is word for word the source's turn of the same number is folded one turn too far.
- The Host creates the new Session and the browser registers it in the ledger afterwards; there is no transaction across the two. If the browser's registration is lost, the project graph still restores the parents from the `dsh-git/merge` event in the log. Merge Sessions older than that event depend on the ledger alone.
- Only selected completed turns are written into the new Session's seed; unselected ancestor turns are not inherited implicitly. Core trajectory events are copied, while source-plugin-specific log-only events are excluded. The seed opens with one system prompt, the one in effect for the last selected turn; the other sources' system prompts and tool-change notices are not replayed.
- A draft containing `@` references or other structured content cannot be forked, merged, or sent as an anchored question.
- Harness uploads a draft's images and attached files for the Session they were added to. Moving them into the new Chat stages the uploads again through a member of the Harness Conversation service that is outside its published interface. On a Harness build without that member, a draft with attachments is refused and stays where it is; a text-only draft still moves.
- Lines in the graph may cross each other and may pass through nodes; there is no obstacle avoidance.
