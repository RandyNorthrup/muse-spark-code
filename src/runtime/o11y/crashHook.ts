// Desktop observability (M111 lane OB, PLAN.md D91.22): the Node
// runtime's crash hook. An uncaught exception or an unhandled rejection
// lands one structured crash record (component, kind, the error's class,
// time — never a stack, whose absolute paths stay out of the store) and
// the process exits non-zero, as it would have without the hook; the
// supervisor restarts it with backoff (D90.19). The write is synchronous:
// the process is dying and nothing async would finish.

import { buildCrashRecord, serializeCrashRecord } from '../../core/o11y/crash'

export interface O11yCrashHookOptions {
  /** The crashing component, from the fixed vocabulary. */
  readonly component: string
  /** Appends one record line, synchronously; the store owns the file. */
  readonly writeLine: (line: string) => void
  readonly now?: () => number
  /** Defaults to `process.exit`; injected so tests never exit the worker. */
  readonly exit?: (code: number) => void
  /** Files a hook failure; implementations print a fixed sentence. */
  readonly report?: (error: unknown) => void
}

/**
Install the crash hook; returns the uninstaller. A refused record still
exits: the crash happened, with or without its record.
*/
export function installO11yCrashHook(options: O11yCrashHookOptions): () => void {
  const now = options.now ?? Date.now
  // A crashing process owns its exit: without the hook Node would exit
  // non-zero on its own, so the hook does the same after recording.
  const exit = options.exit ?? process.exit.bind(process)
  const capture = (error: unknown): void => {
    const code = error instanceof Error ? error.constructor.name : 'unknown'
    const built = buildCrashRecord({ component: options.component, kind: 'uncaught', code }, now())
    if (!built.ok) {
      options.report?.(new Error(`o11y crash record refused: ${built.reason}`))
      exit(1)
      return
    }
    try {
      options.writeLine(serializeCrashRecord(built.record))
    } catch (error_: unknown) {
      // Only a write failure reports: anything else keeps its kind past
      // the hook. The exit below still runs: the crash happened.
      if (!(error_ instanceof Error)) throw error_
      options.report?.(error_)
    }
    exit(1)
  }
  const onUncaught = (error: unknown): void => {
    capture(error)
  }
  const onRejection = (reason: unknown): void => {
    capture(reason)
  }
  process.on('uncaughtException', onUncaught)
  process.on('unhandledRejection', onRejection)
  return () => {
    process.off('uncaughtException', onUncaught)
    process.off('unhandledRejection', onRejection)
  }
}
