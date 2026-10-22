// An engine worker's file tools, fenced (M96 lane W, C-M96-3 review RVCM963
// finding 1). The worker host's ordinary confinement resolves its root afresh
// on every call, so a replaced copy would become the new root, and its tools
// would write wherever the role's charter only asks them not to. Here every
// read goes through the retained root grant (`confineWorkerPath`, which checks
// the copy's native identity), and every write also through the resolved role
// policy (`isCheckedWorkerWriteAllowed`: no write for read-only roles or a role
// without the write group, no protected path such as `.git`, only the role's
// `write-paths`). Each call first asks the task's live admission (trust, the
// paid switch, the caps, a stop), so a worker stops at its next file call too.

import { TOOL_FILE_MAX_BYTES, WORKER_MODEL_TEXT } from '../../../shared/constants'
import { fingerprint } from '../../verify/fingerprint'
import type { ToolIo } from '../../backends/modelapi/tools'
import { pathModule } from '../../workspaceRoot'
import {
  confineWorkerPath,
  MuseWorkerFolderError,
  withWorkerFile,
  type WorkerPathInput,
  type WorkerFileHandle,
} from './workerFence'
import type { WorkerRolePolicy } from './workerTypes'

export interface WorkerToolFence {
  /** The task's copy, the user's repository and the retained root grant. */
  readonly input: WorkerPathInput
  readonly role: WorkerRolePolicy
  /** The task's live admission; throws the refusal. */
  readonly admit: () => void
}

type ConfinedTarget = Extract<Awaited<ReturnType<typeof confineWorkerPath>>, { ok: true }>

/**
A path in the copy, existing or not: an existing path is confined by
identity; a new one by its nearest existing ancestor, which must be inside
the granted root, plus the plain names below it.
*/
async function confineTarget(input: WorkerPathInput, given: string): Promise<ConfinedTarget> {
  const exact = await confineWorkerPath(input, given)
  if (exact.ok) return exact
  const p = pathModule(input.platform)
  const absolute = p.resolve(input.grant?.absolute ?? input.folder, given)
  let ancestor = absolute
  for (;;) {
    const parent = p.dirname(ancestor)
    if (parent === ancestor) throw new MuseWorkerFolderError()
    ancestor = parent
    const confined = await confineWorkerPath(input, ancestor)
    if (!confined.ok) continue
    const rest = p.relative(ancestor, absolute).split(p.sep).join('/')
    if (rest === '' || rest.split('/').includes('..')) throw new MuseWorkerFolderError()
    const join = (base: string): string => (base === '' ? rest : `${base}/${rest}`)
    const target = p.join(confined.checkedAbsolute, rest)
    return {
      ok: true,
      absolute: target,
      checkedAbsolute: target,
      relative: join(confined.relative),
      canonical: join(confined.canonical),
    }
  }
}

/** The worker host's tool I/O with every path admitted against the grant and the role. */
function unavailable(): never {
  throw new Error(WORKER_MODEL_TEXT.fileOperationUnavailable)
}

export function fenceWorkerToolIo(base: ToolIo, fence: WorkerToolFence): ToolIo {
  const readBytes = async (
    given: string,
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array | undefined> => {
    fence.admit()
    signal?.throwIfAborted()
    try {
      return await withWorkerFile(fence.input, given, false, async (handle) => {
        fence.admit()
        signal?.throwIfAborted()
        if (handle.readBytes === undefined) return unavailable()
        const bytes = await handle.readBytes(maxBytes)
        signal?.throwIfAborted()
        return bytes
      })
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    }
  }
  const readText = async (given: string, signal?: AbortSignal): Promise<string | undefined> => {
    const bytes = await readBytes(given, TOOL_FILE_MAX_BYTES, signal)
    return bytes === undefined
      ? undefined
      : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  }
  const write = async <T>(
    given: string,
    work: (handle: WorkerFileHandle) => Promise<T>,
  ): Promise<T> => {
    fence.admit()
    // Opening r+ never creates or truncates; only this verified handle writes.
    return await withWorkerFile(
      fence.input,
      given,
      true,
      async (handle) => {
        fence.admit()
        return await work(handle)
      },
      fence.role,
    )
  }
  return {
    readFile: (absolute, _expected, signal) => readText(absolute, signal),
    readBytes: (absolute, maxBytes, _expected, signal) => readBytes(absolute, maxBytes, signal),
    writeFile: async (absolute, content, _expected, assertCanWrite) => {
      await write(absolute, async (handle) => {
        assertCanWrite?.()
        await handle.write(content)
      })
    },
    writeFileIfUnchanged: async (absolute, expected, content, options) =>
      await write(absolute, async (handle) => {
        if (typeof expected !== 'string' || options.staged !== undefined) return unavailable()
        if (handle.readBytes === undefined) return unavailable()
        const current = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
          await handle.readBytes(TOOL_FILE_MAX_BYTES),
        )
        if (
          fingerprint(current) !== expected ||
          options.unsavedAt.some((given) => base.hasUnsavedChanges(given))
        )
          return 'changed'
        fence.admit()
        options.assertCanWrite?.()
        await handle.write(content)
        return 'written'
      }),
    pathExists: async (absolute) => {
      fence.admit()
      await confineTarget(fence.input, fence.input.folder)
      // Metadata has no unverified base callback; the retained grant checks it.
      const target = await confineWorkerPath(fence.input, absolute)
      return target.ok
    },
    // Node's portable API has no handle-relative creation or removal. These
    // operations fail closed until a native port can bind their parent handle.
    reserveFile: () => unavailable(),
    hasUnsavedChanges: (absolute) => base.hasUnsavedChanges(absolute),
    unsavedFiles: () => base.unsavedFiles(),
    listFiles: async (signal) => {
      fence.admit()
      await confineTarget(fence.input, fence.input.folder)
      const listed = await base.listFiles(signal)
      await confineTarget(fence.input, fence.input.folder)
      const kept: string[] = []
      for (const relative of listed) {
        signal?.throwIfAborted()
        try {
          await withWorkerFile(fence.input, relative, false, () => {
            kept.push(relative)
            return Promise.resolve()
          })
        } catch {
          /* A name cannot escape the grant, even if enumeration raced. */
        }
      }
      fence.admit()
      return kept
    },
    searchFiles: async (job, signal) => {
      fence.admit()
      const files = []
      for (const file of job.files) {
        const bytes = await readBytes(file.absolute, job.maxFileBytes, signal)
        if (bytes !== undefined)
          files.push({
            ...file,
            content: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
          })
      }
      // The matcher receives verified snapshots, never paths to reopen.
      return await base.searchFiles({ ...job, files }, signal)
    },
    runShell: (...args) => base.runShell(...args),
    realPath: async (absolute) => {
      fence.admit()
      const target = await confineTarget(fence.input, absolute)
      return target.checkedAbsolute
    },
  }
}
