// M104g's VS Code leg: the shared scenario contract (test/hostApi/scenarios/
// contract.json) against the modules VS Code really runs, inside a real VS Code.
// No session is bound and no model is called. VS Code does not speak MHP on
// this tree (lane A's in-process adapter is not landed; cc-rlm104.md, remainder
// 1), so the two document scenarios whose refusals are MHP words wait in the
// contract with that need. Every leg below runs on the product's own wiring,
// as src/extension.ts builds it: real files, real diagnostics, real settings.
// Observations are asserted against the contract and recorded to
// temp/m104-vscode-observations.json for the receipt, with the running VS
// Code's version and the observation time as provenance.
import * as assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as vscode from 'vscode'
import type { Owner } from '../../src/core/checkpoints/toolWrites'
import { canonicalPath } from '../../src/host/canonicalPath'
import { createCheckpointStore } from '../../src/host/checkpoints/checkpointStoreEntry'
import { isProcessAlive } from '../../src/host/checkpoints/windowPresence'
import { createOwnerIo, createTurnRecording } from '../../src/host/checkpoints/writeRecorder'
import { EditReview } from '../../src/host/editor/editReview'
import { createRevertIo } from '../../src/host/editor/revertIo'
import { processGitProcess } from '../../src/host/git'
import { createLogger, type Logger } from '../../src/host/logger'
import { readSettings } from '../../src/host/settings'
import { createVerifyEditor } from '../../src/host/vscode/editor/verifyEditor'
import { PanelDelivery } from '../../src/runtime/panel/delivery'
import { PanelSurfaces, type PanelView } from '../../src/runtime/panel/surfaces'
import {
  MHP_PANEL,
  SETTING_DEFAULTS,
  SETTINGS_SECTION,
  VSCODE_COMMANDS,
} from '../../src/shared/constants'
import { MhpPanelError } from '../../src/shared/hostApi/panelError'
import { EN } from '../../src/shared/l10n/en'
import { resolveWorkingGit } from '../unit/helpers/fixtureGit'
import { reviewDriverBase, scenarioDiffPatchJson } from '../unit/helpers/reviewDriver'
import { removeFolder } from '../unit/helpers/temporaryFolders'
import { createIntegrationToolIo } from './helpers/testToolIo'

interface Scenario {
  readonly id: string
  readonly expected: Record<string, unknown>
}

interface Contract {
  readonly protocol: string
  readonly scenarios: readonly Scenario[]
}

type Backend = 'musecode' | 'modelapi'

function checkoutRoot(): string {
  // Built to dist/test/integration/*.test.js (scripts/build.mjs): three up.
  // The host's cwd is VS Code's, never the checkout.
  const root = path.resolve(__dirname, '..', '..', '..')
  assert.ok(existsSync(path.join(root, 'package.json')), 'the bundle lives in the checkout')
  return root
}

function isContract(value: unknown): value is Contract {
  return (
    typeof value === 'object' &&
    value !== null &&
    'protocol' in value &&
    typeof value.protocol === 'string' &&
    'scenarios' in value &&
    Array.isArray(value.scenarios)
  )
}

function readContract(): Contract {
  const parsed: unknown = JSON.parse(
    readFileSync(
      path.join(checkoutRoot(), 'test', 'hostApi', 'scenarios', 'contract.json'),
      'utf8',
    ),
  )
  assert.ok(isContract(parsed), 'contract.json names its protocol and scenarios')
  return parsed
}

const contract = readContract()

const observations = new Map<string, Record<string, unknown>>()

function record(backend: Backend, scenario: string, observed: Record<string, unknown>): void {
  const key = `${backend}/${scenario}`
  assert.ok(!observations.has(key), `leg runs once: ${key}`)
  const expected = contract.scenarios.find((entry) => entry.id === scenario)?.expected
  assert.deepEqual(observed, expected)
  observations.set(key, observed)
}

