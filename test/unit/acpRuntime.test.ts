import { EventEmitter } from 'node:events'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { LaunchResolution } from '../../src/core/backends/musecode/launch'
import { authClear, authSet, authStatus, login } from '../../src/runtime/authCommands'
import { createRuntimeBackend } from '../../src/runtime/backends'
import { WorkspaceEdits } from '../../src/core/verify/workspaceEdits'
import { VerifyLedger } from '../../src/core/backends/modelapi/verifyLedger'
import { isSamePath } from '../../src/core/paths'
import * as atomicWrites from '../../src/host/fsAtomic'
import { parseCommandLine, type ServeOptions } from '../../src/runtime/cliArgs'
import { takeCredentials, withoutCredentials } from '../../src/runtime/credentialVariables'
import {
  agentDataFolder,
  paidGrantsFile,
  workspaceSessionsFolder,
} from '../../src/runtime/dataFolder'
import { walkFiles } from '../../src/runtime/fileWalk'
import { readSecretLine } from '../../src/runtime/hiddenInput'
import {
  credentialStoreName,
  type KeyringEntry,
  keyringSecretStore,
} from '../../src/runtime/keyStore'
import { displayLanguage } from '../../src/runtime/locale'
import { paidGrantFile } from '../../src/runtime/paidGrants'
import { stderrLogger } from '../../src/runtime/stderrLog'
import { webReadable } from '../../src/runtime/webStreams'
import { MODEL_TEXT, SECRET_KEYS, UI_TEXT } from '../../src/shared/constants'
import { memorySecrets } from './helpers/fakes'
import { FAKE_MODEL_API_KEY, fakeModelApi } from './helpers/fakeModelApi'
import { buildModelApiBundle } from './helpers/modelApiBundle'
import { removeFolder } from './helpers/temporaryFolders'

// M63 (PLAN.md D61, D62): the agent's process, sign-in commands and key store.

const KEY = 'LLM|123456|secret-value'
const folders: string[] = []

