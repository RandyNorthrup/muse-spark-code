// The PATH guard: no workspace program runs from PATH when Muse Code starts
// (docs/certification/pathguard.md). Drives the real environment builder
// with a real temporary workspace and a real planted program.
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { chmodSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildChildEnvironment } from '../../src/core/backends/musecode/launch'
import {
  NO_WORKSPACE,
  resolveExecutable,
  sanitizePathForWorkspace,
} from '../../src/core/executables'
import { processGitRunner } from '../../src/host/git'

const PLATFORM = process.platform
const SEPARATOR = PLATFORM === 'win32' ? ';' : ':'
const PLANTED = 'pathguard-planted-probe'

const throwingRealpath = (filePath: string): string => {
  throw Object.assign(new Error(`no such file: ${filePath}`), { code: 'ENOENT' })
}

// Fails when the guard resolves a drive-rewritten entry instead of the
// original UNC spelling: the rewritten C:\localhost\… names nothing.
const refuseRewrittenRealpath = (filePath: string): string => {
  if (filePath.startsWith(String.raw`C:\localhost`)) {
    throw Object.assign(new Error(`no such file: ${filePath}`), { code: 'ENOENT' })
  }
  return filePath
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

  it('resolves rooted Windows entries on the workspace drive: inside goes, outside stays', () => {
    const joined = String.raw`\Users\me\project\bin;/Users/me/project/bin;\Other\bin;D:\Tools;\\srv\share\bin`
    expect(
      sanitizePathForWorkspace({
        platform: 'win32',
        pathVariable: joined,
        workspaceRoot: String.raw`D:\Users\me\project`,
        realpath: throwingRealpath,
      }),
    ).toBe(String.raw`\Other\bin;D:\Tools;\\srv\share\bin`)
  })

  it('drops rooted Windows entries when the workspace root names no drive', () => {
    expect(
      sanitizePathForWorkspace({
        platform: 'win32',
        pathVariable: String.raw`\Tools\bin;D:\Tools`,
        workspaceRoot: String.raw`\\srv\share\project`,
        realpath: throwingRealpath,
      }),
    ).toBe(String.raw`D:\Tools`)
  })

  it('drops forward-slash UNC, verbatim and loopback admin-share spellings of the workspace', () => {
    // Windows accepts forward slashes in a UNC path, so //localhost/C$/…
    // is an admin share of the workspace drive, and //?/… is a verbatim
    // path: both must compare as the workspace itself, lexically, with no
    // resolver to hide behind.
    const joined = [
      '//localhost/C$/Users/me/repo/bin',
      '//?/C:/Users/me/repo/bin',
      String.raw`\\?\C:\Users\me\repo\bin`,
      String.raw`\\?\UNC\localhost\C$\Users\me\repo\bin`,
      '//127.0.0.1/C$/Users/me/repo/bin',
      String.raw`D:\Tools`,
      String.raw`\\srv\share\bin`,
    ].join(';')
    expect(
      sanitizePathForWorkspace({
        platform: 'win32',
        pathVariable: joined,
        workspaceRoot: String.raw`C:\Users\me\repo`,
        realpath: throwingRealpath,
      }),
    ).toBe(String.raw`D:\Tools;\\srv\share\bin`)
  })

  it('compares the original entry, not a drive-rewritten one', () => {
    // A resolver that rewrites //localhost/C$/… onto the workspace drive
    // before comparing loses the share spelling and keeps it; the guard
    // resolves the entry as itself.
    expect(
      sanitizePathForWorkspace({
        platform: 'win32',
        pathVariable: '//localhost/C$/Users/me/repo/bin;D:/Tools',
        workspaceRoot: String.raw`C:\Users\me\repo`,
        realpath: refuseRewrittenRealpath,
      }),
    ).toBe('D:/Tools')
  })
})

