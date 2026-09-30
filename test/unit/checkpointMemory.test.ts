// Muse Code's memory as activation composes it (M72, PLAN.md D51): real git
// and real native file I/O under a real checkpoint port, the store and the
// view's lease from `createCheckpointedMemory` (the one factory activation
// calls), and a second window on the same folder. Only the editor (quick
// picks, boxes, the trash) is the `vscode` mock, and its delete removes the
// file for real.

import { readFileSync } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { window, workspace } from 'vscode'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import type { MemoryStore } from '../../src/core/memory/memoryStore'
import { createCheckpointedMemory } from '../../src/host/backend/checkpointedMemory'
import { systemPath } from '../../src/host/backend/memoryIo'
import { createToolIo } from '../../src/host/backend/toolIo'
import {
  createCheckpointPort,
  withCheckpointEditAt,
} from '../../src/host/checkpoints/checkpointHost'
import { createMemoryFeatures } from '../../src/host/memoryFeatures'
import { CHECKPOINT_ACTIVITY_PREFIX, type MemoryScope, UI_TEXT } from '../../src/shared/constants'
import {
  changedFileTurn,
  harness,
  isPresent,
  read,
  REAL_GIT_TIMEOUT_MS,
  removeCheckpointFolders,
  restoreOutcome,
  restoreTurn,
  turn,
  write,
} from './helpers/checkpointHarness'
import { fakeMuseCodeManager } from './helpers/museCodeManager'
import { confirmModal, pickOne, resetMemoryViewMocks } from './helpers/vscodeViews'

const NOTES = '.agents/memory'
const OWNED = `${NOTES}/owned.md`
const INDEX = `${NOTES}/MEMORY.md`
const OWNED_TEXT = 'original memory\n'
const INDEX_TEXT = '- [owned](owned.md) | Owned\n'

afterEach(removeCheckpointFolders)

beforeEach(resetMemoryViewMocks)

interface SetupOptions {
  /** Muse Code's personal data folders live below the workspace (a window opened on the home). */
  readonly isDataInWorkspace?: boolean
  /** The native file lookup of a path ending like this waits, once, for `release`. */
  readonly holdLookupOf?: string
  /** A Restricted Mode window: no git runs, and the view must still work. */
  readonly isRestricted?: boolean
}

async function setup(options: SetupOptions = {}) {
  const h = await harness()
  await write(h.root, '.gitignore', '.agents/memory/\n')
  const dataFolder = options.isDataInWorkspace
    ? path.join(h.root, '.muse-data')
    : path.join(path.dirname(h.top), 'data')
  const dataRoot = path.join(dataFolder, 'muse', 'memory')
  const port = createCheckpointPort({
    store: h.store,
    isNamespaceKnown: () => true,
    isEnabled: () => true,
    isWorkspaceTrusted: () => options.isRestricted !== true,
    hasGit: () => true,
  })
  const native = createToolIo({
    platform: process.platform,
    systemRoot: process.env['SystemRoot'],
    env: () => ({}),
    listFiles: () => Promise.resolve([]),
    searchWorkerPath: 'unused',
    log: () => undefined,
    unsavedFiles: () => [],
  })
  const lookup = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  let isHolding = options.holdLookupOf !== undefined
  const io: ToolIo = {
    ...native,
    realPath: async (file) => {
      if (isHolding && file.endsWith(options.holdLookupOf ?? '')) {
        isHolding = false
        lookup.resolve(undefined)
        await release.promise
      }
      return await native.realPath(file)
    },
  }
  const lifetime = new AbortController()
  const manager = fakeMuseCodeManager({ workspaceRoot: h.root })
  const memory = createCheckpointedMemory(io, port, {
    platform: process.platform,
    dataRoot: () => dataRoot,
    workspaceRoot: h.root,
    systemPath,
    warn: (message) => {
      h.log.warn(message)
    },
    // What activation passes: the backend's guard over the window's lifetime.
    captureGuard: () => manager.workspaceActionGuard(lifetime.signal),
  })
  const features = createMemoryFeatures({
    store: memory.store,
    log: h.log,
    edit: memory.edit,
    beforeDelete: memory.beforeDelete,
  })
  return {
    h,
    port,
    memory,
    features,
    lifetime,
    dataRoot,
    /** Resolves once the held lookup is reached (or never, when nothing holds). */
    heldLookup: lookup.promise,
    release: () => {
      release.resolve(undefined)
    },
  }
}

