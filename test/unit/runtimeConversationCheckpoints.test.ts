// The runtime panel's turn checkpoints (RLF-M104GL's wiring, on int): the conversation's port is
// the backend's own cached checkpoints for the folder, the port and recorder its tools write
// through, so a restore here sees the turns the tools recorded. Without checkpoints, or when the
// folder's namespace cannot be established, the port reports no namespace, as a folder-less
// window does, and the folder's backend still runs. Real backend, real store in a temporary
// folder, real git; the second half is the packed agent over real stdio.
//
// A turn that runs a model is not here: no suite calls one, so the backend's own `beforeTurnRuns`
// and `afterTurnRuns` over a real turn are for a real run of the packed product.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createRuntimeBackend } from '../../src/runtime/backends'
import type { ServeOptions } from '../../src/runtime/cliArgs'
import { createRuntimeCheckpoints } from '../../src/runtime/features/checkpoints'
import { conversationCheckpoints } from '../../src/runtime/panel/runtimeFeatures'
import { RuntimeSettingsStore } from '../../src/runtime/settingsStore'
import { stderrLogger } from '../../src/runtime/stderrLog'
import { StoreUnavailableError } from '../../src/runtime/keyStore'
import { canonicalPath } from '../../src/host/canonicalPath'
import * as checkpointStoreEntry from '../../src/host/checkpoints/checkpointStoreEntry'
import { SETTING_DEFAULTS, TURN_CHECKPOINTS_SETTING } from '../../src/shared/constants'
import { panelInitializeResultSchema } from '../../src/shared/hostApi/panel'
import { parseMhpResult } from '../../src/shared/hostApi/protocol'
import { EN } from '../../src/shared/l10n/en'
import { captureLog } from './helpers/captureLog'
import { resolveWorkingGit } from './helpers/fixtureGit'
import { headlessToolIo } from './helpers/headlessToolIo'
import { writeAsOwner } from './helpers/ownerWrite'
import { panelEditor } from './helpers/panelEditor'
import { createPanelRun } from './helpers/panelRun'
import { removeFolder } from './helpers/temporaryFolders'
import { assertCurrentProductionBuild } from './productionBuild'

const ROOT = process.cwd()

interface ComposeOptions {
  readonly trusted?: boolean
  readonly turnCheckpoints?: boolean
  readonly hasGit?: () => boolean
  readonly withCheckpoints?: boolean
  /** The folder's namespace cannot be established: the checkpoints' folder is a file. */
  readonly namespaceFails?: boolean
  readonly backend?: ServeOptions['backend']
}

async function compose(options: ComposeOptions = {}) {
  const {
    trusted = true,
    turnCheckpoints = true,
    hasGit,
    withCheckpoints = true,
    namespaceFails = false,
    backend: backendKind = 'modelApi',
  } = options
  const scope = realpathSync(mkdtempSync(path.join(tmpdir(), 'muse-conversation-checkpoints-')))
  const dataRoot = path.join(scope, 'data')
  const workspace = path.join(scope, 'workspace')
  const notAFolder = path.join(scope, 'not-a-folder')
  mkdirSync(dataRoot)
  mkdirSync(workspace)
  writeFileSync(notAFolder, 'not a directory')
  // The store's separation guard reads the enclosing repository top: the fixture is its own
  // repository, so the storage beside it is separate.
  execFileSync(await resolveWorkingGit(), ['init', '--quiet'], { cwd: workspace })
  const { logger, lines } = captureLog()
  const backend = createRuntimeBackend({
    options: {
      backend: backendKind,
      trustWorkspace: trusted,
      museBinary: path.join(scope, 'no-such-muse'),
      shellSandbox: 'off',
      canBypass: false,
      allowsContributorModels: false,
      paidFeatures: [],
      isVerbose: false,
    },
    version: '0.0.0-test',
    distDir: path.join(ROOT, 'dist'),
    platform: process.platform,
    env: process.env,
    homeDir: scope,
    // The machine's own credential store is not this suite's: it reads as this store does on a
    // machine with none, and nothing here needs a key.
    secrets: {
      get: () => Promise.reject(new StoreUnavailableError()),
      store: () => Promise.reject(new StoreUnavailableError()),
      delete: () => Promise.reject(new StoreUnavailableError()),
    },
    runGit: () => Promise.reject(new Error('this suite runs git itself')),
    fetch: () => Promise.reject(new Error('no request may leave the machine')),
    sleep: () => Promise.resolve(),
    log: logger,
    ...(withCheckpoints && {
      checkpoints: (root: string) =>
        createRuntimeCheckpoints(
          {
            workspaceRoot: namespaceFails ? notAFolder : root,
            dataRoot,
            distDir: scope,
            platform: process.platform,
            env: process.env,
            log: logger,
            isTrusted: () => trusted,
            isEnabled: () => turnCheckpoints,
            retentionDays: () => SETTING_DEFAULTS.cleanupPeriodDays,
            ...(hasGit !== undefined && { hasGit }),
            loadBundle: () => checkpointStoreEntry,
          },
          EN,
          'en',
        ),
    }),
  })
  const port = await conversationCheckpoints(backend, workspace, () => trusted, logger)
  return {
    backend,
    port,
    workspace,
    logger,
    lines,
    close: async () => {
      await backend.close()
      await removeFolder(scope)
    },
  }
}

