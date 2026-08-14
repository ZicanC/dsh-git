window.__ModuleLoader__.load({
	id: "dsh-git",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		//#region lib/types/client/extract.js
		function contentText(content) {
			return content.flatMap((block) => {
				const candidate = block;
				return candidate.type === "text" && typeof candidate.text === "string" ? [candidate.text] : [];
			}).join("\n");
		}
		function assistantText(node) {
			return node.blocks.flatMap((block) => block.kind === "text" ? [block.text] : []).join("\n");
		}
		/** Project completed DSH turns into Prompt + Answer records for the graph ledger. */
		function extractCompletedTurns(snapshot) {
			const result = [];
			for (const turnNumber of snapshot.chat.timeline.turnOrder) {
				const location = snapshot.chat.timeline.turns.get(turnNumber);
				const start = location?.start;
				const end = location?.end;
				if (location?.status !== "closed" || start === void 0 || end === void 0) continue;
				const nodes = snapshot.nodes.filter((node) => node.seq > start.seq && node.seq < end.seq);
				const prompt = nodes.flatMap((node) => node.kind === "user" ? [contentText(node.content)] : []).filter(Boolean).join("\n");
				const answer = nodes.flatMap((node) => node.kind === "assistant" ? [assistantText(node)] : []).filter(Boolean).join("\n\n");
				if (prompt === "" && answer === "") continue;
				result.push({
					turn: turnNumber,
					prompt,
					answer,
					createdAt: start.time,
					boundarySeq: end.seq
				});
			}
			return result;
		}
		//#endregion
		//#region lib/types/client/graph.js
		/** Return nodes in stable creation order with ids breaking timestamp ties. */
		function orderedNodes(state) {
			return Object.values(state.nodes).sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
		}
		/** Return the primary-parent ancestry from root through the addressed node. */
		function primaryPath(state, nodeId) {
			const reversed = [];
			const visited = /* @__PURE__ */ new Set();
			let cursor = nodeId;
			while (cursor !== null && !visited.has(cursor)) {
				const node = state.nodes[cursor];
				if (node === void 0) break;
				visited.add(cursor);
				reversed.push(cursor);
				cursor = node.primaryParentId;
			}
			return reversed.reverse();
		}
		/** Return selected nodes whose primary parent is absent from the selection. */
		function missingDirectDependencies(state, manifest) {
			const selected = new Set(manifest);
			const missing = /* @__PURE__ */ new Set();
			for (const id of manifest) {
				const parent = state.nodes[id]?.primaryParentId;
				if (parent !== null && parent !== void 0 && !selected.has(parent)) missing.add(parent);
			}
			return [...missing];
		}
		/** Estimate prompt tokens without coupling the browser plugin to a tokenizer. */
		function estimateTokens(state, manifest) {
			const characters = manifest.reduce((total, id) => {
				const node = state.nodes[id];
				return total + (node === void 0 ? 0 : node.prompt.length + node.answer.length);
			}, 0);
			return Math.ceil(characters / 4);
		}
		//#endregion
		//#region lib/types/client/ContextTray.js
		function shortId(id) {
			return id.startsWith("pa-") ? `PA-${id.slice(-5)}` : id.slice(-8);
		}
		/** Draggable ordered context selection and branch-creating prompt composer. */
		function ContextTray({ state, busy, error, onMove, onMoveEnd, onRemove, onClear, onAsk }) {
			const [question, setQuestion] = (0, react.useState)("");
			const [dragging, setDragging] = (0, react.useState)(null);
			const missing = missingDirectDependencies(state, state.contextManifest);
			const canAsk = !busy && question.trim() !== "" && state.contextManifest.length > 0;
			const submit = async () => {
				if (!canAsk) return;
				await onAsk(question);
				setQuestion("");
			};
			return (0, react_jsx_runtime.jsxs)("section", {
				className: "dsh-git-tray",
				"aria-label": "Context Tray",
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-git-tray-head",
						children: [(0, react_jsx_runtime.jsx)("strong", { children: "Context Tray" }), (0, react_jsx_runtime.jsxs)("span", {
							className: "dsh-git-muted",
							children: [
								"约 ",
								estimateTokens(state, state.contextManifest),
								" tokens · 可拖动排序"
							]
						})]
					}),
					(0, react_jsx_runtime.jsx)("div", {
						className: "dsh-git-chips",
						onDragOver: (event) => event.preventDefault(),
						onDrop: () => {
							if (dragging !== null) onMoveEnd(dragging);
							setDragging(null);
						},
						children: state.contextManifest.length === 0 ? (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-git-muted",
							children: "在上方分叉图中勾选 PA 节点"
						}) : state.contextManifest.map((nodeId) => {
							const node = state.nodes[nodeId];
							if (node === void 0) return null;
							return (0, react_jsx_runtime.jsxs)("span", {
								className: "dsh-git-chip",
								draggable: true,
								title: node.prompt,
								onDragStart: (event) => {
									event.stopPropagation();
									setDragging(nodeId);
									event.dataTransfer.effectAllowed = "move";
								},
								onDragOver: (event) => event.preventDefault(),
								onDrop: (event) => {
									event.stopPropagation();
									if (dragging !== null) onMove(dragging, nodeId);
									setDragging(null);
								},
								children: [
									(0, react_jsx_runtime.jsx)("span", {
										"aria-hidden": "true",
										children: "⠿"
									}),
									shortId(nodeId),
									(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										"aria-label": `移除 ${shortId(nodeId)}`,
										onClick: () => onRemove(nodeId),
										children: "×"
									})
								]
							}, nodeId);
						})
					}),
					missing.length > 0 ? (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-git-warning",
						children: [
							"自由选择模式：",
							missing.map(shortId).join("、"),
							" 未加入；模型只接收 Tray 中列出的 PA。"
						]
					}) : null,
					(0, react_jsx_runtime.jsx)("textarea", {
						className: "dsh-git-question",
						value: question,
						disabled: busy,
						placeholder: "输入下一个问题；提交后会自动建立新的 merge branch…",
						onChange: (event) => setQuestion(event.target.value),
						onKeyDown: (event) => {
							if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
								event.preventDefault();
								submit().catch(() => {});
							}
						}
					}),
					error === null ? null : (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-git-error",
						role: "alert",
						children: error
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-git-actions",
						children: [(0, react_jsx_runtime.jsx)("button", {
							className: "dsh-git-button",
							type: "button",
							disabled: busy || state.contextManifest.length === 0,
							onClick: onClear,
							children: "清空"
						}), (0, react_jsx_runtime.jsx)("button", {
							className: "dsh-git-button dsh-git-button-primary",
							type: "button",
							disabled: !canAsk,
							onClick: () => {
								submit().catch(() => {});
							},
							children: busy ? "正在创建 branch…" : "创建 merge branch 并提问 →"
						})]
					})
				]
			});
		}
		//#endregion
		//#region lib/types/client/GraphCanvas.js
		const NODE_WIDTH = 72;
		const NODE_HEIGHT = 42;
		const HORIZONTAL_GAP = 28;
		const STAGE_PADDING = 32;
		function nodeLabels(state) {
			return new Map(orderedNodes(state).map((node, index) => [node.id, `PA${index + 1}`]));
		}
		/** Lay out the primary-parent tree; secondary parents are drawn as merge edges. */
		function layoutTree(state) {
			const nodes = orderedNodes(state);
			const nodeIds = new Set(nodes.map((node) => node.id));
			const children = /* @__PURE__ */ new Map();
			const roots = [];
			for (const node of nodes) if (node.primaryParentId === null || !nodeIds.has(node.primaryParentId)) roots.push(node.id);
			else children.set(node.primaryParentId, [...children.get(node.primaryParentId) ?? [], node.id]);
			const widths = /* @__PURE__ */ new Map();
			const measuring = /* @__PURE__ */ new Set();
			const measure = (nodeId) => {
				if (widths.has(nodeId)) return widths.get(nodeId);
				if (measuring.has(nodeId)) return NODE_WIDTH;
				measuring.add(nodeId);
				const childWidth = (children.get(nodeId) ?? []).reduce((total, childId, index) => total + measure(childId) + (index === 0 ? 0 : HORIZONTAL_GAP), 0);
				const width = Math.max(NODE_WIDTH, childWidth);
				widths.set(nodeId, width);
				measuring.delete(nodeId);
				return width;
			};
			const positioned = /* @__PURE__ */ new Set();
			const positions = [];
			const place = (nodeId, left, depth) => {
				if (positioned.has(nodeId)) return;
				positioned.add(nodeId);
				const width = measure(nodeId);
				positions.push({
					nodeId,
					x: left + width / 2,
					y: STAGE_PADDING + depth * 120
				});
				let childLeft = left;
				for (const childId of children.get(nodeId) ?? []) {
					place(childId, childLeft, depth + 1);
					childLeft += measure(childId) + HORIZONTAL_GAP;
				}
			};
			let rootLeft = STAGE_PADDING;
			for (const rootId of roots) {
				place(rootId, rootLeft, 0);
				rootLeft += measure(rootId) + HORIZONTAL_GAP;
			}
			for (const node of nodes) {
				if (positioned.has(node.id)) continue;
				place(node.id, rootLeft, 0);
				rootLeft += measure(node.id) + HORIZONTAL_GAP;
			}
			const maxDepthY = Math.max(STAGE_PADDING, ...positions.map((position) => position.y));
			return {
				positions,
				width: Math.max(320, rootLeft - HORIZONTAL_GAP + STAGE_PADDING),
				height: maxDepthY + NODE_HEIGHT + STAGE_PADDING
			};
		}
		function connector(parent, child) {
			const startY = parent.y + NODE_HEIGHT;
			const endY = child.y;
			const middleY = startY + (endY - startY) / 2;
			return `M ${parent.x} ${startY} V ${middleY} H ${child.x} V ${endY}`;
		}
		/** Compact tree visualization: node details are intentionally kept out of the graph. */
		function GraphCanvas({ state, previewNodeId, onPreview }) {
			const viewportRef = (0, react.useRef)(null);
			const [viewport, setViewport] = (0, react.useState)({
				width: 0,
				height: 0
			});
			const layout = (0, react.useMemo)(() => layoutTree(state), [state]);
			const labels = (0, react.useMemo)(() => nodeLabels(state), [state]);
			const byId = (0, react.useMemo)(() => new Map(layout.positions.map((position) => [position.nodeId, position])), [layout]);
			const activePath = (0, react.useMemo)(() => new Set(primaryPath(state, state.headNodeId)), [state]);
			const context = new Set(state.contextManifest);
			(0, react.useEffect)(() => {
				const element = viewportRef.current;
				if (element === null) return;
				const update = () => setViewport({
					width: element.clientWidth,
					height: element.clientHeight
				});
				update();
				if (typeof ResizeObserver === "undefined") return;
				const observer = new ResizeObserver(update);
				observer.observe(element);
				return () => observer.disconnect();
			}, []);
			if (layout.positions.length === 0) return (0, react_jsx_runtime.jsx)("div", {
				className: "dsh-git-empty",
				children: "完成第一轮对话后，这里会出现第一条 branch。"
			});
			const availableWidth = Math.max(0, viewport.width - 24);
			const availableHeight = Math.max(0, viewport.height - 24);
			const scale = viewport.width === 0 || viewport.height === 0 ? 1 : Math.min(1, availableWidth / layout.width, availableHeight / layout.height);
			const fittedWidth = layout.width * scale;
			const fittedHeight = layout.height * scale;
			return (0, react_jsx_runtime.jsx)("div", {
				ref: viewportRef,
				className: "dsh-git-tree-viewport",
				children: (0, react_jsx_runtime.jsx)("div", {
					className: "dsh-git-tree-fit",
					style: {
						width: fittedWidth,
						height: fittedHeight
					},
					children: (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-git-tree-stage",
						style: {
							width: layout.width,
							height: layout.height,
							transform: `scale(${scale})`
						},
						children: [(0, react_jsx_runtime.jsx)("svg", {
							className: "dsh-git-tree-svg",
							width: layout.width,
							height: layout.height,
							"aria-hidden": "true",
							children: orderedNodes(state).flatMap((node) => node.parentIds.map((parentId) => {
								const parent = byId.get(parentId);
								const child = byId.get(node.id);
								if (parent === void 0 || child === void 0) return null;
								const merge = parentId !== node.primaryParentId;
								const active = !merge && activePath.has(parentId) && activePath.has(node.id);
								return (0, react_jsx_runtime.jsx)("path", {
									d: connector(parent, child),
									className: `dsh-git-tree-edge ${merge ? "dsh-git-tree-edge-merge" : active ? "dsh-git-tree-edge-active" : ""}`
								}, `${parentId}:${node.id}`);
							}))
						}), layout.positions.map((position) => {
							const node = state.nodes[position.nodeId];
							if (node === void 0) return null;
							const label = labels.get(node.id) ?? "PA";
							const isHead = node.id === state.headNodeId;
							const isPreview = node.id === previewNodeId;
							const inContext = context.has(node.id);
							return (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: `dsh-git-tree-node ${isPreview ? "dsh-git-tree-node-preview" : ""} ${inContext ? "dsh-git-tree-node-context" : ""}`,
								style: {
									left: position.x - NODE_WIDTH / 2,
									top: position.y,
									width: NODE_WIDTH,
									height: NODE_HEIGHT
								},
								title: `${label}: ${node.prompt || "（无文字问题）"}`,
								"aria-label": `查看 ${label} context`,
								"aria-current": isHead ? "true" : void 0,
								onClick: () => onPreview(node.id),
								children: [(0, react_jsx_runtime.jsx)("span", { children: label }), isHead ? (0, react_jsx_runtime.jsx)("span", {
									className: "dsh-git-tree-head",
									children: "HEAD"
								}) : null]
							}, node.id);
						})]
					})
				})
			});
		}
		//#endregion
		//#region lib/types/client/GraphView.js
		function BranchControls({ branchId, name, current, onCheckout, onRename }) {
			const [draft, setDraft] = (0, react.useState)(name);
			const commit = () => {
				const normalized = draft.trim();
				if (normalized === "") setDraft(name);
				else onRename(branchId, normalized);
			};
			return (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-git-inspector-actions",
				children: [(0, react_jsx_runtime.jsx)("input", {
					className: "dsh-git-branch-name",
					"aria-label": "Branch 名称",
					value: draft,
					onChange: (event) => setDraft(event.target.value),
					onBlur: commit,
					onKeyDown: (event) => {
						if (event.key === "Enter") event.currentTarget.blur();
						if (event.key === "Escape") {
							setDraft(name);
							event.currentTarget.blur();
						}
					}
				}), (0, react_jsx_runtime.jsx)("button", {
					className: "dsh-git-button",
					type: "button",
					disabled: current,
					onClick: onCheckout,
					children: current ? "当前 HEAD" : "切换到此分支"
				})]
			});
		}
		/** Complete graph view registered as one conversation tab. */
		function GraphView({ useSession, useGraph, syncTurns, toggleContext, moveContext, moveContextToEnd, clearContext, checkout, renameBranch, ask }) {
			const snapshot = useSession((value) => value);
			const state = useGraph((value) => value);
			const turns = (0, react.useMemo)(() => extractCompletedTurns(snapshot), [snapshot]);
			const signature = turns.map((turn) => `${turn.turn}:${turn.boundarySeq}:${turn.answer.length}`).join("|");
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const [inspectedNodeId, setInspectedNodeId] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				syncTurns(turns);
			}, [signature, syncTurns]);
			const inspected = inspectedNodeId === null ? void 0 : state.nodes[inspectedNodeId];
			const inspectedBranch = inspected === void 0 ? void 0 : state.branches[inspected.branchId];
			const labels = (0, react.useMemo)(() => new Map(Object.values(state.nodes).sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)).map((node, index) => [node.id, `PA${index + 1}`])), [state.nodes]);
			const submit = async (question) => {
				setBusy(true);
				setError(null);
				try {
					await ask(question, state.contextManifest);
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
					throw cause;
				} finally {
					setBusy(false);
				}
			};
			return (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-git-root",
				"data-conversation-composer-overlay": "",
				children: [(0, react_jsx_runtime.jsxs)("div", {
					className: `dsh-git-workbench ${inspected === void 0 ? "" : "dsh-git-workbench-open"}`,
					children: [(0, react_jsx_runtime.jsxs)("section", {
						className: "dsh-git-panel",
						"aria-label": "Conversation Graph",
						children: [(0, react_jsx_runtime.jsxs)("header", {
							className: "dsh-git-heading",
							children: [(0, react_jsx_runtime.jsx)("span", { children: "Conversation Graph" }), (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-git-muted",
								children: "点击节点查看 Context · 虚线为 merge"
							})]
						}), (0, react_jsx_runtime.jsx)(GraphCanvas, {
							state,
							previewNodeId: inspectedNodeId,
							onPreview: setInspectedNodeId
						})]
					}), inspected === void 0 ? null : (0, react_jsx_runtime.jsxs)("aside", {
						className: "dsh-git-panel",
						"aria-label": "节点 Context",
						children: [(0, react_jsx_runtime.jsxs)("header", {
							className: "dsh-git-heading",
							children: [(0, react_jsx_runtime.jsxs)("span", { children: [labels.get(inspected.id) ?? "PA", " Context"] }), (0, react_jsx_runtime.jsx)("button", {
								className: "dsh-git-close",
								type: "button",
								"aria-label": "关闭节点 Context",
								onClick: () => setInspectedNodeId(null),
								children: "×"
							})]
						}), (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-git-inspector",
							children: [
								(0, react_jsx_runtime.jsx)("h3", { children: inspected.prompt || "（无文字问题）" }),
								inspectedBranch === void 0 ? null : (0, react_jsx_runtime.jsx)(BranchControls, {
									branchId: inspectedBranch.id,
									name: inspectedBranch.name,
									current: inspected.id === state.headNodeId,
									onCheckout: () => checkout(inspected.id),
									onRename: renameBranch
								}, inspectedBranch.id),
								(0, react_jsx_runtime.jsx)("button", {
									className: "dsh-git-button",
									type: "button",
									onClick: () => toggleContext(inspected.id),
									children: state.contextManifest.includes(inspected.id) ? "从 Context Tray 移除" : "加入 Context Tray"
								}),
								(0, react_jsx_runtime.jsxs)("section", {
									className: "dsh-git-context-history",
									"aria-label": "回答时使用的 Context",
									children: [(0, react_jsx_runtime.jsx)("span", {
										className: "dsh-git-message-label",
										children: "回答时使用的 CONTEXT"
									}), inspected.contextManifest.length === 0 ? (0, react_jsx_runtime.jsx)("div", {
										className: "dsh-git-muted",
										children: "该节点没有前置 Context。"
									}) : (0, react_jsx_runtime.jsx)("ol", { children: inspected.contextManifest.map((nodeId) => {
										const contextNode = state.nodes[nodeId];
										if (contextNode === void 0) return null;
										return (0, react_jsx_runtime.jsxs)("li", { children: [(0, react_jsx_runtime.jsx)("strong", { children: labels.get(nodeId) ?? "PA" }), (0, react_jsx_runtime.jsx)("span", { children: contextNode.prompt || "（无文字问题）" })] }, nodeId);
									}) })]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-git-message",
									children: [(0, react_jsx_runtime.jsx)("span", {
										className: "dsh-git-message-label",
										children: "PROMPT"
									}), inspected.prompt]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-git-message",
									children: [(0, react_jsx_runtime.jsx)("span", {
										className: "dsh-git-message-label",
										children: "ANSWER"
									}), inspected.answer || "（没有文字回答）"]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-git-muted",
									children: [
										"parents: ",
										inspected.parentIds.length || 0,
										" · context: ",
										inspected.contextManifest.length || 0
									]
								})
							]
						})]
					})]
				}), (0, react_jsx_runtime.jsx)(ContextTray, {
					state,
					busy,
					error,
					onMove: moveContext,
					onMoveEnd: moveContextToEnd,
					onRemove: toggleContext,
					onClear: clearContext,
					onAsk: submit
				})]
			});
		}
		//#endregion
		//#region lib/types/client/repository.js
		const STORAGE_KEY = "dsh-git.graph.v1";
		const EMPTY_STATE = {
			format: 1,
			nodes: {},
			branches: {},
			sessionBranches: {},
			sessionTurnRefs: {},
			pendingMerges: {},
			headNodeId: null,
			previewNodeId: null,
			contextManifest: []
		};
		function id(prefix) {
			return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
		}
		function distinct(ids) {
			return [...new Set(ids)];
		}
		function parseState(raw) {
			if (raw === null) return EMPTY_STATE;
			try {
				const value = JSON.parse(raw);
				if (value.format !== 1 || value.nodes === void 0 || value.branches === void 0) return EMPTY_STATE;
				return {
					...EMPTY_STATE,
					...value,
					contextManifest: Array.isArray(value.contextManifest) ? value.contextManifest : []
				};
			} catch {
				return EMPTY_STATE;
			}
		}
		/** Persistent observable owning the browser-side conversation DAG. */
		var GraphRepository = class {
			storage;
			state;
			listeners = /* @__PURE__ */ new Set();
			/** @param storage - browser storage; omitted keeps an in-memory repository. */
			constructor(storage) {
				this.storage = storage;
				this.state = parseState(storage?.getItem(STORAGE_KEY) ?? null);
			}
			/** Return the stable snapshot until the next mutation. */
			getSnapshot = () => this.state;
			/** Subscribe to graph mutations. */
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			commit(next) {
				this.state = next;
				this.storage?.setItem(STORAGE_KEY, JSON.stringify(next));
				for (const listener of this.listeners) listener();
			}
			/** Import completed turns from the currently viewed DSH session. */
			syncSession(sessionId, turns) {
				let next = this.state;
				const knownRefs = { ...next.sessionTurnRefs[sessionId] ?? {} };
				let branchId = next.sessionBranches[sessionId];
				if (branchId === void 0) {
					branchId = id("branch");
					next = {
						...next,
						branches: {
							...next.branches,
							[branchId]: {
								id: branchId,
								name: `branch-${Object.keys(next.branches).length + 1}`,
								sessionId,
								headId: null,
								color: Object.keys(next.branches).length % 8,
								createdAt: turns[0]?.createdAt ?? Date.now()
							}
						},
						sessionBranches: {
							...next.sessionBranches,
							[sessionId]: branchId
						}
					};
				}
				let nodes = { ...next.nodes };
				let previousId = null;
				let pending = next.pendingMerges[sessionId];
				for (const turn of [...turns].sort((left, right) => left.turn - right.turn)) {
					const knownId = knownRefs[turn.turn];
					if (knownId !== void 0) {
						const known = nodes[knownId];
						if (known !== void 0 && (known.prompt !== turn.prompt || known.answer !== turn.answer)) nodes[knownId] = {
							...known,
							prompt: turn.prompt,
							answer: turn.answer
						};
						previousId = knownId;
						continue;
					}
					const nodeId = id("pa");
					const merge = pending;
					const parentIds = merge === void 0 ? previousId === null ? [] : [previousId] : distinct(merge.parentIds);
					const primaryParentId = merge?.primaryParentId ?? previousId;
					nodes[nodeId] = {
						id: nodeId,
						sessionId,
						turn: turn.turn,
						prompt: merge?.prompt ?? turn.prompt,
						answer: turn.answer,
						createdAt: turn.createdAt,
						boundarySeq: turn.boundarySeq,
						primaryParentId,
						parentIds,
						contextManifest: merge?.contextManifest ?? primaryPath({
							...next,
							nodes
						}, primaryParentId),
						branchId
					};
					knownRefs[turn.turn] = nodeId;
					previousId = nodeId;
					pending = void 0;
				}
				const headId = previousId;
				const branch = next.branches[branchId];
				const pendingMerges = { ...next.pendingMerges };
				if (next.pendingMerges[sessionId] !== void 0 && pending === void 0) delete pendingMerges[sessionId];
				const shouldSeedTray = next.contextManifest.length === 0 && headId !== null;
				const final = {
					...next,
					nodes,
					branches: branch === void 0 ? next.branches : {
						...next.branches,
						[branchId]: {
							...branch,
							headId
						}
					},
					sessionTurnRefs: {
						...next.sessionTurnRefs,
						[sessionId]: knownRefs
					},
					pendingMerges,
					headNodeId: headId,
					previewNodeId: next.previewNodeId ?? headId,
					contextManifest: shouldSeedTray ? primaryPath({
						...next,
						nodes
					}, headId) : next.contextManifest
				};
				if (JSON.stringify(final) !== JSON.stringify(this.state)) this.commit(final);
			}
			/** Record an auto-created child session before its first merged request completes. */
			prepareBranch(input) {
				const inherited = {};
				for (const [index, nodeId] of distinct(input.importedNodeIds).entries()) if (this.state.nodes[nodeId] !== void 0) inherited[index + 1] = nodeId;
				const branchId = id("branch");
				this.commit({
					...this.state,
					branches: {
						...this.state.branches,
						[branchId]: {
							id: branchId,
							name: `merge-${Object.keys(this.state.branches).length + 1}`,
							sessionId: input.childSessionId,
							headId: input.baseNodeId,
							color: Object.keys(this.state.branches).length % 8,
							createdAt: Date.now()
						}
					},
					sessionBranches: {
						...this.state.sessionBranches,
						[input.childSessionId]: branchId
					},
					sessionTurnRefs: {
						...this.state.sessionTurnRefs,
						[input.childSessionId]: inherited
					},
					pendingMerges: {
						...this.state.pendingMerges,
						[input.childSessionId]: {
							branchId,
							parentIds: distinct(input.parentIds),
							primaryParentId: input.primaryParentId,
							contextManifest: [...input.contextManifest],
							prompt: input.prompt
						}
					},
					headNodeId: input.baseNodeId
				});
			}
			/** Remove a pending merge after a rejected prompt. */
			abortPending(sessionId) {
				if (this.state.pendingMerges[sessionId] === void 0) return;
				const pendingMerges = { ...this.state.pendingMerges };
				delete pendingMerges[sessionId];
				this.commit({
					...this.state,
					pendingMerges
				});
			}
			/** Toggle one node in the context tray; additions restore creation-time order. */
			toggleContext(nodeId) {
				if (this.state.nodes[nodeId] === void 0) return;
				const selected = new Set(this.state.contextManifest);
				if (selected.has(nodeId)) {
					selected.delete(nodeId);
					this.commit({
						...this.state,
						contextManifest: this.state.contextManifest.filter((id) => selected.has(id))
					});
					return;
				}
				const contextManifest = this.state.contextManifest.every((id, index, values) => index === 0 || this.state.nodes[values[index - 1]].createdAt <= this.state.nodes[id].createdAt) ? [...selected, nodeId].sort((left, right) => this.state.nodes[left].createdAt - this.state.nodes[right].createdAt) : [...this.state.contextManifest, nodeId];
				this.commit({
					...this.state,
					contextManifest
				});
			}
			/** Remove all nodes from the next-request tray. */
			clearContext() {
				this.commit({
					...this.state,
					contextManifest: []
				});
			}
			/** Move one selected node before another selected node. */
			moveContext(nodeId, beforeId) {
				if (nodeId === beforeId) return;
				const next = this.state.contextManifest.filter((id) => id !== nodeId);
				const index = next.indexOf(beforeId);
				if (index < 0 || !this.state.contextManifest.includes(nodeId)) return;
				next.splice(index, 0, nodeId);
				this.commit({
					...this.state,
					contextManifest: next
				});
			}
			/** Move one selected node to the end of the tray. */
			moveContextToEnd(nodeId) {
				if (!this.state.contextManifest.includes(nodeId)) return;
				this.commit({
					...this.state,
					contextManifest: [...this.state.contextManifest.filter((id) => id !== nodeId), nodeId]
				});
			}
			/** Change only the preview selection. */
			preview(nodeId) {
				if (this.state.nodes[nodeId] !== void 0) this.commit({
					...this.state,
					previewNodeId: nodeId
				});
			}
			/** Rename a branch in the graph ledger. */
			renameBranch(branchId, name) {
				const branch = this.state.branches[branchId];
				const normalized = name.trim();
				if (branch === void 0 || normalized === "") return;
				this.commit({
					...this.state,
					branches: {
						...this.state.branches,
						[branchId]: {
							...branch,
							name: normalized
						}
					}
				});
			}
		};
		//#endregion
		//#region lib/types/client/styles.js
		/** Plugin-owned stylesheet using the Web surface semantic token vocabulary. */
		const STYLES = `
.dsh-git-root{height:100%;width:100%;min-height:0;flex:1 1 0;display:grid;grid-template-rows:minmax(260px,1fr) auto;box-sizing:border-box;padding-bottom:calc(var(--dsh-composer-height,152px) + 16px);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);overflow:hidden}
.dsh-git-workbench{min-height:0;display:grid;grid-template-columns:minmax(0,1fr);border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-git-workbench-open{grid-template-columns:minmax(300px,36%) minmax(420px,1fr)}
.dsh-git-panel{min-width:0;min-height:0;overflow:hidden}
.dsh-git-workbench-open>aside.dsh-git-panel{height:100%;display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden}
.dsh-git-panel+.dsh-git-panel{border-left:1px solid var(--dsw-alias-border-l2)}
.dsh-git-heading{position:sticky;top:0;z-index:4;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;background:var(--dsw-alias-bg-base);border-bottom:1px solid var(--dsw-alias-border-l2);font:var(--dsw-font-s-strong-14)}
.dsh-git-muted{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xs-13)}
.dsh-git-tree-viewport{height:calc(100% - 49px);min-height:0;overflow:hidden;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box}
.dsh-git-tree-fit{position:relative;flex:none}
.dsh-git-tree-stage{position:absolute;left:0;top:0;transform-origin:top left}
.dsh-git-tree-svg{position:absolute;inset:0;pointer-events:none;overflow:visible}
.dsh-git-tree-edge{fill:none;stroke:var(--dsw-alias-line-secondary);stroke-width:1.5;opacity:.65}
.dsh-git-tree-edge-active{stroke:var(--dsw-static-deepseek-500);stroke-width:2;opacity:1}
.dsh-git-tree-edge-merge{stroke:var(--dsw-static-deepseek-200);stroke-width:2;stroke-dasharray:5 5;opacity:.9}
.dsh-git-tree-node{position:absolute;z-index:2;display:flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l3);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-strong-14);cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.dsh-git-tree-node:hover{border-color:var(--dsw-static-deepseek-500);background:var(--dsw-alias-interactive-bg-hover);transform:translateY(-1px)}
.dsh-git-tree-node-preview{border-color:var(--dsw-static-deepseek-500);background:var(--dsw-alias-button-info-fill);box-shadow:0 0 0 2px var(--dsw-static-deepseek-200)}
.dsh-git-tree-node-context::after{content:'';position:absolute;right:5px;bottom:5px;width:6px;height:6px;border-radius:50%;background:var(--dsw-static-deepseek-500)}
.dsh-git-tree-head{position:absolute;top:-9px;right:-10px;padding:1px 4px;border-radius:4px;background:var(--dsw-alias-state-success-primary);color:white;font-size:9px;line-height:14px;letter-spacing:.2px}
.dsh-git-empty{padding:32px;color:var(--dsw-alias-label-tertiary);text-align:center}
.dsh-git-inspector{min-height:0;padding:16px;display:flex;flex-direction:column;gap:16px;overflow-y:scroll;overflow-x:hidden;scrollbar-gutter:stable;box-sizing:border-box}
.dsh-git-inspector h3{margin:0;font:var(--dsw-font-s-strong-14)}
.dsh-git-close{border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:22px;line-height:1;cursor:pointer;padding:0 3px}
.dsh-git-close:hover{color:var(--dsw-alias-label-primary)}
.dsh-git-inspector-actions{display:flex;gap:8px;align-items:center}
.dsh-git-branch-name{min-width:0;flex:1;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 9px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13)}
.dsh-git-message{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px;white-space:pre-wrap;overflow-wrap:anywhere;font:var(--dsw-font-xs-13);line-height:1.55}
.dsh-git-message-label{display:block;margin-bottom:7px;color:var(--dsw-alias-label-tertiary);font-weight:600}
.dsh-git-context-history{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px;font:var(--dsw-font-xs-13)}
.dsh-git-context-history ol{display:grid;gap:7px;margin:0;padding-left:22px}
.dsh-git-context-history li{padding-left:3px}
.dsh-git-context-history li strong{display:inline-block;margin-right:7px;color:var(--dsw-static-deepseek-500)}
.dsh-git-context-history li span{color:var(--dsw-alias-label-secondary)}
.dsh-git-tray{padding:12px 16px 14px;display:grid;gap:10px;background:var(--dsw-alias-bg-base)}
.dsh-git-tray-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dsh-git-chips{display:flex;flex-wrap:wrap;gap:7px;min-height:34px;padding:7px;border:1px dashed var(--dsw-alias-border-l3);border-radius:10px}
.dsh-git-chip{display:inline-flex;align-items:center;gap:5px;padding:5px 8px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-specific-selector);color:var(--dsw-alias-label-primary);cursor:grab;font:var(--dsw-font-xs-13)}
.dsh-git-chip:active{cursor:grabbing}
.dsh-git-chip button{border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0 2px}
.dsh-git-question{width:100%;min-height:76px;resize:vertical;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13);line-height:1.5;outline:none}
.dsh-git-question:focus{border-color:var(--dsw-static-deepseek-500)}
.dsh-git-actions{display:flex;justify-content:space-between;align-items:center;gap:12px}
.dsh-git-button{border:1px solid var(--dsw-alias-border-l3);border-radius:8px;padding:7px 12px;background:var(--dsw-alias-button-floating-fill);color:var(--dsw-alias-label-primary);cursor:pointer}
.dsh-git-button:hover{background:var(--dsw-alias-button-floating-hover)}
.dsh-git-button-primary{background:var(--dsw-alias-button-info-fill);border-color:var(--dsw-static-deepseek-500)}
.dsh-git-button:disabled{opacity:.45;cursor:not-allowed}
.dsh-git-warning{color:var(--dsw-alias-state-warn-label);font:var(--dsw-font-xs-13)}
.dsh-git-error{color:var(--dsw-alias-state-error-primary);font:var(--dsw-font-xs-13)}
@media(max-width:760px){.dsh-git-workbench-open{grid-template-columns:1fr;grid-template-rows:minmax(250px,1fr) auto}.dsh-git-panel+.dsh-git-panel{border-left:0;border-top:1px solid var(--dsw-alias-border-l2)}.dsh-git-inspector{max-height:260px;overflow:auto}}
`;
		//#endregion
		//#region lib/types/protocol.js
		const CREATE_MERGED_SESSION_COMMAND = "dsh-git-create-merged-session";
		/** Encode the small JSON payload without exposing selected conversation text in the command log. */
		function encodeCreateMergedSessionPayload(payload) {
			return encodeURIComponent(JSON.stringify(payload));
		}
		//#endregion
		//#region lib/types/client/index.js
		/** Required client services: the conversation view slot and session runtime. */
		const inject = ["slots", "sessions"];
		function installStyles() {
			if (document.querySelector("style[data-plugin=\"dsh-git\"]") !== null) return () => {};
			const style = document.createElement("style");
			style.dataset.plugin = "dsh-git";
			style.textContent = STYLES;
			document.head.appendChild(style);
			return () => {
				style.remove();
			};
		}
		function createSessionId() {
			return `dsh-git-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
		}
		async function waitForSession(sessions, sessionId) {
			for (let attempt = 0; attempt < 80; attempt += 1) {
				const binding = sessions.binding(sessionId);
				if (binding !== void 0) return binding;
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
		}
		/** Mount the browser graph view and its process-local persistent repository. */
		function apply(ctx) {
			const sessions = ctx.sessions;
			const repository = new GraphRepository(typeof localStorage === "undefined" ? void 0 : localStorage);
			ctx.effect(installStyles, "dsh-git: stylesheet");
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "dsh-git",
				order: 20,
				label: "分支",
				inject: (sessionId) => ({
					hooks: { graph: repository },
					syncTurns: (turns) => repository.syncSession(sessionId, turns),
					toggleContext: (nodeId) => repository.toggleContext(nodeId),
					moveContext: (nodeId, beforeId) => repository.moveContext(nodeId, beforeId),
					moveContextToEnd: (nodeId) => repository.moveContextToEnd(nodeId),
					clearContext: () => repository.clearContext(),
					checkout: (nodeId) => {
						const node = repository.getSnapshot().nodes[nodeId];
						if (node !== void 0) sessions.open(node.sessionId);
					},
					renameBranch: (branchId, branchName) => repository.renameBranch(branchId, branchName),
					ask: async (question, manifest) => {
						const state = repository.getSnapshot();
						const selected = manifest.flatMap((nodeId) => state.nodes[nodeId] === void 0 ? [] : [state.nodes[nodeId]]);
						if (selected.length === 0) throw new Error("请先选择至少一个 PA 节点。");
						const base = [...selected].sort((left, right) => left.createdAt - right.createdAt)[0];
						const primaryParentId = state.headNodeId !== null && manifest.includes(state.headNodeId) ? state.headNodeId : manifest.at(-1) ?? null;
						const source = sessions.binding(base.sessionId)?.session;
						if (source === void 0) throw new Error("无法访问用于创建 merge branch 的来源 session。");
						const childSessionId = createSessionId();
						const payload = encodeCreateMergedSessionPayload({
							targetSessionId: childSessionId,
							sources: selected.map((node) => ({
								sourceSessionId: node.sessionId,
								sourceTurn: node.turn,
								sourceBoundarySeq: node.boundarySeq
							}))
						});
						const command = await source.command(`/${CREATE_MERGED_SESSION_COMMAND} ${payload}`);
						if (!command.ok) throw new Error(`创建 merge branch 失败：${command.error.message}`);
						if (!command.value.matched) throw new Error("Host 未加载 dsh-git 历史合成命令，请重启 dsh。");
						repository.prepareBranch({
							sourceSessionId: base.sessionId,
							childSessionId,
							baseNodeId: base.id,
							importedNodeIds: manifest,
							parentIds: manifest,
							primaryParentId,
							contextManifest: manifest,
							prompt: question.trim()
						});
						const binding = await waitForSession(sessions, childSessionId);
						if (binding === void 0) {
							repository.abortPending(childSessionId);
							throw new Error("新 branch 已在 Host 创建，但浏览器没有收到对应 session。");
						}
						sessions.open(childSessionId);
						const result = await binding.session.prompt([{
							type: "text",
							text: question.trim()
						}], "queue");
						if (!result.ok) {
							repository.abortPending(childSessionId);
							throw new Error(`新 branch 提问失败：${result.error.message}`);
						}
					}
				})
			}, GraphView));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map