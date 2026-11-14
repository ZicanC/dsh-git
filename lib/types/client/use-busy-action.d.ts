/**
 * Run asynchronous actions that the view must be able to abandon.
 *
 * Starting an action aborts the one before it, and unmounting aborts the one
 * in flight. A failure is reported; an abort is not, since nothing is left to
 * show it to.
 * @param onFailure - receives the message of an action that failed.
 * @returns whether an action is in flight, and the function that starts one.
 */
export declare function useBusyAction(onFailure: (message: string) => void): readonly [boolean, (action: (signal: AbortSignal) => Promise<void>) => Promise<void>];
