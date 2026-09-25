import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnvironmentVariable } from '../../src/shared/constants'
import {
  MuseCodeBackendManager,
  type BackendManagerDeps,
} from '../../src/host/backend/museCodeBackendManager'
import { FakeLogOutputChannel } from './helpers/fakes'

const VS_CODE_PROXY = 'https://proxy.example:8443'
const VS_CODE_NO_PROXY = ['localhost', '127.0.0.1']
const PROXY_NAMES = [
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'https_proxy',
  'http_proxy',
  'NO_PROXY',
  'no_proxy',
]

/** A manager whose child environment is built from these settings; it spawns nothing. */
function managerWith(
  configured: readonly EnvironmentVariable[],
  proxy = VS_CODE_PROXY,
  log = new FakeLogOutputChannel(),
): MuseCodeBackendManager {
  const deps: BackendManagerDeps = {
    log,
    extensionVersion: '0.0.0-test',
    getConfiguredBinaryPath: () => '',
    getEnvironmentVariables: () => configured,
    workspaceRoot: undefined,
    getShellSandbox: () => 'off',
    userProfileDir: undefined,
    isWorkspaceTrusted: () => true,
    getProxySettings: () => ({ proxy, noProxy: VS_CODE_NO_PROXY }),
  }
  return new MuseCodeBackendManager(deps)
}

/** The values the child sees under any spelling of `name`. */
function valuesOf(env: NodeJS.ProcessEnv, name: string): readonly (string | undefined)[] {
  return Object.entries(env)
    .filter(([key]) => key.toLowerCase() === name.toLowerCase())
    .map(([, value]) => value)
}

describe('MuseCodeBackendManager: VS Code’s proxy for the CLI (D25)', () => {
  beforeEach(() => {
    // The machine running the tests may have a proxy of its own.
    for (const name of PROXY_NAMES) {
      vi.stubEnv(name, undefined)
    }
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('hands the proxy and its exclusions over when the environment has none', () => {
    const env = managerWith([]).childEnvironment()
    expect(valuesOf(env, 'HTTPS_PROXY')).toEqual([VS_CODE_PROXY])
    expect(valuesOf(env, 'HTTP_PROXY')).toEqual([VS_CODE_PROXY])
    expect(valuesOf(env, 'NO_PROXY')).toEqual(['localhost,127.0.0.1'])
  })

  it('never contradicts a proxy set in museSpark.environmentVariables, in either case', () => {
    const env = managerWith([
      { name: 'https_proxy', value: 'http://mine:3128' },
      { name: 'no_proxy', value: '.corp' },
    ]).childEnvironment()
    expect(valuesOf(env, 'HTTPS_PROXY')).toEqual(['http://mine:3128'])
    expect(Object.values(env)).not.toContain(VS_CODE_PROXY)
    expect(valuesOf(env, 'NO_PROXY')).toEqual(['.corp'])
  })

  it('keeps an inherited proxy, and its own NO_PROXY, as they are', () => {
    vi.stubEnv('http_proxy', 'http://inherited:3128')
    vi.stubEnv('no_proxy', 'internal')
    const env = managerWith([]).childEnvironment()
    expect(Object.values(env)).not.toContain(VS_CODE_PROXY)
    expect(valuesOf(env, 'NO_PROXY')).toEqual(['internal'])
  })

  it('adds nothing when VS Code has no proxy', () => {
    const env = managerWith([], '').childEnvironment()
    expect(valuesOf(env, 'HTTPS_PROXY')).toEqual([])
    expect(valuesOf(env, 'NO_PROXY')).toEqual([])
  })
})

// M39: "CLI not found" must not hide a permission problem.
describe('MuseCodeBackendManager: the CLI lookup reads (M39)', () => {
  it('says in the log when a file is there but cannot be read, not when it is missing', () => {
    const log = new FakeLogOutputChannel()
    const manager = managerWith([], VS_CODE_PROXY, log)
    const installDir = mkdtempSync(path.join(tmpdir(), 'muse-lookup-'))
    try {
      expect(manager.installedVersion(installDir)).toBeUndefined()
      expect(log.warn).not.toHaveBeenCalled()
      // A folder where the version file should be: there, but not readable as a file.
      mkdirSync(path.join(installDir, '.muse-version'))
      expect(manager.installedVersion(installDir)).toBeUndefined()
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining('while looking for the Muse Code CLI: Error: EISDIR'),
      )
    } finally {
      rmSync(installDir, { recursive: true, force: true })
    }
  })
})
