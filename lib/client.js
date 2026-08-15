window.__ModuleLoader__.load({
	id: "dsh-git",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_dom_client = require("react-dom/client");
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
		//#region lib/types/client/labels.js
		/** Assign the same creation-order PA number everywhere the graph is rendered. */
		function nodeLabelMap(state) {
			const labels = /* @__PURE__ */ new Map();
			const nodes = orderedNodes(state);
			for (const [index, node] of nodes.filter((candidate) => candidate.forkSourceId === void 0).entries()) labels.set(node.id, `PA${index + 1}`);
			for (const node of nodes) {
				if (node.forkSourceId === void 0) continue;
				labels.set(node.id, `${labels.get(node.forkSourceId) ?? "PA"} fork`);
			}
			return labels;
		}
		/** Short display hash kept out of primary node labels and shown only in the inspector. */
		function nodeHash(nodeId) {
			return nodeId.startsWith("pa-") ? `PA-${nodeId.slice(-5)}` : nodeId;
		}
		//#endregion
		//#region lib/types/client/i18n.js
		let source;
		const fallback = Object.freeze({
			active: "zh",
			revision: 0
		});
		/** Connect UI copy to DSH's single locale preference source. */
		function installLocaleSource(next) {
			source = next;
			return () => {
				if (source === next) source = void 0;
			};
		}
		function snapshot() {
			return source?.getSnapshot() ?? fallback;
		}
		function subscribe(listener) {
			return source?.subscribe(listener) ?? (() => {});
		}
		function getLocale() {
			return snapshot().active === "en" ? "en-US" : "zh-CN";
		}
		function useLocale() {
			return (0, react.useSyncExternalStore)(subscribe, snapshot, () => fallback).active === "en" ? "en-US" : "zh-CN";
		}
		function localized(zh, en, value = getLocale()) {
			return value === "zh-CN" ? zh : en;
		}
		//#endregion
		//#region lib/types/client/ContextTray.js
		/** Draggable ordered context selection and branch-creating prompt composer. */
		function ContextTray({ state, busy, error, onMove, onMoveEnd, onRemove, onClear, onAsk }) {
			const locale = useLocale();
			const [question, setQuestion] = (0, react.useState)("");
			const [dragging, setDragging] = (0, react.useState)(null);
			const missing = missingDirectDependencies(state, state.contextManifest);
			const labels = nodeLabelMap(state);
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
								localized("约", "About", locale),
								" ",
								estimateTokens(state, state.contextManifest),
								" tokens · ",
								localized("可拖动排序", "drag to reorder", locale)
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
							children: localized("在上方分叉图中勾选 PA 节点", "Select PA nodes in the graph above", locale)
						}) : state.contextManifest.map((nodeId) => {
							const node = state.nodes[nodeId];
							if (node === void 0) return null;
							const label = labels.get(nodeId) ?? "PA";
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
									label,
									(0, react_jsx_runtime.jsx)("button", {
										type: "button",
										"aria-label": localized(`移除 ${label}`, `Remove ${label}`, locale),
										onClick: () => onRemove(nodeId),
										children: "×"
									})
								]
							}, nodeId);
						})
					}),
					missing.length > 0 ? (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-git-warning",
						children: localized(`自由选择模式：${missing.map((id) => labels.get(id) ?? "PA").join("、")} 未加入；模型只接收 Tray 中列出的 PA。`, `Free selection: ${missing.map((id) => labels.get(id) ?? "PA").join(", ")} not included; the model receives only the PAs listed in the Tray.`, locale)
					}) : null,
					(0, react_jsx_runtime.jsx)("textarea", {
						className: "dsh-git-question",
						value: question,
						disabled: busy,
						placeholder: localized("输入下一个问题；提交后会自动建立新的 merge branch…", "Enter your next question; submitting creates a new merge branch…", locale),
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
							children: localized("清空", "Clear", locale)
						}), (0, react_jsx_runtime.jsx)("button", {
							className: "dsh-git-button dsh-git-button-primary",
							type: "button",
							disabled: !canAsk,
							onClick: () => {
								submit().catch(() => {});
							},
							children: busy ? localized("正在创建 branch…", "Creating branch…", locale) : localized("创建 merge branch 并提问 →", "Create merge branch and ask →", locale)
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
		function GraphCanvas({ state, previewNodeId, onPreview, labels: suppliedLabels, nodeColors, fit = true }) {
			const locale = useLocale();
			const viewportRef = (0, react.useRef)(null);
			const [viewport, setViewport] = (0, react.useState)({
				width: 0,
				height: 0
			});
			const layout = (0, react.useMemo)(() => layoutTree(state), [state]);
			const automaticLabels = (0, react.useMemo)(() => nodeLabelMap(state), [state]);
			const labels = suppliedLabels ?? automaticLabels;
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
				children: localized("完成第一轮对话后，这里会出现第一条 branch。", "The first branch will appear here after you complete a conversation turn.", locale)
			});
			const availableWidth = Math.max(0, viewport.width - 24);
			const availableHeight = Math.max(0, viewport.height - 24);
			const scale = !fit || viewport.width === 0 || viewport.height === 0 ? 1 : Math.min(1, availableWidth / layout.width, availableHeight / layout.height);
			const fittedWidth = layout.width * scale;
			const fittedHeight = layout.height * scale;
			return (0, react_jsx_runtime.jsx)("div", {
				ref: viewportRef,
				className: `dsh-git-tree-viewport ${fit ? "" : "dsh-git-tree-viewport-scroll"}`,
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
									height: NODE_HEIGHT,
									"--dsh-git-node-color": nodeColors === void 0 ? void 0 : `var(--dsh-git-session-${nodeColors.get(node.id) ?? 0})`
								},
								title: `${label}: ${node.prompt || localized("（无文字问题）", "(No text prompt)", locale)}`,
								"aria-label": localized(`查看 ${label} context`, `View ${label} context`, locale),
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
		function BranchControls({ branchId, name, current, onCheckout, onRename, locale }) {
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
					"aria-label": localized("Branch 名称", "Branch name", locale),
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
					children: current ? localized("当前 HEAD", "Current HEAD", locale) : localized("切换到此分支", "Switch to this branch", locale)
				})]
			});
		}
		/** Complete graph view registered as one conversation tab. */
		function GraphView({ useSession, useGraph, syncTurns, toggleContext, moveContext, moveContextToEnd, clearContext, checkout, renameBranch, ask }) {
			const locale = useLocale();
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
			const labels = (0, react.useMemo)(() => nodeLabelMap(state), [state]);
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
								children: localized("点击节点查看 Context · 虚线为 merge", "Click a node to view Context · dashed lines are merges", locale)
							})]
						}), (0, react_jsx_runtime.jsx)(GraphCanvas, {
							state,
							previewNodeId: inspectedNodeId,
							onPreview: setInspectedNodeId
						})]
					}), inspected === void 0 ? null : (0, react_jsx_runtime.jsxs)("aside", {
						className: "dsh-git-panel",
						"aria-label": localized("节点 Context", "Node Context", locale),
						children: [(0, react_jsx_runtime.jsxs)("header", {
							className: "dsh-git-heading",
							children: [(0, react_jsx_runtime.jsxs)("span", { children: [labels.get(inspected.id) ?? "PA", " Context"] }), (0, react_jsx_runtime.jsx)("button", {
								className: "dsh-git-close",
								type: "button",
								"aria-label": localized("关闭节点 Context", "Close Node Context", locale),
								onClick: () => setInspectedNodeId(null),
								children: "×"
							})]
						}), (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-git-inspector",
							children: [
								(0, react_jsx_runtime.jsx)("h3", { children: inspected.prompt || localized("（无文字问题）", "(No text prompt)", locale) }),
								(0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-git-node-hash",
									children: [(0, react_jsx_runtime.jsx)("span", { children: "HASH" }), (0, react_jsx_runtime.jsx)("code", { children: nodeHash(inspected.id) })]
								}),
								inspectedBranch === void 0 ? null : (0, react_jsx_runtime.jsx)(BranchControls, {
									branchId: inspectedBranch.id,
									name: inspectedBranch.name,
									current: inspected.id === state.headNodeId,
									locale,
									onCheckout: () => checkout(inspected.id),
									onRename: renameBranch
								}, inspectedBranch.id),
								(0, react_jsx_runtime.jsx)("button", {
									className: "dsh-git-button",
									type: "button",
									onClick: () => toggleContext(inspected.id),
									children: state.contextManifest.includes(inspected.id) ? localized("从 Context Tray 移除", "Remove from Context Tray", locale) : localized("加入 Context Tray", "Add to Context Tray", locale)
								}),
								(0, react_jsx_runtime.jsxs)("section", {
									className: "dsh-git-context-history",
									"aria-label": localized("回答时使用的 Context", "Context used for this answer", locale),
									children: [(0, react_jsx_runtime.jsx)("span", {
										className: "dsh-git-message-label",
										children: localized("回答时使用的 CONTEXT", "CONTEXT USED FOR THIS ANSWER", locale)
									}), inspected.contextManifest.length === 0 ? (0, react_jsx_runtime.jsx)("div", {
										className: "dsh-git-muted",
										children: localized("该节点没有前置 Context。", "This node has no preceding Context.", locale)
									}) : (0, react_jsx_runtime.jsx)("ol", { children: inspected.contextManifest.map((nodeId) => {
										const contextNode = state.nodes[nodeId];
										if (contextNode === void 0) return null;
										return (0, react_jsx_runtime.jsxs)("li", { children: [(0, react_jsx_runtime.jsx)("strong", { children: labels.get(nodeId) ?? "PA" }), (0, react_jsx_runtime.jsx)("span", { children: contextNode.prompt || localized("（无文字问题）", "(No text prompt)", locale) })] }, nodeId);
									}) })]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-git-message",
									children: [(0, react_jsx_runtime.jsx)("span", {
										className: "dsh-git-message-label",
										children: "PROMPT"
									}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, { text: inspected.prompt || localized("（无文字问题）", "(No text prompt)", locale) })]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-git-message",
									children: [(0, react_jsx_runtime.jsx)("span", {
										className: "dsh-git-message-label",
										children: "ANSWER"
									}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, { text: inspected.answer || localized("（没有文字回答）", "(No text answer)", locale) })]
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-git-muted",
									children: [
										localized("父节点", "parents", locale),
										": ",
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
		//#region lib/types/graph-state.js
		/**
		* The durable conversation-graph ledger, shared by both bundle halves.
		*
		* Types only — the Host owns the storage domain and its zod schemas
		* (`./graph-domain.ts`), the browser owns the observable repository
		* (`./client/repository.ts`), and neither may pull the other's runtime in.
		*/
		/** The ledger a scope starts from before its first completed turn. */
		const EMPTY_GRAPH_STATE = {
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
		//#endregion
		//#region lib/types/protocol.js
		const CREATE_MERGED_SESSION_COMMAND = "dsh-git-create-merged-session";
		/** Generic Connection channel and endpoint used by the project graph reader. */
		const PROJECT_GRAPH_RPC_CHANNEL = "/dsh-git";
		const PROJECT_GRAPH_RPC_ENDPOINT = "workspace/graph";
		/** Endpoints backing the Host-owned graph ledger. */
		const GRAPH_READ_ENDPOINT = "graph/read";
		const GRAPH_WRITE_ENDPOINT = "graph/write";
		function object(value, label) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
			return value;
		}
		function nonBlank(value, label) {
			if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-blank string`);
			return value;
		}
		function nonNegativeInteger(value, label) {
			if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
			return value;
		}
		/** Validate seed-recovered merge lineage arriving across Connection. */
		function decodeMergeSources(value, label) {
			if (!Array.isArray(value)) throw new Error(`${label} mergeSources must be an array`);
			return value.map((raw, index) => {
				const source = object(raw, `${label} mergeSource ${index + 1}`);
				const positive = (candidate, field) => {
					const parsed = nonNegativeInteger(candidate, `${label} mergeSource ${index + 1} ${field}`);
					if (parsed < 1) throw new Error(`${label} mergeSource ${index + 1} ${field} must be positive`);
					return parsed;
				};
				return {
					sourceSessionId: nonBlank(source.sourceSessionId, `${label} mergeSource ${index + 1} sourceSessionId`),
					sourceTurn: positive(source.sourceTurn, "sourceTurn"),
					sourceBoundarySeq: nonNegativeInteger(source.sourceBoundarySeq, `${label} mergeSource ${index + 1} sourceBoundarySeq`),
					targetTurn: positive(source.targetTurn, "targetTurn")
				};
			});
		}
		/** Validate the ledger-read response envelope received across Connection. */
		function decodeGraphReadResponse(value) {
			const candidate = object(value, "dsh-git graph read response");
			const state = candidate.state;
			if (state !== null && (typeof state !== "object" || Array.isArray(state))) throw new Error("dsh-git graph read response state must be an object or null");
			return {
				scopeId: nonBlank(candidate.scopeId, "scopeId"),
				state
			};
		}
		/** Strictly validate the project graph response received across Connection. */
		function decodeProjectGraphResponse(value) {
			const candidate = object(value, "dsh-git project graph response");
			const workspaceId = nonBlank(candidate.workspaceId, "workspaceId");
			if (!Array.isArray(candidate.sessions)) throw new Error("sessions must be an array");
			return {
				workspaceId,
				sessions: candidate.sessions.map((rawSession, sessionIndex) => {
					const session = object(rawSession, `session ${sessionIndex + 1}`);
					const sessionId = nonBlank(session.sessionId, `session ${sessionIndex + 1} sessionId`);
					const createdAt = nonNegativeInteger(session.createdAt, `session ${sessionIndex + 1} createdAt`);
					const seedLength = nonNegativeInteger(session.seedLength, `session ${sessionIndex + 1} seedLength`);
					const parentSessionId = session.parentSessionId === void 0 ? void 0 : nonBlank(session.parentSessionId, `session ${sessionIndex + 1} parentSessionId`);
					if (!Array.isArray(session.turns)) throw new Error(`session ${sessionIndex + 1} turns must be an array`);
					const turns = session.turns.map((rawTurn, turnIndex) => {
						const turn = object(rawTurn, `session ${sessionIndex + 1} turn ${turnIndex + 1}`);
						const turnNumber = nonNegativeInteger(turn.turn, `session ${sessionIndex + 1} turn number`);
						if (turnNumber < 1) throw new Error(`session ${sessionIndex + 1} turn number must be positive`);
						if (typeof turn.prompt !== "string" || typeof turn.answer !== "string") throw new Error(`session ${sessionIndex + 1} turn ${turnIndex + 1} text must be strings`);
						if (typeof turn.inherited !== "boolean") throw new Error(`session ${sessionIndex + 1} turn ${turnIndex + 1} inherited must be boolean`);
						return {
							turn: turnNumber,
							prompt: turn.prompt,
							answer: turn.answer,
							startedAt: nonNegativeInteger(turn.startedAt, `session ${sessionIndex + 1} turn ${turnIndex + 1} startedAt`),
							completedAt: nonNegativeInteger(turn.completedAt, `session ${sessionIndex + 1} turn ${turnIndex + 1} completedAt`),
							boundarySeq: nonNegativeInteger(turn.boundarySeq, `session ${sessionIndex + 1} turn ${turnIndex + 1} boundarySeq`),
							inherited: turn.inherited,
							fingerprint: nonBlank(turn.fingerprint, `session ${sessionIndex + 1} turn ${turnIndex + 1} fingerprint`)
						};
					});
					const mergeSources = session.mergeSources === void 0 ? void 0 : decodeMergeSources(session.mergeSources, `session ${sessionIndex + 1}`);
					return {
						sessionId,
						createdAt,
						...parentSessionId === void 0 ? {} : { parentSessionId },
						seedLength,
						...mergeSources === void 0 ? {} : { mergeSources },
						turns
					};
				})
			};
		}
		/** Encode the small JSON payload without exposing selected conversation text in the command log. */
		function encodeCreateMergedSessionPayload(payload) {
			return encodeURIComponent(JSON.stringify(payload));
		}
		//#endregion
		//#region lib/types/client/graph-transport.js
		function normalize(state) {
			if (state === null || typeof state !== "object") return EMPTY_GRAPH_STATE;
			const candidate = state;
			if (candidate.format !== 1) return EMPTY_GRAPH_STATE;
			return {
				...EMPTY_GRAPH_STATE,
				...candidate
			};
		}
		/**
		* Bind the ledger endpoints to a Connection.
		*
		* Writes are serialized per scope: the repository commits synchronously to
		* memory and hands the resulting snapshot here, so two overlapping calls would
		* otherwise be free to land on the medium out of order and leave the durable
		* ledger behind the one on screen.
		*/
		function connectionGraphTransport(connection) {
			const chains = /* @__PURE__ */ new Map();
			return {
				async read(scopeId) {
					const result = await connection.rpc.call(PROJECT_GRAPH_RPC_CHANNEL, GRAPH_READ_ENDPOINT, { scopeId });
					if (!result.ok) throw new Error(result.error.message);
					return normalize(decodeGraphReadResponse(result.value).state);
				},
				write(scopeId, state) {
					const next = (chains.get(scopeId) ?? Promise.resolve()).then(async () => {
						const result = await connection.rpc.call(PROJECT_GRAPH_RPC_CHANNEL, GRAPH_WRITE_ENDPOINT, {
							scopeId,
							state
						});
						if (!result.ok) throw new Error(result.error.message);
					});
					chains.set(scopeId, next.catch(() => void 0));
					return next;
				}
			};
		}
		//#endregion
		//#region lib/types/client/project-graph.js
		/** Pure assembly of a complete Workspace history into one read-only PA DAG. */
		function deterministicNodeId(sessionId, turn) {
			return `project-pa:${encodeURIComponent(sessionId)}:${turn}`;
		}
		function branchId(sessionId) {
			return `project-branch:${encodeURIComponent(sessionId)}`;
		}
		function forkNodeId(sessionId, turn) {
			return `project-fork:${encodeURIComponent(sessionId)}:${turn}`;
		}
		function exactFingerprintCandidates(addresses, local) {
			const candidates = /* @__PURE__ */ new Map();
			for (const { session, turn } of addresses) {
				if (turn.inherited) continue;
				const localId = local.sessionTurnRefs[session.sessionId]?.[turn.turn];
				const id = localId !== void 0 && local.nodes[localId] !== void 0 ? localId : deterministicNodeId(session.sessionId, turn.turn);
				candidates.set(turn.fingerprint, [...candidates.get(turn.fingerprint) ?? [], id]);
			}
			return candidates;
		}
		function titleOf(sessionId, titles) {
			return titles[sessionId]?.trim() || sessionId;
		}
		/** Assemble and deduplicate the project history without mutating the persistent graph repository. */
		function assembleProjectGraph(response, local, titles = {}) {
			const sessions = [...response.sessions].sort((left, right) => left.createdAt - right.createdAt || left.sessionId.localeCompare(right.sessionId));
			const addresses = sessions.flatMap((session) => session.turns.map((turn) => ({
				session,
				turn
			})));
			const candidates = exactFingerprintCandidates(addresses, local);
			const canonical = /* @__PURE__ */ new Map();
			const addressKey = (sessionId, turn) => `${sessionId}\u0000${turn}`;
			const sessionsById = new Map(sessions.map((session) => [session.sessionId, session]));
			const resolving = /* @__PURE__ */ new Set();
			const ordinaryForkTips = /* @__PURE__ */ new Map();
			for (const session of sessions) {
				if (session.parentSessionId === void 0) continue;
				const parent = sessionsById.get(session.parentSessionId);
				const inherited = session.turns.filter((turn) => turn.inherited);
				if (parent === void 0 || inherited.length === 0) continue;
				if (inherited.every((turn) => parent.turns.some((candidate) => candidate.turn === turn.turn && candidate.fingerprint === turn.fingerprint))) ordinaryForkTips.set(session.sessionId, inherited.at(-1).turn);
			}
			const resolveCanonical = (session, turn) => {
				const key = addressKey(session.sessionId, turn.turn);
				const cached = canonical.get(key);
				if (cached !== void 0) return cached;
				const localId = local.sessionTurnRefs[session.sessionId]?.[turn.turn];
				if (turn.inherited && session.parentSessionId !== void 0 && !resolving.has(key)) {
					const parent = sessionsById.get(session.parentSessionId);
					const parentTurn = parent?.turns.find((candidate) => candidate.turn === turn.turn && candidate.fingerprint === turn.fingerprint);
					if (parent !== void 0 && parentTurn !== void 0) {
						resolving.add(key);
						const parentId = resolveCanonical(parent, parentTurn);
						resolving.delete(key);
						const id = ordinaryForkTips.get(session.sessionId) === turn.turn ? forkNodeId(session.sessionId, turn.turn) : parentId;
						canonical.set(key, id);
						return id;
					}
				}
				if (localId !== void 0 && local.nodes[localId] !== void 0) {
					canonical.set(key, localId);
					return localId;
				}
				const matches = candidates.get(turn.fingerprint) ?? [];
				const id = turn.inherited && matches.length === 1 ? matches[0] : deterministicNodeId(session.sessionId, turn.turn);
				canonical.set(key, id);
				return id;
			};
			for (const { session, turn } of addresses) resolveCanonical(session, turn);
			const nodes = {};
			const branches = {};
			const sessionBranches = {};
			const sessionTurnRefs = {};
			for (const session of sessions) {
				const sid = session.sessionId;
				const bid = branchId(sid);
				sessionBranches[sid] = bid;
				const refs = {};
				let previousId = null;
				let firstOwn = true;
				for (const turn of [...session.turns].sort((left, right) => left.turn - right.turn)) {
					const id = canonical.get(addressKey(sid, turn.turn));
					refs[turn.turn] = id;
					const localNode = local.nodes[id];
					if (nodes[id] === void 0) {
						const isForkMarker = id === forkNodeId(sid, turn.turn);
						const parentSession = session.parentSessionId === void 0 ? void 0 : sessionsById.get(session.parentSessionId);
						const parentTurn = isForkMarker ? parentSession?.turns.find((candidate) => candidate.turn === turn.turn && candidate.fingerprint === turn.fingerprint) : void 0;
						const forkSourceId = parentSession !== void 0 && parentTurn !== void 0 ? canonical.get(addressKey(parentSession.sessionId, parentTurn.turn)) : void 0;
						const forkSource = forkSourceId === void 0 ? void 0 : nodes[forkSourceId];
						const useLocalRelations = localNode !== void 0 && !isForkMarker && !ordinaryForkTips.has(sid);
						const primaryParentId = isForkMarker ? forkSource?.primaryParentId ?? null : useLocalRelations ? localNode.primaryParentId : previousId;
						const parentIds = isForkMarker ? primaryParentId === null ? [] : [primaryParentId] : useLocalRelations ? localNode.parentIds.filter((parentId) => local.nodes[parentId] !== void 0) : previousId === null ? [] : [previousId];
						nodes[id] = {
							id,
							sessionId: localNode?.sessionId ?? sid,
							turn: localNode?.turn ?? turn.turn,
							prompt: localNode?.prompt ?? turn.prompt,
							answer: localNode?.answer ?? turn.answer,
							createdAt: isForkMarker ? session.createdAt : localNode?.createdAt ?? turn.startedAt,
							completedAt: turn.completedAt,
							sessionCreatedAt: session.createdAt,
							sessionTitle: titleOf(localNode?.sessionId ?? sid, titles),
							firstInSession: !turn.inherited && firstOwn,
							fingerprint: turn.fingerprint,
							...forkSourceId === void 0 ? {} : { forkSourceId },
							boundarySeq: localNode?.boundarySeq ?? turn.boundarySeq,
							primaryParentId,
							parentIds,
							contextManifest: isForkMarker ? forkSource?.contextManifest ?? (primaryParentId === null ? [] : [primaryParentId]) : localNode?.contextManifest ?? (primaryParentId === null ? [] : [primaryParentId]),
							branchId: localNode?.branchId ?? bid
						};
					}
					if (!turn.inherited) firstOwn = false;
					previousId = id;
				}
				sessionTurnRefs[sid] = refs;
				const headId = session.turns.length === 0 ? null : refs[session.turns.at(-1).turn] ?? null;
				branches[bid] = {
					id: bid,
					name: titleOf(sid, titles),
					sessionId: sid,
					headId,
					color: Object.keys(branches).length % 8,
					createdAt: session.createdAt
				};
			}
			const provisional = {
				format: 1,
				nodes,
				branches,
				sessionBranches,
				sessionTurnRefs,
				pendingMerges: {},
				headNodeId: null,
				previewNodeId: null,
				contextManifest: []
			};
			for (const [id, node] of Object.entries(nodes)) {
				if (local.nodes[id] !== void 0) continue;
				nodes[id] = {
					...node,
					contextManifest: primaryPath(provisional, node.primaryParentId)
				};
			}
			const timeline = Object.values(nodes).filter((node) => node.forkSourceId === void 0).sort((left, right) => left.completedAt - right.completedAt || left.id.localeCompare(right.id)).map((node) => node.id);
			const headNodeId = timeline.at(-1) ?? null;
			return {
				state: {
					...provisional,
					nodes,
					headNodeId,
					previewNodeId: headNodeId
				},
				nodes,
				timeline,
				sessionCount: sessions.length
			};
		}
		/** Return the graph prefix visible at one one-based PA timeline position. */
		function projectGraphAt(model, count) {
			const timelineCount = Math.max(1, Math.min(count, model.timeline.length));
			const visibleIds = new Set(model.timeline.slice(0, timelineCount));
			const cutoff = model.nodes[model.timeline[timelineCount - 1] ?? ""]?.completedAt ?? Number.NEGATIVE_INFINITY;
			for (const node of Object.values(model.nodes)) if (node.forkSourceId !== void 0 && node.sessionCreatedAt <= cutoff) visibleIds.add(node.id);
			const nodes = Object.fromEntries(Object.entries(model.state.nodes).flatMap(([id, node]) => visibleIds.has(id) ? [[id, {
				...node,
				parentIds: node.parentIds.filter((parentId) => visibleIds.has(parentId)),
				primaryParentId: node.primaryParentId !== null && visibleIds.has(node.primaryParentId) ? node.primaryParentId : null,
				contextManifest: node.contextManifest.filter((nodeId) => visibleIds.has(nodeId))
			}]] : []));
			const headNodeId = model.timeline[Math.max(0, Math.min(count, model.timeline.length) - 1)] ?? null;
			return {
				...model.state,
				nodes,
				headNodeId,
				previewNodeId: null
			};
		}
		//#endregion
		//#region lib/types/client/ProjectGraphPage.js
		/** Project-level Conversation Graph takeover page with a Fusion-style PA timeline. */
		function formatTime(time, locale) {
			return new Intl.DateTimeFormat(locale, {
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
				hour12: false
			}).format(new Date(time));
		}
		/** Full takeover page mounted by the sidebar compatibility bridge. */
		function ProjectGraphPage({ workspaceId, workspaceTitle, sessionTitles, load, getLocalState, onClose, onOpenSession }) {
			const locale = useLocale();
			const [model, setModel] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [refreshKey, setRefreshKey] = (0, react.useState)(0);
			const [cursor, setCursor] = (0, react.useState)(1);
			const [inspectedId, setInspectedId] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				setError(null);
				load(controller.signal).then((response) => {
					if (controller.signal.aborted) return;
					const next = assembleProjectGraph(response, getLocalState(), sessionTitles);
					setModel(next);
					setCursor(Math.max(1, next.timeline.length));
					setInspectedId(null);
				}).catch((cause) => {
					if (controller.signal.aborted) return;
					setError(cause instanceof Error ? cause.message : String(cause));
				});
				return () => {
					controller.abort();
				};
			}, [
				workspaceId,
				refreshKey,
				load,
				getLocalState,
				sessionTitles
			]);
			(0, react.useEffect)(() => {
				const close = (event) => {
					if (event.key === "Escape") onClose();
				};
				window.addEventListener("keydown", close);
				return () => {
					window.removeEventListener("keydown", close);
				};
			}, [onClose]);
			const labels = (0, react.useMemo)(() => {
				const result = new Map(model?.timeline.map((id, index) => [id, `PA${index + 1}`]) ?? []);
				if (model === null) return result;
				for (const node of Object.values(model.nodes)) {
					if (node.forkSourceId === void 0) continue;
					result.set(node.id, `${result.get(node.forkSourceId) ?? "PA"} fork`);
				}
				return result;
			}, [model]);
			const nodeColors = (0, react.useMemo)(() => {
				const colors = /* @__PURE__ */ new Map();
				if (model === null) return colors;
				const sessions = /* @__PURE__ */ new Map();
				const nodes = Object.values(model.nodes).sort((left, right) => left.sessionCreatedAt - right.sessionCreatedAt || left.id.localeCompare(right.id));
				for (const node of nodes) {
					if (!sessions.has(node.sessionId)) sessions.set(node.sessionId, sessions.size % 8);
					colors.set(node.id, sessions.get(node.sessionId));
				}
				return colors;
			}, [model]);
			const visible = model === null || model.timeline.length === 0 ? null : projectGraphAt(model, cursor);
			const selectedId = model?.timeline[Math.max(0, cursor - 1)];
			const selected = selectedId === void 0 ? void 0 : model?.nodes[selectedId];
			const inspected = inspectedId === null ? void 0 : model?.nodes[inspectedId];
			return (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-git-project-page",
				role: "dialog",
				"aria-label": `${workspaceTitle} Conversation Graph`,
				children: [
					(0, react_jsx_runtime.jsxs)("header", {
						className: "dsh-git-project-header",
						children: [(0, react_jsx_runtime.jsxs)("div", { children: [(0, react_jsx_runtime.jsx)("h1", { children: workspaceTitle }), (0, react_jsx_runtime.jsx)("span", { children: "Conversation Graph" })] }), (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-git-project-summary",
							children: [
								(0, react_jsx_runtime.jsxs)("span", { children: [model?.sessionCount ?? 0, " Sessions"] }),
								(0, react_jsx_runtime.jsxs)("span", { children: [model?.timeline.length ?? 0, " PA"] }),
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: () => {
										setModel(null);
										setRefreshKey((value) => value + 1);
									},
									children: localized("刷新", "Refresh", locale)
								}),
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									"aria-label": localized("关闭项目 Conversation Graph", "Close project Conversation Graph", locale),
									onClick: onClose,
									children: "×"
								})
							]
						})]
					}),
					model === null ? (0, react_jsx_runtime.jsxs)("main", {
						className: "dsh-git-project-status",
						role: error === null ? "status" : "alert",
						children: [(0, react_jsx_runtime.jsx)("p", { children: error ?? localized("正在读取项目中的全部 Session…", "Loading all Sessions in this project…", locale) }), error === null ? null : (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => {
								setModel(null);
								setRefreshKey((value) => value + 1);
							},
							children: localized("重试", "Retry", locale)
						})]
					}) : model.timeline.length === 0 ? (0, react_jsx_runtime.jsx)("main", {
						className: "dsh-git-project-status",
						children: (0, react_jsx_runtime.jsx)("p", { children: localized("这个项目还没有已完成的 PA。", "This project has no completed PAs yet.", locale) })
					}) : (0, react_jsx_runtime.jsxs)("main", {
						className: `dsh-git-project-main ${inspected === void 0 ? "" : "dsh-git-project-main-open"}`,
						children: [(0, react_jsx_runtime.jsx)("section", {
							className: "dsh-git-project-canvas",
							"aria-label": localized("项目 Conversation Graph", "Project Conversation Graph", locale),
							children: (0, react_jsx_runtime.jsx)(GraphCanvas, {
								state: visible,
								previewNodeId: inspectedId,
								onPreview: setInspectedId,
								labels,
								nodeColors,
								fit: false
							})
						}), inspected === void 0 ? null : (0, react_jsx_runtime.jsxs)("aside", {
							className: "dsh-git-project-inspector",
							"aria-label": localized("项目 PA 详情", "Project PA details", locale),
							children: [(0, react_jsx_runtime.jsxs)("header", { children: [(0, react_jsx_runtime.jsxs)("strong", { children: [
								labels.get(inspected.id) ?? "PA",
								" · ",
								inspected.sessionTitle
							] }), (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								"aria-label": localized("关闭 PA 详情", "Close PA details", locale),
								onClick: () => setInspectedId(null),
								children: "×"
							})] }), (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-git-project-inspector-body",
								children: [
									(0, react_jsx_runtime.jsxs)("dl", { children: [
										(0, react_jsx_runtime.jsxs)("div", { children: [(0, react_jsx_runtime.jsx)("dt", { children: "Session" }), (0, react_jsx_runtime.jsx)("dd", { children: inspected.sessionTitle })] }),
										(0, react_jsx_runtime.jsxs)("div", { children: [(0, react_jsx_runtime.jsx)("dt", { children: "Session ID" }), (0, react_jsx_runtime.jsx)("dd", { children: (0, react_jsx_runtime.jsx)("code", { children: inspected.sessionId }) })] }),
										(0, react_jsx_runtime.jsxs)("div", { children: [(0, react_jsx_runtime.jsx)("dt", { children: localized("轮次", "Turn", locale) }), (0, react_jsx_runtime.jsx)("dd", { children: inspected.turn })] }),
										(0, react_jsx_runtime.jsxs)("div", { children: [(0, react_jsx_runtime.jsx)("dt", { children: localized("PA 完成", "PA completed", locale) }), (0, react_jsx_runtime.jsx)("dd", { children: formatTime(inspected.completedAt, locale) })] }),
										(0, react_jsx_runtime.jsxs)("div", { children: [(0, react_jsx_runtime.jsx)("dt", { children: localized("Session 创建", "Session created", locale) }), (0, react_jsx_runtime.jsx)("dd", { children: formatTime(inspected.sessionCreatedAt, locale) })] })
									] }),
									(0, react_jsx_runtime.jsxs)("section", {
										className: "dsh-git-message",
										children: [(0, react_jsx_runtime.jsx)("span", {
											className: "dsh-git-message-label",
											children: "PROMPT"
										}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, { text: inspected.prompt || localized("（无文字问题）", "(No text prompt)", locale) })]
									}),
									(0, react_jsx_runtime.jsxs)("section", {
										className: "dsh-git-message",
										children: [(0, react_jsx_runtime.jsx)("span", {
											className: "dsh-git-message-label",
											children: "ANSWER"
										}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, { text: inspected.answer || localized("（没有文字回答）", "(No text answer)", locale) })]
									}),
									(0, react_jsx_runtime.jsxs)("section", {
										className: "dsh-git-context-history",
										children: [(0, react_jsx_runtime.jsx)("span", {
											className: "dsh-git-message-label",
											children: "CONTEXT"
										}), inspected.contextManifest.length === 0 ? (0, react_jsx_runtime.jsx)("span", {
											className: "dsh-git-muted",
											children: localized("没有前置 Context", "No preceding Context", locale)
										}) : (0, react_jsx_runtime.jsx)("ol", { children: inspected.contextManifest.map((id) => (0, react_jsx_runtime.jsx)("li", { children: labels.get(id) ?? id }, id)) })]
									}),
									(0, react_jsx_runtime.jsx)("button", {
										className: "dsh-git-button dsh-git-button-primary",
										type: "button",
										onClick: () => onOpenSession(inspected.sessionId),
										children: localized("打开原会话", "Open source Session", locale)
									})
								]
							})]
						})]
					}),
					model === null || model.timeline.length === 0 ? null : (0, react_jsx_runtime.jsxs)("footer", {
						className: "dsh-git-timeline",
						"aria-label": localized("PA 时间轴", "PA timeline", locale),
						children: [(0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-git-timeline-readout",
							children: [
								(0, react_jsx_runtime.jsx)("strong", { children: labels.get(selectedId) }),
								(0, react_jsx_runtime.jsx)("span", { children: selected?.sessionTitle }),
								(0, react_jsx_runtime.jsx)("time", { children: selected === void 0 ? "" : formatTime(selected.completedAt, locale) })
							]
						}), (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-git-timeline-controls",
							children: [
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									"aria-label": localized("上一个 PA", "Previous PA", locale),
									disabled: cursor <= 1,
									onClick: () => setCursor((value) => Math.max(1, value - 1)),
									children: "‹"
								}),
								(0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-git-timeline-track",
									children: [(0, react_jsx_runtime.jsx)("div", {
										className: "dsh-git-timeline-session-marks",
										"aria-hidden": "true",
										children: model.timeline.map((id, index) => model.nodes[id]?.firstInSession ? (0, react_jsx_runtime.jsx)("span", { style: { left: `${model.timeline.length === 1 ? 0 : index / (model.timeline.length - 1) * 100}%` } }, id) : null)
									}), (0, react_jsx_runtime.jsx)("input", {
										type: "range",
										min: 1,
										max: model.timeline.length,
										step: 1,
										value: cursor,
										"aria-label": localized("PA 时间轴游标", "PA timeline cursor", locale),
										"aria-valuetext": `${labels.get(selectedId)} ${selected?.sessionTitle ?? ""}`,
										onChange: (event) => {
											setCursor(Number(event.currentTarget.value));
											setInspectedId(null);
										}
									})]
								}),
								(0, react_jsx_runtime.jsx)("button", {
									type: "button",
									"aria-label": localized("下一个 PA", "Next PA", locale),
									disabled: cursor >= model.timeline.length,
									onClick: () => setCursor((value) => Math.min(model.timeline.length, value + 1)),
									children: "›"
								})
							]
						})]
					})
				]
			});
		}
		//#endregion
		//#region lib/types/client/project-bridge.js
		/** DOM compatibility bridge for project-row buttons and the main-area takeover page. */
		const BUTTON_ATTRIBUTE = "data-dsh-git-project-button";
		const HOST_ATTRIBUTE = "data-dsh-git-project-host";
		function graphIcon() {
			return "<svg viewBox=\"0 0 16 16\" width=\"16\" height=\"16\" aria-hidden=\"true\"><path d=\"M3 3.5h3v3H3zM10 2h3v3h-3zM10 10h3v3h-3zM5.7 4.5h4.6M11.5 5v5M5.5 6.3l5 4.2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.25\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>";
		}
		function workspaceRow(workspace, used) {
			return [...document.querySelectorAll("[role=\"treeitem\"][aria-expanded]")].find((row) => !used.has(row) && row.querySelectorAll("button").length >= 2 && [...row.querySelectorAll("span")].some((span) => span.textContent?.trim() === workspace.title));
		}
		function sessionTitles(sessions) {
			const snapshot = sessions.list.getSnapshot();
			return Object.fromEntries(snapshot.ids.flatMap((id) => {
				const summary = snapshot.byId[id];
				return summary === void 0 ? [] : [[id, summary.displayTitle]];
			}));
		}
		/** Install the isolated compatibility layer and return its complete disposer. */
		function installProjectBridge(services) {
			let active = null;
			const close = () => {
				if (active === null) return;
				const page = active;
				active = null;
				page.root.unmount();
				page.container.remove();
				page.owner.classList.remove("dsh-git-project-host-open");
			};
			const open = (workspace) => {
				close();
				const owner = document.querySelector("[data-conversation-scroll]")?.parentElement;
				if (owner === null || owner === void 0) return;
				owner.classList.add("dsh-git-project-host-open");
				const container = document.createElement("div");
				container.setAttribute(HOST_ATTRIBUTE, workspace.workspaceId);
				owner.appendChild(container);
				const root = (0, react_dom_client.createRoot)(container);
				active = {
					container,
					owner,
					root
				};
				const repository = services.repositoryForWorkspace(workspace.workspaceId);
				const load = async (signal) => {
					const result = await services.connection.rpc.call(PROJECT_GRAPH_RPC_CHANNEL, PROJECT_GRAPH_RPC_ENDPOINT, { workspaceId: workspace.workspaceId }, signal);
					if (!result.ok) throw new Error(result.error.message);
					const response = decodeProjectGraphResponse(result.value);
					if (response.workspaceId !== workspace.workspaceId) throw new Error(localized("Host 返回了错误的 Workspace graph。", "The Host returned a graph for the wrong Workspace."));
					return response;
				};
				root.render((0, react_jsx_runtime.jsx)(ProjectGraphPage, {
					workspaceId: workspace.workspaceId,
					workspaceTitle: workspace.title,
					sessionTitles: sessionTitles(services.sessions),
					load,
					getLocalState: repository.getSnapshot,
					onClose: () => {
						queueMicrotask(close);
					},
					onOpenSession: (sessionId) => {
						queueMicrotask(() => {
							close();
							services.sessions.open(sessionId);
						});
					}
				}));
			};
			const scan = () => {
				const workspaces = services.workspaces.list.getSnapshot().items;
				const used = /* @__PURE__ */ new Set();
				for (const workspace of workspaces) {
					const row = workspaceRow(workspace, used);
					if (row === void 0) continue;
					used.add(row);
					const existing = row.querySelector(`[${BUTTON_ATTRIBUTE}]`);
					if (existing !== null && existing.getAttribute(BUTTON_ATTRIBUTE) === workspace.workspaceId) {
						existing.setAttribute("aria-label", localized(`打开“${workspace.title}”的 Conversation Graph`, `Open the Conversation Graph for “${workspace.title}”`));
						continue;
					}
					existing?.remove();
					const buttons = row.querySelectorAll("button");
					const anchor = buttons.item(buttons.length - 1);
					if (anchor === null) continue;
					const button = document.createElement("button");
					button.type = "button";
					button.className = anchor.className;
					button.setAttribute(BUTTON_ATTRIBUTE, workspace.workspaceId);
					button.setAttribute("aria-label", localized(`打开“${workspace.title}”的 Conversation Graph`, `Open the Conversation Graph for “${workspace.title}”`));
					button.title = "Conversation Graph";
					button.innerHTML = graphIcon();
					button.addEventListener("click", (event) => {
						event.preventDefault();
						event.stopPropagation();
						open(workspace);
					});
					anchor.before(button);
				}
			};
			let queued = false;
			const queueScan = () => {
				if (queued) return;
				queued = true;
				queueMicrotask(() => {
					queued = false;
					scan();
				});
			};
			const observer = new MutationObserver(queueScan);
			observer.observe(document.body, {
				childList: true,
				subtree: true
			});
			const unsubscribeWorkspaces = services.workspaces.list.subscribe(queueScan);
			const unsubscribeLocale = services.locale.subscribe(queueScan);
			scan();
			return () => {
				observer.disconnect();
				unsubscribeWorkspaces();
				unsubscribeLocale();
				close();
				document.querySelectorAll(`[${BUTTON_ATTRIBUTE}]`).forEach((button) => {
					button.remove();
				});
			};
		}
		//#endregion
		//#region lib/types/client/repository.js
		const EMPTY_STATE = EMPTY_GRAPH_STATE;
		function id(prefix) {
			return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
		}
		function distinct(ids) {
			return [...new Set(ids)];
		}
		function officialForkNodeId(sessionId, turn) {
			return `fork-${encodeURIComponent(sessionId)}-${turn}`;
		}
		/**
		* Observable owning one scope's conversation DAG, durable on the Host.
		*
		* Reads stay synchronous — React subscribes through `useSyncExternalStore` —
		* so every mutation lands in memory first and is pushed to the Host after.
		* Until {@link hydrate} resolves the repository holds the empty ledger and
		* defers mutations rather than applying them, because a `syncSession` that ran
		* against the empty state would mint fresh node ids for turns the Host already
		* knows and then overwrite the stored ledger with the duplicates.
		*/
		var GraphRepository = class {
			transport;
			scopeId;
			state = EMPTY_STATE;
			listeners = /* @__PURE__ */ new Set();
			hydrated = false;
			deferred = [];
			/**
			* @param transport - Host ledger access; omitted keeps an in-memory repository
			*   that is hydrated from the start (used by tests and by a Host that has not
			*   loaded the plugin's storage domain).
			* @param scopeId - the ledger's owning scope; omitted with a transport is invalid.
			*/
			constructor(transport, scopeId) {
				this.transport = transport;
				this.scopeId = scopeId;
				this.hydrated = transport === void 0 || scopeId === void 0;
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
			/** True once the Host ledger has landed and mutations apply immediately. */
			get ready() {
				return this.hydrated;
			}
			/**
			* Load this scope's stored ledger once, then release any deferred mutations.
			*
			* A failed read still opens the gate: the graph rebuilds itself from the
			* session logs the browser is already displaying, which is a better outcome
			* than a permanently frozen tab.
			*/
			async hydrate() {
				if (this.hydrated || this.transport === void 0 || this.scopeId === void 0) return;
				let loaded = EMPTY_STATE;
				try {
					loaded = await this.transport.read(this.scopeId);
				} finally {
					this.hydrated = true;
					this.state = loaded;
					const pending = this.deferred;
					this.deferred = [];
					for (const mutation of pending) mutation();
					for (const listener of this.listeners) listener();
				}
			}
			/** Apply one mutation now, or hold it until the Host ledger has landed. */
			run(mutation) {
				if (this.hydrated) mutation();
				else this.deferred.push(mutation);
			}
			commit(next) {
				this.state = next;
				if (this.transport !== void 0 && this.scopeId !== void 0) this.transport.write(this.scopeId, next).catch(() => void 0);
				for (const listener of this.listeners) listener();
			}
			/** Import completed turns from the currently viewed DSH session. */
			syncSession(sessionId, turns) {
				this.run(() => {
					this.syncSessionNow(sessionId, turns);
				});
			}
			syncSessionNow(sessionId, turns) {
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
			/** Collapse browser-imported copies from ordinary Host forks into one labeled fork point. */
			reconcileOfficialForks(parents) {
				this.run(() => {
					this.reconcileOfficialForksNow(parents);
				});
			}
			reconcileOfficialForksNow(parents) {
				let next = this.state;
				for (const [childSessionId, parentSessionId] of Object.entries(parents)) {
					if (childSessionId.startsWith("dsh-git-")) continue;
					const childRefs = next.sessionTurnRefs[childSessionId];
					const parentRefs = next.sessionTurnRefs[parentSessionId];
					if (childRefs === void 0 || parentRefs === void 0) continue;
					const prefix = [];
					for (const [rawTurn, childId] of Object.entries(childRefs).sort(([left], [right]) => Number(left) - Number(right))) {
						const turn = Number(rawTurn);
						const sourceId = parentRefs[turn];
						if (sourceId === void 0) break;
						const child = next.nodes[childId];
						const source = next.nodes[sourceId];
						if (child === void 0 || source === void 0 || child.prompt !== source.prompt || child.answer !== source.answer) break;
						prefix.push({
							turn,
							childId,
							sourceId
						});
					}
					const tip = prefix.at(-1);
					if (tip === void 0) continue;
					const branchId = next.sessionBranches[childSessionId];
					const branch = branchId === void 0 ? void 0 : next.branches[branchId];
					if (branchId === void 0 || branch === void 0) continue;
					const markerId = officialForkNodeId(childSessionId, tip.turn);
					const sourceTip = next.nodes[tip.sourceId];
					const remaining = Object.entries(childRefs).map(([turn, nodeId]) => ({
						turn: Number(turn),
						nodeId
					})).filter((entry) => entry.turn > tip.turn).sort((left, right) => left.turn - right.turn);
					const firstOwnCreatedAt = next.nodes[remaining[0]?.nodeId ?? ""]?.createdAt;
					const markerCreatedAt = firstOwnCreatedAt === void 0 ? sourceTip.createdAt + .001 : Math.max(sourceTip.createdAt + .001, firstOwnCreatedAt - .001);
					const marker = {
						...sourceTip,
						id: markerId,
						sessionId: childSessionId,
						turn: tip.turn,
						createdAt: markerCreatedAt,
						branchId,
						forkSourceId: tip.sourceId
					};
					const refs = {};
					const replacements = /* @__PURE__ */ new Map();
					for (const entry of prefix.slice(0, -1)) {
						refs[entry.turn] = entry.sourceId;
						replacements.set(entry.childId, entry.sourceId);
					}
					refs[tip.turn] = markerId;
					replacements.set(tip.childId, markerId);
					let nodes = {
						...next.nodes,
						[markerId]: marker
					};
					let previousId = markerId;
					for (const entry of remaining) {
						const node = nodes[entry.nodeId];
						if (node === void 0) continue;
						refs[entry.turn] = entry.nodeId;
						nodes[entry.nodeId] = {
							...node,
							primaryParentId: previousId,
							parentIds: [previousId],
							contextManifest: primaryPath({
								...next,
								nodes
							}, previousId)
						};
						previousId = entry.nodeId;
					}
					for (const entry of prefix) {
						if (entry.childId === entry.sourceId || entry.childId === markerId) continue;
						if (nodes[entry.childId]?.sessionId === childSessionId) delete nodes[entry.childId];
					}
					const replace = (nodeId) => replacements.get(nodeId) ?? nodeId;
					nodes = Object.fromEntries(Object.entries(nodes).map(([nodeId, node]) => [nodeId, {
						...node,
						primaryParentId: node.primaryParentId === null ? null : replace(node.primaryParentId),
						parentIds: distinct(node.parentIds.map(replace)),
						contextManifest: distinct(node.contextManifest.map(replace))
					}]));
					const contextManifest = distinct(next.contextManifest.map(replace)).filter((nodeId) => nodes[nodeId] !== void 0);
					next = {
						...next,
						nodes,
						branches: {
							...next.branches,
							[branchId]: {
								...branch,
								headId: previousId
							}
						},
						sessionTurnRefs: {
							...next.sessionTurnRefs,
							[childSessionId]: refs
						},
						headNodeId: next.headNodeId === null ? null : replace(next.headNodeId),
						previewNodeId: next.previewNodeId === null ? null : replace(next.previewNodeId),
						contextManifest
					};
				}
				if (JSON.stringify(next) !== JSON.stringify(this.state)) this.commit(next);
			}
			/** Record an auto-created child session before its first merged request completes. */
			prepareBranch(input) {
				this.run(() => {
					this.prepareBranchNow(input);
				});
			}
			prepareBranchNow(input) {
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
				this.run(() => {
					if (this.state.pendingMerges[sessionId] === void 0) return;
					const pendingMerges = { ...this.state.pendingMerges };
					delete pendingMerges[sessionId];
					this.commit({
						...this.state,
						pendingMerges
					});
				});
			}
			/** Toggle one node in the context tray; additions restore creation-time order. */
			toggleContext(nodeId) {
				this.run(() => {
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
				});
			}
			/** Remove all nodes from the next-request tray. */
			clearContext() {
				this.run(() => {
					this.commit({
						...this.state,
						contextManifest: []
					});
				});
			}
			/** Move one selected node before another selected node. */
			moveContext(nodeId, beforeId) {
				this.run(() => {
					if (nodeId === beforeId) return;
					const next = this.state.contextManifest.filter((id) => id !== nodeId);
					const index = next.indexOf(beforeId);
					if (index < 0 || !this.state.contextManifest.includes(nodeId)) return;
					next.splice(index, 0, nodeId);
					this.commit({
						...this.state,
						contextManifest: next
					});
				});
			}
			/** Move one selected node to the end of the tray. */
			moveContextToEnd(nodeId) {
				this.run(() => {
					if (!this.state.contextManifest.includes(nodeId)) return;
					this.commit({
						...this.state,
						contextManifest: [...this.state.contextManifest.filter((id) => id !== nodeId), nodeId]
					});
				});
			}
			/** Change only the preview selection. */
			preview(nodeId) {
				this.run(() => {
					if (this.state.nodes[nodeId] !== void 0) this.commit({
						...this.state,
						previewNodeId: nodeId
					});
				});
			}
			/** Rename a branch in the graph ledger. */
			renameBranch(branchId, name) {
				this.run(() => {
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
				});
			}
		};
		//#endregion
		//#region lib/types/client/workspace-repositories.js
		/**
		* Owns isolated graph ledgers and resolves the ledger for each Session.
		*
		* A scope id is the Host record key, so it must stay stable across sessions and
		* browsers: `workspace:<id>` for a folder member, `session:<id>` for a Session
		* that belongs to no folder.
		*/
		var WorkspaceGraphRepositories = class {
			workspaces;
			transport;
			repositories = /* @__PURE__ */ new Map();
			pendingSessionScopes = /* @__PURE__ */ new Map();
			constructor(workspaces, transport) {
				this.workspaces = workspaces;
				this.transport = transport;
			}
			/** Return the ledger owned by exactly one Workspace folder. */
			forWorkspace(workspaceId) {
				return this.forScope(`workspace:${workspaceId}`);
			}
			/** Resolve a Session through current Workspace membership, never through a global ledger. */
			forSession(sessionId) {
				const workspace = this.workspaces.list.getSnapshot().items.find((candidate) => candidate.sessionIds.some((id) => id === sessionId));
				if (workspace !== void 0) {
					const scope = `workspace:${workspace.workspaceId}`;
					this.pendingSessionScopes.set(sessionId, scope);
					return this.forScope(scope);
				}
				const pending = this.pendingSessionScopes.get(sessionId);
				return this.forScope(pending ?? `session:${sessionId}`);
			}
			/** Keep a newly-created branch in its source folder while membership frames arrive. */
			pinSession(sessionId, repository) {
				const entry = [...this.repositories.entries()].find(([, candidate]) => candidate === repository);
				if (entry !== void 0) this.pendingSessionScopes.set(sessionId, entry[0]);
			}
			forScope(scope) {
				const existing = this.repositories.get(scope);
				if (existing !== void 0) return existing;
				const repository = new GraphRepository(this.transport, scope);
				this.repositories.set(scope, repository);
				repository.hydrate();
				return repository;
			}
		};
		//#endregion
		//#region lib/types/client/styles.js
		/** Plugin-owned stylesheet using the Web surface semantic token vocabulary. */
		const STYLES = `
:root{--dsh-git-session-0:#4f7cff;--dsh-git-session-1:#9b6cff;--dsh-git-session-2:#00a889;--dsh-git-session-3:#e58a21;--dsh-git-session-4:#d95780;--dsh-git-session-5:#3b9dd8;--dsh-git-session-6:#72a83b;--dsh-git-session-7:#ad6b42}
.dsh-git-root{height:100%;width:100%;min-height:0;flex:1 1 0;display:grid;grid-template-rows:minmax(260px,1fr) auto;box-sizing:border-box;padding-bottom:calc(var(--dsh-composer-height,152px) + 16px);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);overflow:hidden}
.dsh-git-workbench{min-height:0;display:grid;grid-template-columns:minmax(0,1fr);border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-git-workbench-open{grid-template-columns:minmax(300px,36%) minmax(420px,1fr)}
.dsh-git-panel{min-width:0;min-height:0;overflow:hidden}
.dsh-git-workbench-open>aside.dsh-git-panel{height:100%;display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden}
.dsh-git-panel+.dsh-git-panel{border-left:1px solid var(--dsw-alias-border-l2)}
.dsh-git-heading{position:sticky;top:0;z-index:4;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;background:var(--dsw-alias-bg-base);border-bottom:1px solid var(--dsw-alias-border-l2);font:var(--dsw-font-s-strong-14)}
.dsh-git-muted{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xs-13)}
.dsh-git-tree-viewport{height:calc(100% - 49px);min-height:0;overflow:hidden;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box}
.dsh-git-tree-viewport-scroll{height:100%;overflow:auto;align-items:flex-start;justify-content:flex-start}
.dsh-git-tree-fit{position:relative;flex:none}
.dsh-git-tree-stage{position:absolute;left:0;top:0;transform-origin:top left}
.dsh-git-tree-svg{position:absolute;inset:0;pointer-events:none;overflow:visible}
.dsh-git-tree-edge{fill:none;stroke:var(--dsw-alias-line-secondary);stroke-width:1.5;opacity:.65}
.dsh-git-tree-edge-active{stroke:var(--dsw-static-deepseek-500);stroke-width:2;opacity:1}
.dsh-git-tree-edge-merge{stroke:var(--dsw-static-deepseek-200);stroke-width:2;stroke-dasharray:5 5;opacity:.9}
.dsh-git-tree-node{position:absolute;z-index:2;display:flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l3);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-strong-14);cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.dsh-git-tree-node[style*="--dsh-git-node-color"]{border-left:4px solid var(--dsh-git-node-color)}
.dsh-git-tree-node:hover{border-color:var(--dsw-static-deepseek-500);background:var(--dsw-alias-interactive-bg-hover);transform:translateY(-1px)}
.dsh-git-tree-node-preview{border-color:var(--dsw-static-deepseek-500);background:var(--dsw-alias-button-info-fill);box-shadow:0 0 0 2px var(--dsw-static-deepseek-200)}
.dsh-git-tree-node-context::after{content:'';position:absolute;right:5px;bottom:5px;width:6px;height:6px;border-radius:50%;background:var(--dsw-static-deepseek-500)}
.dsh-git-tree-head{position:absolute;top:-9px;right:-10px;padding:1px 4px;border-radius:4px;background:var(--dsw-alias-state-success-primary);color:white;font-size:9px;line-height:14px;letter-spacing:.2px}
.dsh-git-empty{padding:32px;color:var(--dsw-alias-label-tertiary);text-align:center}
.dsh-git-inspector{min-height:0;padding:16px;display:flex;flex-direction:column;gap:16px;overflow-y:scroll;overflow-x:hidden;scrollbar-gutter:stable;box-sizing:border-box}
.dsh-git-inspector h3{margin:0;font:var(--dsw-font-s-strong-14)}
.dsh-git-node-hash{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xs-13)}
.dsh-git-node-hash span{font-weight:600;letter-spacing:.04em}
.dsh-git-node-hash code{padding:2px 6px;border-radius:5px;background:var(--dsw-specific-selector);color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.dsh-git-close{border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:22px;line-height:1;cursor:pointer;padding:0 3px}
.dsh-git-close:hover{color:var(--dsw-alias-label-primary)}
.dsh-git-inspector-actions{display:flex;gap:8px;align-items:center}
.dsh-git-branch-name{min-width:0;flex:1;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 9px;background:var(--dsw-specific-input-major);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13)}
.dsh-git-message{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px;overflow-wrap:anywhere;font:var(--dsw-font-xs-13);line-height:1.55}
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
.dsh-git-project-host-open{position:relative!important;overflow:hidden!important}
[data-dsh-git-project-host]{position:absolute;inset:0;z-index:50;min-width:0;min-height:0;background:var(--dsw-alias-bg-base)}
.dsh-git-project-page{height:100%;min-width:0;min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family)}
.dsh-git-project-header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:14px 18px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}
.dsh-git-project-header h1{margin:0;font:var(--dsw-font-l-strong-20);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:min(48vw,620px)}
.dsh-git-project-header h1+span{display:block;margin-top:2px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xs-13)}
.dsh-git-project-summary{display:flex;align-items:center;gap:12px;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13)}
.dsh-git-project-summary button,.dsh-git-project-status button,.dsh-git-timeline button{border:1px solid var(--dsw-alias-border-l3);border-radius:8px;padding:6px 10px;background:var(--dsw-alias-button-floating-fill);color:var(--dsw-alias-label-primary);cursor:pointer}
.dsh-git-project-summary button:last-child{border:0;background:transparent;padding:2px 5px;font-size:24px;line-height:1}
.dsh-git-project-status{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--dsw-alias-label-secondary)}
.dsh-git-project-status p{margin:0}
.dsh-git-project-main{min-height:0;display:grid;grid-template-columns:minmax(0,1fr);overflow:hidden}
.dsh-git-project-main-open{grid-template-columns:minmax(320px,1fr) minmax(340px,40%)}
.dsh-git-project-canvas{min-width:0;min-height:0;overflow:hidden;background:radial-gradient(circle,var(--dsw-alias-border-l2) 1px,transparent 1px);background-size:18px 18px}
.dsh-git-project-inspector{min-width:0;min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr);border-left:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}
.dsh-git-project-inspector>header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-git-project-inspector>header button{border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:22px;cursor:pointer}
.dsh-git-project-inspector-body{min-height:0;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:14px}
.dsh-git-project-inspector dl{margin:0;display:grid;gap:7px;font:var(--dsw-font-xs-13)}
.dsh-git-project-inspector dl div{display:grid;grid-template-columns:100px minmax(0,1fr);gap:10px}
.dsh-git-project-inspector dt{color:var(--dsw-alias-label-tertiary)}
.dsh-git-project-inspector dd{margin:0;overflow-wrap:anywhere}
.dsh-git-timeline{padding:11px 18px 14px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);display:grid;gap:10px}
.dsh-git-timeline-readout{display:flex;align-items:baseline;gap:10px;font:var(--dsw-font-xs-13)}
.dsh-git-timeline-readout strong{color:var(--dsw-static-deepseek-500)}
.dsh-git-timeline-readout time{margin-left:auto;color:var(--dsw-alias-label-tertiary)}
.dsh-git-timeline-controls{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px}
.dsh-git-timeline button{padding:2px 10px;font-size:20px;line-height:24px}
.dsh-git-timeline button:disabled{opacity:.35;cursor:not-allowed}
.dsh-git-timeline-track{position:relative;height:30px;display:flex;align-items:center}
.dsh-git-timeline-track input{position:relative;z-index:2;width:100%;margin:0;accent-color:var(--dsw-static-deepseek-500);cursor:ew-resize}
.dsh-git-timeline-session-marks{position:absolute;z-index:1;left:7px;right:7px;top:3px;height:24px;pointer-events:none}
.dsh-git-timeline-session-marks span{position:absolute;top:0;width:3px;height:24px;border-radius:2px;background:var(--dsw-static-deepseek-200);transform:translateX(-1px)}
@media(max-width:760px){.dsh-git-workbench-open{grid-template-columns:1fr;grid-template-rows:minmax(250px,1fr) auto}.dsh-git-panel+.dsh-git-panel{border-left:0;border-top:1px solid var(--dsw-alias-border-l2)}.dsh-git-inspector{max-height:260px;overflow:auto}}
@media(max-width:760px){.dsh-git-project-header{padding:10px 12px}.dsh-git-project-summary>span{display:none}.dsh-git-project-main-open{grid-template-columns:1fr;grid-template-rows:minmax(220px,1fr) minmax(220px,42%)}.dsh-git-project-inspector{border-left:0;border-top:1px solid var(--dsw-alias-border-l2)}.dsh-git-timeline{padding:9px 12px 11px}.dsh-git-timeline-readout time{display:none}}
`;
		//#endregion
		//#region lib/types/client/index.js
		/** Required client services: the conversation view slot and session runtime. */
		const inject = [
			"connection",
			"slots",
			"sessions",
			"workspaces",
			"locale"
		];
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
			const repositories = new WorkspaceGraphRepositories(ctx.workspaces, connectionGraphTransport(ctx.connection));
			ctx.effect(() => installLocaleSource(ctx.locale), "dsh-git: locale source");
			ctx.effect(installStyles, "dsh-git: stylesheet");
			ctx.effect(() => installProjectBridge({
				connection: ctx.connection,
				sessions,
				workspaces: ctx.workspaces,
				locale: ctx.locale,
				repositoryForWorkspace: (workspaceId) => repositories.forWorkspace(workspaceId)
			}), "dsh-git: project graph compatibility bridge");
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "dsh-git",
				order: 20,
				label: () => localized("分支", "Branches"),
				inject: (sessionId) => {
					const repository = repositories.forSession(sessionId);
					const sessionParents = () => Object.fromEntries(Object.values(sessions.list.getSnapshot().byId).flatMap((item) => item.parentId === void 0 ? [] : [[String(item.id), String(item.parentId)]]));
					repository.reconcileOfficialForks(sessionParents());
					return {
						hooks: { graph: repository },
						syncTurns: (turns) => {
							repository.syncSession(sessionId, turns);
							repository.reconcileOfficialForks(sessionParents());
						},
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
							if (selected.length === 0) throw new Error(localized("请先选择至少一个 PA 节点。", "Select at least one PA node first."));
							const base = [...selected].sort((left, right) => left.createdAt - right.createdAt)[0];
							const primaryParentId = state.headNodeId !== null && manifest.includes(state.headNodeId) ? state.headNodeId : manifest.at(-1) ?? null;
							const source = sessions.binding(base.sessionId)?.session;
							if (source === void 0) throw new Error(localized("无法访问用于创建 merge branch 的来源 session。", "Cannot access the source Session used to create the merge branch."));
							const childSessionId = createSessionId();
							repositories.pinSession(childSessionId, repository);
							const payload = encodeCreateMergedSessionPayload({
								targetSessionId: childSessionId,
								sources: selected.map((node) => ({
									sourceSessionId: node.sessionId,
									sourceTurn: node.turn,
									sourceBoundarySeq: node.boundarySeq
								}))
							});
							const command = await source.command(`/${CREATE_MERGED_SESSION_COMMAND} ${payload}`);
							if (!command.ok) throw new Error(localized(`创建 merge branch 失败：${command.error.message}`, `Failed to create merge branch: ${command.error.message}`));
							if (!command.value.matched) throw new Error(localized("Host 未加载 dsh-git 历史合成命令，请重启 dsh。", "The Host did not load the dsh-git history composition command. Restart dsh."));
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
								throw new Error(localized("新 branch 已在 Host 创建，但浏览器没有收到对应 session。", "The new branch was created on the Host, but the browser did not receive its Session."));
							}
							sessions.open(childSessionId);
							const result = await binding.session.prompt([{
								type: "text",
								text: question.trim()
							}], "queue");
							if (!result.ok) {
								repository.abortPending(childSessionId);
								throw new Error(localized(`新 branch 提问失败：${result.error.message}`, `Failed to ask on the new branch: ${result.error.message}`));
							}
						}
					};
				}
			}, GraphView));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map