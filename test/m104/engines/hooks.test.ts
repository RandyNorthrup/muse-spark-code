import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeHooks, type RuntimeHookDeps } from '../../../src/runtime/features/hooks'
import { UI_TEXT } from '../../../src/shared/constants'
import { memoryContextIo } from '../../unit/helpers/fakeContextIo'
import { hookResult } from '../../unit/helpers/fakeToolIo'

const owners: ReturnType<typeof createRuntimeHooks>[] = []
afterEach(async () => {
  await Promise.all(owners.splice(0).map((owner) => owner.dispose()))
})
function setup(platform: 'linux' | 'win32' = 'linux') {
  const root = platform === 'win32' ? String.raw`C:\ws` : '/ws'
  const settings =
    platform === 'win32' ? String.raw`C:\user\muse\settings.json` : '/user/muse/settings.json'
  const config =
    platform === 'win32' ? String.raw`C:\ws\.muse\spark-hooks.json` : '/ws/.muse/spark-hooks.json'
  const files = new Map<string, string | Uint8Array>([
    [
      config.replaceAll('\\', '/'),
      JSON.stringify({
        hooks: {
          Manual: [{ description: 'Checks', hooks: [{ type: 'command', command: 'check' }] }],
          MessageDisplay: [{ hooks: [{ type: 'command', command: 'display' }] }],
          FileChanged: [{ matcher: '**', hooks: [{ type: 'command', command: 'watch' }] }],
        },
      }),
    ],
  ])
  const state = { isTrusted: true, isEnabled: true, isCurrent: true, isIndexed: true }
  const runHook = vi.fn<RuntimeHookDeps['runHook']>(() => Promise.resolve(hookResult('')))
  const output = vi.fn()
  const io = memoryContextIo(files)
  const owner = createRuntimeHooks(
    {
      io,
      runHook,
      platform,
      workspaceRoot: root,
      settingsPath: settings,
      assertCurrent: () => {
        if (!state.isCurrent) throw new Error('replaced')
      },
      isWorkspaceTrusted: () => state.isTrusted,
      isHooksEnabled: () => state.isEnabled,
      isIndexed: () => Promise.resolve(state.isIndexed),
      now: () => 1,
      notice: output,
      showOutput: output,
      warn: () => undefined,
    },
    UI_TEXT,
    'en',
  )
  owners.push(owner)
  return { root, config, files, io, state, runHook, output, owner }
}

describe('portable owner-bound window hooks', () => {
  it('loads the user configuration beside a Windows settings path', async () => {
    const { owner, files } = setup('win32')
    files.set(
      'C:/user/muse/spark-hooks.json',
      JSON.stringify({
        hooks: {
          Manual: [{ hooks: [{ type: 'command', command: 'user-check' }] }],
        },
      }),
    )
    await owner.reload()
    expect(owner.listManual()).toContainEqual({ command: 'user-check', source: 'user' })
  })
  it.each(['linux', 'win32'] as const)(
    'runs real manual and indexed file hooks on %s',
    async (platform) => {
      const { owner, runHook, root, state } = setup(platform)
      await owner.reload()
      expect(owner.listManual()).toMatchObject([{ command: 'check' }])
      expect(await owner.runManual('check')).toMatchObject({ matched: true })
      const file = platform === 'win32' ? String.raw`${root}\src\file.ts` : `${root}/src/file.ts`
      await owner.noteWorkspaceFile(file)
      expect(runHook.mock.calls.map(([command]) => command)).toEqual(['check', 'watch'])
      expect(JSON.parse(runHook.mock.calls[1]?.[1] ?? '{}')).toMatchObject({
        hook_event_name: 'FileChanged',
        path: 'src/file.ts',
      })
      state.isIndexed = false
      await owner.noteWorkspaceFile(file)
      expect(runHook).toHaveBeenCalledTimes(2)
    },
  )

  it('reads live trust and opt-in and refuses a replaced owner before process dispatch', async () => {
    const { owner, runHook, state } = setup()
    state.isTrusted = false
    expect(await owner.runManual('check')).toMatchObject({ matched: false })
    state.isTrusted = true
    state.isEnabled = false
    expect(await owner.runManual('check')).toMatchObject({ matched: false })
    state.isEnabled = true
    state.isCurrent = false
    await expect(owner.runManual('check')).rejects.toThrow('replaced')
    expect(runHook).not.toHaveBeenCalled()
  })

  it('rechecks trust after suspended configuration reads', async () => {
    const { owner, runHook, state, io } = setup()
    const read = io.readFile
    const held = Promise.withResolvers<undefined>()
    const reached = Promise.withResolvers<undefined>()
    vi.spyOn(io, 'readFile').mockImplementation(async (file) => {
      reached.resolve(undefined)
      await held.promise
      return await read(file)
    })
    const running = owner.runManual('check')
    await reached.promise
    state.isTrusted = false
    held.resolve(undefined)
    expect(await running).toMatchObject({ matched: false })
    expect(runHook).not.toHaveBeenCalled()
  })

  it('cancels and drains an admitted hook without publishing late output', async () => {
    const { owner, runHook, output } = setup()
    const held = Promise.withResolvers<ReturnType<typeof hookResult>>()
    const reached = Promise.withResolvers<undefined>()
    runHook.mockImplementation((_command, _payload, _cwd, _timeout, signal) => {
      expect(signal).toBeDefined()
      reached.resolve(undefined)
      return held.promise
    })
    const running = owner.runManual('check')
    await reached.promise
    const closing = owner.dispose()
    expect(owner.dispose()).toBe(closing)
    expect(runHook.mock.calls[0]?.[4]?.aborted).toBe(true)
    held.resolve(hookResult('late output'))
    await expect(running).rejects.toThrow()
    await closing
    expect(output).not.toHaveBeenCalled()
    await expect(owner.runManual('check')).rejects.toThrow()
  })
})