type Setup = Awaited<ReturnType<typeof setup>>

async function place(store: MemoryStore, scope: MemoryScope, name: string) {
  const located = await store.locate(scope, name)
  if (!located.ok) {
    throw new Error(located.reason)
  }
  return located.value
}

/** Each quick pick answers with the row whose id or label is next. */
function pickRows(...wanted: string[]) {
  const queue = [...wanted]
  vi.mocked(pickOne).mockImplementation((items) => {
    const row = queue.shift()
    return Promise.resolve(
      items.find((item) => ('id' in item && item.id === row) || item.label === row),
    )
  })
}

/** The editor side of a new note: its name, then its description. */
function typeNote(name: string, description: string) {
  vi.mocked(window.showInputBox).mockResolvedValueOnce(name).mockResolvedValueOnce(description)
}

/** The editor's delete, which removes the file for real, after `before`. */
function trashFor(before: () => Promise<void> = () => Promise.resolve()) {
  vi.mocked(workspace.fs.delete).mockImplementation(async (uri) => {
    await before()
    await rm(uri.fsPath)
  })
  vi.mocked(confirmModal).mockResolvedValue('Delete')
}

async function ownedNote(t: Setup): Promise<void> {
  await write(t.h.root, OWNED, OWNED_TEXT)
  await write(t.h.root, INDEX, INDEX_TEXT)
}

/** The turn restored: the note and its index are as they were before it. */
async function restoreOwnedNote(t: Setup): Promise<void> {
  const restored = await restoreTurn(t.h.store, 't1')
  expect(restored.refused).toEqual([])
  expect(await read(t.h.root, OWNED)).toBe(OWNED_TEXT)
  expect(await read(t.h.root, INDEX)).toBe(INDEX_TEXT)
}

/** Another window's restore of the turn a.txt changed, which a held lease must refuse. */
async function peerRestore(t: Setup) {
  return await restoreOutcome(t.h.reopen(), 't1')
}

async function isPeerRestoreOk(t: Setup): Promise<boolean> {
  const outcome = await peerRestore(t)
  return outcome.ok
}

/** A new note asked for in the view, run to the held native lookup (or to its end, when nothing holds). */
async function startNote(t: Setup, scope: MemoryScope): Promise<{ showing: Promise<void> }> {
  pickRows('action:new', scope)
  typeNote('tabs', 'Indentation')
  const showing = t.features.showMemory()
  await Promise.race([t.heldLookup, finished(showing)])
  return { showing }
}

/** Another window's restore while the view's work is held; the hold is let go after it. */
async function restoreWhileHeld(t: Setup) {
  try {
    return await peerRestore(t)
  } finally {
    t.release()
  }
}

/** Settles when `work` does, so a race against a hold ends either way. */
async function finished(work: Promise<unknown>): Promise<undefined> {
  await work
}

/** Holds the checkpoint copy of one path; the test sees whether the copy was reached. */
function holdCopyOf(t: Setup, absolute: string) {
  const reached = Promise.withResolvers<undefined>()
  const resume = Promise.withResolvers<undefined>()
  const copy = t.port.beforeToolWrite.bind(t.port)
  const copies: string[] = []
  vi.spyOn(t.port, 'beforeToolWrite').mockImplementation(async (file) => {
    copies.push(file)
    if (file === absolute) {
      reached.resolve(undefined)
      await resume.promise
    }
    await copy(file)
  })
  return {
    copies,
    reached: reached.promise,
    resume: () => {
      resume.resolve(undefined)
    },
  }
}

