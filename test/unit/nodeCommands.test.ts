import { nodeTempRoot, nodeNativeTest } from './helpers/nodeNative'
import { createHash } from 'node:crypto'
import { readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { parseNodeArgs } from '../../src/runtime/node/args'
import {
  runNodeCommand,
  type NodeCommandDeps,
  type NodeServiceBinding,
} from '../../src/runtime/node/main'
import { NodeStateStore } from '../../src/runtime/node/state'
import { nodeDataFolder } from '../../src/runtime/dataFolder'
import { NODE_LOCK_FILE } from '../../src/shared/constants'
import { nodeDashboard } from './helpers/node/records'

const directories: string[] = []
async function setup() {
  const root = await nodeTempRoot('m110-commands-')
  directories.push(root)
  const lines: string[] = []
  const deps: NodeCommandDeps = {
    root,
    signal: new AbortController().signal,
    now: () => 0,
    print: (line) => {
      lines.push(line)
    },
    readSecret: () => Promise.resolve('test-only stdin'),
  }
  const init = parseNodeArgs([
    'init',
    '--label',
    'Home',
    '--name',
    'home.local',
    '--workspace-root',
    '/workspaces',
  ])
  return { root, lines, deps, init }
}
afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('M110-N node commands and isolated dispatch', () => {
  it('routes only explicit node commands and keeps ordinary ACP behavior', () => {
    expect(parseCommandLine(['node', '--help'])).toEqual({ command: 'node', argv: ['--help'] })
    expect(parseCommandLine([]).command).toBe('serve')
    expect(parseCommandLine(['auth', 'status']).command).toBe('authStatus')
    expect(
      nodeDataFolder({ platform: 'linux', env: { XDG_DATA_HOME: '/data' }, homeDir: '/home/test' }),
    ).toBe('/data/muse-spark-code/node')
    expect(
      nodeDataFolder({
        platform: 'win32',
        env: { LOCALAPPDATA: String.raw`C:\Data` },
        homeDir: String.raw`C:\Users\Test`,
      }),
    ).toBe(String.raw`C:\Data\Muse Spark Code\node`)
  })
  it.each(
    [
      ['init', '--listen', '0.0.0.0'],
      ['init', '--listen', '8.8.8.8'],
      ['init', '--port', '7443'],
      ['init', '--listen', '127.0.0.1', '--port', '1e3'],
      ['init', '--name', '127.0.0.1'],
      ['serve', '--listen', '127.0.0.1'],
      ['stop', '--passphrase', 'test-only'],
      ['unlock', '--key', 'test-only'],
      ['lock', '--all'],
      ['status', '--confirm-wipe'],
      ['relay'],
      ['status', 'extra'],
    ].map((argv) => ({ argv })),
  )('H01 refuses unsafe/secret/wrong-command arguments %j', ({ argv: args }) => {
    const argv =
      args[0] === 'init'
        ? [...args, '--label', 'Home', '--name', 'home.local', '--workspace-root', '/workspaces']
        : args
    expect(() => parseNodeArgs(argv)).toThrow()
  })
  nodeNativeTest(
    'H01 init persists a chosen configuration and only a hash of its single-use setup code',
    async () => {
      const { root, lines, deps, init } = await setup()
      expect(await runNodeCommand(init, deps)).toBe(0)
      const store = new NodeStateStore(root)
      const state = await store.load()
      expect(state.config.listener).toBeNull()
      const code = lines.find((line) => line.startsWith('One-time setup code: '))?.split(': ', 2)[1]
      expect(code).toBeDefined()
      expect(state.setup?.codeHash).toBe(
        createHash('sha256')
          .update(code ?? '')
          .digest('hex'),
      )
      expect(await readFile(path.join(root, 'state.v1.json'), 'utf8')).not.toContain(code)
      await expect(runNodeCommand(init, deps)).rejects.toThrow()
      await expect(stat(path.join(root, NODE_LOCK_FILE))).rejects.toThrow()
    },
  )
  nodeNativeTest(
    'H01 bind is selected only by init; missing production adapters explicitly refuse serve',
    async () => {
      const { deps } = await setup()
      const init = parseNodeArgs([
        'init',
        '--label',
        'Home',
        '--name',
        'home.local',
        '--workspace-root',
        '/workspaces',
        '--listen',
        '192.168.1.9',
      ])
      await runNodeCommand(init, deps)
      const store = new NodeStateStore(deps.root)
      const state = await store.load()
      expect(state.config.listener).toEqual({ address: '192.168.1.9', port: 7443 })
      await expect(runNodeCommand(parseNodeArgs(['serve']), deps)).rejects.toThrow()
      await runNodeCommand(parseNodeArgs(['status']), deps)
    },
  )
  nodeNativeTest(
    'H08 commands use the authenticated binding, stdin-only unlock and singleton supervision',
    async () => {
      const { deps, init } = await setup()
      await runNodeCommand(init, deps)
      const started = Promise.withResolvers<undefined>()
      const finish = Promise.withResolvers<undefined>()
      const command = vi.fn(
        (
          action: 'status' | 'stop' | 'lock' | 'unlock',
          _input: Parameters<NodeServiceBinding['command']>[1],
        ) => Promise.resolve(action === 'status' ? nodeDashboard() : { done: true }),
      )
      const binding: NodeServiceBinding = {
        serve: async () => {
          started.resolve(undefined)
          await finish.promise
        },
        command,
        wipe: () => Promise.resolve(),
      }
      const bound = { ...deps, binding }
      const running = runNodeCommand(parseNodeArgs(['serve']), bound)
      await started.promise
      await expect(runNodeCommand(parseNodeArgs(['serve']), bound)).rejects.toThrow()
      await expect(runNodeCommand(parseNodeArgs(['status']), deps)).rejects.toThrow()
      for (const action of ['status', 'lock', 'unlock', 'stop'])
        await runNodeCommand(parseNodeArgs([action]), bound)
      expect(command.mock.calls.map(([action]) => action)).toEqual([
        'status',
        'lock',
        'unlock',
        'stop',
      ])
      finish.resolve(undefined)
      expect(await running).toBe(0)
    },
  )
  nodeNativeTest(
    'H08 wipe requires explicit confirmation and destroys key slots before removing state',
    async () => {
      const { deps, init, root } = await setup()
      await runNodeCommand(init, deps)
      const wipe = vi.fn(async (store: NodeStateStore) => {
        expect(store.read().config.label).toBe('Home')
        await store.files.write('keys.v1', '')
      })
      const bound = {
        ...deps,
        binding: { serve: () => Promise.resolve(), command: () => Promise.resolve({}), wipe },
      }
      await expect(runNodeCommand(parseNodeArgs(['wipe']), bound)).rejects.toThrow()
      expect(wipe).not.toHaveBeenCalled()
      expect(await runNodeCommand(parseNodeArgs(['wipe', '--confirm-wipe']), bound)).toBe(0)
      expect(wipe).toHaveBeenCalledOnce()
      await expect(stat(root)).rejects.toThrow()
    },
  )
})
