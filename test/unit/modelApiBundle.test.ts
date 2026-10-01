// The Model API backend's own bundle (M57, PLAN.md D6): src/host/backend/
// modelApiEntry.ts built with esbuild into a temporary folder, in the
// production build's format, platform and target, then required by
// `ModelApiBackendManager` with Node's own `require`, as the extension
// requires dist/modelApi.js. The host it builds is the bundle's: its
// classes and its localization state are copies of this file's, which is
// what the error guards and the table handoff are for.

import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  type AgentSession,
  GoalRefusedError,
  isGoalRefusedError,
} from '../../src/core/agent/agentBackend'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { ModelApiBackendManager } from '../../src/host/backend/modelApiBackendManager'
import { loadUiTable } from '../../src/host/l10n'
import type { AgentEvent } from '../../src/shared/agentEvents'
import {
  GOAL_OBJECTIVE_MAX_CHARS,
  MODEL_API_BUNDLE_FILE,
  UI_TEXT,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApi } from './helpers/fakeModelApi'
import { buildModelApiBundle } from './helpers/modelApiBundle'
import { fakeManagerDeps } from './helpers/modelApiManager'
import { removeFolder } from './helpers/temporaryFolders'

const ROOT = '/ws'
const MODEL = 'muse-spark-1.3'
const built = { folder: '', file: '' }

beforeAll(async () => {
  built.folder = mkdtempSync(path.join(tmpdir(), 'muse-model-api-bundle-'))
  built.file = await buildModelApiBundle(built.folder)
})

/** Installs both runtime modules into a fixture that started with a missing or broken backend. */
function copyBundleTo(file: string): void {
  copyFileSync(built.file, file)
  copyFileSync(path.join(built.folder, 'uiText.js'), path.join(path.dirname(file), 'uiText.js'))
}

afterAll(() => removeFolder(built.folder))

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

/** A manager over the fake API whose bundle is the file at `bundlePath`, required for real. */
function managerFor(bundlePath: string) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  let ids = 0
  const manager = new ModelApiBackendManager(
    fakeManagerDeps(api, log, {
      workspaceRoot: ROOT,
      newId: () => {
        ids += 1
        return `id-${String(ids)}`
      },
      bundlePath,
    }),
  )
  return { api, log, manager }
}

async function startSession(manager: ModelApiBackendManager): Promise<AgentSession> {
  const host = await manager.ensureHost()
  return await host.startSession({
    workspaceRoot: ROOT,
    modelId: MODEL,
    approvalMode: 'promptUnmatched',
  })
}

/** A folder of its own, removed after the file's tests. */
function scratchFolder(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'muse-model-api-missing-'))
  folders.push(folder)
  return folder
}

const folders: string[] = []
afterAll(async () => {
  await Promise.all(folders.map((folder) => removeFolder(folder)))
})

