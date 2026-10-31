// A save the registry genuinely cannot land throws typed, so the caller
// can say what failed in words (RLWINFIX2 item 2): a corrupt live manifest
// is invalid, an unusable folder is unsafe, an unwritable stage is io. Each
// drives the real CreatedRegistry; every failure lands before the native
// helper is reached, so no helper build is needed. A genuine helper
// refusal (refused: the helper said no and the live manifest is unchanged)
// is not deterministically reachable with real parts and stays covered by
// review plus the race suite's green, as does the republish bound's
// `contended` (five lost races in one save; RLF-SAFELIMITS proves it fires
// in docs/certification/rlf-safelimits.md's drill R5).
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CreatedRegistry, type CreatedPathProof } from '../../src/core/resources/createdRegistry'
import {
  isCreatedRegistrySaveError,
  type CreatedRegistrySaveReason,
} from '../../src/shared/createdRegistrySaveError'
import { denyWrites } from './helpers/deniedAccess'
import { createdTreeCreator, isCreatedTreeCreatorGone } from '../../src/core/resources/createdOwner'

const proof: CreatedPathProof = {
  exited: () => Promise.resolve(true),
  creator: () => createdTreeCreator(scratch.folder),
  creatorExited: (creator) => isCreatedTreeCreatorGone(creator, scratch.folder),
  archivedAndClean: () => Promise.resolve(true),
  freeBytes: () => Promise.resolve(null),
}

const scratch: { folder: string } = { folder: '' }

beforeEach(async () => {
  scratch.folder = await mkdtemp(path.join(path.resolve('temp'), 'created-registry-save-errors-'))
})

afterEach(async () => {
  try {
    await chmod(scratch.folder, 0o755)
  } catch {
    // The folder may already allow writes; removal decides.
  }
  await rm(scratch.folder, { recursive: true, force: true })
  scratch.folder = ''
})

async function reasonOf(action: () => Promise<unknown>): Promise<CreatedRegistrySaveReason> {
  try {
    await action()
  } catch (error: unknown) {
    expect(isCreatedRegistrySaveError(error)).toBe(true)
    if (!isCreatedRegistrySaveError(error)) throw new Error('unreachable', { cause: error })
    expect(error.cause).toBeInstanceOf(Error)
    return error.reason
  }
  throw new Error('the save should have failed')
}

describe('created registry genuine save failures (RLWINFIX2 item 1)', () => {
  it('a corrupt live manifest is invalid', async () => {
    const file = path.join(scratch.folder, 'registry.json')
    const registry = await CreatedRegistry.open(file, Date.now, proof)
    await writeFile(file, 'not a manifest')
    await expect(reasonOf(() => registry.createTemp('owner'))).resolves.toBe('invalid')
  })

  it('an unusable registry folder is unsafe', async () => {
    const parent = path.join(scratch.folder, 'parent')
    const file = path.join(parent, 'registry.json')
    const registry = await CreatedRegistry.open(file, Date.now, proof)
    await rm(parent, { recursive: true, force: true })
    await writeFile(parent, 'a file where the folder was')
    await expect(reasonOf(() => registry.createTemp('owner'))).resolves.toBe('unsafe')
  })

  it('an unwritable registry folder is io', async () => {
    const parent = path.join(scratch.folder, 'parent')
    const file = path.join(parent, 'registry.json')
    const registry = await CreatedRegistry.open(file, Date.now, proof)
    // The operating system itself refuses new files (chmod 555 on POSIX, an
    // access-control entry on Windows): reads still work, the stage fails.
    const allowWrites = await denyWrites(parent)
    try {
      await expect(reasonOf(() => registry.createTemp('owner'))).resolves.toBe('io')
    } finally {
      await allowWrites()
    }
  })
})
