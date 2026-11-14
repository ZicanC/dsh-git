/** One abortable action at a time, with a busy flag for the view that started it. */
import { useEffect, useRef, useState } from 'react';
function isAbort(cause, signal) {
    return signal.aborted
        || (typeof cause === 'object' && cause !== null && 'name' in cause && cause.name === 'AbortError');
}
/**
 * Run asynchronous actions that the view must be able to abandon.
 *
 * Starting an action aborts the one before it, and unmounting aborts the one
 * in flight. A failure is reported; an abort is not, since nothing is left to
 * show it to.
 * @param onFailure - receives the message of an action that failed.
 * @returns whether an action is in flight, and the function that starts one.
 */
export function useBusyAction(onFailure) {
    const [busy, setBusy] = useState(false);
    const inFlight = useRef(null);
    useEffect(() => () => { inFlight.current?.abort(); }, []);
    const run = async (action) => {
        const controller = new AbortController();
        inFlight.current?.abort();
        inFlight.current = controller;
        setBusy(true);
        try {
            await action(controller.signal);
        }
        catch (cause) {
            if (!isAbort(cause, controller.signal))
                onFailure(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            if (inFlight.current === controller)
                inFlight.current = null;
            setBusy(false);
        }
    };
    return [busy, run];
}
//# sourceMappingURL=use-busy-action.js.map