import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { LaunchResolution } from '../../src/core/backends/musecode/launch'
import { authClear, authSet, authStatus, login } from '../../src/runtime/authCommands'
import { createRuntimeBackend } from '../../src/runtime/backends'
import { parseCommandLine, type ServeOptions } from '../../src/runtime/cliArgs'
import { agentDataFolder, workspaceSessionsFolder } from '../../src/runtime/dataFolder'
import { walkFiles } from '../../src/runtime/fileWalk'
import { readSecretLine } from '../../src/runtime/hiddenInput'
import {
  credentialStoreName,
  type KeyringEntry,
  keyringSecretStore,
} from '../../src/runtime/keyStore'
import { displayLanguage } from '../../src/runtime/locale'
import { stderrLogger } from '../../src/runtime/stderrLog'
import { webReadable } from '../../src/runtime/webStreams'
import { SECRET_KEYS, UI_TEXT } from '../../src/shared/constants'
import { memorySecrets } from './helpers/fakes'
import { fakeModelApi } from './helpers/fakeModelApi'
import { removeFolder } from './helpers/temporaryFolders'

// M63 (PLAN.md D61, D62): the agent's process, sign-in commands and key store.

const KEY = 'LLM|123456|secret-value'
const folders: string[] = []

function folder(): string {
  const created = mkdtempSync(path.join(tmpdir(), 'acp-runtime-'))
  folders.push(created)
  return created
}

afterAll(async () => {
  await Promise.all(folders.map((created) => removeFolder(created)))
})

const DEFAULTS: ServeOptions = {
  backend: 'museCode',
  trustWorkspace: false,
  museBinary: '',
  shellSandbox: 'auto',
  canBypass: false,
  allowsContributorModels: false,
  paidFeatures: [],
  isVerbose: false,
}

function fakeKeyring() {
  const values = new Map<string, string>()
  const opened: string[] = []
  const open = (service: string, account: string): KeyringEntry => {
    opened.push(`${service}/${account}`)
    const id = `${service}/${account}`
    return {
      // The native binding reads a missing entry as null.
      getPassword: () => Promise.resolve(values.get(id) ?? null),
      setPassword: (password) => {
        values.set(id, password)
        return Promise.resolve()
      },
      deletePassword: () => Promise.resolve(values.delete(id)),
    }
  }
  return { values, opened, open }
}

function deps(line: string, secrets = memorySecrets()) {
  const printed: string[] = []
  const errors: string[] = []
  return {
    printed,
    errors,
    secrets,
    deps: {
      secrets,
      storeName: 'the test store',
      readSecret: vi.fn(() => Promise.resolve(line)),
      print: (text: string) => {
        printed.push(text)
      },
      printError: (text: string) => {
        errors.push(text)
      },
    },
  }
}

function fakeChild(): EventEmitter {
  return new EventEmitter()
}