describe('the Model API bundle (M57)', () => {
  it('is required from its file and runs a turn on the fake Model API', async () => {
    const t = managerFor(built.file)
    const host = await t.manager.ensureHost()
    // The bundle's own class, not this file's: the host came from the built file.
    expect(host).not.toBeInstanceOf(ModelApiHost)
    expect(host.info).toMatchObject({ kind: 'modelApi', serverName: 'meta-model-api' })
    const session = await startSession(t.manager)
    const events: AgentEvent[] = []
    const completed = Promise.withResolvers<undefined>()
    session.onEvent((event) => {
      events.push(event)
      if (event.type === 'turnCompleted') {
        completed.resolve(undefined)
      }
    })
    t.api.script({ text: 'Hello from the bundle' })
    await session.sendTurn([{ type: 'text', text: 'Say hello' }])
    await completed.promise
    const replies = events.flatMap((event) =>
      event.type === 'itemCompleted' && event.item.kind === 'agentMessage' ? [event.item.text] : [],
    )
    expect(replies).toEqual(['Hello from the bundle'])
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'turnCompleted', terminal: 'completed' }),
    )
    expect(t.api.responseBodies()).toHaveLength(1)
    expect(t.log.info).toHaveBeenCalledWith(expect.stringContaining('Model API backend ready'))
    await t.manager.dispose()
  })

  it('refuses a missing file in the user’s words, logs the path, and loads it once it is there', async () => {
    const file = path.join(scratchFolder(), MODEL_API_BUNDLE_FILE)
    const t = managerFor(file)
    await expect(t.manager.ensureHost()).rejects.toThrow(UI_TEXT.modelApiBundleUnavailable)
    expect(t.manager.isRunning).toBe(false)
    expect(t.log.error).toHaveBeenCalledWith(expect.stringContaining(file))
    copyBundleTo(file)
    const host = await t.manager.ensureHost()
    expect(host.info.kind).toBe('modelApi')
    await t.manager.dispose()
  })

  it('refuses a file that is not JavaScript, or not the bundle, in the user’s words', async () => {
    const folder = scratchFolder()
    const corrupt = path.join(folder, 'corrupt.js')
    writeFileSync(corrupt, 'module.exports = {{ not javascript')
    const t = managerFor(corrupt)
    await expect(t.manager.ensureHost()).rejects.toThrow(UI_TEXT.modelApiBundleUnavailable)
    expect(t.log.error).toHaveBeenCalledWith(expect.stringContaining(corrupt))
    for (const [name, body] of [
      ['empty.js', 'module.exports = {}'],
      ['number.js', 'module.exports = 42'],
      ['string.js', "module.exports = { createModelApiHost: 'not a function' }"],
    ] as const) {
      const other = path.join(folder, name)
      writeFileSync(other, body)
      const wrong = managerFor(other)
      await expect(wrong.manager.ensureHost()).rejects.toThrow(UI_TEXT.modelApiBundleUnavailable)
      expect(wrong.log.error).toHaveBeenCalledWith(
        `${other} does not export the Model API backend's factory`,
      )
    }
  })

  it('reads a wrong-shaped file again once it is repaired in place (the review of PR #47)', async () => {
    const file = path.join(scratchFolder(), MODEL_API_BUNDLE_FILE)
    writeFileSync(file, 'module.exports = {}')
    const t = managerFor(file)
    await expect(t.manager.ensureHost()).rejects.toThrow(UI_TEXT.modelApiBundleUnavailable)
    // Node cached the module that ran; the manager must not keep reading that copy.
    copyBundleTo(file)
    const host = await t.manager.ensureHost()
    expect(host.info.kind).toBe('modelApi')
    await t.manager.dispose()
  })

  it('shows the host’s own sentences in the installed table and language (D33)', async () => {
    const de = await loadUiTable({
      language: 'de',
      readExtensionFile: (segments) =>
        Promise.resolve(readFileSync(path.join(...segments), 'utf8')),
      log: new FakeLogOutputChannel(),
    })
    expect(de.locale).toBe('de')
    const t = managerFor(built.file)
    const session = await startSession(t.manager)
    // A sentence the bundle's host fills in itself, with a number in the
    // table's own grouping: German writes four thousand as 4.000.
    await expect(
      session.controlGoal({ verb: 'set', objective: 'x'.repeat(GOAL_OBJECTIVE_MAX_CHARS + 1) }),
    ).rejects.toThrow('goal/set: Das Ziel darf höchstens 4.000 Zeichen lang sein.')
    await expect(session.controlGoal({ verb: 'set', objective: ' ' })).rejects.toThrow(
      `goal/set: ${de.table.goalObjectiveMissing}`,
    )
    await t.manager.dispose()
  })

  it('loads the shared English fallback without changing it when a language is installed', async () => {
    const bundleText = readFileSync(built.file, 'utf8')
    expect(bundleText).toMatch(/require\(["']\.\/uiText\.js["']\)/u)
    expect(bundleText).not.toContain(EN.goalObjectiveMissing)
    const fallback: unknown = createRequire(built.file)('./uiText.js')
    expect(fallback).toHaveProperty('EN.goalObjectiveMissing', EN.goalObjectiveMissing)
    setUiText({ ...EN, goalObjectiveMissing: 'Installed goal sentence' }, BASE_LOCALE)
    const t = managerFor(built.file)
    const session = await startSession(t.manager)
    await expect(session.controlGoal({ verb: 'set', objective: ' ' })).rejects.toThrow(
      'goal/set: Installed goal sentence',
    )
    expect(fallback).toHaveProperty('EN.goalObjectiveMissing', EN.goalObjectiveMissing)
    await t.manager.dispose()
  })

  it('refuses a goal command with an error the controller’s guard knows, not its class', async () => {
    const t = managerFor(built.file)
    const session = await startSession(t.manager)
    const refused = session.controlGoal({ verb: 'pause' })
    // The bundle threw its own copy of the class: `instanceof` misses it,
    // which is why the conversation controller tests with the guard.
    await expect(refused).rejects.not.toBeInstanceOf(GoalRefusedError)
    await expect(refused).rejects.toSatisfy(isGoalRefusedError)
    await expect(refused).rejects.toMatchObject({ name: 'GoalRefusedError', refusal: 'noGoal' })
    await t.manager.dispose()
  })
})