function makeDirectory(parent: string, prefix: string): string {
  const folder = path.join(parent, `${prefix}-${randomUUID()}`)
  mkdirSync(folder, { recursive: true })
  return folder
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

// The setting round trip the runtime's store gives every other host: what a
// person sets in VS Code, read by the product's own settings reader.
async function runSettings(backend: Backend, log: Logger): Promise<void> {
  const section = vscode.workspace.getConfiguration(SETTINGS_SECTION)
  const before = section.inspect('paidDailyBudgetUsd')?.globalValue
  try {
    await section.update('paidDailyBudgetUsd', 5, vscode.ConfigurationTarget.Global)
    const read = readSettings(vscode.workspace.getConfiguration(SETTINGS_SECTION), log)
    record(backend, 'settings', { settingValue: Number(read.paidDailyBudgetUsd) })
  } finally {
    await section.update('paidDailyBudgetUsd', before, vscode.ConfigurationTarget.Global)
  }
}

// The edit review as src/extension.ts builds it, on a forward edit the tool
// write path really wrote: the first hunk is left, the second reverted.
async function runDiffHunks(backend: Backend, folder: string, log: Logger): Promise<void> {
  const file = path.join(folder, 'lines.txt')
  writeFileSync(file, 'l1\nl2\nl3\n')
  const toolIo = createIntegrationToolIo(folder, log)
  await toolIo.writeFile(file, 'l1c\nl2c\nl3\n', await canonicalPath(file))
  const review = new EditReview({
    ...reviewDriverBase(toolIo, folder),
    io: createRevertIo({
      io: toolIo,
      platform: process.platform,
      trash: async (fsPath) => {
        await vscode.workspace.fs.delete(vscode.Uri.file(fsPath), { useTrash: true })
      },
    }),
    openDiff: async (beforeUri, fsPath, title) => {
      await vscode.commands.executeCommand(
        VSCODE_COMMANDS.diff,
        vscode.Uri.parse(beforeUri),
        vscode.Uri.file(fsPath),
        title,
      )
    },
    log,
  })
  const rejected = await review.revertHunk('m104g-diff-hunks', scenarioDiffPatchJson(), 0, 1)
  assert.equal(rejected.isReverted, true)
  record(backend, 'diff-hunks', {
    hunks: { one: 'accept', two: 'reject' },
    text: readFileSync(file, 'utf8'),
  })
}

// A server that is still starting can take seconds to report here; the
// M68 suite's timing, which its cold TypeScript start proved.
const VERIFY_SETTLE = { firstMs: 12_000, quietMs: 1500, maxMs: 15_000 }
const VERIFY_FORMAT = { syncMs: 2000, pollMs: 50, formatMs: 12_000 }
const SCENARIO_SOURCE = 'm104g-conformance'
// Panel delivery runs on the surfaces' queue: two seconds for both payloads.
const DELIVERY_POLL = { rounds: 200, gapMs: 10 }

// The verify loop against VS Code's own diagnostics: the scenario's error
// through the editor's real channel, beside what the built-in JSON server says.
async function runDiagnostics(backend: Backend, created: string, log: Logger): Promise<void> {
  // Its real form, as confinement hands the loop every path (M68).
  const folder = await canonicalPath(created)
  const file = path.join(folder, 'broken.json')
  writeFileSync(file, '{\n  "a": 1\n  "b": 2\n}\n')
  const collection = vscode.languages.createDiagnosticCollection(SCENARIO_SOURCE)
  try {
    const scenario = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 1),
      'fixture error',
      vscode.DiagnosticSeverity.Error,
    )
    scenario.source = SCENARIO_SOURCE
    collection.set(vscode.Uri.file(file), [scenario])
    const verify = createVerifyEditor({
      platform: process.platform,
      log,
      workspaceRoot: folder,
      realPath: canonicalPath,
      settle: VERIFY_SETTLE,
      format: VERIFY_FORMAT,
    })
    const [result] = await verify.diagnosticsAfterEdit(
      [{ relative: 'broken.json', absolute: file }],
      new AbortController().signal,
    )
    assert.ok(result !== undefined)
    assert.equal(result.unchecked, undefined)
    assert.ok(
      result.entries.some((entry) => entry.message === 'Expected comma'),
      'the JSON server reported through verify',
    )
    record(backend, 'diagnostics', {
      verifyErrors: result.entries
        .filter((entry) => entry.source === SCENARIO_SOURCE)
        .map((entry) => entry.message),
    })
  } finally {
    collection.dispose()
  }
}

// The window's recording and store, built as src/extension.ts builds them: a
// real journal, real lanes, the real git process. Storage sits beside the
// workspace, as in production: the shadow guard refuses it nested.
async function runCheckpoint(backend: Backend, folder: string, log: Logger): Promise<void> {
  const root = await canonicalPath(folder)
  const file = path.join(folder, 'note.txt')
  writeFileSync(file, 'original')
  execFileSync(await resolveWorkingGit(), ['init', '--quiet'], { cwd: folder })
  const storageDir = makeDirectory(path.dirname(folder), 'checkpoints')
  const recording = createTurnRecording({
    storageDir,
    instance: randomUUID(),
    platform: process.platform,
  })
  const store = createCheckpointStore(
    {
      workspaceRoot: root,
      displayRoot: folder,
      storageDir,
      instance: recording.instance,
      journal: recording.journal,
      lanes: recording.lanes,
      storageRoot: storageDir,
      platform: process.platform,
      git: processGitProcess(),
      env: process.env,
      retentionDays: () => SETTING_DEFAULTS.cleanupPeriodDays,
      now: () => Date.now(),
      newId: () => randomUUID(),
      pid: process.pid,
      isProcessAlive,
      log,
    },
    EN,
    vscode.env.language,
  )
  try {
    const sessionId = randomUUID()
    const owner: Owner = {
      instance: recording.instance,
      sessionId,
      unitKind: 'turn',
      unitId: randomUUID(),
    }
    await store.startUnit(owner)
    const ownerIo = createOwnerIo(createIntegrationToolIo(folder, log), {
      journal: recording.journal,
      lanes: recording.lanes,
      owner,
      workspaceRoot: root,
      platform: process.platform,
      canonicalPath,
      newId: () => randomUUID(),
      log,
    })
    try {
      await ownerIo.writeFile(file, 'changed', await canonicalPath(file), () => undefined)
    } finally {
      await ownerIo.drain()
    }
    await store.endUnit(owner, { ranProcesses: false })
    assert.equal(readFileSync(file, 'utf8'), 'changed')
    const outcome = await store.restore({
      backend: () => 'modelApi',
      sessionId,
      turnId: owner.unitId,
      transcriptTurnIds: [owner.unitId],
      unsavedPaths: () => [],
    })
    assert.equal(outcome.ok, true)
    const turns = await store.turns(sessionId)
    record(backend, 'checkpoint', { text: readFileSync(file, 'utf8'), checkpoints: turns.length })
  } finally {
    store.dispose()
    await recording.journal.close()
  }
}