describe('parseCommandLine', () => {
  it('serves by default, with the flags as options', () => {
    expect(parseCommandLine([])).toEqual({ command: 'serve', options: DEFAULTS })
    expect(
      parseCommandLine([
        '--backend',
        'modelApi',
        '--trust-workspace',
        '--muse-binary=/opt/muse',
        '--shell-sandbox',
        'off',
        '--allow-dangerously-skip-permissions',
        '--allow-contributor-models',
        '--image-generation',
        '--web-search',
        '--verbose',
      ]),
    ).toEqual({
      command: 'serve',
      options: {
        backend: 'modelApi',
        trustWorkspace: true,
        museBinary: '/opt/muse',
        shellSandbox: 'off',
        canBypass: true,
        allowsContributorModels: true,
        paidFeatures: ['webSearch', 'imageGeneration'],
        isVerbose: true,
      },
    })
  })

  it('refuses a paid feature on the Muse Code backend, naming the flag (M63c)', () => {
    expect(parseCommandLine(['--web-search'])).toEqual({
      command: 'invalid',
      reason: '--web-search needs --backend modelApi: paid features bill a Model API key.',
    })
    expect(parseCommandLine(['--backend', 'museCode', '--image-generation'])).toEqual({
      command: 'invalid',
      reason: '--image-generation needs --backend modelApi: paid features bill a Model API key.',
    })
  })

  it('reads the sign-in commands after the configured flags, as terminal sign-ins append them', () => {
    expect(parseCommandLine(['--backend', 'modelApi', 'auth', 'set'])).toEqual({
      command: 'authSet',
    })
    expect(parseCommandLine(['auth', 'status'])).toEqual({ command: 'authStatus' })
    expect(parseCommandLine(['auth', 'clear'])).toEqual({ command: 'authClear' })
    expect(parseCommandLine(['--muse-binary', '/m', 'login'])).toEqual({
      command: 'login',
      options: { ...DEFAULTS, museBinary: '/m' },
    })
    expect(parseCommandLine(['-h'])).toEqual({ command: 'help' })
    expect(parseCommandLine(['--version'])).toEqual({ command: 'version' })
  })

  it('refuses what it does not know, naming it', () => {
    for (const argv of [
      ['--backend', 'auto'],
      ['--shell-sandbox', 'maybe'],
      ['auth', 'rotate'],
      ['auth', 'set', 'extra'],
      ['login', 'now'],
      ['serve'],
      ['--colour'],
    ]) {
      expect(parseCommandLine(argv).command).toBe('invalid')
    }
    expect(parseCommandLine(['--backend', 'auto'])).toEqual({
      command: 'invalid',
      reason: 'Unknown argument: --backend auto',
    })
  })
})

describe('displayLanguage', () => {
  it('reads the POSIX locale variables in their order, else the runtime’s locale', () => {
    expect(displayLanguage({ LANG: 'de_DE.UTF-8' }, 'en-US')).toBe('de-de')
    expect(displayLanguage({ LC_ALL: 'pt_BR@euro', LANG: 'de_DE' }, 'en-US')).toBe('pt-br')
    expect(displayLanguage({ LC_MESSAGES: 'ja_JP' }, 'en-US')).toBe('ja-jp')
    expect(displayLanguage({ LANG: 'C.UTF-8' }, 'fr-FR')).toBe('fr-fr')
    expect(displayLanguage({ LANG: '' }, 'zh-TW')).toBe('zh-tw')
  })
})

describe('the data folder', () => {
  it('lives where each platform keeps application data', () => {
    expect(
      agentDataFolder({
        platform: 'win32',
        env: { LOCALAPPDATA: String.raw`C:\L` },
        homeDir: String.raw`C:\u`,
      }),
    ).toBe(String.raw`C:\L\Muse Spark Code`)
    expect(agentDataFolder({ platform: 'win32', env: {}, homeDir: String.raw`C:\u` })).toBe(
      String.raw`C:\u\AppData\Local\Muse Spark Code`,
    )
    expect(agentDataFolder({ platform: 'darwin', env: {}, homeDir: '/Users/a' })).toBe(
      '/Users/a/Library/Application Support/Muse Spark Code',
    )
    expect(agentDataFolder({ platform: 'linux', env: {}, homeDir: '/home/a' })).toBe(
      '/home/a/.local/share/muse-spark-code',
    )
    expect(
      agentDataFolder({ platform: 'linux', env: { XDG_DATA_HOME: '/d' }, homeDir: '/home/a' }),
    ).toBe('/d/muse-spark-code')
  })

  it('keeps each workspace’s sessions under a hash of its path, never the path', () => {
    const input = { platform: 'linux' as const, env: {}, homeDir: '/home/a' }
    const one = workspaceSessionsFolder(input, '/work/one')
    expect(one).toMatch(
      /^\/home\/a\/\.local\/share\/muse-spark-code\/acp\/[0-9a-f]{16}\/modelapi-sessions$/,
    )
    expect(one).not.toContain('work')
    expect(workspaceSessionsFolder(input, '/work/two')).not.toBe(one)
  })
})

