import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as sdk from '@muse-code/sdk'
import {
  NATIVE_MUSE_CODE_FEATURE_PORTS,
  type MuseCodeHost,
} from '../../src/core/backends/musecode/MuseCodeHost'
import { NATIVE_FEEDBACK_READER } from '../../src/core/backends/musecode/feedback'
import { UI_TEXT } from '../../src/shared/constants'
import { createRuntimeBackend } from '../../src/runtime/backends'
import type { ServeOptions } from '../../src/runtime/cliArgs'
import { FakeLogOutputChannel, memorySecrets } from './helpers/fakes'
import { fakeMuseCodeManager } from './helpers/museCodeManager'

vi.mock('@muse-code/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof sdk>()),
}))

// The production constructions bind these readers (C-M106-3R2): the VS Code
// window in src/extension.ts and the CLI/ACP runtime in
// src/runtime/backends.ts. Both tests below drive the real spawn seam — a
// real `muse serve` process over the real SDK transport, serving the real
// captured 1.4.4 frames — and read the behaviour back out.
const SPAWN_ENV = {
  MUSE_FAKE_FINGERPRINT: sdk.EXPECTED_SCHEMA_FINGERPRINT,
  XDG_CONFIG_HOME: path.resolve('test/fixtures/workspace/no-muse-config'),
  MUSE_FAKE_MODEL_LIST: 'capture',
}

function mockServe() {
  const spawn = sdk.spawnMspConnection
  vi.spyOn(sdk, 'spawnMspConnection').mockImplementation((options) =>
    spawn({
      ...options,
      args: [path.resolve('test/e2e/fake-muse/serve.mjs')],
      env: { ...SPAWN_ENV },
    }),
  )
}

// The captured frames in at the transport seam, and the behaviour out: the
// grant the handshake asks for, the catalogue with its ordered variants and
// default, the note-only receipt as the upload line, and the deletion
// refusal with no delete frames behind it.
async function expectNativeBehaviour(host: MuseCodeHost) {
  // The handshake asks for the grant the capture proves (1.4.4 grants
  // exactly what its client asks for), so the dialog may send.
  expect(host.info.grantedCapabilities).toContain('feedback')
  // The captured catalogue arrives with its ordered variants and default.
  const models = await host.listModels()
  const contributor = models.find((model) => model.modelId === 'muse-spark-1.3-contributor')
  expect(contributor?.variants).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  expect(contributor).toMatchObject({ defaultReasoningEffort: 'max' })
  // The captured note-only receipt comes out as the upload line, with
  // none of its identifiers.
  await expect(
    host.submitFeedback({
      sessionId: 's',
      classification: 'badResult',
      note: 'A wrong answer',
      withFiles: false,
      attachSessionRecord: false,
    }),
  ).resolves.toBe(UI_TEXT.feedbackUploaded)
  // No delete frames exist, so deletion stays refused before dispatch.
  await expect(host.deleteSession('s')).rejects.toThrow(UI_TEXT.sessionDeleteUnsupported)
}

describe('Native reader binding: VS Code backend manager', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('binds the native ports the window constructs with', async () => {
    // Reads the production wiring in src/extension.ts, not a copy of it:
    // deleting `featurePorts` from the window's manager construction fails
    // this test (RVCM1063 #7). The effort reader is preloaded by the
    // manager on first spawn (lane K budget); the catalogue assertions
    // below prove it reads the captured rows all the same.
    const windowSource = readFileSync('src/extension.ts', 'utf8')
    expect(windowSource).toMatch(/featurePorts:\s*NATIVE_MUSE_CODE_FEATURE_PORTS/)
    expect(NATIVE_MUSE_CODE_FEATURE_PORTS.feedback).toBe(NATIVE_FEEDBACK_READER)
    expect(NATIVE_MUSE_CODE_FEATURE_PORTS.modelEfforts).toBeUndefined()
    expect(NATIVE_MUSE_CODE_FEATURE_PORTS.lifecycle).toBeUndefined()
    mockServe()
    const manager = fakeMuseCodeManager({
      featurePorts: NATIVE_MUSE_CODE_FEATURE_PORTS,
      getConfiguredBinaryPath: () => process.execPath,
    })
    vi.spyOn(manager, 'credentialFileVerdict').mockReturnValue('absent')
    try {
      await expectNativeBehaviour(await manager.ensureHost())
    } finally {
      await manager.dispose()
    }
  })
})

const RUNTIME_DEFAULTS: ServeOptions = {
  backend: 'museCode',
  trustWorkspace: true,
  museBinary: process.execPath,
  shellSandbox: 'off',
  canBypass: false,
  allowsContributorModels: false,
  paidFeatures: [],
  isVerbose: false,
  questionsDeferAfterSeconds: 60,
  autoCompaction: true,
}

describe('Native reader binding: CLI/ACP runtime', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads the same captured frames through the runtime construction', async () => {
    // Mirrors src/runtime/backends.ts: the runtime passes the native readers.
    mockServe()
    const runtime = createRuntimeBackend({
      options: { ...RUNTIME_DEFAULTS },
      version: '0.0.0-test',
      distDir: path.resolve('test/fixtures/workspace/no-muse-config'),
      platform: process.platform,
      env: {},
      homeDir: path.resolve('test/fixtures/workspace/no-muse-config'),
      secrets: memorySecrets(),
      runGit: () => Promise.reject(new Error('no git')),
      fetch: fetch,
      sleep: () => Promise.resolve(),
      log: new FakeLogOutputChannel(),
    })
    vi.spyOn(runtime.museCode, 'credentialFileVerdict').mockReturnValue('absent')
    try {
      await expectNativeBehaviour(await runtime.museCode.ensureHost())
    } finally {
      await runtime.close()
    }
  })
})
