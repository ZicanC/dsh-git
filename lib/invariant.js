//#region lib/types/invariant.js
/** Runtime invariant companion for the host-empty, browser-only plugin. */
const name = "dsh-git-invariant";
/** No host invariant: all state and effects are owned by the browser plugin. */
function apply() {}
//#endregion
export { apply, name };
