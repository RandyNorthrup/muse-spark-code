// Devcontainer gate + merge over REAL exchanges (M110b W2): the
// read-configuration and up fixtures below were captured 2026-10-22
// with `devcontainer read-configuration --workspace-folder <ws>` and
// `devcontainer up --workspace-folder <ws>` (CLI 0.89.0) against
// scratch workspaces under $TMPDIR/dc-drill (dockerfile + features +
// bind mount), $TMPDIR/dc-cli/ws (python image) and wsnode (node
// image) — each kept whole in test/fixtures/workspaces/.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  absolutizeMountSource,
  devcontainerExecArgv,
  devcontainerResolvedSchema,
  devcontainerUpArgv,
  devcontainerUpResultSchema,
  DevcontainerRefusedError,
  gateDevcontainerConfig,
  gateMount,
  isPathInside,
  mergeDevcontainerConfig,
  parseMountString,
  type DevcontainerResolved,
} from '../../src/runtime/node/workspaces/devcontainer'

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'workspaces')

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8')) as unknown
}

function resolvedFixture(name: string): DevcontainerResolved {
  return devcontainerResolvedSchema.parse(readFixture(name))
}

const LINUX = 'linux' as const
const DARWIN = 'darwin' as const

describe('parseMountString', () => {
  it('splits a full bind mount into type, source and target', () => {
    expect(parseMountString('type=bind,source=/ws/data,target=/data,readonly')).toEqual({
      type: 'bind',
      source: '/ws/data',
      target: '/data',
    })
  })
  it('unescapes a comma inside a source path', () => {
    expect(parseMountString(String.raw`type=bind,source=/ws/a\,b,target=/data`)).toEqual({
      type: 'bind',
      source: '/ws/a,b',
      target: '/data',
    })
  })
  it('defaults a typeless mount to a volume', () => {
    expect(parseMountString('source=cache,target=/cache')).toEqual({
      type: 'volume',
      source: 'cache',
      target: '/cache',
    })
  })
})

describe('isPathInside', () => {
  it('accepts a child and the workspace itself at the call site', () => {
    expect(isPathInside('/ws', '/ws/data', LINUX)).toBe(true)
    expect(isPathInside('/ws', '/ws', LINUX)).toBe(false)
  })
  it('refuses the parent, a sibling and a sibling-prefix', () => {
    expect(isPathInside('/ws', '/ws/..', LINUX)).toBe(false)
    expect(isPathInside('/ws', '/other', LINUX)).toBe(false)
    expect(isPathInside('/ws', '/ws-evil', LINUX)).toBe(false)
  })
  it('folds case on darwin but not on linux', () => {
    expect(isPathInside('/WS', '/ws/data', DARWIN)).toBe(true)
    expect(isPathInside('/WS', '/ws/data', LINUX)).toBe(false)
  })
})

describe('absolutizeMountSource', () => {
  it('splices the resolved source and keeps every other field', () => {
    expect(absolutizeMountSource('type=bind,source=data,target=/data,readonly', '/ws/data')).toBe(
      'type=bind,source=/ws/data,target=/data,readonly',
    )
  })
})

describe('gateMount', () => {
  const WS = '/ws'
  const CFG = '/ws/.devcontainer'
  it('rides volumes and tmpfs through (no host path)', () => {
    expect(gateMount('source=cache,target=/cache', WS, CFG, LINUX)).toEqual({ ok: true })
    expect(gateMount('type=tmpfs,target=/run', WS, CFG, LINUX)).toEqual({ ok: true })
  })
  it('rides an inside bind through, absolutizing a relative source', () => {
    expect(gateMount('type=bind,source=/ws/data,target=/data', WS, CFG, LINUX)).toEqual({
      ok: true,
    })
    expect(gateMount('type=bind,source=../data,target=/data,readonly', WS, CFG, LINUX)).toEqual({
      ok: true,
      absolutized: 'type=bind,source=/ws/data,target=/data,readonly',
    })
  })
  it('refuses a volume source that looks like a path', () => {
    expect(gateMount('type=volume,source=/etc,target=/evil', WS, CFG, LINUX)).toEqual({
      ok: false,
    })
    expect(gateMount('source=../etc,target=/evil', WS, CFG, LINUX)).toEqual({ ok: false })
  })
  it('refuses escapes, other types and missing ends', () => {
    expect(gateMount('type=bind,source=/etc,target=/evil', WS, CFG, LINUX)).toEqual({
      ok: false,
    })
    expect(gateMount('type=bind,source=../../etc,target=/evil', WS, CFG, LINUX)).toEqual({
      ok: false,
    })
    expect(gateMount('type=npipe,source=//./pipe/x,target=/x', WS, CFG, LINUX)).toEqual({
      ok: false,
    })
    expect(gateMount('type=bind,target=/data', WS, CFG, LINUX)).toEqual({ ok: false })
    expect(gateMount('type=bind,source=/ws/data', WS, CFG, LINUX)).toEqual({ ok: false })
  })
})

