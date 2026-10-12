// First-use native creation. The host retains the sole root-grant authority.
// The production launcher and its error mapping live in the sibling
// worker-operations chunk beside this one, loaded lazily below, so this entry
// stays a thin admission front inside its size row.
import { lstat } from 'node:fs/promises'
import { pathModule } from '../../workspaceRoot'
import { windowsPathProblem } from '../../windowsPathSpelling'
import type { WorkerFileHandle, WorkerPathInput } from './workerFence'
import type { UiText } from '../../../shared/l10n/en'
import { setUiText } from '../../../shared/l10n/text'

import type * as WorkerAuthority from './workerFence'

type Authority = Pick<
  typeof WorkerAuthority,
  'confineWorkerPath' | 'isCheckedWorkerWriteAllowed' | 'recheckWorkerRoot' | 'withWorkerFile'
>
import type { WorkerRolePolicy } from './workerTypes'
import { UI_TEXT } from '../../../shared/constants'

export interface WorkerCreateProof {
  readonly root: string
  readonly rootIdentity: string
  readonly ancestor: string
  readonly ancestorIdentity: string
  readonly remaining: string
  // The path relative to the working copy as asked, for worker-file
  // sentences; the helper never sees it, only ancestor and remaining.
  readonly relative: string
}

/** A missing suffix is admitted against its existing ancestor before any creation. */
export async function createWorkerFile(
  input: WorkerPathInput,
  absolute: string,
  role: WorkerRolePolicy,
  rootIdentity: string,
  authority: Authority,
  table: UiText,
  locale: string,
): Promise<WorkerFileHandle> {
  setUiText(table, locale)
  // The launcher, its error mapping, the sweep and the cleanup live in the
  // sibling first-use chunk beside this one.
  const sweep = await import('./workerOpsEntry.js')
  sweep.installSweepText(table, locale)
  if (input.grant === undefined || input.io.openFile === undefined)
    throw new Error(UI_TEXT.teamFileHelperMissing)
  const { confineWorkerPath, isCheckedWorkerWriteAllowed, recheckWorkerRoot, withWorkerFile } =
    authority
  const grant = input.grant
  const root = await recheckWorkerRoot(input, grant)
  const p = pathModule(input.platform)
  // A reservation this process recorded but never filled or released is
  // removed here when still empty and unchanged; live ones are skipped.
  await sweep.sweepAbandonedReservations(
    input.folder,
    root,
    rootIdentity,
    p,
    input.io,
    input.io.workerNativeOperation ?? sweep.nativeOperation,
  )
  if (windowsPathProblem(absolute, input.platform, root) !== undefined)
    throw new Error(UI_TEXT.teamFileOutside)
  const relative = p.relative(root, absolute).split(p.sep).join('/')
  if (relative === '' || relative.split('/').includes('..') || p.isAbsolute(relative))
    throw new Error(UI_TEXT.teamFileOutside)
  let ancestor = p.dirname(absolute)
  for (;;) {
    const target = await confineWorkerPath(input, ancestor)
    if (target.ok) {
      if (p.relative(ancestor, target.checkedAbsolute) !== '')
        throw new Error(UI_TEXT.teamFileLinked)
      const remaining = p.relative(ancestor, absolute).split(p.sep).join('/')
      const canonical = [target.canonical, remaining].filter(Boolean).join('/')
      if (!isCheckedWorkerWriteAllowed(role, { ...target, relative, canonical }))
        throw new Error(UI_TEXT.teamFileRoleDenied)
      // A dangling symlink is not a missing path, and neither is a device.
      try {
        await lstat(absolute)
        throw new Error(UI_TEXT.teamFileExists)
      } catch (error: unknown) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
          throw sweep.typedCreateError(error, relative)
      }
      const proof: WorkerCreateProof = {
        root,
        rootIdentity,
        ancestor: target.canonical,
        ancestorIdentity: await input.io.pathIdentity(target.checkedAbsolute),
        remaining,
        relative,
      }
      const run = input.io.workerNativeOperation ?? sweep.nativeOperation
      // Missing folders are counted without creating anything, so the write
      // guard approves the operation before any mutation. The single create
      // below is the only helper launch of this file operation.
      const predicted = await sweep.countMissingFolders(
        p,
        target.checkedAbsolute,
        remaining,
        relative,
      )
      await input.beforeCreate?.(predicted)
      await recheckWorkerRoot(input, grant)
      let created: { readonly identity: string; readonly createdFolders: number }
      try {
        // The receipt is parsed at the trust boundary for every operation,
        // production or injected: a malformed identity fails before opening.
        created = sweep.parseWorkerReceipt(await run(proof, 'worker-create'))
      } catch (error: unknown) {
        // The helper never reported what it made: at most the preflight
        // missing count can be ours.
        await sweep.cleanupCreated(run, proof, absolute, undefined, p, predicted)
        throw sweep.mapNativeError(error, relative)
      }
      let opened: Awaited<ReturnType<NonNullable<typeof input.io.openFile>>>
      try {
        opened = await input.io.openFile(absolute, true)
      } catch (error: unknown) {
        await sweep.cleanupCreated(
          run,
          proof,
          absolute,
          created.identity,
          p,
          created.createdFolders,
        )
        throw sweep.typedCreateError(error, relative)
      }
      await sweep.recordCreated(input.folder, relative, created.identity)
      let isReserved = false
      const check = async () => {
        const current = await opened.identify()
        if (current.identity !== created.identity || p.relative(current.absolute, absolute) !== '')
          throw new Error(UI_TEXT.teamFileChanged)
        await recheckWorkerRoot(input, grant)
        return current
      }
      const forget = (): void => {
        sweep.forgetCreated(input.folder, relative, created.identity)
      }
      sweep.trackCreated(created.identity, opened)
      try {
        await check()
      } catch (error: unknown) {
        try {
          await opened.close()
        } catch {
          /* The descriptor is already gone; cleanup still runs. */
        }
        await sweep.cleanupCreated(
          run,
          proof,
          absolute,
          created.identity,
          p,
          created.createdFolders,
        )
        forget()
        throw error
      }
      const handle: WorkerFileHandle = {
        ...opened,
        identify: check,
        write: async (content) => {
          await check()
          try {
            await opened.write(content)
          } catch (error: unknown) {
            // A failed first write leaves no empty file or folders behind;
            // the exact-state release refuses anything with content.
            await sweep.cleanupCreated(
              run,
              proof,
              absolute,
              created.identity,
              p,
              created.createdFolders,
            )
            forget()
            throw error
          }
        },
        close: async () => {
          if (isReserved) return
          forget()
          await opened.close()
        },
        reserve: () => {
          isReserved = true
          let isFinished = false
          let isSettled = false
          const finish = async (): Promise<void> => {
            if (isFinished) return
            isFinished = true
            // Every unsettled terminal path attempts the exact-state cleanup:
            // the release refuses a changed or nonempty file, and rmdir
            // removes only folders that are still empty.
            if (!isSettled)
              await sweep.cleanupCreated(
                run,
                proof,
                absolute,
                created.identity,
                p,
                created.createdFolders,
              )
            forget()
            await opened.close()
          }
          return {
            fill: async (bytes) => {
              if (isFinished) return 'changed'
              try {
                try {
                  await check()
                } catch {
                  return 'changed'
                }
                const outcome = await withWorkerFile(
                  { ...input, io: { ...input.io, openFile: () => Promise.resolve(handle) } },
                  absolute,
                  false,
                  async (_file, target) => {
                    if (!isCheckedWorkerWriteAllowed(role, target))
                      throw new Error(UI_TEXT.teamFileRoleDenied)
                    if (opened.readBytes === undefined)
                      throw new Error(UI_TEXT.teamFileHelperMissing)
                    try {
                      await opened.readBytes(0)
                    } catch {
                      return 'changed'
                    }
                    // Binary bytes use a verified existing descriptor, never a path reopen.
                    if (opened.writeBytes === undefined)
                      throw new Error(UI_TEXT.teamFileHelperMissing)
                    await check()
                    await opened.writeBytes(bytes)
                    return 'done'
                  },
                  role,
                )
                if (outcome === 'done') isSettled = true
                return outcome
              } finally {
                await finish()
              }
            },
            release: async () => {
              if (isFinished) return 'changed'
              try {
                try {
                  await check()
                  if (opened.readBytes === undefined) throw new Error(UI_TEXT.teamFileHelperMissing)
                  await opened.readBytes(0)
                } catch {
                  return 'changed'
                }
                await run(proof, 'worker-release', created.identity)
                isSettled = true
                return 'done'
              } finally {
                await finish()
              }
            },
          }
        },
      }
      return handle
    }
    const parent = p.dirname(ancestor)
    if (parent === ancestor || ancestor === root) throw new Error(UI_TEXT.teamFileOutside)
    ancestor = parent
  }
}