function folder(): string {
  const created = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'acp-runtime-')))
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
  // The agent's dist/ folder, with the Model API backend's own bundle (M57).
  const dist = { folder: '' }
  beforeAll(() => {
    dist.folder = folder()
    buildModelApiBundle(dist.folder)
  })
  function backend(
    options: Partial<ServeOptions>,
    secrets = memorySecrets(),
    env: NodeJS.ProcessEnv = {},
    distDir = dist.folder,
    fetch: typeof globalThis.fetch = fakeModelApi().fetch,
  ) {
    return createRuntimeBackend({
      options: { ...DEFAULTS, ...options },
      version: '0.0.0-test',
      distDir,
      platform: process.platform,
      env,
      homeDir: folder(),
      secrets,
      runGit: () => Promise.reject(new Error('no git')),
      museCodeCredentials: [],
      fetch,
      sleep: () => Promise.resolve(),
      log,
    })
  }

  it('asks for a key the Model API backend does not have, and reports a store it cannot read', async () => {
    const secrets = memorySecrets()
    const runtime = backend({ backend: 'modelApi' }, secrets)
    expect(await runtime.backend.readiness(false)).toEqual({
      state: 'signedOut',
      message: UI_TEXT.acpNoStoredKey,
    })
    secrets.values.set(SECRET_KEYS.modelApiKey, KEY)
    expect(await runtime.backend.readiness(false)).toEqual({ state: 'ready' })
    const broken = backend(
      { backend: 'modelApi' },
      Object.assign(memorySecrets(), { get: () => Promise.reject(new Error('locked')) }),
    )
    const brokenReadiness = await broken.backend.readiness(false)
    expect(brokenReadiness.state).toBe('unavailable')
  })

  it('says where it looked when the Muse Code CLI is missing, and builds a Model API host per folder', async () => {
    // The CLI search reads this process's PATH, LOCALAPPDATA and home, so a
    // machine with Muse Code installed must not be the one searched.
    const home = folder()
    vi.stubEnv('PATH', '')
    vi.stubEnv('LOCALAPPDATA', home)
    vi.stubEnv('USERPROFILE', home)
    vi.stubEnv('HOME', home)
    try {
      const missing = backend(
        { museBinary: path.join(folder(), 'no-such-muse') },
        memorySecrets(),
        {
          PATH: '',
        },
      )
      const readiness = await missing.backend.readiness(false)
      expect(readiness.state).toBe('unavailable')
    } finally {
      vi.unstubAllEnvs()
    }
    const secrets = memorySecrets()
    secrets.values.set(SECRET_KEYS.modelApiKey, KEY)
    const runtime = backend({ backend: 'modelApi' }, secrets)
    const root = folder()
    const host = await runtime.backend.hostFor(root)
    expect(host.info.kind).toBe('modelApi')
    expect(await runtime.backend.hostFor(root)).toBe(host)
    await runtime.close()
  })

  it('loads the Model API backend from dist/modelApi.js beside the agent, and says so when it is missing (M57)', async () => {
    const secrets = memorySecrets()
    secrets.values.set(SECRET_KEYS.modelApiKey, KEY)
    const empty = folder()
    const runtime = backend({ backend: 'modelApi' }, secrets, {}, empty)
    await expect(runtime.backend.hostFor(folder())).rejects.toThrow(
      UI_TEXT.acpModelApiBundleUnavailable,
    )
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining(`The Model API bundle ${path.join(empty, 'modelApi.js')}`),
    )
  })

  it('shares edit notices for native workspace aliases without joining distinct directories', async () => {
    const secrets = memorySecrets()
    secrets.values.set(SECRET_KEYS.modelApiKey, KEY)
    const runtime = backend({ backend: 'modelApi' }, secrets)
    const root = folder()
    const alias = path.join(folder(), 'alias')
    symlinkSync(root, alias, 'junction')
    const caseRoot = folder()
    const upper = path.join(caseRoot, 'Case')
    const lower = path.join(caseRoot, 'case')
    mkdirSync(upper)
    mkdirSync(lower, { recursive: true })
    const added = vi.spyOn(WorkspaceEdits.prototype, 'add')
    try {
      for (const cwd of [root, alias, folder(), upper, lower]) {
        const host = await runtime.backend.hostFor(cwd)
        await host.startSession({
          workspaceRoot: cwd,
          modelId: 'muse-spark-1.3',
          approvalMode: 'onRequest',
        })
      }
      expect(added).toHaveBeenCalledTimes(5)
      const [first, linked, distinct, upperRegistry, lowerRegistry] = added.mock.contexts
      expect(first).toBe(linked)
      expect(first).not.toBe(distinct)
      const upperIdentity = statSync(upper, { bigint: true })
      const lowerIdentity = statSync(lower, { bigint: true })
      if (upperIdentity.dev === lowerIdentity.dev && upperIdentity.ino === lowerIdentity.ino) {
        expect(upperRegistry).toBe(lowerRegistry)
      } else {
        expect(upperRegistry).not.toBe(lowerRegistry)
      }
    } finally {
      added.mockRestore()
      await runtime.close()
    }
  })

  it('refuses an unreadable or non-directory Model API workspace before building its host', async () => {
    const runtime = backend({ backend: 'modelApi' })
    const root = folder()
    const file = path.join(root, 'file.txt')
    writeFileSync(file, 'ordinary file')
    await expect(runtime.backend.hostFor(file)).rejects.toThrow(UI_TEXT.modelApiNeedsFolder)
    await expect(runtime.backend.hostFor(path.join(root, 'missing'))).rejects.toThrow()
    await runtime.close()
  })

  it.each(['alias', 'directory'])(
    'refuses a cached and held writer after its owned workspace changes: %s',
    async (kind) => {
      const a = folder()
      const b = folder()
      const named = kind === 'alias' ? path.join(folder(), 'alias') : a
      if (kind === 'alias') {
        symlinkSync(a, named, 'junction')
      }
      writeFileSync(path.join(a, 'note.txt'), 'before A')
      writeFileSync(path.join(b, 'note.txt'), 'before B')
      const secrets = memorySecrets()
      secrets.values.set(SECRET_KEYS.modelApiKey, FAKE_MODEL_API_KEY)
      const api = fakeModelApi()
      const runtime = backend(
        { backend: 'modelApi', trustWorkspace: true },
        secrets,
        {},
        dist.folder,
        api.fetch,
      )
      const added = vi.spyOn(WorkspaceEdits.prototype, 'add')
      const realWrite = atomicWrites.writeFileAtomically
      const entered = Promise.withResolvers<undefined>()
      const held = Promise.withResolvers<undefined>()
      const writing = vi
        .spyOn(atomicWrites, 'writeFileAtomically')
        .mockImplementation(async (target, text, options) => {
          if (isSamePath(target, path.join(a, 'note.txt'), process.platform)) {
            entered.resolve(undefined)
            await held.promise
          }
          await realWrite(target, text, options)
        })
      try {
        const host = await runtime.backend.hostFor(named)
        const writer = await host.startSession({
          workspaceRoot: named,
          modelId: 'muse-spark-1.3',
          approvalMode: 'onRequest',
        })
        const peerHost = await runtime.backend.hostFor(b)
        await peerHost.startSession({
          workspaceRoot: b,
          modelId: 'muse-spark-1.3',
          approvalMode: 'onRequest',
        })
        const peerRegistry = added.mock.contexts[1]
        if (!(peerRegistry instanceof WorkspaceEdits)) {
          throw new TypeError('peer did not receive its workspace registry')
        }
        const peer = new VerifyLedger()
        peerRegistry.add(peer)
        peer.record('passed', peer.snapshot('lint', 'project'))
        const completed = Promise.withResolvers<undefined>()
        writer.onEvent((event) => {
          if (event.type === 'turnCompleted') {
            completed.resolve(undefined)
          }
        })
        api.script(
          {
            calls: [
              { name: 'read_file', arguments: JSON.stringify({ path: 'note.txt' }) },
              {
                name: 'write_file',
                arguments: JSON.stringify({ path: 'note.txt', content: 'changed' }),
              },
            ],
          },
          { text: 'done' },
        )
        await writer.sendTurn([{ type: 'text', text: 'edit the note' }])
        await entered.promise
        let oldA = a
        if (kind === 'alias') {
          expect(lstatSync(named).isSymbolicLink()).toBe(true)
          unlinkSync(named)
          symlinkSync(b, named, 'junction')
        } else {
          oldA = path.join(folder(), 'old-A')
          renameSync(a, oldA)
          mkdirSync(a)
          writeFileSync(path.join(a, 'note.txt'), 'replacement')
        }
        await expect(runtime.backend.hostFor(named)).rejects.toThrow()
        held.resolve(undefined)
        await completed.promise
        expect(readFileSync(path.join(oldA, 'note.txt'), 'utf8')).toBe('before A')
        expect(readFileSync(path.join(b, 'note.txt'), 'utf8')).toBe('before B')
        expect(peer.hasCurrentRun('lint', 'project')).toBe(true)
        const after = api.responseBodies().at(-1)?.['input']
        expect(JSON.stringify(after)).toContain(MODEL_TEXT.pathChangedAfterApproval)
      } finally {
        held.resolve(undefined)
        writing.mockRestore()
        added.mockRestore()
        await runtime.close()
      }
    },
  )

  it('lets "always" lapse at start only for the Model API agent, which has the flags (M58)', async () => {
    const home = folder()
    const env = { XDG_DATA_HOME: home, LOCALAPPDATA: home }
    const file = paidGrantsFile({ platform: process.platform, env, homeDir: home })
    const workspace = path.resolve('work')
    const grants = paidGrantFile({ file, log, sleep: () => Promise.resolve() })
    await grants.add(workspace, ['webSearch'])
    const runtimeOn = (backend: ServeOptions['backend']) =>
      createRuntimeBackend({
        options: { ...DEFAULTS, backend },
        version: '0.0.0-test',
        distDir: dist.folder,
        platform: process.platform,
        env,
        homeDir: home,
        secrets: memorySecrets(),
        runGit: () => Promise.reject(new Error('no git')),
        museCodeCredentials: [],
        fetch: fakeModelApi().fetch,
        sleep: () => Promise.resolve(),
        log,
      })
    // A Muse Code agent beside it leaves the Model API agent's grants alone.
    await runtimeOn('museCode').forgetUnflaggedGrants()
    expect(grants.read(workspace)).toEqual(new Set(['webSearch']))
    await runtimeOn('modelApi').forgetUnflaggedGrants()
    expect(grants.read(workspace)).toEqual(new Set())
  })

  it('keeps paid-use grants in the agent’s data folder (M58)', () => {
    const home = folder()
    const input = { platform: 'linux' as const, env: { XDG_DATA_HOME: home }, homeDir: home }
    expect(paidGrantsFile(input)).toBe(
      path.posix.join(home, 'muse-spark-code', 'acp', 'paid-uses.json'),
    )
    expect(
      paidGrantsFile({ platform: 'win32', env: { LOCALAPPDATA: String.raw`C:\L` }, homeDir: 'C:' }),
    ).toBe(String.raw`C:\L\Muse Spark Code\acp\paid-uses.json`)
  })
})