describe('gateDevcontainerConfig', () => {
  const drill = resolvedFixture('read-config-drill.json')
  const WS = path.dirname(path.dirname(drill.configuration.configFilePath.fsPath))
  it('accepts the recorded dockerfile + features + bind config once trusted', () => {
    expect(gateDevcontainerConfig(drill, WS, true, LINUX)).toEqual({ ok: true })
  })
  it('refuses everything before trust', () => {
    expect(gateDevcontainerConfig(drill, WS, false, LINUX)).toEqual({
      ok: false,
      reason: 'untrusted',
    })
  })
  it('accepts the recorded python and node image configs', () => {
    for (const name of ['read-config-python.json', 'read-config-node.json']) {
      const resolved = resolvedFixture(name)
      const root = path.dirname(path.dirname(resolved.configuration.configFilePath.fsPath))
      expect(gateDevcontainerConfig(resolved, root, true, LINUX)).toEqual({ ok: true })
    }
  })
  it('refuses the recorded host-command and compose configs', () => {
    const evilA = resolvedFixture('read-config-evil-a.json')
    const rootA = path.dirname(path.dirname(evilA.configuration.configFilePath.fsPath))
    expect(gateDevcontainerConfig(evilA, rootA, true, LINUX)).toEqual({
      ok: false,
      reason: 'host-command',
    })
    const evilCompose = resolvedFixture('read-config-evil-compose.json')
    const rootCompose = path.dirname(path.dirname(evilCompose.configuration.configFilePath.fsPath))
    expect(gateDevcontainerConfig(evilCompose, rootCompose, true, LINUX)).toEqual({
      ok: false,
      reason: 'compose-refused',
    })
  })
  it('refuses no source, both sources, run-args and escaping context', () => {
    const noSource: DevcontainerResolved = {
      ...drill,
      configuration: { ...drill.configuration, dockerFile: undefined },
    }
    expect(gateDevcontainerConfig(noSource, WS, true, LINUX)).toEqual({
      ok: false,
      reason: 'no-source',
    })
    const both: DevcontainerResolved = {
      ...drill,
      configuration: { ...drill.configuration, image: 'img' },
    }
    expect(gateDevcontainerConfig(both, WS, true, LINUX)).toEqual({
      ok: false,
      reason: 'both-sources',
    })
    const runArgs: DevcontainerResolved = {
      ...drill,
      configuration: { ...drill.configuration, runArgs: ['--privileged'] },
    }
    expect(gateDevcontainerConfig(runArgs, WS, true, LINUX)).toEqual({
      ok: false,
      reason: 'run-args',
    })
    const context: DevcontainerResolved = {
      ...drill,
      configuration: { ...drill.configuration, image: 'img', dockerFile: undefined, context: '/' },
    }
    expect(gateDevcontainerConfig(context, WS, true, LINUX)).toEqual({
      ok: false,
      reason: 'host-context',
    })
  })
  it('refuses a dockerfile or build context outside the workspace', () => {
    const dockerfile: DevcontainerResolved = {
      ...drill,
      configuration: { ...drill.configuration, dockerFile: '/etc/passwd' },
    }
    expect(gateDevcontainerConfig(dockerfile, WS, true, LINUX)).toEqual({
      ok: false,
      reason: 'host-context',
    })
    const buildContext: DevcontainerResolved = {
      ...drill,
      configuration: {
        ...drill.configuration,
        image: 'img',
        dockerFile: undefined,
        build: { context: '/etc' },
      },
    }
    expect(gateDevcontainerConfig(buildContext, WS, true, LINUX)).toEqual({
      ok: false,
      reason: 'host-context',
    })
    const buildDockerfile: DevcontainerResolved = {
      ...drill,
      configuration: {
        ...drill.configuration,
        image: 'img',
        dockerFile: undefined,
        build: { dockerfile: '../../Dockerfile' },
      },
    }
    expect(gateDevcontainerConfig(buildDockerfile, WS, true, LINUX)).toEqual({
      ok: false,
      reason: 'host-context',
    })
  })
})

