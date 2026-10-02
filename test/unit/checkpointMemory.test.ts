// Muse Code's memory as activation composes it (M72, M86, PLAN.md D51/D63):
// real git and real native file I/O under a real checkpoint port, the store
// and the view's lease from `createCheckpointedMemory` (the one factory
// activation calls), and a second window on the same folder. Only the editor
// (quick picks, boxes, the trash) is the `vscode` mock, and its delete removes
// the file for real. What the model's memory tools record for a restore is
// tested with the recorder (writeRecorder.test.ts).

import { readFileSync } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { window, workspace } from 'vscode'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import { createCheckpointedMemory } from '../../src/host/backend/checkpointedMemory'
import { systemPath } from '../../src/host/backend/memoryIo'
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
import { nativeToolIo } from './helpers/fakeToolIo'
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
  const native = nativeToolIo()
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
    store: memory.viewStore,
    log: h.log,
    edit: memory.edit,
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

describe('Muse Code memory as activation composes it (M72, M86)', () => {
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
      const deleting = Promise.withResolvers<undefined>()
      const resume = Promise.withResolvers<undefined>()
      trashFor(async () => {
        deleting.resolve(undefined)
        await resume.promise
      })
      pickRows('owned.md', 'delete')
      const showing = t.features.showMemory()
      try {
        // The delete holds, the note is still there, and no restore may start.
        await Promise.race([deleting.promise, finished(showing)])
        expect(await isPresent(t.h.root, OWNED)).toBe(true)
        expect(await peerRestore(t)).toEqual({ ok: false, reason: 'turnElsewhere' })
      } finally {
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
    'leaves a note in place when the window closes once the lease is held, before the trash',
    async () => {
      const t = await setup()
      await ownedNote(t)
      await changedFileTurn(t.h)
      const mark = t.port.markTurn.bind(t.port)
      vi.spyOn(t.port, 'markTurn').mockImplementation(async (key, isRunning) => {
        await mark(key, isRunning)
        if (isRunning && key.startsWith(CHECKPOINT_ACTIVITY_PREFIX)) {
          t.lifetime.abort()
        }
      })
      trashFor()
      pickRows('owned.md', 'delete')
      await t.features.showMemory()
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

/** A write of one export file, as activation wires it, held inside its lease until `release`. */
async function heldExport(t: Setup, file: string) {
  const holding = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const editing = withCheckpointEditAt(
    t.port,
    t.h.log,
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

describe('an export the user places (M72, M86)', () => {
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

  it(
    "never records an export written into the workspace while a turn ran, so that turn's restore leaves it",
    async () => {
      const t = await setup()
      await write(t.h.root, 'a.txt', 'a0\n')
      await turn(t.h, 't1', async (tool) => {
        await tool('a.txt', 'a1\n')
        const held = await heldExport(t, path.join(t.h.root, 'export.md'))
        held.release()
        await held.editing
      })
      const restored = await restoreTurn(t.h.store, 't1')
      expect(restored.changed).toEqual(['a.txt'])
      expect(restored.refused).toEqual([])
      expect(await read(t.h.root, 'export.md')).toBe('# Exported\n')
      expect(await read(t.h.root, 'a.txt')).toBe('a0\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('activation builds the memory through the checkpointed composition (M72, M86)', () => {
  it('has no raw memory store, gives the view its lease, and the turns their own writes', () => {
    // src/extension.ts is excluded from the unit run (vitest.config.ts): what
    // a unit test can hold it to is the wiring itself.
    const source = readFileSync(
      fileURLToPath(new URL('../../src/extension.ts', import.meta.url)),
      'utf8',
    )
    expect(source).toMatch(/createCheckpointedMemory\(\s*toolIo,\s*checkpoints,/)
    // The view writes as the user, never recorded; the model's memory tools
    // write through their turn's own writes (M86).
    expect(source).toMatch(/store:\s*memory\.viewStore,\s*log,\s*edit:\s*memory\.edit,\s*\}/)
    expect(source).toMatch(/memory:\s*memory\.store,/)
    expect(source).toMatch(/memory:\s*memory\.turnWrites,/)
    // Every turn, a child turn with its top turn's decision, through the window's one recorder.
    expect(source).toMatch(
      /beforeTurnRuns:\s*\(sessionId, turnId, top\) =>\s*prepareCheckpointTurn\(checkpoints, turnRecorder, sessionId, turnId, log, top\)/,
    )
    expect(source).toMatch(
      /afterTurnRuns:\s*\(sessionId, turnId, end\) =>\s*finishCheckpointTurn\(checkpoints, turnRecorder, sessionId, turnId, end\)/,
    )
    // One window recording: the store's restores and the turns' recorder share its journal and lanes.
    expect(source).toMatch(
      /instance: writeRecording\.instance,\s*journal: writeRecording\.journal,\s*lanes: writeRecording\.lanes,/,
    )
    expect(source).toMatch(
      /: writeRecording\.recorder\(\{\s*io: checkpointedIo,\s*memory: memory\.turnWrites,/,
    )
    // The guard the memory captures for each mutation is the window's own
    // native-start guard, not a no-op.
    expect(source).toMatch(
      /captureGuard:\s*\(\)\s*=>\s*backend\.workspaceActionGuard\(nativeStarts\.signal\)/,
    )
    // The exports the user places are written under the same lease, the same
    // guard, and the workspace root and platform the restore compares with.
    expect(source).toMatch(
      /editFile:\s*async \(fsPath, work\) =>\s*await withCheckpointEditAt\(\s*checkpoints,\s*log,\s*backend\.workspaceActionGuard\(nativeStarts\.signal\),\s*\{\s*root: checkpointRoot\?\.canonicalRoot \?\? workspaceRoot,\s*displayRoot: workspaceRoot,\s*platform: process\.platform,?\s*\},\s*fsPath,\s*work,\s*\)/,
    )
    // What else the extension writes in the user's name is under the lease
    // and never recorded (M86): Create AGENTS.md and Revert's write, Revert's
    // delete, and a plan's publication or stale-stage removal.
    expect(source).toMatch(
      /const writeUserFile = async \(check: \(\) => void, fsPath: string, content: string\) => \{\s*await withCheckpointEdit\(checkpoints, log, check, async \(\) => \{\s*await vscode\.workspace\.fs\.writeFile\(/,
    )
    expect(source).toMatch(
      /writeFile: async \(fsPath, content\) => \{\s*await writeUserFile\(backend\.workspaceActionGuard\(nativeStarts\.signal\), fsPath, content\)/,
    )
    expect(source).toMatch(
      /writeFile: \(fsPath, content\) => writeUserFile\(check, fsPath, content\),/,
    )
    expect(source).toMatch(
      /await withCheckpointEdit\(checkpoints, log, check, async \(\) => \{\s*await vscode\.workspace\.fs\.delete\(/,
    )
    expect(source).not.toContain('asUserEdit')
    expect(source).not.toContain('noteUserSave')
    expect(source).not.toContain('noteUserWrite')
    // Sessions, the CLI's working directory and memory are keyed by the folder as
    // VS Code spells it, as they always were: opening a workspace through a link,
    // a junction or a mapped drive must not hide the conversations saved under
    // that spelling. Only the checkpoint store takes the canonical root.
    expect(source).toMatch(/const workspaceRoot = firstFolderPath\(\)/)
    expect(source).not.toMatch(/const workspaceRoot = checkpointRoot/)
    expect(source).not.toContain('new MemoryStore(')
    expect(source).not.toContain('createMemoryIo(')
  })
})