/** The agent's own environment, with three credential variables among the rest. */
function env(): NodeJS.ProcessEnv {
  return {
    META_API_KEY: 'LLM|1|placeholder',
    OPENAI_API_KEY: 'sk-placeholder',
    AWS_SECRET_ACCESS_KEY: 'placeholder',
    PATH: '/usr/bin',
    HOME: '/home/person',
  }
}

describe('credential variables (AGENTS.md rule 8; Codex on a209130)', () => {
  it('takes every credential variable out of the agent’s own environment, and leaves the rest', () => {
    const own = env()
    expect(takeCredentials(own).map(({ name }) => name)).toEqual([
      'META_API_KEY',
      'OPENAI_API_KEY',
      'AWS_SECRET_ACCESS_KEY',
    ])
    expect(own).toEqual({ PATH: '/usr/bin', HOME: '/home/person' })
    const original = env()
    expect(withoutCredentials(original)).toEqual({ PATH: '/usr/bin', HOME: '/home/person' })
    expect(original['META_API_KEY']).toBe('LLM|1|placeholder')
  })

  it('hands them back to Muse Code only, where META_API_KEY counts as its credential (D1)', () => {
    vi.stubEnv('META_API_KEY', '')
    try {
      const runtime = createRuntimeBackend({
        options: DEFAULTS,
        version: '0.0.0-test',
        distDir: folder(),
        platform: process.platform,
        env: {},
        homeDir: folder(),
        secrets: memorySecrets(),
        runGit: () => Promise.reject(new Error('no git')),
        museCodeCredentials: [{ name: 'META_API_KEY', value: 'LLM|1|placeholder' }],
        fetch: fakeModelApi().fetch,
        sleep: () => Promise.resolve(),
        log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      })
      expect(runtime.museCode.childEnvironment()['META_API_KEY']).toBe('LLM|1|placeholder')
      expect(runtime.museCode.hasEnvironmentKey()).toBe(true)
    } finally {
      vi.unstubAllEnvs()
    }
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
