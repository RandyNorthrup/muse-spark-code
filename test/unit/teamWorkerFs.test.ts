import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { onTestFinished, describe, expect, it } from 'vitest'
import { acpFsRead, acpFsWrite, type AcpFsInput } from '../../src/core/team/workers/acpWorker'
import { WORKER_NATIVE_IO } from '../../src/core/team/workers/workerFence'

/** A real working copy and workspace root on the real filesystem. */
function scratchInput(): AcpFsInput {
  const directory = mkdtempSync(path.join(tmpdir(), 'm116w-fs-'))
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true })
  })
  const workspaceRoot = path.join(directory, 'workspace')
  const folder = path.join(directory, 'copy')
  mkdirSync(workspaceRoot, { recursive: true })
  mkdirSync(folder, { recursive: true })
  return {
    role: {
      roleId: 'engineering',
      workspaceMode: 'own-branch',
      toolGroups: ['read', 'write'],
      reportShape: 'summary',
    },
    folder,
    workspaceRoot,
    platform: process.platform,
    io: WORKER_NATIVE_IO,
  }
}

describe('confined ACP file reads and writes over the real filesystem', () => {
  it('reads a real file inside the working copy', async () => {
    const input = scratchInput()
    writeFileSync(path.join(input.folder, 'note.txt'), 'hello')
    expect(await acpFsRead(input, 'note.txt')).toEqual({ content: 'hello' })
  })

  it('refuses a read escaping the working copy', async () => {
    const input = scratchInput()
    // The escape target exists: the fence opens it, then proves it is no
    // descendant of the grant and refuses.
    writeFileSync(path.join(input.workspaceRoot, 'secret.txt'), 'owner-only')
    expect(await acpFsRead(input, '../workspace/secret.txt')).toEqual({
      error: 'outside the working copy',
    })
  })

  it('throws a missing file inside the copy instead of calling it outside', async () => {
    const input = scratchInput()
    // The fence's own refusal still reads "outside the working copy": only a
    // real I/O failure changed shape. Reverting the narrowing answers this
    // read as outside instead of throwing.
    await expect(acpFsRead(input, 'absent.txt')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('writes a real file inside the working copy and reads it back', async () => {
    const input = scratchInput()
    writeFileSync(path.join(input.folder, 'draft.txt'), 'before')
    expect(await acpFsWrite(input, 'draft.txt', 'after')).toEqual({ ok: true })
    expect(await acpFsRead(input, 'draft.txt')).toEqual({ content: 'after' })
  })
})