describe('the OS credential store (D61)', () => {
  it('keeps the key under the agent’s service and the extension’s key name', async () => {
    const keyring = fakeKeyring()
    const store = keyringSecretStore(keyring.open)
    await store.store(SECRET_KEYS.modelApiKey, KEY)
    expect(await store.get(SECRET_KEYS.modelApiKey)).toBe(KEY)
    await store.delete(SECRET_KEYS.modelApiKey)
    expect(await store.get(SECRET_KEYS.modelApiKey)).toBeUndefined()
    expect(new Set(keyring.opened)).toEqual(
      new Set(['Muse Spark Code (Unofficial)/museSpark.modelApiKey']),
    )
  })

  it('reports no key, not a stored one, when the entry is missing', async () => {
    const keyring = fakeKeyring()
    const run = deps('', { ...keyringSecretStore(keyring.open), values: keyring.values })
    expect(await authStatus(run.deps)).toBe(1)
    expect(run.printed).toEqual([UI_TEXT.acpKeyAbsent])
  })

  it('names the store the way each platform does', () => {
    expect(credentialStoreName('win32')).toBe(UI_TEXT.acpStoreNames.windows)
    expect(credentialStoreName('darwin')).toBe(UI_TEXT.acpStoreNames.macos)
    expect(credentialStoreName('linux')).toBe(UI_TEXT.acpStoreNames.linux)
  })
})

describe('the key’s commands', () => {
  const broken = {
    get: () => Promise.reject(new Error('no keyring')),
    store: () => Promise.reject(new Error('no keyring')),
    delete: () => Promise.reject(new Error('no keyring')),
  }

  it('stores a valid key and says where, never what', async () => {
    const run = deps(`  ${KEY}  `)
    expect(await authSet(run.deps)).toBe(0)
    expect(run.secrets.values.get(SECRET_KEYS.modelApiKey)).toBe(KEY)
    expect(run.printed).toEqual(['The key is stored in the test store.'])
    expect([...run.printed, ...run.errors].join('\n')).not.toContain('secret-value')
  })

  it('stores nothing for an empty line or a value that is not a key', async () => {
    const empty = deps('')
    expect(await authSet(empty.deps)).toBe(1)
    expect(empty.errors).toEqual([UI_TEXT.acpKeyNotStored])
    const wrong = deps('sk-not-a-meta-key')
    expect(await authSet(wrong.deps)).toBe(1)
    expect(wrong.errors).toEqual([UI_TEXT.apiKeyInvalid])
    expect(wrong.secrets.values.size).toBe(0)
  })

  it('says whether a key is stored, and removes it', async () => {
    const run = deps(KEY)
    expect(await authStatus(run.deps)).toBe(1)
    await authSet(run.deps)
    expect(await authStatus(run.deps)).toBe(0)
    expect(await authClear(run.deps)).toBe(0)
    expect(run.printed).toEqual([
      UI_TEXT.acpKeyAbsent,
      'The key is stored in the test store.',
      'A Meta Model API key is stored in the test store.',
      UI_TEXT.acpKeyCleared,
    ])
  })

  it('reports a store it cannot use, with the system’s reason', async () => {
    for (const command of [authSet, authStatus, authClear]) {
      const run = { ...deps(KEY), deps: { ...deps(KEY).deps, secrets: broken } }
      const errors: string[] = []
      expect(
        await command({
          ...run.deps,
          printError: (text) => {
            errors.push(text)
          },
        }),
      ).toBe(1)
      expect(errors[0]).toContain('(no keyring)')
    }
  })
})

