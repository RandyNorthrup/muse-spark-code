// M91 lane E: the window's extension hook runner (both backends). The
// snapshot loads under the trust gate and opt-in; Setup and Manual run on
// demand with their output shown; FileChanged, ConfigChange and
// DirectoryAdded fire at their operations only, and never with the gates
// closed.

import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import {
  ExtensionHookRunner,
  type ExtensionHookRunnerDeps,
} from '../../src/host/extensionHooksRunner'
import type { ShellResult } from '../../src/core/shellResult'
import { memoryContextIo } from './helpers/fakeContextIo'
import { hookResult } from './helpers/fakeToolIo'
import { FakeLogOutputChannel } from './helpers/fakes'
import { extensionHooksBundle } from '../../src/host/extensionHooksBundle'
import { UI_TEXT } from '../../src/shared/constants'

const ROOT = '/ws'
const SETTINGS = '/home/user/.config/muse/settings.json'
const PROJECT_HOOKS = `${ROOT}/.muse/spark-hooks.json`
const USER_HOOKS = '/home/user/.config/muse/spark-hooks.json'

function sparkDoc(doc: unknown): string {
  return JSON.stringify({ hooks: doc })
}

const WATCHED_FILE_CONFIG = sparkDoc({
  FileChanged: [{ matcher: '**', hooks: [{ type: 'command', command: 'watch' }] }],
})

interface HookRun {
  readonly command: string
  readonly payload: Record<string, unknown>
}

function setup(
  options: {
    readonly files?: Record<string, string>
    readonly runHook?: (command: string, payload: Record<string, unknown>) => ShellResult
    readonly isWorkspaceTrusted?: () => boolean
    readonly isHooksEnabled?: () => boolean
    readonly isIndexed?: (relativePath: string) => Promise<boolean>
    readonly links?: Record<string, string>
  } = {},
) {
  const files = new Map<string, string | Uint8Array>(Object.entries(options.files ?? {}))
  const hookRuns: HookRun[] = []
  const notices: { readonly level: string; readonly text: string }[] = []
  const outputs: { readonly title: string; readonly text: string }[] = []
  const warnings: string[] = []
  let clock = 1_000_000
  const deps: ExtensionHookRunnerDeps = {
    io: memoryContextIo(files, options.links),
    runHook: (command, payload) => {
      const parsed = z.record(z.string(), z.unknown()).parse(JSON.parse(payload))
      hookRuns.push({ command, payload: parsed })
      return Promise.resolve(options.runHook?.(command, parsed) ?? hookResult(''))
    },
    platform: 'linux',
    workspaceRoot: ROOT,
    settingsPath: SETTINGS,
    instanceId: 'test-window',
    isWorkspaceTrusted: options.isWorkspaceTrusted ?? (() => true),
    isHooksEnabled: options.isHooksEnabled ?? (() => true),
    now: () => clock,
    ...(options.isIndexed !== undefined && { isIndexed: options.isIndexed }),
    notice: (level, text) => {
      notices.push({ level, text })
    },
    showOutput: (title, text) => {
      outputs.push({ title, text })
    },
    warn: (message) => {
      warnings.push(message)
    },
  }
  const runner = new ExtensionHookRunner(deps)
  return {
    runner,
    files,
    hookRuns,
    notices,
    outputs,
    warnings,
    advanceClock: (ms: number) => {
      clock += ms
    },
  }
}

describe('extension hooks lazy bundle', () => {
  it.each([
    { name: 'null', value: null },
    { name: 'missing factory', value: {} },
    { name: 'nonfunction factory', value: { createExtensionHookRunner: false } },
  ])('rejects a malformed bundle factory ($name)', async ({ value }) => {
    const bundle = extensionHooksBundle(
      '/extensionHooks.js',
      new FakeLogOutputChannel(),
      () => value,
    )
    await expect(async () => {
      await bundle.loadBundle()
    }).rejects.toThrow(UI_TEXT.extensionHooksUnavailable)
  })
})