function noSubscription(): void {
  // The observed view publishes nothing, so there is nothing to detach.
}

function panelRefusalOf(error: unknown): string {
  assert.ok(error instanceof MhpPanelError, 'panel refusals are panel errors')
  return error.frame.code
}

// The shared panel transport's ordering, inside the editor's own process.
async function runPanelOrder(backend: Backend, log: Logger): Promise<void> {
  const delivered: string[] = []
  let fatalCalls = 0
  const view: PanelView = {
    handle: (message) => {
      // cancelHandoff carries the envelope's sequence in its request id.
      if (message !== null && message.type === 'cancelHandoff') delivered.push(message.requestId)
    },
    subscribe: () => noSubscription,
  }
  const surfaces = new PanelSurfaces(
    new PanelDelivery(),
    () => view,
    log,
    () => {
      fatalCalls += 1
    },
  )
  const surface = `m104g-${backend}`
  const binding = {
    mhp: MHP_PANEL.wireVersion,
    kind: 'surface',
    surface,
    sessionId: randomUUID(),
    surfaceKind: 'chat',
  } as const
  surfaces.lifecycle({ ...binding, event: 'opened' })
  surfaces.lifecycle({ ...binding, event: 'ready' })
  const send = (seq: number): void => {
    surfaces.message({
      mhp: MHP_PANEL.wireVersion,
      kind: 'panel',
      surface,
      seq,
      direction: 'toHost',
      payload: { type: 'cancelHandoff', requestId: `seq-${String(seq)}` },
    })
  }
  send(1)
  const refusals: string[] = []
  for (const seq of [1, 3]) {
    try {
      send(seq)
    } catch (error: unknown) {
      refusals.push(panelRefusalOf(error))
    }
  }
  send(2)
  for (let waited = 0; delivered.length < 2 && waited < DELIVERY_POLL.rounds; waited += 1)
    await sleep(DELIVERY_POLL.gapMs)
  assert.equal(fatalCalls, 0)
  record(backend, 'panel-order', {
    deliveredSequences: delivered.map((requestId) => Number(requestId.slice('seq-'.length))),
    refusals,
  })
}

suite('M104g VS Code conformance', () => {
  const temp = path.join(checkoutRoot(), 'temp')
  let root = ''
  const channel = vscode.window.createOutputChannel('M104g conformance', { log: true })
  const log = createLogger(channel)

  suiteSetup(() => {
    mkdirSync(temp, { recursive: true })
    root = makeDirectory(temp, 'm104g-vscode')
  })

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    // The native runners' report shape (test/hostApi/harness.mjs buildReport),
    // so the matrix reads one shape from every host.
    const results = [...observations].map(([key, observed]) => {
      const [backend = '', scenario = ''] = key.split('/', 2)
      return { backend, scenario, observations: observed, skipped: false }
    })
    writeFileSync(
      path.join(temp, 'm104-vscode-observations.json'),
      JSON.stringify(
        {
          report: { protocol: contract.protocol, host: 'vscode', results },
          provenance: { vscodeVersion: vscode.version, observedAt: new Date().toISOString() },
        },
        null,
        2,
      ),
    )
    channel.dispose()
    await removeFolder(root)
  })

  for (const backend of ['musecode', 'modelapi'] as const) {
    test(`${backend}/settings round-trips through the product's settings reader`, async () => {
      await runSettings(backend, log)
    })
    test(`${backend}/diff-hunks reverts only the rejected hunk`, async () => {
      await runDiffHunks(backend, makeDirectory(root, 'hunks'), log)
    })
    test(`${backend}/diagnostics verifies the scenario's error`, async () => {
      await runDiagnostics(backend, makeDirectory(root, 'diagnostics'), log)
    })
    // The musecode leg waits in the contract: the product restores Model API turns only.
    if (backend === 'modelapi') {
      test(`${backend}/checkpoint restores the recorded turn`, async () => {
        await runCheckpoint(backend, makeDirectory(root, 'checkpoint'), log)
      })
    }
    test(`${backend}/panel-order delivers in sequence and refuses the rest`, async () => {
      await runPanelOrder(backend, log)
    })
  }
})