describe('Muse Code memory as activation composes it (M72)', () => {
  it(
    'keeps an ignored note, its index and a new note for a restore, as the tools write them',
    async () => {
      const t = await setup()
      await ownedNote(t)
      await turn(t.h, 't1', async () => {
        const owned = await place(t.memory.store, 'project', 'owned.md')
        await t.memory.store.edit(owned, { old_str: 'original', new_str: 'late' })
        const added = await place(t.memory.store, 'project', 'added.md')
        await t.memory.store.add(added, { content: 'added memory\n', description: 'Added' })
        expect(await read(t.h.root, OWNED)).toBe('late memory\n')
        expect(await read(t.h.root, INDEX)).toContain('added.md')
      })
      await restoreOwnedNote(t)
      expect(await isPresent(t.h.root, `${NOTES}/added.md`)).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'takes the copy of an exclusive creation before it publishes anything',
    async () => {
      const t = await setup()
      const added = path.join(t.h.root, NOTES, 'added.md')
      const copy = holdCopyOf(t, added)
      const writing = t.memory.store.add(await place(t.memory.store, 'project', 'added.md'), {
        content: 'added memory\n',
      })
      await Promise.race([copy.reached, finished(writing)])
      try {
        expect(copy.copies).toContain(added)
        expect(await isPresent(t.h.root, NOTES)).toBe(false)
      } finally {
        copy.resume()
      }
      const written = await writing
      expect(written.ok).toBe(true)
      expect(await read(t.h.root, `${NOTES}/added.md`)).toBe('added memory\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'publishes nothing when the copy of a new note cannot be kept',
    async () => {
      const t = await setup()
      vi.spyOn(t.port, 'beforeToolWrite').mockRejectedValue(new Error(UI_TEXT.checkpointFailed))
      const outcome = await t.memory.store.add(await place(t.memory.store, 'project', 'added.md'), {
        content: 'added memory\n',
      })
      expect(outcome).toEqual({ ok: false, reason: UI_TEXT.checkpointFailed })
      expect(await isPresent(t.h.root, NOTES)).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps a note the view trashes, and its index, for a restore',
    async () => {
      const t = await setup()
      await ownedNote(t)
      trashFor()
      await turn(t.h, 't1', async () => {
        pickRows('owned.md', 'delete')
        await t.features.showMemory()
        expect(await isPresent(t.h.root, OWNED)).toBe(false)
        expect(await read(t.h.root, INDEX)).toBe('')
      })
      await restoreOwnedNote(t)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each([
    ['trusted', false],
    ['in Restricted Mode, where no git runs', true],
  ])(
    'holds a view creation in the project under the lease until its native publication settles (%s)',
    async (_name, isRestricted) => {
      const t = await setup({ holdLookupOf: 'tabs.md', isRestricted })
      await changedFileTurn(t.h)
      const { showing } = await startNote(t, 'project')
      const during = await restoreWhileHeld(t)
      await showing
      expect(during).toEqual({ ok: false, reason: 'turnElsewhere' })
      expect(await read(t.h.root, `${NOTES}/tabs.md`)).toBe(
        '---\ndescription: Indentation\n---\n\n',
      )
      expect(await read(t.h.root, INDEX)).toBe('- [tabs](tabs.md) | Indentation\n')
      expect(window.showErrorMessage).not.toHaveBeenCalled()
      expect(t.h.store.isNativeUnsafe).toBe(false)
      expect(await isPeerRestoreOk(t)).toBe(true)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'holds a view trash and its index line under the lease until the delete settles',
    async () => {
      const t = await setup()
      await ownedNote(t)
      await changedFileTurn(t.h)
      const copy = holdCopyOf(t, path.join(t.h.root, OWNED))
      const deleting = Promise.withResolvers<undefined>()
      const resume = Promise.withResolvers<undefined>()
      trashFor(async () => {
        deleting.resolve(undefined)
        await resume.promise
      })
      pickRows('owned.md', 'delete')
      const showing = t.features.showMemory()
      try {
        await Promise.race([copy.reached, deleting.promise, finished(showing)])
        // The copy comes first; then the delete holds, the note is still there, and no restore may start.
        expect(copy.copies[0]).toBe(path.join(t.h.root, OWNED))
        copy.resume()
        await Promise.race([deleting.promise, finished(showing)])
        expect(await isPresent(t.h.root, OWNED)).toBe(true)
        expect(await peerRestore(t)).toEqual({ ok: false, reason: 'turnElsewhere' })
      } finally {
        copy.resume()
        resume.resolve(undefined)
      }
      await showing
      expect(await isPresent(t.h.root, OWNED)).toBe(false)
      expect(await read(t.h.root, INDEX)).toBe('')
      expect(t.h.store.isNativeUnsafe).toBe(false)
      expect(await isPeerRestoreOk(t)).toBe(true)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'leaves a note in place when the window closes after its copy, before the trash',
    async () => {
      const t = await setup()
      await ownedNote(t)
      await changedFileTurn(t.h)
      const copy = holdCopyOf(t, path.join(t.h.root, OWNED))
      trashFor()
      pickRows('owned.md', 'delete')
      const showing = t.features.showMemory()
      await Promise.race([copy.reached, showing])
      t.lifetime.abort()
      copy.resume()
      await showing
      expect(workspace.fs.delete).not.toHaveBeenCalled()
      expect(await read(t.h.root, OWNED)).toBe(OWNED_TEXT)
      expect(await read(t.h.root, INDEX)).toBe(INDEX_TEXT)
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        `${UI_TEXT.memoryFailed}: ${UI_TEXT.questionCancelled}`,
      )
      expect(await isPeerRestoreOk(t)).toBe(true)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'does not trash a note whose copy cannot be kept',
    async () => {
      const t = await setup()
      await ownedNote(t)
      vi.spyOn(t.port, 'beforeToolWrite').mockRejectedValue(new Error(UI_TEXT.checkpointFailed))
      trashFor()
      pickRows('owned.md', 'delete')
      await t.features.showMemory()
      expect(workspace.fs.delete).not.toHaveBeenCalled()
      expect(await read(t.h.root, OWNED)).toBe(OWNED_TEXT)
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        `${UI_TEXT.memoryFailed}: ${UI_TEXT.checkpointFailed}`,
      )
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'takes no project lease for personal notes outside the workspace, and leaves restores free',
    async () => {
      const t = await setup({ holdLookupOf: 'tabs.md' })
      await changedFileTurn(t.h)
      const marks = vi.spyOn(t.port, 'markTurn')
      const personal = path.join(t.dataRoot, 'personal')
      await mkdir(personal, { recursive: true })
      await write(personal, 'prefs.md', 'Prefers tabs.\n')
      const { showing } = await startNote(t, 'personal')
      const during = await restoreWhileHeld(t)
      await showing
      expect(during).toMatchObject({ ok: true, changed: ['a.txt'] })
      expect(await read(personal, 'tabs.md')).toBe('---\ndescription: Indentation\n---\n\n')
      trashFor()
      pickRows('prefs.md', 'delete')
      await t.features.showMemory()
      expect(await isPresent(personal, 'prefs.md')).toBe(false)
      expect(await read(personal, 'MEMORY.md')).toBe('- [tabs](tabs.md) | Indentation\n')
      expect(
        marks.mock.calls.filter(([key]) => key.startsWith(CHECKPOINT_ACTIVITY_PREFIX)),
      ).toEqual([])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'still refuses a closed window its personal note, without a project lease',
    async () => {
      const t = await setup()
      const marks = vi.spyOn(t.port, 'markTurn')
      t.lifetime.abort()
      pickRows('action:new', 'personal')
      typeNote('tabs', 'Indentation')
      await t.features.showMemory()
      expect(await isPresent(t.dataRoot, 'personal/tabs.md')).toBe(false)
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        `${UI_TEXT.memoryFailed}: ${UI_TEXT.questionCancelled}`,
      )
      expect(marks).not.toHaveBeenCalled()
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'takes the lease for a personal scope that lives below the workspace folder',
    async () => {
      const t = await setup({ isDataInWorkspace: true, holdLookupOf: 'tabs.md' })
      await changedFileTurn(t.h)
      const { showing } = await startNote(t, 'personal')
      const during = await restoreWhileHeld(t)
      await showing
      expect(during).toEqual({ ok: false, reason: 'turnElsewhere' })
      expect(await isPresent(t.dataRoot, 'personal/tabs.md')).toBe(true)
      expect(await isPeerRestoreOk(t)).toBe(true)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'creates and trashes a project note as before when nothing is held',
    async () => {
      const t = await setup()
      pickRows('action:new', 'project')
      typeNote('tabs', 'Indentation')
      await t.features.showMemory()
      expect(await read(t.h.root, `${NOTES}/tabs.md`)).toBe(
        '---\ndescription: Indentation\n---\n\n',
      )
      expect(window.showTextDocument).toHaveBeenCalledTimes(1)
      trashFor()
      pickRows('tabs.md', 'delete')
      await t.features.showMemory()
      expect(await isPresent(t.h.root, `${NOTES}/tabs.md`)).toBe(false)
      expect(await read(t.h.root, INDEX)).toBe('')
      expect(window.showErrorMessage).not.toHaveBeenCalled()
      expect(await readdir(path.join(t.h.root, NOTES))).toEqual(['MEMORY.md'])
      expect(t.h.store.isNativeUnsafe).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

/** A write of one export file, held inside its lease until `release`. */
async function heldExport(t: Setup, file: string) {
  const holding = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const editing = withCheckpointEditAt(
    t.port,
    () => undefined,
    { root: t.h.root, platform: process.platform },
    file,
    async () => {
      holding.resolve(undefined)
      await release.promise
      await writeFile(file, '# Exported\n')
    },
  )
  await Promise.race([holding.promise, finished(editing)])
  return {
    editing,
    release: () => {
      release.resolve(undefined)
    },
  }
}

describe('an export the user places (M72)', () => {
  it(
    'holds the lease of an export written into the workspace until its native write settles',
    async () => {
      const t = await setup()
      await changedFileTurn(t.h)
      const held = await heldExport(t, path.join(t.h.root, 'export.md'))
      try {
        expect(await peerRestore(t)).toEqual({ ok: false, reason: 'turnElsewhere' })
      } finally {
        held.release()
      }
      await held.editing
      expect(await read(t.h.root, 'export.md')).toBe('# Exported\n')
      expect(await isPeerRestoreOk(t)).toBe(true)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'takes no lease for an export written outside the workspace',
    async () => {
      const t = await setup()
      await changedFileTurn(t.h)
      const held = await heldExport(t, path.join(path.dirname(t.h.top), 'export.md'))
      let restored
      try {
        restored = await peerRestore(t)
      } finally {
        held.release()
      }
      await held.editing
      expect(restored).toMatchObject({ ok: true })
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('activation builds the memory through the checkpointed composition (M72)', () => {
  it('has no raw memory store, and gives the view the composition’s lease and copy', () => {
    // src/extension.ts is excluded from the unit run (vitest.config.ts): what
    // a unit test can hold it to is the wiring itself.
    const source = readFileSync(
      fileURLToPath(new URL('../../src/extension.ts', import.meta.url)),
      'utf8',
    )
    expect(source).toMatch(/createCheckpointedMemory\(\s*toolIo,\s*checkpoints,/)
    expect(source).toMatch(/edit:\s*memory\.edit,\s*beforeDelete:\s*memory\.beforeDelete,/)
    expect(source).toMatch(/memory:\s*memory\.store,/)
    // The guard the memory captures for each mutation is the window's own
    // native-start guard, not a no-op.
    expect(source).toMatch(
      /captureGuard:\s*\(\)\s*=>\s*backend\.workspaceActionGuard\(nativeStarts\.signal\)/,
    )
    // The exports the user places are written under the same lease, the same
    // guard, and the workspace root and platform the restore compares with.
    expect(source).toMatch(
      /editFile:\s*async \(fsPath, work\) =>\s*await withCheckpointEditAt\(\s*checkpoints,\s*backend\.workspaceActionGuard\(nativeStarts\.signal\),\s*\{ root: workspaceRoot, platform: process\.platform \},\s*fsPath,\s*work,\s*\)/,
    )
    expect(source).not.toContain('new MemoryStore(')
    expect(source).not.toContain('createMemoryIo(')
  })
})
