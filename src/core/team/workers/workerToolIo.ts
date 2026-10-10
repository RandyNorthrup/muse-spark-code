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

import type { ToolIo } from '../../backends/modelapi/tools'
import { pathModule } from '../../workspaceRoot'
import {
  confineWorkerPath,
  isCheckedWorkerWriteAllowed,
  MuseWorkerFolderError,
  type WorkerPathInput,
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
 * A path in the copy, existing or not: an existing path is confined by
 * identity; a new one by its nearest existing ancestor, which must be inside
 * the granted root, plus the plain names below it.
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
export function fenceWorkerToolIo(base: ToolIo, fence: WorkerToolFence): ToolIo {
  const read = async (given: string): Promise<void> => {
    fence.admit()
    await confineTarget(fence.input, given)
  }
  const write = async (given: string): Promise<void> => {
    fence.admit()
    const target = await confineTarget(fence.input, given)
    if (!isCheckedWorkerWriteAllowed(fence.role, target)) throw new MuseWorkerFolderError()
  }
  return {
    ...(base.readMedia !== undefined && {
      readMedia: async (absolute, maxBytes, expected, signal, observe) => {
        await read(absolute)
        return await base.readMedia?.(absolute, maxBytes, expected, signal, observe)
      },
    }),
    readFile: async (absolute, expected, signal, observe) => {
      await read(absolute)
      return await base.readFile(absolute, expected, signal, observe)
    },
    readBytes: async (absolute, maxBytes, expected, signal, observe) => {
      await read(absolute)
      return await base.readBytes(absolute, maxBytes, expected, signal, observe)
    },
    writeFile: async (absolute, content, expected, assertCanWrite) => {
      await write(absolute)
      await base.writeFile(absolute, content, expected, assertCanWrite)
    },
    writeFileIfUnchanged: async (absolute, fingerprint, content, options) => {
      await write(absolute)
      return await base.writeFileIfUnchanged(absolute, fingerprint, content, options)
    },
    pathExists: async (absolute) => {
      await read(absolute)
      return await base.pathExists(absolute)
    },
    reserveFile: async (absolute, expected, beforeCreate) => {
      await write(absolute)
      return await base.reserveFile(absolute, expected, beforeCreate)
    },
    hasUnsavedChanges: (absolute) => base.hasUnsavedChanges(absolute),
    unsavedFiles: () => base.unsavedFiles(),
    listFiles: async (signal) => {
      await read(fence.input.folder)
      return await base.listFiles(signal)
    },
    searchFiles: async (job, signal) => {
      await read(job.root)
      return await base.searchFiles(job, signal)
    },
    runShell: (command, cwd, timeoutMs, signal, limit, assertCanRun, isInteractive, kind) =>
      base.runShell(command, cwd, timeoutMs, signal, limit, assertCanRun, isInteractive, kind),
    realPath: async (absolute) => {
      fence.admit()
      const target = await confineTarget(fence.input, absolute)
      return target.checkedAbsolute
    },
  }
}
