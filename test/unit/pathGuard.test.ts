// The PATH guard: no workspace program runs from PATH when Muse Code starts
// (docs/certification/pathguard.md). Drives the real environment builder
// with a real temporary workspace and a real planted program.
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildChildEnvironment } from '../../src/core/backends/musecode/launch'
import { resolveExecutable, sanitizePathForWorkspace } from '../../src/core/executables'

const PLATFORM = process.platform
const SEPARATOR = PLATFORM === 'win32' ? ';' : ':'
const PLANTED = 'pathguard-planted-probe'

const throwingRealpath = (filePath: string): string => {
  throw Object.assign(new Error(`no such file: ${filePath}`), { code: 'ENOENT' })
}

describe('sanitizePathForWorkspace', () => {
  it('drops empty and relative entries but keeps every absolute one outside', () => {
    const joined = ['/opt/tools', '', '.', 'rel/bin', '/usr/bin', '/opt/tools'].join(':')
    expect(
      sanitizePathForWorkspace({
        platform: 'linux',
        pathVariable: joined,
        workspaceRoot: '/home/person/work',
        realpath: throwingRealpath,
      }),
    ).toBe(['/opt/tools', '/usr/bin', '/opt/tools'].join(':'))
  })

  it('drops the workspace itself and everything lexically inside it', () => {
    const joined = ['/srv/bin', '/home/person/work', '/home/person/work/bin', '/usr/bin'].join(':')
    expect(
      sanitizePathForWorkspace({
        platform: 'linux',
        pathVariable: joined,
        workspaceRoot: '/home/person/work',
        realpath: throwingRealpath,
      }),
    ).toBe(['/srv/bin', '/usr/bin'].join(':'))
  })

  it('keeps a sibling whose name only shares the workspace prefix', () => {
    expect(
      sanitizePathForWorkspace({
        platform: 'linux',
        pathVariable: '/home/person/work-evil:/usr/bin',
        workspaceRoot: '/home/person/work',
        realpath: throwingRealpath,
      }),
    ).toBe('/home/person/work-evil:/usr/bin')
  })

  it('compares Windows entries case-insensitively across separator spellings', () => {
    const joined = String.raw`D:\Tools;C:\WS\BIN;c:\ws;.\bin;;C:\Git\cmd`
    expect(
      sanitizePathForWorkspace({
        platform: 'win32',
        pathVariable: joined,
        workspaceRoot: String.raw`C:\ws`,
        realpath: throwingRealpath,
      }),
    ).toBe(String.raw`D:\Tools;C:\Git\cmd`)
  })
})

describe('buildChildEnvironment PATH guard', () => {
  it('leaves PATH untouched without a workspace root', () => {
    const env = buildChildEnvironment({
      platform: 'linux',
      baseEnv: { PATH: '/home/person/work/bin:/usr/bin' },
      extraVariables: [],
      systemRoot: undefined,
      programFiles: undefined,
    })
    expect(env['PATH']).toBe('/home/person/work/bin:/usr/bin')
  })

  it('never adds a PATH key that was not there', () => {
    const env = buildChildEnvironment({
      platform: 'linux',
      baseEnv: {},
      extraVariables: [],
      systemRoot: undefined,
      programFiles: undefined,
      workspaceRoot: '/home/person/work',
      realpath: throwingRealpath,
    })
    expect('PATH' in env).toBe(false)
  })
})

describe('planted workspace program (real filesystem)', () => {
  let root = ''
  let binDir = ''
  let linkDir = ''
  let outsideDir = ''

  beforeAll(async () => {
    root = realpathSync(await mkdtemp(path.join(tmpdir(), 'muse-pathguard-ws-')))
    binDir = path.join(root, 'bin')
    outsideDir = realpathSync(await mkdtemp(path.join(tmpdir(), 'muse-pathguard-out-')))
    await mkdir(binDir, { recursive: true })
    // A real planted program, as the finding's <workspace>/bin/bwrap.
    const planted = path.join(binDir, PLATFORM === 'win32' ? `${PLANTED}.exe` : PLANTED)
    await writeFile(
      planted,
      PLATFORM === 'win32' ? '@echo off\r\necho planted\r\n' : '#!/bin/sh\necho planted\n',
    )
    // A link that resolves inside the workspace: the guard follows it.
    linkDir = path.join(root, 'linked-tools')
    await symlink(binDir, linkDir, 'junction')
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outsideDir, { recursive: true, force: true })
  })

  it('the planted program is not reachable from the child PATH; a real system program still is', () => {
    const nodeDir = path.dirname(process.execPath)
    const pathValue = [binDir, linkDir, 'bin', '', '.', nodeDir, outsideDir].join(SEPARATOR)
    const child = buildChildEnvironment({
      platform: PLATFORM,
      baseEnv: { PATH: pathValue },
      extraVariables: [],
      systemRoot: undefined,
      programFiles: undefined,
      workspaceRoot: root,
      realpath: realpathSync,
    })
    // Without the guard the planted program wins: the threat is real.
    expect(
      resolveExecutable(PLANTED, {
        platform: PLATFORM,
        pathVariable: pathValue,
        fileExists: existsSync,
      }),
    ).toBe(path.join(binDir, PLATFORM === 'win32' ? `${PLANTED}.exe` : PLANTED))
    const childPath = child['PATH'] ?? child['Path']
    expect(childPath).toBeDefined()
    // Relative, empty and workspace entries (direct and through the link)
    // are gone; the two outside entries survive byte-identical and in order.
    expect(childPath).toBe([nodeDir, outsideDir].join(SEPARATOR))
    expect(
      resolveExecutable(PLANTED, {
        platform: PLATFORM,
        pathVariable: childPath,
        fileExists: existsSync,
      }),
    ).toBeUndefined()
    const systemName = PLATFORM === 'win32' ? 'node.exe' : 'node'
    expect(
      resolveExecutable(systemName, {
        platform: PLATFORM,
        pathVariable: childPath,
        fileExists: existsSync,
      }),
    ).toBe(path.join(nodeDir, systemName))
  })
})
