import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import type * as Fs from 'node:fs'
import { link, rename } from 'node:fs/promises'
import type * as FsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AcpPaidUse, paidUseAnswer, paidUseOptions } from '../../src/acp/paid'
import { paidGrantFile } from '../../src/runtime/paidGrants'
import { workspaceKey } from '../../src/runtime/dataFolder'
import { memoryPaidGrants } from './helpers/paidGrants'
import { removeFolder } from './helpers/temporaryFolders'

// M58 in the agent (PLAN.md D48, D62): a paid use is off without its flag,
// asks the editor each time otherwise, and "Allow always" is kept per folder
// in the agent's data folder and forgotten when the agent starts without the
// flag.

const FOLDER = path.resolve('work', 'app')
const OTHER = path.resolve('work', 'other')
const WEB_SEARCH = { feature: 'webSearch' } as const
const folders: string[] = []

vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof Fs>()
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) }
})
vi.mock('node:fs/promises', async (importActual) => {
  const actual = await importActual<typeof FsPromises>()
  return { ...actual, link: vi.fn(actual.link), rename: vi.fn(actual.rename) }
})
const actualFs = await vi.importActual<typeof FsPromises>('node:fs/promises')
const actualFsSync = await vi.importActual<typeof Fs>('node:fs')

function restoreFileIo(): void {
  vi.mocked(readFileSync).mockImplementation(actualFsSync.readFileSync)
  vi.mocked(link).mockImplementation(actualFs.link)
  vi.mocked(rename).mockImplementation(actualFs.rename)
}

beforeEach(restoreFileIo)
afterEach(restoreFileIo)

afterAll(async () => {
  await Promise.all(folders.map((folder) => removeFolder(folder)))
})

function logger() {
  return { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function grantsFile(): string {
  // Existing atomic-write targets use their real path, including macOS's
  // /private/var and Windows junctions and 8.3 names. The native API expands
  // short names too, matching fs.promises.realpath in the atomic writer.
  const folder = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'acp-paid-grants-')))
  folders.push(folder)
  return path.join(folder, 'acp', 'paid-uses.json')
}

/** The client chose the option of that id. */
function selected(optionId: string) {
  return { outcome: { outcome: 'selected' as const, optionId } }
}

function fileStore(file: string, log = logger()) {
  return paidGrantFile({ file, log, sleep: () => Promise.resolve() })
}

/** Two processes starting from one explicit web-search grant. */
async function grantedStores() {
  const file = grantsFile()
  const first = fileStore(file)
  await first.add(FOLDER, ['webSearch'])
  return { file, first, second: fileStore(file) }
}

function generationPath(file: string, feature = 'webSearch'): string {
  return path.join(`${file}.d`, feature, 'generation.json')
}

function grantPath(file: string, feature = 'webSearch', workspaceRoot = FOLDER): string {
  const generation: unknown = JSON.parse(readFileSync(generationPath(file, feature), 'utf8'))
  if (
    typeof generation !== 'object' ||
    generation === null ||
    !('id' in generation) ||
    typeof generation.id !== 'string'
  ) {
    throw new Error('no generation for the grant')
  }
  return path.join(`${file}.d`, feature, `${workspaceKey(workspaceRoot)}.${generation.id}.json`)
}

/** Holds one selected write so another process can change the store before it lands. */
function holdFirstRename(isHolding: (from: Fs.PathLike, to: Fs.PathLike) => boolean) {
  const held = Promise.withResolvers<undefined>()
  const released = Promise.withResolvers<undefined>()
  let hasHeld = false
  vi.mocked(rename).mockImplementation(async (from, to) => {
    if (!hasHeld && isHolding(from, to)) {
      hasHeld = true
      held.resolve(undefined)
      await released.promise
    }
    await actualFs.rename(from, to)
  })
  return { held, released }
}

