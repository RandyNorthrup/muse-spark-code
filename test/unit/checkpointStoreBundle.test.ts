// Exercise the shipped factory through a real CommonJS build/require, not a
// replacement store. Its own localization state must receive activation's.
import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildSync } from 'esbuild'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { turnKey } from '../../src/core/checkpoints/turnKey'
import {
  checkpointStoreLoader,
  isCheckpointStoreBundle,
} from '../../src/host/checkpoints/checkpointStoreBundle'
import type {
  CheckpointStore,
  CheckpointStoreDeps,
} from '../../src/host/checkpoints/checkpointStore'
import { GitExitError, GitMissingError, processGitProcess } from '../../src/host/git'
import { requireFile } from '../../src/host/lazyBundle'
import {
  CHECKPOINT_FENCED_WINDOW,
  CHECKPOINT_STORE_BUNDLE_FILE,
  UI_TEXT,
} from '../../src/shared/constants'
import { uiLocale } from '../../src/shared/l10n/text'
import { harness, REAL_GIT_TIMEOUT_MS, removeCheckpointFolders } from './helpers/checkpointHarness'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'

const built = { folder: '', file: '' }
const stores: CheckpointStore[] = []

beforeAll(() => {
  built.folder = mkdtempSync(path.join(tmpdir(), 'muse-checkpoint-bundle-'))
  built.file = path.join(built.folder, CHECKPOINT_STORE_BUNDLE_FILE)
  buildSync({
    entryPoints: [path.resolve('src/host/checkpoints/checkpointStoreEntry.ts')],
    outfile: built.file,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20.18',
    logLevel: 'silent',
  })
})
afterEach(async () => {
  for (const store of stores.splice(0)) store.dispose()
  await removeCheckpointFolders()
})
afterAll(() => removeFolder(built.folder))

async function storeDeps(): Promise<CheckpointStoreDeps> {
  const h = await harness({ git: 'none' })
  return {
    workspaceRoot: h.root,
    storageDir: h.storage,
    platform: process.platform,
    git: processGitProcess(),
    env: process.env,
    retentionDays: () => 0,
    now: () => Date.now(),
    newId: () => randomUUID(),
    pid: process.pid,
    isProcessAlive: () => true,
    log: h.log,
  }
}

