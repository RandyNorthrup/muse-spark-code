import { afterEach, describe, expect, it, vi } from 'vitest'
import { openMuseTerminal } from '../../src/host/commands/openInTerminal'
import { SandboxSetup } from '../../src/host/backend/sandboxSetup'
import { createCliFeatures } from '../../src/host/cliFeatures'
import { createRulesFile } from '../../src/host/commands/createRulesFile'
import type { MuseCodeBackendManager } from '../../src/host/backend/museCodeBackendManager'
import type { ProcessResult } from '../../src/host/backend/sandboxSetup'
import { UI_TEXT } from '../../src/shared/constants'
import { fakeMuseCodeManager } from './helpers/museCodeManager'
import {
  type Harness,
  harness,
  holdRestoreRef,
  isPresent,
  REAL_GIT_TIMEOUT_MS,
  removeCheckpointFolders,
  write,
} from './helpers/checkpointHarness'

afterEach(removeCheckpointFolders)

function heldAdmission(h: Harness) {
  const entered = Promise.withResolvers<undefined>()
  const resume = Promise.withResolvers<undefined>()
  const manager = fakeMuseCodeManager({
    getConfiguredBinaryPath: () => process.execPath,
    workspaceRoot: h.root,
    beforeWorkspaceHostStart: async () => {
      entered.resolve(undefined)
      await resume.promise
      await h.store.markNativeBackend()
    },
  })
  return { manager, entered, resume }
}

type Family = 'CLI command' | 'sandbox command' | 'interactive terminal' | 'Muse init'

function startFamily(
  family: Family,
  h: Harness,
  manager: MuseCodeBackendManager,
  signal: AbortSignal,
  work: () => Promise<ProcessResult>,
): Promise<unknown> {
  switch (family) {
    case 'Muse init': {
      return createRulesFile({
        workspaceRoot: h.root,
        isWorkspaceTrusted: () => true,
        fileExists: () => isPresent(h.root, 'AGENTS.md'),
        runInit: () => manager.startWorkspaceCommand(work, signal),
        writeFile: () => Promise.reject(new Error('refused init must not choose the template')),
        openFile: () => Promise.resolve(),
        showInformation: () => undefined,
        showWarning: () => undefined,
        log: h.log,
      })
    }
    case 'CLI command': {
      const features = createCliFeatures({
        runCli: () => manager.startWorkspaceCommand(work, signal),
        runCliInTerminal: () => false,
        museSettingsPath: () => '',
        workspaceRoot: h.root,
        editFile: async (_fsPath, work) => await work(),
        openPreview: () => Promise.resolve(),
        restartBackend: () => Promise.resolve(),
        modelApiMcp: () => undefined,
        modelApiHooks: () => undefined,
        openLog: () => undefined,
        isProjectTrusted: () => true,
        log: h.log,
      })
      return features.manageSkills()
    }
    case 'sandbox command': {
      return new SandboxSetup({
        platform: 'win32',
        systemRoot: 'C:/Windows',
        resolveLaunch: () => manager.resolveLaunch(),
        run: () => manager.startWorkspaceCommand(work, signal),
        showWarning: () => Promise.resolve(undefined),
        showInformation: () => undefined,
        isPromptSuppressed: () => false,
        suppressPrompt: () => Promise.resolve(),
        log: h.log,
      }).check()
    }
    case 'interactive terminal': {
      return openMuseTerminal({
        resolveCli: () => ({ ok: true, cliPath: process.execPath }),
        runInTerminal: async () => {
          await manager.startWorkspaceCommand(work, signal)
        },
        workspaceRoot: h.root,
        showWarning: () => undefined,
      })
    }
  }
}

async function expectRefused(
  family: Family,
  starting: Promise<unknown>,
  reason: string,
): Promise<void> {
  if (family === 'sandbox command') {
    expect(await starting).toEqual({ status: 'unknown', reason: undefined, diagnostics: [] })
    return
  }
  await expect(starting).rejects.toThrow(reason)
}

