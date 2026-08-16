/** Plugin-owned stylesheet using the Web surface semantic token vocabulary. */
export const STYLES = `
:root{--dsh-git-session-0:#4f7cff;--dsh-git-session-1:#9b6cff;--dsh-git-session-2:#00a889;--dsh-git-session-3:#e58a21;--dsh-git-session-4:#d95780;--dsh-git-session-5:#3b9dd8;--dsh-git-session-6:#72a83b;--dsh-git-session-7:#ad6b42}
.dsh-git-root{height:100%;width:100%;min-height:0;flex:1 1 0;display:grid;grid-template-rows:minmax(260px,1fr) auto;box-sizing:border-box;padding-bottom:calc(var(--dsh-composer-height,152px) + 16px);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);overflow:hidden}
.dsh-git-workbench{min-height:0;display:grid;grid-template-columns:minmax(0,1fr);border-bottom:1px solid var(--dsw-alias-border-l2)}
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
.dsh-git-tree-node:disabled{cursor:not-allowed;opacity:.72;transform:none}
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
.dsh-git-chip button:disabled{opacity:.35;cursor:not-allowed}
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
@media(max-width:760px){.dsh-git-project-header{padding:10px 12px}.dsh-git-project-summary>span{display:none}.dsh-git-project-main-open{grid-template-columns:1fr;grid-template-rows:minmax(220px,1fr) minmax(220px,42%)}.dsh-git-project-inspector{border-left:0;border-top:1px solid var(--dsw-alias-border-l2)}.dsh-git-timeline{padding:9px 12px 11px}.dsh-git-timeline-readout time{display:none}}

/* Branches merge workbench. The project-level takeover above keeps its own layout. */
.dsh-git-root{grid-template-rows:minmax(320px,1fr) auto}
.dsh-git-workbench{grid-template-columns:minmax(280px,35%) minmax(420px,1fr);border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-git-branch-left{min-width:0;min-height:0;display:grid;grid-template-rows:minmax(0,1fr);border-right:1px solid var(--dsw-alias-border-l2);overflow:hidden}
.dsh-git-branch-left-open{grid-template-rows:minmax(210px,1fr) minmax(210px,42%)}
.dsh-git-graph-panel{min-width:0;min-height:0;overflow:hidden;background:radial-gradient(circle,var(--dsw-alias-border-l2) 1px,transparent 1px);background-size:18px 18px}
.dsh-git-context-window{min-width:0;min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr);border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);overflow:hidden}
.dsh-git-context-window .dsh-git-inspector{padding:12px;gap:12px}
.dsh-git-chat-panel{min-width:0;min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden;background:var(--dsw-alias-bg-base)}
.dsh-git-chat-history{min-height:0;overflow:auto;padding:18px max(18px,5%);scrollbar-gutter:stable;display:flex;flex-direction:column;gap:18px}
.dsh-git-chat-status{min-height:100%;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xs-13)}
.dsh-git-preview-turn{display:flex;flex-direction:column;gap:10px;padding:2px 0 14px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-git-preview-turn-candidate{padding:12px;border:2px dashed var(--dsw-alias-state-success-primary);border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 5%,transparent)}
.dsh-git-preview-turn-head{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xs-13)}
.dsh-git-preview-turn-head strong{color:var(--dsw-static-deepseek-500)}
.dsh-git-preview-turn-candidate .dsh-git-preview-turn-head strong{color:var(--dsw-alias-state-success-primary)}
.dsh-git-preview-record{min-width:0;overflow-wrap:anywhere;font:var(--dsw-font-xs-13);line-height:1.55}
.dsh-git-preview-user{align-self:flex-end;max-width:min(84%,760px);padding:9px 13px;border-radius:14px 14px 4px 14px;background:var(--dsw-alias-button-info-fill)}
.dsh-git-preview-assistant{align-self:stretch;padding:2px 0;color:var(--dsw-alias-label-primary)}
.dsh-git-preview-reasoning,.dsh-git-preview-request,.dsh-git-preview-event{padding:7px 10px;border-left:2px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-raised,transparent)}
.dsh-git-preview-tool{padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-specific-selector)}
.dsh-git-preview-tool>header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:5px;color:var(--dsw-alias-label-secondary);font-weight:600}
.dsh-git-preview-tool pre,.dsh-git-preview-event pre{margin:5px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
.dsh-git-preview-blocks{display:flex;flex-direction:column;gap:8px}
.dsh-git-preview-image{display:block;max-width:min(100%,720px);max-height:480px;object-fit:contain;border-radius:10px;border:1px solid var(--dsw-alias-border-l2)}
.dsh-git-preview-other{color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.dsh-git-tree-node-selected{border-color:var(--dsw-static-deepseek-500);background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-label-primary);box-shadow:0 0 0 2px var(--dsw-static-deepseek-200)}
.dsh-git-tree-node-candidate{border-color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 16%,var(--dsw-alias-bg-base));box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-success-primary) 28%,transparent)}
.dsh-git-tree-node-candidate:hover{border-color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 20%,var(--dsw-alias-bg-base))}
.dsh-git-tray{padding:10px 16px 12px;gap:8px}
.dsh-git-tray-head>div{min-width:0;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.dsh-git-tray-meta{display:inline-block}
.dsh-git-candidate-note{color:var(--dsw-alias-state-success-primary);font:var(--dsw-font-xs-13)}
.dsh-git-merge-guard{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;border:1px solid var(--dsw-alias-state-warn-primary,var(--dsw-alias-border-l3));border-radius:9px;color:var(--dsw-alias-state-warn-label);background:color-mix(in srgb,var(--dsw-alias-state-warn-label) 7%,transparent);font:var(--dsw-font-xs-13)}
.dsh-git-tray-footer{display:flex;align-items:center;justify-content:space-between;gap:12px}
@media(max-width:900px){.dsh-git-workbench{grid-template-columns:minmax(240px,42%) minmax(340px,1fr)}.dsh-git-chat-history{padding:14px}}
@media(max-width:700px){.dsh-git-workbench{grid-template-columns:1fr;grid-template-rows:minmax(300px,48%) minmax(300px,1fr)}.dsh-git-branch-left{border-right:0;border-bottom:1px solid var(--dsw-alias-border-l2)}.dsh-git-merge-guard,.dsh-git-tray-footer{align-items:flex-start;flex-direction:column}.dsh-git-chat-history{padding:12px}}
`;
//# sourceMappingURL=styles.js.map