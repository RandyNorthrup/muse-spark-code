// M83/M68: real import publications share the existing live workspace ledger;
// personal files stay outside it and never start the lazy Model API backend.

import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type * as NodeFsPromises from 'node:fs/promises'
import type * as NodeOs from 'node:os'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { window, workspace } from 'vscode'
import { applyImportWrites, type ImportWrite } from '../../src/core/import/agentImport'
import { ModelApiSession } from '../../src/core/backends/modelapi/ModelApiHost'
import { VerifyLedger } from '../../src/core/backends/modelapi/verifyLedger'
import type { WorkspaceEditRecorder } from '../../src/core/verify/workspaceEdits'
import { ModelApiBackendManager } from '../../src/host/backend/modelApiBackendManager'
import * as modelApiEntry from '../../src/host/backend/modelApiEntry'
import {
  importFromAgents,
  runAgentImport as bundledAgentImport,
} from '../../src/host/agentImportEntry'
import { type AgentImportHostDeps, runAgentImport } from '../../src/host/agentImportHost'
import { fileImportWriter, isPathPresent } from '../../src/host/importIo'
import { AGENT_IMPORT_PATHS, ATOMIC_TEMPORARY_SUFFIX, UI_TEXT } from '../../src/shared/constants'
import { fakeModelApi } from './helpers/fakeModelApi'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeManagerDeps } from './helpers/modelApiManager'
import { removeFolder } from './helpers/temporaryFolders'
import { inform, pickMany, pickOne } from './helpers/vscodeViews'

const folders = { root: '' }
const gates = vi.hoisted(() => {
  const controls: {
    beforeOpen: ((file: string) => Promise<void>) | undefined
    stageWrites: string[]
    home: string
  } = {
    beforeOpen: undefined,
    stageWrites: [],
    home: '',
  }
  return controls
})

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeOs>()),
  homedir: () => gates.home,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof NodeFsPromises>()
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const file = String(args[0])
      await gates.beforeOpen?.(file)
      const handle = await fs.open(...args)
      if (file.endsWith(ATOMIC_TEMPORARY_SUFFIX)) {
        const write = handle.writeFile.bind(handle)
        vi.spyOn(handle, 'writeFile').mockImplementation(
          async (...bytes: Parameters<typeof handle.writeFile>) => {
            gates.stageWrites.push(file)
            await write(...bytes)
          },
        )
      }
      return handle
    },
  }
})

beforeAll(async () => {
  folders.root = realpathSync.native(await mkdtemp(path.join(tmpdir(), 'muse-import-notices-')))
  gates.home = path.join(folders.root, 'home')
})
afterEach(() => {
  gates.beforeOpen = undefined
  gates.stageWrites.length = 0
  vi.unstubAllEnvs()
  vi.mocked(pickOne).mockReset()
  vi.mocked(inform).mockReset()
})
afterAll(async () => {
  await removeFolder(folders.root)
})

/** Holds the next staged file's open until `resume` resolves; `held` resolves when it is reached. */
function holdStaging() {
  const held = Promise.withResolvers<undefined>()
  const resume = Promise.withResolvers<undefined>()
  gates.beforeOpen = async (file) => {
    if (!file.endsWith(ATOMIC_TEMPORARY_SUFFIX)) {
      return
    }
    held.resolve(undefined)
    await resume.promise
  }
  return { held, resume }
}

function fixture(workspaceRoot: string, newId: () => string = randomUUID) {
  const api = fakeModelApi()
  const loadBundle = vi.fn(() => modelApiEntry)
  const manager = new ModelApiBackendManager(
    fakeManagerDeps(api, new FakeLogOutputChannel(), {
      workspaceRoot,
      newId,
      bundlePath: 'src/host/backend/modelApiEntry.ts',
      loadBundle,
    }),
  )
  return { api, manager, loadBundle }
}

/** The host's side of an import in a real folder: no checkpoint store, the window's folder is the root. */
function hostDeps(
  root: string | undefined,
  overrides: Partial<AgentImportHostDeps>,
): AgentImportHostDeps {
  return {
    workspaceRoot: root,
    isActive: () => true,
    currentRoot: () => root,
    editProject: async (work) => await work(() => undefined),
    beforeProjectWrite: () => Promise.resolve(),
    museSettingsPath: () => path.join(folders.root, 'settings.json'),
    openDocument: () => Promise.resolve(),
    bundle: () => ({ importFromAgents, runAgentImport: bundledAgentImport }),
    log: new FakeLogOutputChannel(),
    ...overrides,
  }
}