describe('mergeDevcontainerConfig', () => {
  const drill = resolvedFixture('read-config-drill.json')
  const WS = path.dirname(path.dirname(drill.configuration.configFilePath.fsPath))
  const CFG = path.dirname(drill.configuration.configFilePath.fsPath)
  it('injects the proxy and network, drops customizations', () => {
    const merged = mergeDevcontainerConfig(drill, WS, {
      proxyUrl: 'http://proxy:8080',
      network: 'ws-net',
    })
    expect(merged['dockerFile']).toBe(path.join(CFG, 'Dockerfile'))
    expect(merged['features']).toEqual(drill.configuration.features)
    expect(merged['containerEnv']).toEqual({
      http_proxy: 'http://proxy:8080',
      https_proxy: 'http://proxy:8080',
    })
    expect(merged['runArgs']).toEqual(['--network', 'ws-net'])
    expect(merged).not.toHaveProperty('customizations')
    expect(merged).not.toHaveProperty('initializeCommand')
  })
  it('absolutizes build dockerfile and context against the config dir', () => {
    const withBuild: DevcontainerResolved = {
      ...drill,
      configuration: {
        ...drill.configuration,
        build: { dockerfile: 'docker/Dockerfile.alt', context: '..', args: { V: '1' } },
      },
    }
    const merged = mergeDevcontainerConfig(withBuild, WS, {})
    expect(merged['build']).toEqual({
      dockerfile: path.join(CFG, 'docker/Dockerfile.alt'),
      context: WS,
      args: { V: '1' },
    })
  })
  it('throws rather than merge a refused mount', () => {
    const evil: DevcontainerResolved = {
      ...drill,
      configuration: {
        ...drill.configuration,
        mounts: ['type=bind,source=/etc,target=/host-etc'],
      },
    }
    let reason = ''
    try {
      mergeDevcontainerConfig(evil, WS, {})
    } catch (error: unknown) {
      if (error instanceof DevcontainerRefusedError) reason = error.reason
    }
    expect(reason).toBe('host-mount')
  })
  it('merges proxy env over the recorded python containerEnv', () => {
    const python = resolvedFixture('read-config-python.json')
    const root = path.dirname(path.dirname(python.configuration.configFilePath.fsPath))
    const merged = mergeDevcontainerConfig(python, root, { proxyUrl: 'http://proxy:8080' })
    expect(merged['image']).toBe('mcr.microsoft.com/devcontainers/python:3-3.14-trixie')
    const env = merged['containerEnv'] as Record<string, string>
    expect(env['http_proxy']).toBe('http://proxy:8080')
    expect(env['https_proxy']).toBe('http://proxy:8080')
  })
})

describe('devcontainer argv', () => {
  it('builds the up argv with id labels and docker path', () => {
    expect(
      devcontainerUpArgv({
        workspaceDir: '/ws',
        overrideConfig: '/tmp/override.json',
        idLabels: { 'muse.node': 'n1' },
        dockerPath: '/usr/bin/docker',
      }),
    ).toEqual([
      'up',
      '--workspace-folder',
      '/ws',
      '--override-config',
      '/tmp/override.json',
      '--id-label',
      'muse.node=n1',
      '--docker-path',
      '/usr/bin/docker',
    ])
  })
  it('builds the exec argv with the container id first', () => {
    expect(devcontainerExecArgv({ containerId: 'abc', command: ['sh', '-c', 'echo hi'] })).toEqual([
      'exec',
      '--container-id',
      'abc',
      'sh',
      '-c',
      'echo hi',
    ])
  })
})

describe('devcontainerUpResultSchema', () => {
  it('parses the recorded success and error results', () => {
    const success = devcontainerUpResultSchema.parse(readFixture('up-result-success.json'))
    expect(success.outcome).toBe('success')
    if (success.outcome === 'success') {
      expect(success.containerId).toBe(
        '1dc212cc207367bb20638cb4c86833740e0fba6039ffb05c9044f6af04002ca8',
      )
      expect(success.remoteUser).toBe('root')
      expect(success.remoteWorkspaceFolder).toBe('/workspaces/ws')
    }
    const error = devcontainerUpResultSchema.parse(readFixture('up-result-error.json'))
    expect(error.outcome).toBe('error')
    if (error.outcome === 'error') {
      expect(error.message).toContain('invalid.invalid')
    }
  })
})