describe('the checkpoint store bundle (M72)', () => {
  it(
    'captures with native Git while preserving an activation-copy exit-one config error',
    async () => {
      const deps = await storeDeps()
      const nativeGit = processGitProcess()
      const store = checkpointStoreLoader({
        bundlePath: built.file,
        log: deps.log,
      })().createCheckpointStore(
        {
          ...deps,
          git: async (args, options) => {
            if (args.includes('core.excludesFile')) throw new GitExitError(1, '', 'config')
            return await nativeGit(args, options)
          },
        },
        UI_TEXT,
        uiLocale(),
      )
      stores.push(store)
      writeFileSync(path.join(deps.workspaceRoot, 'owned.txt'), 'captured native bytes')
      const captured = await store.capture()
      expect(captured).toMatchObject({ ok: true })
      if (!captured.ok) throw new Error('Expected real native capture')
      await store.release(captured.snapshot)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'captures in the relative repository spelling and refuses a path git cannot open, through the built factory',
    async () => {
      const deps = await storeDeps()
      const module = checkpointStoreLoader({ bundlePath: built.file, log: deps.log })()
      const repository = path.join(deps.storageDir, 'shadow.git').length
      // git's PATH_MAX lowered so this repository is too long to write
      // absolute (PATH_MAX - 40) yet still opens (PATH_MAX - 9), then one
      // short of opening.
      const nativeGit = processGitProcess()
      const gitDirs = new Set<string | undefined>()
      const relative = module.createCheckpointStore(
        {
          ...deps,
          gitPathMax: repository + 20,
          git: async (args, options) => {
            gitDirs.add(options.env['GIT_DIR'])
            return await nativeGit(args, options)
          },
        },
        UI_TEXT,
        uiLocale(),
      )
      stores.push(relative)
      writeFileSync(path.join(deps.workspaceRoot, 'owned.txt'), 'captured native bytes')
      const captured = await relative.capture()
      expect(captured).toMatchObject({ ok: true })
      if (!captured.ok) throw new Error('Expected real native capture')
      await relative.release(captured.snapshot)
      // Only the repository's commands carry GIT_DIR, and every one is relative.
      expect([...gitDirs].filter((dir) => dir !== undefined)).toEqual(['shadow.git'])
      const refused = module.createCheckpointStore(
        { ...deps, gitPathMax: repository + 8 },
        UI_TEXT,
        uiLocale(),
      )
      stores.push(refused)
      await expect(refused.capture()).resolves.toMatchObject({
        ok: false,
        reason: 'pathTooLong',
      })
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it('keeps activation-copy missing-Git refusal distinct from a failed capture', async () => {
    const deps = await storeDeps()
    const store = checkpointStoreLoader({
      bundlePath: built.file,
      log: deps.log,
    })().createCheckpointStore(
      {
        ...deps,
        git: () => Promise.reject(new GitMissingError()),
      },
      UI_TEXT,
      uiLocale(),
    )
    stores.push(store)
    await expect(store.capture()).resolves.toMatchObject({ ok: false, reason: 'noGit' })
  })

  it('loads once at construction and preserves immediate activity, safety and disposal', async () => {
    const deps = await storeDeps()
    const load = vi.fn(requireFile)
    const module = checkpointStoreLoader({
      bundlePath: built.file,
      log: deps.log,
      loadBundle: load,
    })
    expect(load).not.toHaveBeenCalled()
    const store = module().createCheckpointStore(deps, UI_TEXT, uiLocale())
    stores.push(store)
    expect(module()).toBe(module())
    expect(load).toHaveBeenCalledOnce()
    expect(store.isNativeUnsafe).toBe(false)
    const key = turnKey('session', 'turn')
    await store.markTurn(key, true, false)
    const presenceDir = path.join(deps.storageDir, 'windows')
    const files = await readdir(presenceDir)
    expect(files).toHaveLength(1)
    const presence: unknown = JSON.parse(
      await readFile(path.join(presenceDir, files[0] ?? ''), 'utf8'),
    )
    expect(presence).toMatchObject({ running: [CHECKPOINT_FENCED_WINDOW, key] })
    await store.markTurn(key, false, false)
    store.dispose()
    await expect(store.markTurn('late', true, false)).rejects.toThrow(UI_TEXT.sendMarkFailed)
  })

  it('installs activation localization before the real store and legacy reader run', async () => {
    const deps = await storeDeps()
    const module = checkpointStoreLoader({ bundlePath: built.file, log: deps.log })()
    const table = {
      ...UI_TEXT,
      sendMarkFailed: 'localized startup refusal',
      checkpointFailed: 'localized legacy refusal',
    }
    const store = module.createCheckpointStore(deps, table, 'de')
    stores.push(store)
    store.dispose()
    await expect(store.markNativeBackend()).rejects.toThrow(table.sendMarkFailed)
    const legacyTable = { ...UI_TEXT, checkpointFailed: 'second localized legacy refusal' }
    writeFileSync(
      path.join(deps.workspaceRoot, 'records.json'),
      '{"version":"bad","checkpoints":[]}',
    )
    await expect(
      module.legacyCheckpointTurns(
        {
          storageDir: deps.workspaceRoot,
          workspaceRoot: deps.workspaceRoot,
          platform: deps.platform,
          git: deps.git,
          env: deps.env,
          signal: new AbortController().signal,
        },
        'session',
        legacyTable,
        'de',
      ),
    ).rejects.toThrow(legacyTable.checkpointFailed)
  })

  it('refuses a missing or malformed module, then loads the repaired packaged factory', async () => {
    const log = new FakeLogOutputChannel()
    const missing = checkpointStoreLoader({
      bundlePath: path.join(built.folder, 'missing.js'),
      log,
    })
    expect(() => missing()).toThrow(UI_TEXT.checkpointFailed)
    expect(() => missing()).toThrow(UI_TEXT.checkpointFailed)
    const wrong = path.join(built.folder, 'wrong.js')
    writeFileSync(wrong, 'module.exports = { createCheckpointStore() {} }')
    const repaired = checkpointStoreLoader({ bundlePath: wrong, log })
    expect(() => repaired()).toThrow(UI_TEXT.checkpointFailed)
    copyFileSync(built.file, wrong)
    const deps = await storeDeps()
    const store = repaired().createCheckpointStore(deps, UI_TEXT, uiLocale())
    stores.push(store)
    expect(store.isNativeUnsafe).toBe(false)
  })

  it('requires both packaged entry functions', () => {
    const noop = () => undefined
    expect(isCheckpointStoreBundle(undefined)).toBe(false)
    expect(isCheckpointStoreBundle(null)).toBe(false)
    expect(isCheckpointStoreBundle({ createCheckpointStore: noop })).toBe(false)
    expect(
      isCheckpointStoreBundle({ createCheckpointStore: noop, legacyCheckpointTurns: true }),
    ).toBe(false)
    expect(
      isCheckpointStoreBundle({ createCheckpointStore: noop, legacyCheckpointTurns: noop }),
    ).toBe(true)
  })
})