async function projectWrite(root: string, mode: ImportWrite['mode']): Promise<ImportWrite> {
  return {
    candidateIds: ['imported'],
    absolutePath: path.join(root, mode === 'create' ? 'eslint.config.js' : 'AGENTS.md'),
    content: 'Imported bytes.\n',
    mode,
    sections: [{ candidateId: 'imported', heading: '## Imported', text: '## Imported\n\nRules.' }],
    root,
    isProject: true,
    rootIdentity: await fileImportWriter.identifyRoot(root),
  }
}

describe('import workspace write notices', () => {
  it.each([
    {
      title: 'refuses an unsafe copy target before the editor loads its document',
      isInitiallySafe: false,
      expectedChecks: 1,
      expectedLoads: 0,
    },
    {
      title: 'rechecks a copy target after the editor loads its document',
      isInitiallySafe: true,
      expectedChecks: 2,
      expectedLoads: 1,
    },
  ])('$title', async ({ isInitiallySafe, expectedChecks, expectedLoads }) => {
    const load = vi.spyOn(workspace, 'openTextDocument')
    const show = vi.spyOn(window, 'showTextDocument')
    const checkTarget = vi.fn(() => Promise.resolve(false)).mockResolvedValueOnce(isInitiallySafe)
    try {
      await runAgentImport(
        hostDeps(undefined, {
          bundle: () => ({
            runAgentImport: bundledAgentImport,
            importFromAgents: async (host) => {
              await host.openTarget(path.join(folders.root, 'hooks.json'), true, checkTarget)
            },
          }),
        }),
      )
      expect(checkTarget).toHaveBeenCalledTimes(expectedChecks)
      expect(load).toHaveBeenCalledTimes(expectedLoads)
      expect(show).not.toHaveBeenCalled()
    } finally {
      load.mockRestore()
      show.mockRestore()
    }
  })

  it('captures its owner synchronously before the first queued picker await', async () => {
    const selected = Promise.withResolvers<undefined>()
    const picker = vi.spyOn(window, 'showQuickPick').mockImplementationOnce(() => selected.promise)
    const owner = vi.fn<WorkspaceEditRecorder>()
    const replacement = vi.fn<WorkspaceEditRecorder>()
    const captureOwner = vi.fn(() => owner)
    const beginEdit = vi.fn(() => {
      throw new Error('A dismissed import must not publish')
    })
    const done = runAgentImport(hostDeps(undefined, { captureOwner, beginEdit }))
    try {
      expect(captureOwner).toHaveBeenCalledOnce()
      captureOwner.mockReturnValue(replacement)
      selected.resolve(undefined)
      await done
      expect(captureOwner).toHaveBeenCalledOnce()
      expect(beginEdit).not.toHaveBeenCalled()
    } finally {
      selected.resolve(undefined)
      await done
      picker.mockRestore()
    }
  })

  it.each(['create', 'append'] as const)(
    'invalidates sibling command grants and prior checks before native %s, then credits only the owner',
    async (mode) => {
      const root = path.join(folders.root, `success-${mode}`)
      await mkdir(root)
      const write = await projectWrite(root, mode)
      if (mode === 'append') {
        await writeFile(write.absolutePath, 'Existing rules.\n')
      }
      const f = fixture(root)
      const added = vi.spyOn(f.manager.workspaceEdits, 'add')
      const host = await f.manager.ensureHost()
      const options = { workspaceRoot: root, modelId: 'muse-spark-1.3', approvalMode: 'onRequest' }
      const owner = await host.startSession(options)
      const sibling = await host.startSession(options)
      if (!(owner instanceof ModelApiSession) || !(sibling instanceof ModelApiSession)) {
        throw new TypeError('Expected live Model API sessions')
      }
      const ledgers = added.mock.calls.map(([ledger]) => {
        if (!(ledger instanceof VerifyLedger)) {
          throw new TypeError('Expected actual session ledger')
        }
        return ledger
      })
      const command = `node ${path.basename(write.absolutePath)}`
      for (const ledger of ledgers) {
        ledger.record('passed', ledger.snapshot('lint', 'project'))
        expect(ledger.changesWhatRuns(command)).toBe(false)
      }
      const captured = f.manager.captureExternalEditOwner(owner)
      const ownerNote = vi.spyOn(owner, 'noteExternalEdit')
      const siblingNote = vi.spyOn(sibling, 'noteExternalEdit')
      const { held, resume } = holdStaging()
      const done = applyImportWrites([write], fileImportWriter, process.platform, {
        beginProjectEdit: (file) => f.manager.beginExternalEdit(captured, [file]),
      })
      try {
        await held.promise
        expect(ownerNote).not.toHaveBeenCalled()
        for (const ledger of ledgers) {
          expect(ledger.changesWhatRuns(command)).toBe(true)
          expect(ledger.hasCurrentRun('lint', 'project')).toBe(false)
        }
        resume.resolve(undefined)
        const { written } = await done
        expect(written).toHaveLength(1)
        expect(ownerNote).toHaveBeenCalledOnce()
        expect(siblingNote).not.toHaveBeenCalled()
        const bytes = await readFile(write.absolutePath, 'utf8')
        expect(bytes).toContain(mode === 'append' ? 'Existing rules.\n' : write.content)
        for (const ledger of ledgers) {
          ledger.resetForMessage()
          expect(ledger.changesWhatRuns(command)).toBe(false)
        }
        expect(f.api.responseBodies()).toEqual([])
      } finally {
        resume.resolve(undefined)
        await done
        await f.manager.dispose()
      }
    },
  )

  it('releases a failed native publication without crediting any owner', async () => {
    const root = path.join(folders.root, 'failure')
    await mkdir(root)
    const f = fixture(root)
    const host = await f.manager.ensureHost()
    const owner = await host.startSession({
      workspaceRoot: root,
      modelId: 'muse-spark-1.3',
      approvalMode: 'onRequest',
    })
    if (!(owner instanceof ModelApiSession)) {
      throw new TypeError('Expected live Model API owner')
    }
    const note = vi.spyOn(owner, 'noteExternalEdit')
    const captured = f.manager.captureExternalEditOwner(owner)
    const end = vi.fn<(wasWritten: boolean) => void>()
    gates.beforeOpen = (file) => {
      if (file.endsWith(ATOMIC_TEMPORARY_SUFFIX)) {
        throw Object.assign(new Error('Native write refused'), { code: 'EACCES' })
      }
      return Promise.resolve()
    }
    const write = await projectWrite(root, 'create')
    try {
      const result = await applyImportWrites([write], fileImportWriter, process.platform, {
        beginProjectEdit: (file) => {
          const complete = f.manager.beginExternalEdit(captured, [file])
          return (written) => {
            end(written)
            complete(written)
          }
        },
      })
      expect(result.written).toEqual([])
      expect(result.failures).toEqual([{ absolutePath: write.absolutePath, code: 'EACCES' }])
      expect(end).toHaveBeenCalledExactlyOnceWith(false)
      expect(note).not.toHaveBeenCalled()
      expect(await isPathPresent(write.absolutePath)).toBe(false)
    } finally {
      await f.manager.dispose()
    }
  })

  it('keeps an existing native target intact without reporting a successful import', async () => {
    const root = path.join(folders.root, 'existing')
    await mkdir(root)
    const write = await projectWrite(root, 'create')
    await writeFile(write.absolutePath, 'Owner bytes.\n')
    const complete = vi.fn<(wasWritten: boolean) => void>()
    const result = await applyImportWrites([write], fileImportWriter, process.platform, {
      beginProjectEdit: () => complete,
    })
    expect(result.written).toEqual([])
    expect(result.skipped).toEqual([{ candidateId: 'imported', reason: 'exists' }])
    expect(complete).toHaveBeenCalledExactlyOnceWith(false)
    expect(await readFile(write.absolutePath, 'utf8')).toBe('Owner bytes.\n')
  })

  it('forwards shutdown into the atomic append before writing any staged content', async () => {
    const root = path.join(folders.root, 'closed-append')
    await mkdir(root)
    const write = await projectWrite(root, 'append')
    await writeFile(write.absolutePath, 'Owner rules.\n')
    let isActive = true
    gates.beforeOpen = (file) => {
      if (file.endsWith(ATOMIC_TEMPORARY_SUFFIX)) {
        isActive = false
      }
      return Promise.resolve()
    }
    const complete = vi.fn<(wasWritten: boolean) => void>()
    const result = await applyImportWrites([write], fileImportWriter, process.platform, {
      beforeWrite: () => {
        if (!isActive) {
          throw Object.assign(new Error('Activation closed'), { code: 'EPERM' })
        }
      },
      beginProjectEdit: () => complete,
    })
    expect(result.written).toEqual([])
    expect(result.failures).toEqual([{ absolutePath: write.absolutePath, code: 'EPERM' }])
    expect(gates.stageWrites).toEqual([])
    expect(complete).toHaveBeenCalledExactlyOnceWith(false)
    expect(await readFile(write.absolutePath, 'utf8')).toBe('Owner rules.\n')
    expect(await readdir(root)).toEqual(['AGENTS.md'])
  })

  it('does not assign a held import to a revived session with the same id', async () => {
    const root = path.join(folders.root, 'revived')
    await mkdir(root)
    const f = fixture(root, () => 'same-session')
    const host = await f.manager.ensureHost()
    const options = { workspaceRoot: root, modelId: 'muse-spark-1.3', approvalMode: 'onRequest' }
    const owner = await host.startSession(options)
    const captured = f.manager.captureExternalEditOwner(owner)
    const { held, resume } = holdStaging()
    const done = applyImportWrites(
      [await projectWrite(root, 'create')],
      fileImportWriter,
      process.platform,
      { beginProjectEdit: (file) => f.manager.beginExternalEdit(captured, [file]) },
    )
    try {
      await held.promise
      owner.dispose()
      const replacement = await host.startSession(options)
      if (!(replacement instanceof ModelApiSession)) {
        throw new TypeError('Expected revived Model API owner')
      }
      expect(replacement.sessionId).toBe(owner.sessionId)
      const note = vi.spyOn(replacement, 'noteExternalEdit')
      resume.resolve(undefined)
      const { written } = await done
      expect(written).toHaveLength(1)
      expect(note).not.toHaveBeenCalled()
    } finally {
      resume.resolve(undefined)
      await done
      await f.manager.dispose()
    }
  })

  it('keeps the pre-confirmation owner through the actual host import and native publication', async () => {
    const root = path.join(folders.root, 'host-revived')
    await mkdir(path.join(root, '.claude', 'commands'), { recursive: true })
    await writeFile(path.join(root, '.claude', 'commands', 'ship.md'), 'Ship safely.\n')
    vi.stubEnv(AGENT_IMPORT_PATHS.claudeCode.configDirVariable, path.join(gates.home, '.claude'))
    vi.stubEnv(AGENT_IMPORT_PATHS.codex.homeVariable, path.join(gates.home, '.codex'))
    const f = fixture(root, () => 'same-host-session')
    const host = await f.manager.ensureHost()
    const options = { workspaceRoot: root, modelId: 'muse-spark-1.3', approvalMode: 'onRequest' }
    let active = await host.startSession(options)
    const original = active
    const captureOwner = vi.fn(() => f.manager.captureExternalEditOwner(active))
    vi.mocked(pickOne).mockImplementationOnce((items) =>
      Promise.resolve(items.find((item) => item.label === UI_TEXT.importSourceClaude)),
    )
    vi.mocked(pickMany).mockImplementationOnce((items) => Promise.resolve([...items]))
    const held = Promise.withResolvers<undefined>()
    const resume = Promise.withResolvers<string>()
    vi.mocked(inform).mockImplementationOnce(() => {
      held.resolve(undefined)
      return resume.promise
    })
    const done = runAgentImport(
      hostDeps(root, {
        captureOwner,
        beginEdit: (file, owner) => f.manager.beginExternalEdit(owner, [file]),
        museSettingsPath: () => path.join(gates.home, 'muse', 'settings.json'),
      }),
    )
    try {
      await held.promise
      original.dispose()
      active = await host.startSession(options)
      if (!(active instanceof ModelApiSession)) {
        throw new TypeError('Expected replacement host session')
      }
      expect(active.sessionId).toBe(original.sessionId)
      const note = vi.spyOn(active, 'noteExternalEdit')
      resume.resolve(UI_TEXT.agentImportConfirmAction)
      await done
      expect(
        await readFile(path.join(root, '.agents', 'skills', 'ship', 'SKILL.md'), 'utf8'),
      ).toContain('Ship safely.')
      expect(captureOwner).toHaveBeenCalledOnce()
      expect(note).not.toHaveBeenCalled()
      expect(f.api.responseBodies()).toEqual([])
    } finally {
      resume.resolve(UI_TEXT.agentImportConfirmAction)
      await done
      await f.manager.dispose()
    }
  })

  it('keeps personal publication out of workspace notices and never loads the lazy host', async () => {
    const root = path.join(folders.root, 'workspace')
    const personal = path.join(folders.root, 'personal')
    await mkdir(root)
    await mkdir(personal)
    const f = fixture(root)
    const ledger = new VerifyLedger()
    f.manager.workspaceEdits.add(ledger)
    ledger.record('passed', ledger.snapshot('lint', 'project'))
    const begin = vi.spyOn(f.manager, 'beginExternalEdit')
    const write = {
      ...(await projectWrite(personal, 'create')),
      isProject: false,
      rootIdentity: undefined,
    }
    try {
      const { written } = await applyImportWrites([write], fileImportWriter, process.platform, {
        beginProjectEdit: (file) => f.manager.beginExternalEdit(undefined, [file]),
      })
      expect(written).toHaveLength(1)
      expect(begin).not.toHaveBeenCalled()
      expect(ledger.hasCurrentRun('lint', 'project')).toBe(true)
      expect(f.manager.isRunning).toBe(false)
      expect(f.loadBundle).not.toHaveBeenCalled()
      expect(f.api.responseBodies()).toEqual([])
    } finally {
      await f.manager.dispose()
    }
  })
})
