import { nodeTempRoot, nodeNativeTest, testPackageVersion } from './helpers/nodeNative'
import { createHash } from 'node:crypto'
import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { parseNodeArgs } from '../../src/runtime/node/args'
import { ownService, productionNodeBinding } from '../../src/runtime/node/binding'
import { runNodeArgs, runNodeCommand, type NodeCommandDeps } from '../../src/runtime/node/main'
import { EN } from '../../src/shared/l10n/en'
import { NodeStateStore } from '../../src/runtime/node/state'
import { nodeDataFolder } from '../../src/runtime/dataFolder'
import { NODE_LOCK_FILE, UI_TEXT } from '../../src/shared/constants'
import { recordCalls } from './helpers/recordCalls'

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
      const reread = recordCalls<[unknown]>()
      const store = new NodeStateStore(root, reread.fn)
      const state = await store.load()
      expect(reread.calls).toHaveLength(0)
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
  nodeNativeTest('H01 a corrupt state file fails init with one fixed operator line', async () => {
    const { root, lines, deps, init } = await setup()
    expect(await runNodeCommand(init, deps)).toBe(0)
    await writeFile(path.join(root, 'state.v1.json'), 'not json')
    await expect(runNodeCommand(init, deps)).rejects.toThrow()
    expect(lines.filter((line) => line === UI_TEXT.nodeMessages.unexpectedFailure)).toHaveLength(1)
  })
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
      const reread = recordCalls<[unknown]>()
      const store = new NodeStateStore(deps.root, reread.fn)
      const state = await store.load()
      expect(reread.calls).toHaveLength(0)
      expect(state.config.listener).toEqual({ address: '192.168.1.9', port: 7443 })
      await expect(runNodeCommand(parseNodeArgs(['serve']), deps)).rejects.toThrow()
      await runNodeCommand(parseNodeArgs(['status']), deps)
    },
  )
  nodeNativeTest(
    'H08 lock, unlock and live status refuse explicitly until the control transport lands',
    async () => {
      const { deps, init, lines } = await setup()
      await runNodeCommand(init, deps)
      const bound = {
        ...deps,
        binding: productionNodeBinding({
          print: deps.print,
          version: testPackageVersion(),
        }),
      }
      // A stopped node answers status from its files, binding or not; stop
      // with no lock names the missing lock.
      expect(await runNodeCommand(parseNodeArgs(['status']), bound)).toBe(0)
      lines.length = 0
      expect(await runNodeArgs(['stop'], bound, EN, 'en')).toBe(1)
      expect(lines).toEqual([UI_TEXT.nodeErrors.notFound])
      for (const action of ['lock', 'unlock'])
        await expect(runNodeCommand(parseNodeArgs([action]), bound)).rejects.toThrow(
          UI_TEXT.nodeErrors.unavailable,
        )
      // A held lock refuses serve before the binding runs; status without a
      // binding reports the holder instead of inventing service state.
      const store = new NodeStateStore(deps.root, () => undefined)
      await store.load()
      const release = await ownService(store)
      try {
        await expect(runNodeCommand(parseNodeArgs(['serve']), bound)).rejects.toThrow()
        await expect(runNodeCommand(parseNodeArgs(['status']), deps)).rejects.toThrow()
      } finally {
        await release()
      }
    },
  )
})