describe('the runtime conversation checkpoints', () => {
  it('restores through the backend-owned instance a turn its recorder wrote', async () => {
    const session = await compose()
    try {
      expect(session.port.availability()).toBe('on')
      const shared = await session.backend.checkpointsFor?.(session.workspace)
      if (shared === undefined) throw new Error('the backend holds no checkpoints')
      expect(shared.port).toBe(session.port)
      const file = path.join(session.workspace, 'note.txt')
      writeFileSync(file, 'original')
      const sessionId = 'checkpoint-session'
      const turnId = randomUUID()
      const owner = await session.port.startTurnUnit(sessionId, turnId, false)
      if (owner === undefined) throw new Error('the turn recorded nothing')
      await writeAsOwner(
        headlessToolIo(session.workspace),
        {
          journal: shared.recording.journal,
          lanes: shared.recording.lanes,
          owner,
          workspaceRoot: await canonicalPath(session.workspace),
          log: session.logger,
        },
        file,
        'changed',
      )
      expect(readFileSync(file, 'utf8')).toBe('changed')
      await session.port.endUnit(owner, { ranProcesses: false })
      expect(await session.port.turns(sessionId)).toEqual([turnId])
      const outcome = await session.port.restore({
        backend: () => 'modelApi',
        sessionId,
        turnId,
        transcriptTurnIds: [turnId],
        unsavedPaths: () => [],
      })
      expect(outcome.ok).toBe(true)
      expect(readFileSync(file, 'utf8')).toBe('original')
    } finally {
      await session.close()
    }
  })

  it('reports restricted without trust', async () => {
    const session = await compose({ trusted: false })
    try {
      expect(session.port.availability()).toBe('restricted')
    } finally {
      await session.close()
    }
  })

  it('reports off when the setting is off, and records nothing', async () => {
    const session = await compose({ turnCheckpoints: false })
    try {
      expect(session.port.availability()).toBe('off')
      expect(await session.port.startTurnUnit('off-session', 'off-turn', false)).toBeUndefined()
    } finally {
      await session.close()
    }
  })

  it('reports noGit without git, and records nothing', async () => {
    const session = await compose({ hasGit: () => false })
    try {
      expect(session.port.availability()).toBe('noGit')
      expect(await session.port.startTurnUnit('git-session', 'git-turn', false)).toBeUndefined()
    } finally {
      await session.close()
    }
  })

  it('reports noFolder for a runtime without checkpoints', async () => {
    const session = await compose({ withCheckpoints: false })
    try {
      expect(session.port.availability()).toBe('noFolder')
      expect(session.backend.checkpointsFor).toBeUndefined()
      // A send still goes: an unknown namespace would refuse every turn's mark.
      await expect(session.port.markTurn('a-running-turn', true)).resolves.toBeUndefined()
    } finally {
      await session.close()
    }
  })

  it('reports noFolder when the namespace cannot be established, without the path in the log', async () => {
    const session = await compose({ namespaceFails: true })
    try {
      expect(session.port.availability()).toBe('noFolder')
      const report = session.lines.filter((line) =>
        line.includes('Checkpoint namespace unavailable'),
      )
      expect(report).toHaveLength(1)
      expect(report[0]).not.toContain(session.workspace)
      await expect(session.port.markTurn('a-running-turn', true)).resolves.toBeUndefined()
    } finally {
      await session.close()
    }
  })

  it('marks the folder unsafe to restore once Muse Code is asked for a host', async () => {
    const session = await compose({ backend: 'museCode' })
    try {
      expect(session.port.isNativeUnsafe()).toBe(false)
      // The host is built and never started: there is no Muse Code on this path.
      await session.backend.backend.hostFor(session.workspace)
      expect(session.port.isNativeUnsafe()).toBe(true)
    } finally {
      await session.close()
    }
  })

  // No key here, so the bundle's own sign-in refusal is as far as the host goes: past the
  // manager, its memory and its tool files, all built over the checkpoints by then.
  it('reaches the Model API host over the checkpoints', async () => {
    const session = await compose()
    try {
      await expect(session.backend.backend.hostFor(session.workspace)).rejects.toThrow(
        EN.notSignedInReason,
      )
      expect(session.lines.filter((line) => line.includes('Turn checkpoints'))).toEqual([])
    } finally {
      await session.close()
    }
  })

  it('still reaches the Model API host when the namespace cannot be established', async () => {
    const session = await compose({ namespaceFails: true })
    try {
      await expect(session.backend.backend.hostFor(session.workspace)).rejects.toThrow(
        EN.notSignedInReason,
      )
      const report = session.lines.filter((line) => line.includes('Turn checkpoints are off'))
      expect(report).toHaveLength(1)
      expect(report[0]).not.toContain(session.workspace)
    } finally {
      await session.close()
    }
  })

  it('refuses the folder after the backend closes', async () => {
    const session = await compose()
    const { checkpointsFor } = session.backend
    await session.close()
    await expect(checkpointsFor?.(session.workspace)).rejects.toThrow(
      'MHP_CHECKPOINT_NAMESPACE_UNAVAILABLE',
    )
  })
})

