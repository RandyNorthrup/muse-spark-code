import * as childProcess from 'node:child_process'
import { once } from 'node:events'
import * as workers from 'node:worker_threads'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isCredentialVariable, withoutCredentials } from '../../src/core/credentialEnvironment'
import { buildChildEnvironment } from '../../src/core/backends/musecode/launch'
import { GLOB_LIMITS } from '../../src/core/backends/modelapi/globLimits'
import { browserEnvironment } from '../../src/core/browser/browserLaunch'
import { takeCredentials } from '../../src/runtime/credentialVariables'
import {
  hookEnvironment,
  searchOnWorker,
  shellEnvironment,
  withTerminalOverrides,
} from '../../src/host/backend/toolIo'
import { mcpServerEnvironment } from '../../src/host/backend/mcpProcess'
import { createGitProcess, createGitRunner } from '../../src/host/git'
import { runProgram, windowsPowerShell } from '../../src/host/processTree'
import { hostBrowserRunDeps } from '../../src/host/browser/browserProcess'
import { spawnHelper, startRecorder } from '../../src/host/voice/voiceProcesses'
import { pageConverter } from '../../src/host/web/pageConverter'
import { readSettings } from '../../src/host/settings'
import { FakeLogOutputChannel, fakeSettingsSource } from './helpers/fakes'