describe('AcpPaidUse', () => {
  it('denies every use until the agent attaches its way to ask', async () => {
    const log = logger()
    const paid = new AcpPaidUse({
      flagged: ['webSearch'],
      canRemember: () => true,
      grants: memoryPaidGrants(),
      log,
    })
    expect(await paid.allows(FOLDER, 's1', WEB_SEARCH, false)).toBe(false)
    expect(log.warn).toHaveBeenCalledWith(
      'Paid use of webSearch: no editor to ask, so it is denied',
    )
    const asker = vi.fn(() => Promise.reject(new Error('the connection closed')))
    paid.attach(asker)
    expect(await paid.allows(FOLDER, 's1', WEB_SEARCH, false)).toBe(false)
    expect(asker).toHaveBeenCalledWith('s1', WEB_SEARCH, true)
    expect(log.warn).toHaveBeenCalledWith(
      'Paid use of webSearch: the editor could not be asked, so it is denied: Error',
    )
  })

  it('keeps "always" per folder, asks again where a hook demands it, and not without trust', async () => {
    const grants = memoryPaidGrants()
    let isTrusted = true
    const paid = new AcpPaidUse({
      flagged: ['webSearch'],
      canRemember: () => isTrusted,
      grants,
      log: logger(),
    })
    const asker = vi.fn(() => Promise.resolve('always' as const))
    paid.attach(asker)
    expect(await paid.allows(FOLDER, 's1', WEB_SEARCH, false)).toBe(true)
    expect(await paid.allows(FOLDER, 's1', WEB_SEARCH, false)).toBe(true)
    expect(asker).toHaveBeenCalledTimes(1)
    expect(await paid.allows(FOLDER, 's1', WEB_SEARCH, true)).toBe(true)
    expect(await paid.allows(OTHER, 's2', WEB_SEARCH, false)).toBe(true)
    expect(asker).toHaveBeenCalledTimes(3)
    expect(asker).toHaveBeenLastCalledWith('s2', WEB_SEARCH, true)
    isTrusted = false
    expect(paid.isRemembered(FOLDER, 'webSearch')).toBe(false)
    expect(await paid.allows(FOLDER, 's1', WEB_SEARCH, false)).toBe(true)
    expect(asker).toHaveBeenLastCalledWith('s1', WEB_SEARCH, false)
  })

  it('forgets "always" for every feature it starts without', async () => {
    const grants = memoryPaidGrants()
    grants.byFolder.set(FOLDER, new Set(['webSearch', 'imageGeneration']))
    const paid = new AcpPaidUse({
      flagged: ['imageGeneration'],
      canRemember: () => true,
      grants,
      log: logger(),
    })
    expect(paid.isRemembered(FOLDER, 'webSearch')).toBe(false)
    await paid.forgetUnflagged()
    expect(grants.byFolder.get(FOLDER)).toEqual(new Set(['imageGeneration']))
    expect(paid.isRemembered(FOLDER, 'imageGeneration')).toBe(true)
  })

  it('logs a grants file it cannot write, and still honours nothing unflagged', async () => {
    const grants = memoryPaidGrants()
    grants.byFolder.set(FOLDER, new Set(['webSearch']))
    vi.spyOn(grants, 'forget').mockRejectedValue(new Error('read-only data folder'))
    const log = logger()
    const paid = new AcpPaidUse({ flagged: [], canRemember: () => true, grants, log })
    await paid.forgetUnflagged()
    expect(log.warn).toHaveBeenCalledWith(
      'Paid uses allowed always could not be forgotten for webSearch, imageGeneration: read-only data folder',
    )
    expect(paid.isRemembered(FOLDER, 'webSearch')).toBe(false)
  })

  it('lets an "always" it cannot keep go ahead once, and asks again next time', async () => {
    const grants = memoryPaidGrants()
    vi.spyOn(grants, 'add').mockRejectedValue(new Error('read-only data folder'))
    const log = logger()
    const paid = new AcpPaidUse({ flagged: ['webSearch'], canRemember: () => true, grants, log })
    const asker = vi.fn(() => Promise.resolve('always' as const))
    paid.attach(asker)
    expect(await paid.allows(FOLDER, 's1', WEB_SEARCH, false)).toBe(true)
    expect(log.warn).toHaveBeenCalledWith(
      'Paid use of webSearch: "always" could not be kept, so it is allowed once: read-only data folder',
    )
    expect(log.info).toHaveBeenLastCalledWith('Paid use of webSearch: allowed once')
    expect(await paid.allows(FOLDER, 's1', WEB_SEARCH, false)).toBe(true)
    expect(asker).toHaveBeenCalledTimes(2)
  })

  it('leaves the grants alone when every feature is flagged', async () => {
    const grants = memoryPaidGrants()
    const forget = vi.spyOn(grants, 'forget')
    const paid = new AcpPaidUse({
      flagged: ['webSearch', 'imageGeneration'],
      canRemember: () => true,
      grants,
      log: logger(),
    })
    await paid.forgetUnflagged()
    expect(forget).not.toHaveBeenCalled()
  })

  it('tallies billed uses in the log', () => {
    const log = logger()
    const paid = new AcpPaidUse({
      flagged: ['imageGeneration'],
      canRemember: () => false,
      grants: memoryPaidGrants(),
      log,
    })
    paid.noteUse('imageGeneration', 1)
    paid.noteUse('imageGeneration', 2)
    expect(log.info).toHaveBeenLastCalledWith(
      'Paid use of imageGeneration: 2, 3 since the agent started',
    )
  })
})