describe('the packed agent in panel --stdio', () => {
  const run = createPanelRun('muse-checkpoints-')
  const log = stderrLogger(() => undefined, 'warn')

  beforeAll(() => {
    assertCurrentProductionBuild(inject('productionBuildGeneration'), ROOT)
    run.prepare()
  })

  afterAll(async () => {
    await run.dispose()
  })

  /** The availability the chat's page is told, in a runtime whose backend is not ready. */
  async function availabilityShown(isTrusted: boolean, isSettingOn: boolean): Promise<unknown> {
    const store = new RuntimeSettingsStore({
      dataFolder: run.dataFolder,
      workspaceRoot: run.workspace,
      log,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    })
    await store.updateSetting('museSpark.backend', 'museCode', 'user')
    await store.updateSetting(
      'museSpark.museBinaryPath',
      path.join(run.folder, 'no-such-muse'),
      'user',
    )
    await store.updateSetting(TURN_CHECKPOINTS_SETTING, isSettingOn, 'user')
    const host = run.serve(['panel', '--stdio'])
    const editor = panelEditor(host)
    panelInitializeResultSchema.parse(
      await host.request(
        'initialize',
        run.initializeParams({
          capabilities: ['lifecycle', 'ui', 'surfaces', 'terminal'],
          trusted: isTrusted,
        }),
      ),
    )
    const chat = await editor.nextSurface()
    const state = await chat.shown('checkpointState')
    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await host.exited).toBe(0)
    return state['availability']
  }

  it('tells the page checkpoints are on in a trusted folder', async () => {
    expect(await availabilityShown(true, true)).toBe('on')
  })

  it('tells the page they are restricted in an untrusted one', async () => {
    expect(await availabilityShown(false, true)).toBe('restricted')
  })

  it('tells the page they are off when the setting is off', async () => {
    expect(await availabilityShown(true, false)).toBe('off')
  })
})