describe('login', () => {
  const launch: LaunchResolution = {
    ok: true,
    launch: {
      command: '/usr/bin/node',
      args: ['/opt/muse/cli.js', 'serve', '--stdio'],
      serveArgs: ['serve', '--stdio'],
      installDir: '/opt/muse',
      cliPath: '/opt/muse/muse',
    },
  }

  it('runs `muse login` the way the agent runs `muse serve`, and returns its exit code', async () => {
    const child = fakeChild()
    const spawnInTerminal = vi.fn(() => child)
    const done = login({
      resolveLaunch: () => launch,
      environment: () => ({ HOME: '/home/a' }),
      spawnInTerminal,
      printError: vi.fn(),
    })
    child.emit('exit', 0)
    expect(await done).toBe(0)
    expect(spawnInTerminal).toHaveBeenCalledWith('/usr/bin/node', ['/opt/muse/cli.js', 'login'], {
      HOME: '/home/a',
    })
  })

  it('reports a CLI it cannot find or start', async () => {
    const errors: string[] = []
    const missing = await login({
      resolveLaunch: () => ({ ok: false, searched: ['/a', '/b'], reason: 'not installed.' }),
      environment: () => ({}),
      spawnInTerminal: vi.fn(),
      printError: (text) => {
        errors.push(text)
      },
    })
    expect(missing).toBe(1)
    expect(errors).toEqual(['not installed. Searched: /a, /b'])
    const child = fakeChild()
    const failed = login({
      resolveLaunch: () => launch,
      environment: () => ({}),
      spawnInTerminal: () => child,
      printError: (text) => {
        errors.push(text)
      },
    })
    child.emit('error', new Error('EACCES'))
    expect(await failed).toBe(1)
    const killed = fakeChild()
    const signalled = login({
      resolveLaunch: () => launch,
      environment: () => ({}),
      spawnInTerminal: () => killed,
      printError: vi.fn(),
    })
    killed.emit('exit', null)
    expect(await signalled).toBe(1)
  })
})

describe('walkFiles', () => {
  it('lists the tree breadth first, skipping .git, node_modules and links, up to the limit', async () => {
    const root = folder()
    mkdirSync(path.join(root, 'src', 'deep'), { recursive: true })
    mkdirSync(path.join(root, '.git'))
    mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true })
    writeFileSync(path.join(root, 'a.ts'), '')
    writeFileSync(path.join(root, 'src', 'b.ts'), '')
    writeFileSync(path.join(root, 'src', 'deep', 'c.ts'), '')
    writeFileSync(path.join(root, '.git', 'HEAD'), '')
    writeFileSync(path.join(root, 'node_modules', 'x', 'i.js'), '')
    symlinkSync(path.join(root, 'src'), path.join(root, 'linked'), 'junction')
    const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    expect(await walkFiles(root, 10, log)).toEqual(['a.ts', 'src/b.ts', 'src/deep/c.ts'])
    expect(await walkFiles(root, 2, log)).toEqual(['a.ts', 'src/b.ts'])
    expect(await walkFiles(path.join(root, 'missing'), 10, log)).toEqual([])
    expect(log.warn).toHaveBeenCalledTimes(1)
  })
})

describe('readSecretLine', () => {
  it('takes the first line of a pipe without writing the prompt', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const written: string[] = []
    output.on('data', (chunk: Buffer) => {
      written.push(chunk.toString())
    })
    const line = readSecretLine('Key: ', input, output)
    input.end(`${KEY}\nignored\n`)
    expect(await line).toBe(KEY)
    expect(written).toEqual([])
  })

  it('reads a terminal with echo off, honouring Backspace, and refuses Ctrl+C', async () => {
    const terminal = Object.assign(new PassThrough(), { isTTY: true, setRawMode: vi.fn() })
    const output = new PassThrough()
    const written: string[] = []
    output.on('data', (chunk: Buffer) => {
      written.push(chunk.toString())
    })
    const line = readSecretLine('Key: ', terminal, output)
    terminal.write('abx\u{7F}c\r')
    expect(await line).toBe('abc')
    expect(terminal.setRawMode.mock.calls).toEqual([[true], [false]])
    expect(written.join('')).toBe('Key: \n')
    const cancelled = readSecretLine('Key: ', terminal, output)
    terminal.write('a\u{3}')
    await expect(cancelled).rejects.toThrow('Cancelled')
  })
})

