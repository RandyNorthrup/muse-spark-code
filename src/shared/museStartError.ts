/**
Why Muse Code (`muse serve`) ended before it answered: its sign-in file could
not be read (authFile) or is in a format it does not support (authSchema), the
system would not run it (cannotRun), or it stopped with another failing exit
status (exited).
*/
export type MuseStartFault = 'authFile' | 'authSchema' | 'cannotRun' | 'exited'

const MUSE_START_FAULTS: readonly unknown[] = [
  'authFile',
  'authSchema',
  'cannotRun',
  'exited',
] satisfies readonly MuseStartFault[]

const MUSE_START_ERROR = 'MuseStartError'

/**
Muse Code ended while it was starting. The message is the whole sentence a
person reads (what happened, what to do), already in the installed language;
the fault is the fixed word the log keeps.
*/
export class MuseStartError extends Error {
  public constructor(
    public readonly fault: MuseStartFault,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = MUSE_START_ERROR
  }
}

/** Whether a failure is Muse Code's start failure (cross-bundle: the name and fault, never instanceof). */
export function isMuseStartError(error: unknown): error is MuseStartError {
  return (
    error instanceof Error &&
    error.name === MUSE_START_ERROR &&
    'fault' in error &&
    MUSE_START_FAULTS.includes(error.fault)
  )
}