describe.each<Family>(['CLI command', 'sandbox command', 'interactive terminal', 'Muse init'])(
  'extension-managed %s startup (M72)',
  (family) => {
    it(
      'awaits durable startup before runtime work and retains uncertainty after completion',
      async () => {
        const h = await harness()
        const held = heldAdmission(h)
        const signal = new AbortController().signal
        const work = vi.fn(async () => {
          expect(h.store.isNativeUnsafe).toBe(true)
          await write(h.root, family === 'Muse init' ? 'AGENTS.md' : 'native.txt', family)
          return {
            exitCode: 0,
            stdout: family === 'CLI command' ? '{"skills":[]}' : 'status=ready\n',
            stderr: '',
          }
        })
        const starting = startFamily(family, h, held.manager, signal, work)
        try {
          await held.entered.promise
          expect(work).not.toHaveBeenCalled()
          expect(await isPresent(h.root, 'native.txt')).toBe(false)
        } finally {
          held.resume.resolve(undefined)
        }
        await starting
        expect(work).toHaveBeenCalledOnce()
        expect(h.store.isNativeUnsafe).toBe(true)
      },
      REAL_GIT_TIMEOUT_MS,
    )

    it(
      'starts no runtime work under a real restore reservation',
      async () => {
        const h = await harness()
        await holdRestoreRef(h)
        const manager = fakeMuseCodeManager({
          getConfiguredBinaryPath: () => process.execPath,
          beforeWorkspaceHostStart: () => h.store.markNativeBackend(),
        })
        const work = vi.fn(() => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }))
        await expectRefused(
          family,
          startFamily(family, h, manager, new AbortController().signal, work),
          UI_TEXT.restoreTurnElsewhere,
        )
        expect(work).not.toHaveBeenCalled()
      },
      REAL_GIT_TIMEOUT_MS,
    )

    it.each(['window closed', 'manager disposed'])(
      'starts no runtime work when %s during awaited admission',
      async (reason) => {
        const h = await harness()
        const held = heldAdmission(h)
        const lifetime = new AbortController()
        const work = vi.fn(() => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }))
        const starting = startFamily(family, h, held.manager, lifetime.signal, work)
        const refused = expectRefused(family, starting, UI_TEXT.questionCancelled)
        try {
          await held.entered.promise
          if (reason === 'window closed') {
            lifetime.abort()
          } else {
            await held.manager.dispose()
          }
        } finally {
          held.resume.resolve(undefined)
        }
        await refused
        expect(work).not.toHaveBeenCalled()
      },
      REAL_GIT_TIMEOUT_MS,
    )
  },
)

describe('native command caller admission (M72)', () => {
  it.each(['window closed', 'manager disposed'])(
    'starts no Muse init or template when %s while missing-file lookup is held',
    async (reason) => {
      const h = await harness()
      const entered = Promise.withResolvers<undefined>()
      const resume = Promise.withResolvers<undefined>()
      const lifetime = new AbortController()
      const manager = fakeMuseCodeManager({
        workspaceRoot: h.root,
        beforeWorkspaceHostStart: () => h.store.markNativeBackend(),
      })
      const check = manager.workspaceActionGuard(lifetime.signal)
      const work = vi.fn(() => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }))
      const template = vi.fn(() => Promise.resolve())
      const starting = createRulesFile({
        workspaceRoot: h.root,
        isWorkspaceTrusted: () => true,
        fileExists: async () => {
          entered.resolve(undefined)
          await resume.promise
          return false
        },
        runInit: () => {
          check()
          return manager.startWorkspaceCommand(work, lifetime.signal)
        },
        writeFile: template,
        openFile: () => Promise.resolve(),
        showInformation: () => undefined,
        showWarning: () => undefined,
        log: h.log,
      })
      const refused = expect(starting).rejects.toThrow(UI_TEXT.questionCancelled)
      try {
        await entered.promise
        if (reason === 'window closed') {
          lifetime.abort()
        } else {
          await manager.dispose()
        }
      } finally {
        resume.resolve(undefined)
      }
      await refused
      expect(work).not.toHaveBeenCalled()
      expect(template).not.toHaveBeenCalled()
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'awaits interactive terminal admission before returning or creating the terminal',
    async () => {
      const h = await harness()
      const held = heldAdmission(h)
      const createTerminal = vi.fn(() => undefined)
      const starting = openMuseTerminal({
        resolveCli: () => ({ ok: true, cliPath: process.execPath }),
        runInTerminal: () =>
          held.manager.startWorkspaceCommand(createTerminal, new AbortController().signal),
        workspaceRoot: h.root,
        showWarning: () => undefined,
      })
      let hasFinished = false
      const completed = (async () => {
        await starting
        hasFinished = true
      })()
      try {
        await held.entered.promise
        expect(hasFinished).toBe(false)
        expect(createTerminal).not.toHaveBeenCalled()
      } finally {
        held.resume.resolve(undefined)
      }
      await completed
      expect(createTerminal).toHaveBeenCalledOnce()
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
