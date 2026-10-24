// The window and its playbook worker in one process, for the suites that
// drive the real worker code: every message is copied, as a thread copies
// it, and delivered on a later turn. Only the transport is in-process.
import type { PlaybookWorkerHandle } from '../../../../src/host/playbook/playbookWindow'
import type { PlaybookWorkerPort } from '../../../../src/host/playbook/playbookWorker'
import type {
  FromPlaybookWorker,
  ToPlaybookWorker,
} from '../../../../src/host/playbook/workerProtocol'
import { keepCalls } from './keepCalls'

function deliver(listeners: readonly ((raw: unknown) => void)[], message: unknown): void {
  const copy: unknown = structuredClone(message)
  setImmediate(() => {
    for (const listener of listeners) listener(copy)
  })
}

/** Both sides of a thread: every message is copied, and delivered on a later turn. */
export function thread() {
  const toWorker: ((raw: unknown) => void)[] = []
  const toWindow: Record<'message' | 'error' | 'exit', ((value: unknown) => void)[]> = {
    message: [],
    error: [],
    exit: [],
  }
  const sent: ToPlaybookWorker[] = []
  const terminate = keepCalls(() => Promise.resolve(0))
  const handle: PlaybookWorkerHandle = {
    postMessage: (message) => {
      sent.push(message)
      deliver(toWorker, message)
    },
    on: (event, listener) => {
      toWindow[event].push(listener)
    },
    terminate,
  }
  const port: PlaybookWorkerPort = {
    postMessage: (message) => {
      deliver(toWindow.message, message)
    },
    on: (_event, listener) => {
      toWorker.push(listener)
    },
  }
  return {
    handle,
    port,
    sent,
    terminate,
    /** What the thread says to its window. */
    say: (message: FromPlaybookWorker | Record<string, unknown>) => {
      deliver(toWindow.message, message)
    },
    crash: () => {
      for (const listener of toWindow.error) listener(new Error('the thread died'))
    },
    /** Anything at all, as a request: the worker must not take it on trust. */
    raw: (message: unknown) => {
      deliver(toWorker, message)
    },
  }
}
