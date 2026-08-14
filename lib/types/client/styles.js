/** Plugin-owned stylesheet using the Web surface semantic token vocabulary. */
export const STYLES = `
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
//# sourceMappingURL=styles.js.map