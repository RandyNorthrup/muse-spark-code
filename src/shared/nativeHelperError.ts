/**
Why a shipped native helper cannot be used: its file is not there (missing),
or it is there and the system cannot start it (unloadable: damaged, blocked,
not executable, built for another processor).
*/
export type NativeHelperFault = 'missing' | 'unloadable'

const NATIVE_HELPER_FAULTS: readonly unknown[] = [
  'missing',
  'unloadable',
] satisfies readonly NativeHelperFault[]

const NATIVE_HELPER_ERROR = 'NativeHelperError'

/**
A native helper that cannot be used. The message is the whole sentence a
person reads (what is missing and what to do), already in the installed
language; the fault is the fixed word the log keeps.
*/
export class NativeHelperError extends Error {
  public constructor(
    public readonly fault: NativeHelperFault,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = NATIVE_HELPER_ERROR
  }
}

/** Whether a failure is a native helper's (cross-bundle: the name and fault, never instanceof). */
export function isNativeHelperError(error: unknown): error is NativeHelperError {
  return (
    error instanceof Error &&
    error.name === NATIVE_HELPER_ERROR &&
    'fault' in error &&
    NATIVE_HELPER_FAULTS.includes(error.fault)
  )
}
