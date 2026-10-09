import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { acpConversationFactory } from '../../src/runtime/panel/acpComposition'
import { ControllerRegistry } from '../../src/runtime/panel/controllerRegistry'
import { createRuntimeBackend } from '../../src/runtime/backends'
import type { ServeOptions } from '../../src/runtime/cliArgs'
import type { AcpController } from '../../src/acp/agent'
import { FakeAgentHost } from './helpers/fakeAgent'
import { memorySecrets } from './helpers/fakes'
import { buildHostBundles } from './helpers/modelApiBundle'
import { removeFolder } from './helpers/temporaryFolders'
import { commandApproval } from './helpers/acpWaits'

function refuseGit(): Promise<never> {
  return Promise.reject(new Error('Fake fixture refuses git'))
}

const rig = { root: '' }
beforeAll(async () => {
  rig.root = await mkdtemp(path.join(tmpdir(), 'm104-acp-core-'))
  await buildHostBundles(rig.root, {
    runtimePanelPorts: path.resolve('src/runtime/panel/runtimeFeaturesEntry.ts'),
    conversation: path.resolve('src/host/conversation/conversationEntry.ts'),
  })
})
afterAll(async () => {
  await removeFolder(rig.root)
})

it.each([false, true])(
  'adopts the real composed controller (contributor=%s), preserves rich parts, leaves approvals to ACP and refuses disposed submissions',
  async (contributor) => {
    const options: ServeOptions = {
      backend: 'museCode',
      trustWorkspace: false,
      museBinary: '',
      shellSandbox: 'off',
      canBypass: false,
      allowsContributorModels: contributor,
      paidFeatures: [],
      isVerbose: false,
    }
    const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const runGit = refuseGit
    const runtime = createRuntimeBackend({
      options,
      version: '0.0.0-fake',
      distDir: rig.root,
      platform: process.platform,
      env: {},
      homeDir: rig.root,
      secrets: memorySecrets(),
      runGit,
      fetch: () => Promise.reject(new Error('Fake fixture refuses network')),
      sleep: () => Promise.resolve(),
      log,
    })
    const modelId = contributor ? 'muse-spark-1.3-contributor' : 'muse-spark-1.3'
    const host = new FakeAgentHost([
      {
        modelId,
        displayLabel: 'Fake model',
        contextLimit: 1_000_000,
        isDefault: true,
        isActive: true,
      },
    ])
    const session = await host.startSession({
      workspaceRoot: rig.root,
      modelId,
      approvalMode: 'manual',
    })
    const factory = acpConversationFactory({
      runtime: {
        ...runtime,
        backend: {
          kind: 'museCode',
          readiness: () => Promise.resolve({ state: 'ready' }),
          hostFor: () => Promise.resolve(host),
        },
      },
      options,
      dataRoot: rig.root,
      conversationBundle: path.join(rig.root, 'conversation.js'),
      log,
      runGit,
      controllers: new ControllerRegistry<AcpController>(log),
    })
    const engine = await factory(session, host, rig.root, 'acceptEdits')
    try {
      expect(engine.controller).toBeDefined()
      const parts = [
        { type: 'text', text: 'rich ACP' },
        { type: 'image', base64Data: 'iVBORw0KGgo=', mediaType: 'image/png', width: 1, height: 1 },
      ] as const
      await engine.submit(parts, 'rich ACP')
      expect(host.sessions[0]?.sendTurn).toHaveBeenCalledWith(parts, 'rich ACP')
      const live = host.sessions[0]
      if (live === undefined) throw new Error('Missing fake session')
      live.emit(
        commandApproval(
          [{ choiceId: 'allow', label: 'Allow', decision: 'approved', scope: 'once' }],
          {
            toolName: 'write_file',
            subject: { kind: 'fileWrite', path: 'a.txt', toolName: 'write_file' },
          },
        ),
      )
      expect(live.decideApproval).not.toHaveBeenCalled()
      engine.permissionModeChanged('plan')
      await engine.release()
      await expect(engine.submit(parts, 'late')).rejects.toThrow()
      expect(live.dispose).toHaveBeenCalled()
    } finally {
      await engine.release()
      await runtime.close()
    }
  },
)
