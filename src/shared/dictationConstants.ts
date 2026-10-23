// The dictation helper-process tunables: the commands the recorder speaks to
// the native helper and how long it waits for each. This module imports
// nothing: the voice bundles read it directly, without the rest of
// constants.ts.
export const DICTATION_HELPER_COMMANDS = { start: 'start', stop: 'stop', quit: 'quit' } as const
/** After "stop", the helper has this long to deliver the phrase in flight. */
export const DICTATION_STOP_GRACE_MS = 4000
/** After "quit", the helper has this long to exit before it is killed. */
export const DICTATION_QUIT_GRACE_MS = 2000
export const DICTATION_STDERR_TAIL_CHARS = 400