describe('the paid-use prompt’s options and answers', () => {
  it('offers "always" only where it is kept', () => {
    expect(paidUseOptions(true).map((option) => option.optionId)).toEqual([
      'paid-allow-once',
      'paid-allow-always',
      'paid-deny',
    ])
    expect(paidUseOptions(false).map((option) => option.optionId)).toEqual([
      'paid-allow-once',
      'paid-deny',
    ])
  })

  it('reads anything but a chosen allow as Deny', () => {
    expect(paidUseAnswer(selected('paid-allow-once'), false)).toBe('once')
    expect(paidUseAnswer(selected('paid-allow-always'), true)).toBe('always')
    expect(paidUseAnswer(selected('paid-allow-always'), false)).toBe('deny')
    expect(paidUseAnswer(selected('paid-deny'), true)).toBe('deny')
    expect(paidUseAnswer({ outcome: { outcome: 'cancelled' } }, true)).toBe('deny')
  })
})

describe('the grants file (runtime/paidGrants.ts)', () => {
  it('never restores a revoked grant when another process finishes its older addition', async () => {
    const { file, first, second } = await grantedStores()
    // The old store rewrites its whole map; the corrected store writes only this grant.
    const { held, released } = holdFirstRename(
      (from, to) =>
        (path.dirname(String(to)) === path.join(`${file}.d`, 'imageGeneration') &&
          path.basename(String(to)).startsWith(`${workspaceKey(OTHER)}.`)) ||
        (String(to) === file && readFileSync(from, 'utf8').includes('imageGeneration')),
    )
    const adding = second.add(OTHER, ['imageGeneration'])
    try {
      await held.promise
      await first.forget(['webSearch'])
      expect(first.read(FOLDER)).toEqual(new Set())
    } finally {
      released.resolve(undefined)
    }
    await adding
    expect(first.read(FOLDER)).toEqual(new Set())
    expect(first.read(OTHER)).toEqual(new Set(['imageGeneration']))
  })

  it('reads nothing before the first grant, then each folder’s own, from any process', async () => {
    const file = grantsFile()
    const store = fileStore(file)
    expect(store.read(FOLDER)).toEqual(new Set())
    await store.add(FOLDER, ['webSearch'])
    await store.add(OTHER, ['imageGeneration'])
    // Another process's store over the same file sees them at once.
    const other = fileStore(file)
    expect(other.read(FOLDER)).toEqual(new Set(['webSearch']))
    expect(other.read(OTHER)).toEqual(new Set(['imageGeneration']))
    // Folder hashes and opaque generations, never paths or prompt content.
    const saved: unknown = JSON.parse(readFileSync(grantPath(file), 'utf8'))
    expect(saved).toEqual(expect.stringMatching(/^[\da-f-]{36}$/))
    expect(readFileSync(generationPath(file), 'utf8')).not.toContain('work')
  })

  it('adds to the file as it is when written, never a set read before another change', async () => {
    const file = grantsFile()
    const store = fileStore(file)
    const other = fileStore(file)
    // Two sessions of one agent, each answering "always" for a different feature.
    await Promise.all([store.add(FOLDER, ['webSearch']), store.add(FOLDER, ['imageGeneration'])])
    expect(store.read(FOLDER)).toEqual(new Set(['webSearch', 'imageGeneration']))
    // A feature another agent forgot is not written back by a later add.
    await other.forget(['webSearch'])
    await store.add(FOLDER, ['imageGeneration'])
    expect(store.read(FOLDER)).toEqual(new Set(['imageGeneration']))
  })

  it('fails a change on a file it cannot read, rather than writing over it, and reads it as none', async () => {
    const file = grantsFile()
    const log = logger()
    const store = fileStore(file, log)
    // A folder where the generation should be: there, and unreadable as a file.
    mkdirSync(generationPath(file), { recursive: true })
    expect(store.read(FOLDER)).toEqual(new Set())
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Paid-use grants in'))
    await expect(store.add(FOLDER, ['webSearch'])).rejects.toThrow('could not be read')
    await expect(store.forget(['webSearch'])).rejects.toThrow()
  })

  it('writes one change at a time, each on the file as it then is', async () => {
    const file = grantsFile()
    const store = fileStore(file)
    await Promise.all([store.add(FOLDER, ['webSearch']), store.add(OTHER, ['webSearch'])])
    expect(store.read(FOLDER)).toEqual(new Set(['webSearch']))
    expect(store.read(OTHER)).toEqual(new Set(['webSearch']))
  })

  it('revokes a feature in every folder while preserving other features', async () => {
    const file = grantsFile()
    const store = fileStore(file)
    await store.add(FOLDER, ['webSearch', 'imageGeneration'])
    await store.add(OTHER, ['webSearch'])
    await store.forget(['webSearch'])
    expect(store.read(FOLDER)).toEqual(new Set(['imageGeneration']))
    expect(store.read(OTHER)).toEqual(new Set())
    await store.forget(['webSearch'])
    expect(store.read(FOLDER)).toEqual(new Set(['imageGeneration']))
    await store.add(OTHER, ['webSearch'])
    expect(store.read(OTHER)).toEqual(new Set(['webSearch']))
    expect(store.read(FOLDER)).toEqual(new Set(['imageGeneration']))
  })

  it('ignores legacy grants and fails closed for damaged or missing records', async () => {
    const file = grantsFile()
    const log = logger()
    const store = fileStore(file, log)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ [workspaceKey(FOLDER)]: ['webSearch', 'everything'] }))
    expect(store.read(FOLDER)).toEqual(new Set())
    await store.add(FOLDER, ['webSearch'])
    writeFileSync(generationPath(file), '{"half":')
    expect(store.read(FOLDER)).toEqual(new Set())
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Paid-use grants in'))
    await expect(store.add(FOLDER, ['webSearch'])).rejects.toThrow('could not be read')
    await store.forget(['webSearch'])
    await store.add(FOLDER, ['webSearch'])
    writeFileSync(grantPath(file), '["webSearch"]')
    expect(store.read(FOLDER)).toEqual(new Set())
    await store.add(FOLDER, ['webSearch'])
    rmSync(generationPath(file))
    expect(store.read(FOLDER)).toEqual(new Set())
    await store.add(OTHER, ['webSearch'])
    // A fresh generation never revives a grant whose generation went missing.
    expect(store.read(FOLDER)).toEqual(new Set())
    expect(store.read(OTHER)).toEqual(new Set(['webSearch']))
  })

  it('preserves independent concurrent grants from multiple processes, including their first writes', async () => {
    const file = grantsFile()
    const first = fileStore(file)
    const second = fileStore(file)
    await Promise.all([
      first.add(FOLDER, ['webSearch']),
      second.add(OTHER, ['webSearch', 'imageGeneration']),
      fileStore(file).add(FOLDER, ['imageGeneration']),
    ])
    expect(first.read(FOLDER)).toEqual(new Set(['webSearch', 'imageGeneration']))
    expect(second.read(OTHER)).toEqual(new Set(['webSearch', 'imageGeneration']))
  })

  it('rejects a grant whose generation changes while it is read', async () => {
    const file = grantsFile()
    const store = fileStore(file)
    await store.add(FOLDER, ['webSearch'])
    const target = grantPath(file)
    vi.mocked(readFileSync).mockImplementation((...args) => {
      const text = actualFsSync.readFileSync(...args)
      if (String(args[0]) === target) {
        writeFileSync(
          generationPath(file),
          JSON.stringify({ id: '3ebd9e69-fc07-441a-ac7a-f1387ac2d8cc', isInitial: false }),
        )
      }
      return text
    })
    expect(store.read(FOLDER)).toEqual(new Set())
  })

  it('does not authorize a grant that finishes after its feature was revoked', async () => {
    const { file, first, second } = await grantedStores()
    const { held, released } = holdFirstRename(
      (_from, to) => String(to) === grantPath(file, 'webSearch', OTHER),
    )
    const adding = second.add(OTHER, ['webSearch'])
    try {
      await held.promise
      await first.forget(['webSearch'])
    } finally {
      released.resolve(undefined)
    }
    await adding
    expect(first.read(FOLDER)).toEqual(new Set())
    expect(second.read(OTHER)).toEqual(new Set())
  })

  it('does not join a revocation that wins its first-generation publication race', async () => {
    const file = grantsFile()
    const held = Promise.withResolvers<undefined>()
    const released = Promise.withResolvers<undefined>()
    vi.mocked(link).mockImplementation(async (from, to) => {
      held.resolve(undefined)
      await released.promise
      await actualFs.link(from, to)
    })
    const first = fileStore(file)
    const adding = first.add(FOLDER, ['webSearch'])
    const failed = expect(adding).rejects.toThrow('revoked while this grant was being initialized')
    try {
      await held.promise
      await fileStore(file).forget(['webSearch'])
    } finally {
      released.resolve(undefined)
    }
    await failed
    expect(first.read(FOLDER)).toEqual(new Set())
    await first.add(OTHER, ['webSearch'])
    expect(first.read(OTHER)).toEqual(new Set(['webSearch']))
  })

  it('preserves a newer explicit grant when an old-generation writer finishes last', async () => {
    const { file, first, second } = await grantedStores()
    const { held, released } = holdFirstRename(
      (_from, to) =>
        path.dirname(String(to)) === path.join(`${file}.d`, 'webSearch') &&
        path.basename(String(to)).startsWith(`${workspaceKey(FOLDER)}.`),
    )
    const older = second.add(FOLDER, ['webSearch'])
    try {
      await held.promise
      await first.forget(['webSearch'])
      expect(first.read(FOLDER)).toEqual(new Set())
      await first.add(FOLDER, ['webSearch'])
      expect(first.read(FOLDER)).toEqual(new Set(['webSearch']))
    } finally {
      released.resolve(undefined)
    }
    await older
    expect(second.read(FOLDER)).toEqual(new Set(['webSearch']))
  })

  it('grants nothing when publication fails, and permits a later explicit grant', async () => {
    const file = grantsFile()
    const store = fileStore(file)
    vi.mocked(link).mockRejectedValueOnce(new Error('hard links unavailable'))
    await expect(store.add(FOLDER, ['webSearch'])).rejects.toThrow('hard links unavailable')
    expect(store.read(FOLDER)).toEqual(new Set())
    await store.add(FOLDER, ['webSearch'])
    expect(store.read(FOLDER)).toEqual(new Set(['webSearch']))
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (String(to) === grantPath(file, 'webSearch', OTHER)) {
        throw new Error('grant replacement failed')
      }
      await actualFs.rename(from, to)
    })
    await expect(store.add(OTHER, ['webSearch'])).rejects.toThrow('grant replacement failed')
    expect(store.read(OTHER)).toEqual(new Set())
    expect(store.read(FOLDER)).toEqual(new Set(['webSearch']))
  })
})
