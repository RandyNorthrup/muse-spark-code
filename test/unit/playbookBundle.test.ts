// /playbook's journal bundle (M116, PLAN.md D6): the loader that refuses a
// missing or malformed module with fixed words, and the shipped CommonJS
// bundle itself, built and required the way the ACP agent requires it, run
// over temporary folders (the file-backed surface, not the engine).

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isPlaybookBundle, playbookLoader } from '../../src/runtime/playbook/playbookBundle'
import { PLAYBOOK_BUNDLE_FILE, UI_TEXT } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { sharedUiText } from './helpers/modelApiBundle'
import { removeFolder } from './helpers/temporaryFolders'

const built = { folder: '', file: '' }

// Built as scripts/build.mjs builds it (its shared plugins inline).
beforeAll(async () => {
  built.folder = mkdtempSync(path.join(tmpdir(), 'muse-playbook-bundle-'))
  built.file = path.join(built.folder, PLAYBOOK_BUNDLE_FILE)
  await build({
    entryPoints: {
      [path.parse(PLAYBOOK_BUNDLE_FILE).name]: path.resolve(
        'src/runtime/playbook/playbookEntry.ts',
      ),
      uiText: path.resolve('src/shared/l10n/en.ts'),
    },
    outdir: built.folder,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20.18',
    plugins: [sharedUiText],
    logLevel: 'silent',
  })
})
afterAll(() => removeFolder(built.folder))

describe('isPlaybookBundle', () => {
  it('accepts a module that exports the surface, and nothing else', () => {
    const fns = {
      parsePlaybookCommand: () => undefined,
      createPlaybookSurface: () => undefined,
      runPlaybookCommand: () => Promise.resolve({ ok: true, text: '' }),
      runPlaybookCli: () => Promise.resolve(0),
    }
    expect(isPlaybookBundle(fns)).toBe(true)
    expect(isPlaybookBundle({ ...fns, runPlaybookCli: 1 })).toBe(false)
    expect(isPlaybookBundle({ parsePlaybookCommand: () => undefined })).toBe(false)
    expect(isPlaybookBundle({})).toBe(false)
    expect(isPlaybookBundle(null)).toBe(false)
    expect(isPlaybookBundle('parsePlaybookCommand')).toBe(false)
  })
})

describe('playbookLoader', () => {
  it('answers unavailable for a missing bundle, logging the cause', () => {
    const log = new FakeLogOutputChannel()
    const load = playbookLoader(path.join(built.folder, 'no-such-bundle.js'), log)
    expect(() => load()).toThrow(UI_TEXT.playbookUnavailable)
    expect(log.error).toHaveBeenCalledOnce()
  })

  it('refuses a module with the wrong shape and tries again on the next call', () => {
    const file = path.join(built.folder, 'wrong-shape.js')
    writeFileSync(file, 'module.exports = { parsePlaybookCommand: 1 }\n')
    const load = playbookLoader(file, new FakeLogOutputChannel())
    expect(() => load()).toThrow(UI_TEXT.playbookUnavailable)
    expect(() => load()).toThrow(UI_TEXT.playbookUnavailable)
  })

  it('loads the built journal bundle once and keeps it', async () => {
    const log = new FakeLogOutputChannel()
    const load = playbookLoader(built.file, log)
    const bundle = load()
    expect(load()).toBe(bundle)
    expect(bundle.parsePlaybookCommand([])).toEqual({ view: 'status' })
    expect(bundle.parsePlaybookCommand(['nope'])).toBeUndefined()
    const data = mkdtempSync(path.join(tmpdir(), 'muse-playbook-data-'))
    const workspace = mkdtempSync(path.join(tmpdir(), 'muse-playbook-work-'))
    try {
      const port = bundle.createPlaybookSurface(
        { agentDataFolder: data, workspaceFolder: workspace, teamId: 'panel', laneId: 'test' },
        UI_TEXT,
        'en',
      )
      const result = await bundle.runPlaybookCommand({ view: 'status' }, port, UI_TEXT, 'en')
      expect(result.ok).toBe(true)
      expect(result.text).toContain(UI_TEXT.playbookTitle)
      const missing = await bundle.runPlaybookCommand({ view: 'status' }, undefined, UI_TEXT, 'en')
      expect(missing).toEqual({ ok: false, text: UI_TEXT.playbookUnavailable })
    } finally {
      await removeFolder(data)
      await removeFolder(workspace)
    }
  })
})