describe('stderrLogger', () => {
  it('writes from its level up, redacted', () => {
    const lines: string[] = []
    const quiet = stderrLogger((line) => {
      lines.push(line)
    }, 'warn')
    quiet.trace('t')
    quiet.info('i')
    quiet.warn(`key ${KEY}`)
    quiet.error('e')
    const verbose = stderrLogger((line) => {
      lines.push(line)
    }, 'trace')
    verbose.trace('t')
    verbose.info('i')
    expect(lines[0]).toMatch(/^\[warn\] key /)
    expect(lines[0]).not.toContain('secret-value')
    expect(lines.slice(1)).toEqual(['[error] e', '[trace] t', '[info] i'])
  })
})

describe('createRuntimeBackend', () => {
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  function backend(
    options: Partial<ServeOptions>,
    secrets = memorySecrets(),
    env: NodeJS.ProcessEnv = {},
  ) {
    return createRuntimeBackend({
      options: { ...DEFAULTS, ...options },
      version: '0.0.0-test',
      distDir: folder(),
      platform: process.platform,
      env,
      homeDir: folder(),
      secrets,
      runGit: () => Promise.reject(new Error('no git')),
      fetch: fakeModelApi().fetch,
      log,
    })
  }

  it('asks for a key the Model API backend does not have, and reports a store it cannot read', async () => {
    const secrets = memorySecrets()
    const runtime = backend({ backend: 'modelApi' }, secrets)
    expect(await runtime.backend.readiness()).toEqual({
      state: 'signedOut',
      message: UI_TEXT.acpNoStoredKey,
    })
    secrets.values.set(SECRET_KEYS.modelApiKey, KEY)
    expect(await runtime.backend.readiness()).toEqual({ state: 'ready' })
    const broken = backend(
      { backend: 'modelApi' },
      Object.assign(memorySecrets(), { get: () => Promise.reject(new Error('locked')) }),
    )
    const brokenReadiness = await broken.backend.readiness()
    expect(brokenReadiness.state).toBe('unavailable')
  })

  it('says where it looked when the Muse Code CLI is missing, and builds a Model API host per folder', async () => {
    const missing = backend({ museBinary: path.join(folder(), 'no-such-muse') }, memorySecrets(), {
      PATH: '',
    })
    const readiness = await missing.backend.readiness()
    expect(readiness.state).toBe('unavailable')
    const secrets = memorySecrets()
    secrets.values.set(SECRET_KEYS.modelApiKey, KEY)
    const runtime = backend({ backend: 'modelApi' }, secrets)
    const root = folder()
    const host = await runtime.backend.hostFor(root)
    expect(host.info.kind).toBe('modelApi')
    expect(await runtime.backend.hostFor(root)).toBe(host)
    await runtime.close()
  })
})

describe('webReadable', () => {
  it('passes the chunks on and ends with its source', async () => {
    const source = new PassThrough()
    const reader = webReadable(source).getReader()
    source.write(Buffer.from('ab'))
    const first = await reader.read()
    expect(Buffer.from(first.value ?? []).toString()).toBe('ab')
    source.end()
    const last = await reader.read()
    expect(last.done).toBe(true)
  })

  it('fails with its source', async () => {
    const source = new PassThrough()
    const reader = webReadable(source).getReader()
    source.destroy(new Error('pipe broke'))
    await expect(reader.read()).rejects.toThrow('pipe broke')
  })

  it('lets go of its source once cancelled, so a late end or error is ignored', async () => {
    const source = new PassThrough()
    const stream = webReadable(source)
    await stream.cancel()
    expect(source.isPaused()).toBe(true)
    source.end()
    source.emit('error', new Error('late'))
    expect(source.listenerCount('data')).toBe(0)
  })
})