describe('ExtensionHookRunner', () => {
  it('observes extension settings without inventing a settings filename', async () => {
    const t = setup({
      files: {
        [PROJECT_HOOKS]: sparkDoc({
          ConfigChange: [{ hooks: [{ type: 'command', command: 'config' }] }],
        }),
      },
    })
    await t.runner.reload()
    await t.runner.noteSettingsChange()
    expect(t.hookRuns[0]?.payload).toMatchObject({
      hook_event_name: 'ConfigChange',
      path: '',
      reason: 'settings',
    })
  })
  it('reloads a newly created config when the old snapshot was empty', async () => {
    const t = setup()
    await t.runner.reload()
    t.files.set(
      PROJECT_HOOKS,
      sparkDoc({ Setup: [{ hooks: [{ type: 'command', command: 'new' }] }] }),
    )
    await t.runner.noteConfigFile(PROJECT_HOOKS, 'spark-hooks')
    expect(t.runner.snapshot()).toHaveLength(1)
  })

  it('rejects symlink escapes and unmatched files before they consume the file-change cap', async () => {
    const t = setup({
      files: {
        [PROJECT_HOOKS]: sparkDoc({
          FileChanged: [{ matcher: 'src/**', hooks: [{ type: 'command', command: 'watch' }] }],
        }),
      },
      links: { '/ws/src/out': '/outside' },
    })
    await t.runner.reload()
    await t.runner.noteWorkspaceFile('/ws/src/out/private.txt')
    await t.runner.noteWorkspaceFile('/outside/private.txt')
    for (let index = 0; index < 35; index += 1)
      await t.runner.noteWorkspaceFile(`/ws/docs/${String(index)}.md`)
    await t.runner.noteWorkspaceFile('/ws/src/app.ts')
    expect(t.hookRuns).toHaveLength(1)
    expect(t.hookRuns[0]?.payload['path']).toBe('src/app.ts')
  })

  it('drops a display rewrite when trust changes while the hook answers', async () => {
    let isTrusted = true
    const t = setup({
      files: {
        [PROJECT_HOOKS]: sparkDoc({
          MessageDisplay: [{ hooks: [{ type: 'command', command: 'display' }] }],
        }),
      },
      isWorkspaceTrusted: () => isTrusted,
      runHook: () => {
        isTrusted = false
        return hookResult('{"displayText":"edited"}')
      },
    })
    await t.runner.reload()
    expect(await t.runner.rewriteMessage('original')).toBeUndefined()
  })
  it('loads nothing in an untrusted workspace or with the opt-in off', async () => {
    for (const gates of [
      { isWorkspaceTrusted: () => false, isHooksEnabled: () => true },
      { isWorkspaceTrusted: () => true, isHooksEnabled: () => false },
    ]) {
      const t = setup({
        files: {
          [PROJECT_HOOKS]: sparkDoc({ Setup: [{ hooks: [{ type: 'command', command: 'x' }] }] }),
        },
        ...gates,
      })
      await t.runner.reload()
      expect(t.runner.snapshot()).toEqual([])
      await t.runner.noteWorkspaceFile(`${ROOT}/notes.txt`)
      await t.runner.runSetup('init')
      await t.runner.noteDirectoryAdded(`${ROOT}/fresh`)
      expect(t.hookRuns).toEqual([])
    }
  })

  it('runs the Setup hooks for the init trigger with their output shown', async () => {
    const t = setup({
      files: {
        [PROJECT_HOOKS]: sparkDoc({
          Setup: [
            { matcher: 'init', hooks: [{ type: 'command', command: 'init-only' }] },
            { matcher: 'maintenance', hooks: [{ type: 'command', command: 'tidy' }] },
            { hooks: [{ type: 'command', command: 'always' }] },
          ],
        }),
      },
      runHook: () => hookResult('setup says hi'),
    })
    const result = await t.runner.runSetup('init')
    expect(result).toEqual({ ran: 2, output: 'setup says hi\nsetup says hi' })
    expect(t.hookRuns.map((run) => run.command)).toEqual(['init-only', 'always'])
    expect(t.hookRuns[0]?.payload).toMatchObject({
      hook_event_name: 'Setup',
      trigger: 'init',
      session_id: 'host:test-window',
      cwd: ROOT,
    })
    expect(t.outputs).toEqual([{ title: 'Setup init', text: 'setup says hi\nsetup says hi' }])
  })

  it('runs the maintenance trigger and reports no hooks when none match', async () => {
    const t = setup({
      files: {
        [PROJECT_HOOKS]: sparkDoc({
          Setup: [{ matcher: 'init', hooks: [{ type: 'command', command: 'init-only' }] }],
        }),
      },
    })
    expect(await t.runner.runSetup('maintenance')).toEqual({ ran: 0, output: '' })
    expect(t.hookRuns).toEqual([])
    expect(t.outputs).toEqual([])
  })

  it('lists Manual hooks and runs one by command with its output shown', async () => {
    const t = setup({
      files: {
        [PROJECT_HOOKS]: sparkDoc({
          Manual: [
            {
              description: 'Say hello',
              hooks: [{ type: 'command', command: 'hello' }],
            },
            { hooks: [{ type: 'command', command: 'other' }] },
          ],
        }),
      },
      runHook: (command) => hookResult(`${command} ran`),
    })
    await t.runner.reload()
    expect(t.runner.listManual()).toEqual([
      { command: 'hello', description: 'Say hello', source: 'project' },
      { command: 'other', source: 'project' },
    ])
    // Only the picked hook runs, whatever else is configured.
    const result = await t.runner.runManual('other')
    expect(result).toEqual({ matched: true, output: 'other ran' })
    expect(t.hookRuns.map((run) => run.command)).toEqual(['other'])
    expect(t.outputs).toEqual([{ title: 'other', text: 'other ran' }])
  })

  it('runs a Manual hook by description and reports an unknown name', async () => {
    const t = setup({
      files: {
        [PROJECT_HOOKS]: sparkDoc({
          Manual: [{ description: 'Say hello', hooks: [{ type: 'command', command: 'hello' }] }],
        }),
      },
    })
    expect(await t.runner.runManual('Say hello')).toEqual({ matched: true, output: '' })
    expect(t.hookRuns.map((run) => run.command)).toEqual(['hello'])
    expect(await t.runner.runManual('nope')).toEqual({ matched: false, output: '' })
    expect(t.hookRuns).toHaveLength(1)
    expect(t.outputs).toEqual([])
  })

  it('reports a failing Manual hook with its reason', async () => {
    const t = setup({
      files: {
        [PROJECT_HOOKS]: sparkDoc({
          Manual: [{ hooks: [{ type: 'command', command: 'broken' }] }],
        }),
      },
      runHook: () => hookResult('partial', { exitCode: 1, stderr: 'boom' }),
    })
    const result = await t.runner.runManual('broken')
    expect(result).toEqual({ matched: true, output: 'partial', failedReason: 'boom' })
    expect(t.outputs).toEqual([{ title: 'broken', text: 'partial' }])
  })

  it('fires FileChanged for a watched path, never under .git, node_modules or protected paths', async () => {
    const t = setup({
      files: {
        [PROJECT_HOOKS]: WATCHED_FILE_CONFIG,
      },
    })
    await t.runner.reload()
    await t.runner.noteWorkspaceFile(`${ROOT}/notes.txt`)
    expect(t.hookRuns).toHaveLength(1)
    expect(t.hookRuns[0]?.payload).toMatchObject({
      hook_event_name: 'FileChanged',
      path: 'notes.txt',
      reason: 'watcher',
    })
    for (const skipped of [
      `${ROOT}/.git/index`,
      `${ROOT}/node_modules/pkg/index.js`,
      `${ROOT}/.muse/settings.json`,
    ]) {
      await t.runner.noteWorkspaceFile(skipped)
    }
    expect(t.hookRuns).toHaveLength(1)
  })

  it('drops unlisted paths and debounces and caps the rest', async () => {
    const t = setup({
      files: {
        [PROJECT_HOOKS]: WATCHED_FILE_CONFIG,
      },
      isIndexed: (relativePath) => Promise.resolve(relativePath !== 'dist/bundle.js'),
    })
    await t.runner.reload()
    await t.runner.noteWorkspaceFile(`${ROOT}/dist/bundle.js`)
    expect(t.hookRuns).toEqual([])
    await t.runner.noteWorkspaceFile(`${ROOT}/notes.txt`)
    await t.runner.noteWorkspaceFile(`${ROOT}/notes.txt`)
    expect(t.hookRuns).toHaveLength(1)
    t.advanceClock(1000)
    await t.runner.noteWorkspaceFile(`${ROOT}/notes.txt`)
    expect(t.hookRuns).toHaveLength(2)
    for (let index = 0; index < 30; index += 1) {
      await t.runner.noteWorkspaceFile(`${ROOT}/file-${String(index)}.txt`)
    }
    expect(t.hookRuns).toHaveLength(30)
    expect(t.warnings.some((warning) => warning.includes('capped'))).toBe(true)
  })

  it('fires ConfigChange and observes under the config in effect', async () => {
    const t = setup({
      files: {
        [PROJECT_HOOKS]: sparkDoc({
          ConfigChange: [{ hooks: [{ type: 'command', command: 'first' }] }],
        }),
      },
    })
    await t.runner.reload()
    await t.runner.noteConfigFile(`${ROOT}/.muse/spark-hooks.json`, 'spark-hooks')
    expect(t.hookRuns.map((run) => run.command)).toEqual(['first'])
    expect(t.hookRuns[0]?.payload).toMatchObject({
      hook_event_name: 'ConfigChange',
      path: '.muse/spark-hooks.json',
      reason: 'spark-hooks',
    })
    // The change is observed under the config in effect when it happened; the
    // new config governs the next event.
    t.files.set(
      PROJECT_HOOKS,
      sparkDoc({ ConfigChange: [{ hooks: [{ type: 'command', command: 'second' }] }] }),
    )
    await t.runner.noteConfigFile(`${ROOT}/.muse/spark-hooks.json`, 'spark-hooks')
    await t.runner.noteConfigFile(`${ROOT}/.muse/spark-hooks.json`, 'spark-hooks')
    expect(t.hookRuns.map((run) => run.command)).toEqual(['first', 'first', 'second'])
  })

  it('fires DirectoryAdded for a folder, absolute when outside the root', async () => {
    const t = setup({
      files: {
        [PROJECT_HOOKS]: sparkDoc({
          DirectoryAdded: [{ hooks: [{ type: 'command', command: 'greet' }] }],
        }),
      },
    })
    await t.runner.reload()
    await t.runner.noteDirectoryAdded(`${ROOT}/packages/app`)
    await t.runner.noteDirectoryAdded('/elsewhere/proj')
    expect(t.hookRuns.map((run) => run.payload['path'])).toEqual([
      'packages/app',
      '/elsewhere/proj',
    ])
  })

  it('reads the user file beside the settings and shows a hook message', async () => {
    const t = setup({
      files: {
        [USER_HOOKS]: sparkDoc({
          Setup: [{ hooks: [{ type: 'command', command: 'user-setup' }] }],
        }),
      },
      runHook: () => hookResult('', { exitCode: 0 }),
    })
    const result = await t.runner.runSetup('init')
    expect(result.ran).toBe(1)
    expect(t.hookRuns[0]?.payload).toMatchObject({ hook_event_name: 'Setup', trigger: 'init' })
  })

  it('notices a hook message without starting anything', async () => {
    const t = setup({
      files: {
        [PROJECT_HOOKS]: sparkDoc({
          Setup: [{ hooks: [{ type: 'command', command: 'note' }] }],
        }),
      },
      runHook: () => hookResult(JSON.stringify({ systemMessage: 'setup finished' })),
    })
    await t.runner.runSetup('init')
    expect(t.notices).toEqual([{ level: 'info', text: 'setup finished' }])
  })
})