vi.mock('node:child_process', { spy: true })
vi.mock('node:worker_threads', { spy: true })
afterEach(() => {
  vi.resetAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

const CREDENTIAL_NAMES = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'META_API_KEY',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'NPM_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AZURE_CLIENT_SECRET',
  'AZURE_STORAGE_ACCOUNT_KEY',
  'AZURE_STORAGE_CONNECTION_STRING',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'HF_TOKEN',
  'SERVICE_SECRET',
  'SERVICE_PASSWORD',
  'ANTHROPIC_AUTH_TOKEN',
]
const CREDENTIALS = Object.fromEntries(CREDENTIAL_NAMES.map((name) => [name, 'envfence-fake']))
const ENV = { PATH: '/usr/bin', HOME: '/home/u', ...CREDENTIALS }
const SAFE = { PATH: '/usr/bin', HOME: '/home/u' }

describe('D89.5 shared credential fence', () => {
  it.each(CREDENTIAL_NAMES)('fences %s in either case in the editor and runtime', (name) => {
    expect(isCredentialVariable(name)).toBe(true)
    expect(isCredentialVariable(name.toLowerCase())).toBe(true)
  })

  it('preserves ordinary environment and Muse Code credentials, without mutating the source', () => {
    expect(withoutCredentials(ENV)).toEqual(SAFE)
    const runtime = { ...ENV }
    expect(takeCredentials(runtime)).toEqual(
      CREDENTIAL_NAMES.map((name) => ({ name, value: 'envfence-fake' })),
    )
    expect(runtime).toEqual(SAFE)
    expect(
      buildChildEnvironment({
        baseEnv: ENV,
        platform: 'linux',
        systemRoot: undefined,
        programFiles: undefined,
        extraVariables: [],
      }),
    ).toEqual(ENV)
    expect(isCredentialVariable('AZURE_REGION')).toBe(false)
    expect(isCredentialVariable('API_KEY_ALIAS')).toBe(false)
  })

  it('fences terminal overrides and honors only explicitly named shell variables', () => {
    const overridden = withTerminalOverrides(
      ENV,
      { OPENAI_API_KEY: 'terminal-fake', GH_TOKEN: 'terminal-token' },
      'linux',
      '/ws',
    )
    expect(shellEnvironment(overridden, 'linux', undefined)).toEqual(SAFE)
    expect(shellEnvironment(overridden, 'linux', undefined, ['OPENAI_API_KEY'])).toEqual({
      ...SAFE,
      OPENAI_API_KEY: 'terminal-fake',
    })
    expect(shellEnvironment(overridden, 'linux', undefined, ['openai_api_key'])).toEqual(SAFE)
    expect(
      withoutCredentials({ Path: '/bin', openai_api_key: 'fake' }, ['OPENAI_API_KEY'], 'win32'),
    ).toEqual({ Path: '/bin', openai_api_key: 'fake' })
    expect(hookEnvironment(ENV, 'linux', CREDENTIAL_NAMES)).toEqual(SAFE)
    expect(mcpServerEnvironment(ENV, {}, 'linux')).toEqual(SAFE)
    expect(mcpServerEnvironment(ENV, { GH_TOKEN: 'explicit-fake' }, 'linux')).toEqual({
      ...SAFE,
      GH_TOKEN: 'explicit-fake',
    })
  })

  it('projects browser variables without credentials, including credential-shaped locale names', () => {
    expect(
      browserEnvironment(
        'linux',
        { ...ENV, LANG: 'en_US', LC_API_KEY: 'fake' },
        { profile: '/private/profile', home: '/private/home', temp: '/private/tmp' },
      ),
    ).toEqual({
      LANG: 'en_US',
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      TMPDIR: '/private/tmp',
      HOME: '/private/home',
      XDG_CONFIG_HOME: '/private/home',
      XDG_CACHE_HOME: '/private/home',
      XDG_DATA_HOME: '/private/home',
      XDG_STATE_HOME: '/private/home',
    })
  })

  it('reads name-only settings, rejecting values and malformed names', () => {
    const log = new FakeLogOutputChannel()
    expect(
      readSettings(fakeSettingsSource({ 'shell.passEnvironmentVariables': ['GH_TOKEN'] }), log)[
        'shell.passEnvironmentVariables'
      ],
    ).toEqual(['GH_TOKEN'])
    for (const invalid of [['GH_TOKEN=fake'], [{ name: 'GH_TOKEN', value: 'fake' }]]) {
      expect(
        readSettings(fakeSettingsSource({ 'shell.passEnvironmentVariables': invalid }), log)[
          'shell.passEnvironmentVariables'
        ],
      ).toEqual([])
    }
  })
})

describe('D89.5 native environment snapshots', () => {
  it('fences Git text and binary process entries', async () => {
    const execFile = vi.fn(() => Promise.resolve('ok'))
    await createGitRunner({ platform: 'linux', env: ENV, fileExists: () => true, execFile })(
      ['status'],
      '/ws',
    )
    expect(execFile.mock.calls[0]).toEqual([
      '/usr/bin/git',
      ['status'],
      expect.objectContaining({
        env: { ...SAFE, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
      }),
    ])
    const spawn = vi.spyOn(childProcess, 'spawn').mockImplementation(() => {
      throw new Error('snapshot')
    })
    await expect(
      createGitProcess({
        platform: 'linux',
        env: ENV,
        fileExists: () => true,
        spawn: childProcess.spawn,
      })(['status'], { cwd: '/ws', env: ENV, timeoutMs: 1000 }),
    ).rejects.toThrow('snapshot')
    expect(spawn.mock.calls[0]?.[2]?.env).toEqual(SAFE)
  })

  it('fences process cleanup and PowerShell helper environments', async () => {
    expect(windowsPowerShell(String.raw`C:\Windows`, ENV).env).toEqual({
      ...SAFE,
      PSModulePath: String.raw`C:\Program Files\WindowsPowerShell\Modules;C:\Windows\System32\WindowsPowerShell\v1.0\Modules`,
    })
    // Local native probe: the cleanup runner must fence even a caller's widened environment.
    expect(
      await runProgram(
        process.execPath,
        ['-e', 'process.stdout.write(String(process.env.GH_TOKEN === undefined))'],
        ENV,
      ),
    ).toBe('true')
  })

  it('fences browser and voice helpers at the spawn boundary', () => {
    vi.stubEnv('GH_TOKEN', 'envfence-fake')
    const spawn = vi.spyOn(childProcess, 'spawn').mockImplementation(() => {
      throw new Error('snapshot')
    })
    expect(() =>
      hostBrowserRunDeps({ platform: 'linux', env: ENV, warn: () => undefined }).spawn(
        '/browser',
        [],
        { PATH: '/bin', GH_TOKEN: 'fake' },
      ),
    ).toThrow('snapshot')
    expect(spawn.mock.calls[0]?.[2]?.env).toEqual({ PATH: '/bin' })
    expect(() => startRecorder('/recorder', [])).toThrow('snapshot')
    expect(spawn.mock.calls[1]?.[2]?.env?.['GH_TOKEN']).toBeUndefined()
    expect(() => spawnHelper({ command: '/helper', args: [] })).toThrow('snapshot')
    expect(spawn.mock.calls[2]?.[2]?.env?.['GH_TOKEN']).toBeUndefined()
  })

  it('fences search and HTML worker environments at entry', async () => {
    vi.stubEnv('GH_TOKEN', 'envfence-fake')
    const start = vi.spyOn(workers, 'Worker').mockImplementation(() => {
      throw new Error('snapshot')
    })
    await expect(
      searchOnWorker(
        'unused',
        {
          pattern: 'x',
          root: '/ws',
          files: [],
          maxFileBytes: 100,
          maxHits: 1,
          denyRead: [],
          globLimits: GLOB_LIMITS,
        },
        1000,
      ),
    ).rejects.toThrow('snapshot')
    const searchEnv = start.mock.calls[0]?.[1]?.env
    expect(typeof searchEnv === 'object' && searchEnv['GH_TOKEN'] === undefined).toBe(true)
    const page = pageConverter(
      'unused',
      new FakeLogOutputChannel(),
      undefined,
      (file, options) => new workers.Worker(file, options),
    )
    await page(
      { bytes: new Uint8Array(), charset: undefined, url: 'https://example.test', maxChars: 100 },
      new AbortController().signal,
    )
    const pageEnv = start.mock.calls[1]?.[1]?.env
    expect(typeof pageEnv === 'object' && pageEnv['GH_TOKEN'] === undefined).toBe(true)
  })

  it('fences the Windows browser cleanup helper’s environment', async () => {
    const child = childProcess.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      env: SAFE,
      stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
    })
    try {
      vi.spyOn(childProcess, 'spawn').mockReturnValue(child)
      const cleanup = vi.spyOn(childProcess, 'execFile').mockImplementation(() => {
        throw new Error('snapshot')
      })
      const browser = hostBrowserRunDeps({
        platform: 'win32',
        env: { SystemRoot: String.raw`C:\Windows`, GH_TOKEN: 'fake' },
        warn: () => undefined,
      }).spawn('/browser', [], {})
      await expect(browser.kill()).rejects.toThrow('snapshot')
      expect(cleanup.mock.calls[0]?.[2]).toEqual(
        expect.objectContaining({ env: { SystemRoot: String.raw`C:\Windows` } }),
      )
    } finally {
      const exited = once(child, 'exit')
      child.kill()
      await exited
    }
  })
})