describe('buildChildEnvironment PATH guard', () => {
  it('excludes nothing without a workspace root but still drops relative entries', () => {
    const env = buildChildEnvironment({
      platform: 'linux',
      baseEnv: { PATH: '/home/person/work/bin:/usr/bin:.:/home/person/work/bin' },
      extraVariables: [],
      systemRoot: undefined,
      programFiles: undefined,
      scope: { noWorkspace: NO_WORKSPACE, realpath: throwingRealpath },
    })
    expect(env['PATH']).toBe('/home/person/work/bin:/usr/bin:/home/person/work/bin')
  })

  it('never adds a PATH key that was not there', () => {
    const env = buildChildEnvironment({
      platform: 'linux',
      baseEnv: {},
      extraVariables: [],
      systemRoot: undefined,
      programFiles: undefined,
      scope: { workspaceRoot: '/home/person/work', realpath: throwingRealpath },
    })
    expect('PATH' in env).toBe(false)
  })

  it('deletes PATH when nothing remains instead of storing an empty one', () => {
    const env = buildChildEnvironment({
      platform: 'linux',
      baseEnv: { PATH: '/home/person/work/bin:.:/home/person/work' },
      extraVariables: [],
      systemRoot: undefined,
      programFiles: undefined,
      scope: { workspaceRoot: '/home/person/work', realpath: throwingRealpath },
    })
    expect('PATH' in env).toBe(false)
  })

  it('sanitizes a PATH from environmentVariables instead of letting it replace the guard', () => {
    const env = buildChildEnvironment({
      platform: 'linux',
      baseEnv: { PATH: '/usr/bin' },
      extraVariables: [{ name: 'PATH', value: '/home/person/work/bin:./bin:/usr/bin' }],
      systemRoot: undefined,
      programFiles: undefined,
      scope: { workspaceRoot: '/home/person/work', realpath: throwingRealpath },
    })
    expect(env['PATH']).toBe('/usr/bin')
  })

  it('sets NoDefaultCurrentDirectoryInExePath on every Windows child', () => {
    const guarded = buildChildEnvironment({
      platform: 'win32',
      baseEnv: { PATH: String.raw`D:\Tools` },
      extraVariables: [],
      systemRoot: undefined,
      programFiles: undefined,
      scope: { workspaceRoot: String.raw`D:\ws`, realpath: throwingRealpath },
    })
    expect(guarded['NoDefaultCurrentDirectoryInExePath']).toBe('1')
    const unscoped = buildChildEnvironment({
      platform: 'win32',
      baseEnv: { PATH: String.raw`D:\Tools` },
      extraVariables: [],
      systemRoot: undefined,
      programFiles: undefined,
      scope: { noWorkspace: NO_WORKSPACE, realpath: throwingRealpath },
    })
    expect(unscoped['NoDefaultCurrentDirectoryInExePath']).toBe('1')
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
    const workspace = { workspaceRoot: root, realpath: realpathSync }
    const child = buildChildEnvironment({
      platform: PLATFORM,
      baseEnv: { PATH: pathValue },
      extraVariables: [],
      systemRoot: undefined,
      programFiles: undefined,
      scope: workspace,
    })
    // Without the guard the planted program wins: the threat is real.
    expect(
      resolveExecutable(PLANTED, {
        platform: PLATFORM,
        pathVariable: pathValue,
        fileExists: existsSync,
        scope: { noWorkspace: NO_WORKSPACE, realpath: realpathSync },
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
        scope: workspace,
      }),
    ).toBeUndefined()
    const systemName = PLATFORM === 'win32' ? 'node.exe' : 'node'
    expect(
      resolveExecutable(systemName, {
        platform: PLATFORM,
        pathVariable: childPath,
        fileExists: existsSync,
        scope: workspace,
      }),
    ).toBe(path.join(nodeDir, systemName))
  })

  // A real process start, not a lookup: the planted program runs from the
  // raw PATH with the workspace as the working directory, and the same start
  // from the guarded child environment finds nothing. (Windows CreateProcess
  // behaviour is covered by the recorded probe in docs/certification/m21.md
  // plus the NoDefaultCurrentDirectoryInExePath assertion above.)
  it.runIf(PLATFORM !== 'win32')(
    'the planted program runs raw but not from the child environment',
    () => {
      chmodSync(path.join(binDir, PLANTED), 0o755)
      const nodeDir = path.dirname(process.execPath)
      const rawPath = [binDir, nodeDir].join(':')
      const ran = spawnSync(PLANTED, [], { cwd: root, env: { PATH: rawPath }, encoding: 'utf8' })
      expect(ran.error).toBeUndefined()
      expect(ran.status).toBe(0)
      expect(ran.stdout.trim()).toBe('planted')
      const child = buildChildEnvironment({
        platform: PLATFORM,
        baseEnv: { PATH: rawPath },
        extraVariables: [],
        systemRoot: undefined,
        programFiles: undefined,
        scope: { workspaceRoot: root, realpath: realpathSync },
      })
      const blocked = spawnSync(PLANTED, [], { cwd: root, env: { ...child }, encoding: 'utf8' })
      expect(blocked.status).toBeNull()
      expect(blocked.error?.message).toContain('ENOENT')
    },
  )

  it.runIf(PLATFORM !== 'win32')(
    'a planted git in the workspace never runs with the workspace as cwd',
    async () => {
      // A real planted `git` beside the probe program, and the real git run
      // through the real runner: with the workspace as the working directory
      // the planting is excluded from the lookup and the real git answers.
      const plantedGit = path.join(binDir, 'git')
      await writeFile(plantedGit, '#!/bin/sh\necho planted\n')
      chmodSync(plantedGit, 0o755)
      const realGit = resolveExecutable('git', {
        platform: PLATFORM,
        pathVariable: process.env['PATH'],
        fileExists: existsSync,
        scope: { workspaceRoot: root, realpath: realpathSync },
      })
      if (realGit === undefined) {
        throw new Error('the rig has no git on PATH to compare against')
      }
      const pathValue = [binDir, path.dirname(realGit)].join(':')
      const run = processGitRunner({ env: { PATH: pathValue } })
      const version = await run(['--version'], root)
      expect(version.trim()).toMatch(/^git version /u)
      // The same PATH from another directory still finds the planting
      // first: the exclusion is scoped to the directory the child runs in.
      const planted = await run(['--version'], outsideDir)
      expect(planted.trim()).toBe('planted')
    },
  )

  it.runIf(PLATFORM !== 'win32')('no PATH key means no working-directory fallback', () => {
    chmodSync(path.join(binDir, PLANTED), 0o755)
    const child = buildChildEnvironment({
      platform: PLATFORM,
      baseEnv: { PATH: [binDir, '.', ''].join(':') },
      extraVariables: [],
      systemRoot: undefined,
      programFiles: undefined,
      scope: { workspaceRoot: root, realpath: realpathSync },
    })
    expect('PATH' in child).toBe(false)
    const blocked = spawnSync(PLANTED, [], { cwd: root, env: { ...child }, encoding: 'utf8' })
    expect(blocked.status).toBeNull()
    expect(blocked.error?.message).toContain('ENOENT')
  })
})
