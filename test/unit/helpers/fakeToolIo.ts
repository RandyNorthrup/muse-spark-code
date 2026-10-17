// Tool I/O stand-ins for the Model API backend tests: an in-memory file
// system with a recording shell, and a do-nothing one for tests that never
// touch a tool.

import type { ShellResult, ToolIo } from '../../../src/core/backends/modelapi/tools'
import { refusedShellEntry } from '../../../src/core/shellResult'

/**
 * The real adapter's final admission (the sixth `runShell` argument), asked at
 * the fake's entry: a refusal is the proven no-entry result and the fake
 * records and runs nothing, so a test sees what the real entry would refuse.
 * A command already started keeps its own outcome: only the entry is asked.
 */
export function refusedAtEntry(assertCanRun: (() => void) | undefined): ShellResult | undefined {
  try {
    assertCanRun?.()
  } catch {
    return refusedShellEntry()
  }
  return undefined
}

/** A `runShell` that runs `work` once the final admission lets it in. */
export function enteringShell(work: () => Promise<ShellResult>): ToolIo['runShell'] {
  return async (_command, _cwd, _timeoutMs, _signal, _limit, assertCanRun) =>
    refusedAtEntry(assertCanRun) ?? (await work())
}

export const noopToolIo: ToolIo = {
  realPath: (absolutePath) => Promise.resolve(absolutePath),
  readFile: () => Promise.resolve(undefined),
  readBytes: () => Promise.resolve(undefined),
  writeFile: () => Promise.resolve(),
  writeFileIfUnchanged: () => Promise.resolve('changed'),
  pathExists: () => Promise.resolve(false),
  reserveFile: () =>
    Promise.resolve({
      fill: () => Promise.resolve('done'),
      release: () => Promise.resolve('done'),
    }),
  hasUnsavedChanges: () => false,
  unsavedFiles: () => [],
  listFiles: () => Promise.resolve([]),
  searchFiles: () => Promise.resolve({ ok: true, hits: [] }),
  runShell: enteringShell(() =>
    Promise.resolve({ stdout: '', stderr: '', exitCode: 0, isTimedOut: false, isCancelled: false }),
  ),
}
