// PATHGUARD round 4 (Grok re-review of PR #249): every Windows spelling of
// the workspace is dropped, and every product lookup refuses a program
// planted in the workspace. Drives the real resolvers with a real temporary
// workspace and real planted programs.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chmodSync, existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import {
  resolveExecutable,
  sanitizePathForWorkspace,
  workspaceChildEnvironment,
} from '../../src/core/executables'
import { resolvePluginRuntime } from '../../src/core/backends/modelapi/pluginHost'
import { resolveServerCommand } from '../../src/host/backend/mcpProcess'
import { hookEnvironment, hookProgramFor, shellInterpreter } from '../../src/host/backend/toolIo'
import { PlaybookOutcomes } from '../../src/core/orchestration/playbook/outcomes'
import { locateCaptureHelper } from '../../src/core/voice/helperLocation'
import { processGitRunner } from '../../src/host/git'
import { execResourceFile } from '../../src/core/resources/commands'
import { reportGitIo } from '../../src/runtime/reporting/sources'
import { fixedGitLocator } from '../../src/runtime/panel/git/service'

const PLATFORM = process.platform

const throwingRealpath = (filePath: string): string => {
  throw Object.assign(new Error(`no such file: ${filePath}`), { code: 'ENOENT' })
}

describe('round-4 Windows spellings of the workspace', () => {
  it('drops device, trailing-dot and dot-dot spellings with no resolver to hide behind', () => {
    const joined = [
      String.raw`\\.\C:\Users\me\repo\bin`,
      '//./C:/Users/me/repo/bin',
      String.raw`\\.\UNC\localhost\C$\Users\me\repo\bin`,
      String.raw`C:\Users\me\repo.`,
      String.raw`C:\Users\me\repo.\bin`,
      String.raw`C:\no-such\..\Users\me\repo\bin`,
      String.raw`D:\Tools`,
    ].join(';')
    expect(
      sanitizePathForWorkspace({
        platform: 'win32',
        pathVariable: joined,
        workspaceRoot: String.raw`C:\Users\me\repo`,
        realpath: throwingRealpath,
      }),
    ).toBe(String.raw`D:\Tools`)
  })

  it('drops the space-then-dot spelling but keeps a non-final run of dots', () => {
    const joined = [
      String.raw`C:\Users\me\repo .`,
      String.raw`C:\Users\me\repo .\bin`,
      String.raw`C:\Users\me\repo. \bin`,
      String.raw`C:\Users\me\repo...\bin`,
      String.raw`D:\Tools`,
    ].join(';')
    expect(
      sanitizePathForWorkspace({
        platform: 'win32',
        pathVariable: joined,
        workspaceRoot: String.raw`C:\Users\me\repo`,
        realpath: throwingRealpath,
      }),
    ).toBe(String.raw`C:\Users\me\repo...\bin;D:\Tools`)
  })

  it('keeps a sibling a trailing dot would otherwise merge', () => {
    expect(
      sanitizePathForWorkspace({
        platform: 'win32',
        pathVariable: String.raw`C:\Users\me\repo-evil\bin;D:\Tools`,
        workspaceRoot: String.raw`C:\Users\me\repo`,
        realpath: throwingRealpath,
      }),
    ).toBe(String.raw`C:\Users\me\repo-evil\bin;D:\Tools`)
  })

  it('collapses dot-dot spellings on POSIX too', () => {
    expect(
      sanitizePathForWorkspace({
        platform: 'linux',
        pathVariable: '/home/person/work/../work/bin:/usr/bin',
        workspaceRoot: '/home/person/work',
        realpath: throwingRealpath,
      }),
    ).toBe('/usr/bin')
  })

  it('never resolves through a dropped spelling', () => {
    const isPlantedGit = (filePath: string): boolean =>
      filePath === String.raw`\\.\C:\Users\me\repo\bin\git.exe`
    expect(
      resolveExecutable('git', {
        platform: 'win32',
        pathVariable: String.raw`\\.\C:\Users\me\repo\bin;D:\Tools`,
        fileExists: isPlantedGit,
        workspaceRoot: String.raw`C:\Users\me\repo`,
        realpath: throwingRealpath,
      }),
    ).toBeUndefined()
  })
})

describe('workspaceChildEnvironment', () => {
  it('sanitizes PATH and sets NoDefaultCurrentDirectoryInExePath on Windows', () => {
    const child = workspaceChildEnvironment(
      'win32',
      { PATH: String.raw`D:\ws\bin;D:\Tools`, HOME: 'x' },
      { workspaceRoot: String.raw`D:\ws`, realpath: throwingRealpath },
    )
    expect(child['PATH']).toBe(String.raw`D:\Tools`)
    expect(child['NoDefaultCurrentDirectoryInExePath']).toBe('1')
    expect(child['HOME']).toBe('x')
  })

  it('deletes PATH when nothing remains and never adds one', () => {
    const child = workspaceChildEnvironment(
      'linux',
      { PATH: '/home/person/work/bin:.' },
      { workspaceRoot: '/home/person/work', realpath: throwingRealpath },
    )
    expect('PATH' in child).toBe(false)
    expect('NoDefaultCurrentDirectoryInExePath' in child).toBe(false)
  })
})

describe('fixedGitLocator workspace refusal', () => {
  it('refuses a git inside the bound repository', () => {
    expect(
      fixedGitLocator('linux', '/home/person/work/bin/git', {
        workspaceRoot: '/home/person/work',
      })(),
    ).toBeUndefined()
    expect(fixedGitLocator('linux', '/usr/bin/git', { workspaceRoot: '/home/person/work' })()).toBe(
      '/usr/bin/git',
    )
  })
})

describe('round-4 planted programs (real filesystem)', () => {
  let root = ''
  let binDir = ''
  let linkDir = ''
  let realGitDir = ''

  beforeAll(async () => {
    root = realpathSync(await mkdtemp(path.join(tmpdir(), 'muse-pathguard-r4-')))
    binDir = path.join(root, 'bin')
    await mkdir(binDir, { recursive: true })
    await mkdir(path.join(root, '.git'), { recursive: true })
    for (const name of ['git', 'node', 'bash', 'sh', 'arecord', 'xdg-open']) {
      const planted = path.join(binDir, name)
      await writeFile(planted, '#!/bin/sh\necho planted\n')
      chmodSync(planted, 0o755)
    }
    linkDir = path.join(root, 'linked-tools')
    await symlink(binDir, linkDir, 'junction')
    const realGit = resolveExecutable('git', {
      platform: PLATFORM,
      pathVariable: process.env['PATH'],
      fileExists: existsSync,
    })
    if (realGit === undefined) {
      throw new Error('the rig has no git on PATH to compare against')
    }
    realGitDir = path.dirname(realGit)
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it.runIf(PLATFORM !== 'win32')(
    'a symlinked workspace entry never resolves the planted git',
    () => {
      const pathValue = [linkDir, realGitDir].join(':')
      // Without the workspace the planting wins through the link.
      expect(
        resolveExecutable('git', {
          platform: PLATFORM,
          pathVariable: pathValue,
          fileExists: existsSync,
        }),
      ).toBe(path.join(linkDir, 'git'))
      // With it, the link resolves inside and the real git answers.
      expect(
        resolveExecutable('git', {
          platform: PLATFORM,
          pathVariable: pathValue,
          fileExists: existsSync,
          workspaceRoot: root,
          realpath: realpathSync,
        }),
      ).toBe(path.join(realGitDir, 'git'))
    },
  )

  it.runIf(PLATFORM !== 'win32')(
    'the git runner answers through the link, never the planting',
    async () => {
      const run = processGitRunner({ env: { PATH: [linkDir, realGitDir].join(':') } })
      const version = await run(['--version'], root)
      expect(version.trim()).toMatch(/^git version /u)
    },
  )

  it.runIf(PLATFORM !== 'win32')('reportGitIo never resolves the planted git', async () => {
    // With only the planted git on PATH, the lookup finds nothing and the
    // source reports missing before any spawn; a resolved planting would
    // reach the spawn instead. (The governed spawn itself needs the
    // resource host, so unit tests stop at the lookup verdict.)
    const io = reportGitIo(root, PLATFORM, { PATH: binDir })
    await expect(io.run(['--version'], AbortSignal.timeout(10_000))).rejects.toThrow('missing')
  })

  it.runIf(PLATFORM !== 'win32')('the plugin runtime refuses a planted node', async () => {
    const runtime = await resolvePluginRuntime('amp', {
      env: { PATH: binDir },
      fileExists: existsSync,
      workspaceRoot: root,
      realpath: realpathSync,
    })
    expect(runtime.ok).toBe(false)
  })

  it.runIf(PLATFORM !== 'win32')('the MCP server command refuses a planted node', () => {
    expect(() =>
      resolveServerCommand(
        'node',
        root,
        { PATH: binDir },
        {
          platform: PLATFORM,
          isExistingFile: existsSync,
        },
      ),
    ).toThrow(/absolute entries of PATH/u)
    expect(
      resolveServerCommand(
        'node',
        root,
        { PATH: [binDir, path.dirname(process.execPath)].join(':') },
        { platform: PLATFORM, isExistingFile: existsSync },
      ),
    ).toBe(path.join(path.dirname(process.execPath), 'node'))
  })

  it.runIf(PLATFORM !== 'win32')('the shell interpreter refuses a planted bash', () => {
    expect(
      shellInterpreter('linux', undefined, { PATH: binDir }, existsSync, {
        workspaceRoot: root,
        realpath: realpathSync,
      }),
    ).toBeUndefined()
  })

  it.runIf(PLATFORM !== 'win32')('hook and shell PATHs drop the workspace', () => {
    const nodeDir = path.dirname(process.execPath)
    const hooked = hookEnvironment({ PATH: [binDir, nodeDir].join(':') }, 'linux', [], {
      workspaceRoot: root,
      realpath: realpathSync,
    })
    expect(hooked['PATH']).toBe(nodeDir)
  })

  it.runIf(PLATFORM !== 'win32')('the Linux recorder refuses a planted arecord', () => {
    const location = locateCaptureHelper({
      platform: 'linux',
      systemRoot: undefined,
      programFiles: undefined,
      remoteName: undefined,
      appName: 'test',
      helperDir: path.join(root, 'no-helpers'),
      fileExists: existsSync,
      pathVariable: binDir,
      workspaceRoot: root,
      realpath: realpathSync,
    })
    expect(location.isAvailable).toBe(false)
  })

  it.runIf(PLATFORM !== 'win32')('the governed opener refuses a planted xdg-open', async () => {
    await expect(
      execResourceFile('probe', 'xdg-open', ['--version'], {
        env: { PATH: binDir },
        cwd: root,
        timeout: 10_000,
      }),
    ).rejects.toThrow('Governed command unavailable')
  })

  it.runIf(PLATFORM !== 'win32')(
    'an absolute SHELL inside the workspace is ignored for hooks',
    () => {
      const realSh = resolveExecutable('sh', {
        platform: PLATFORM,
        pathVariable: process.env['PATH'],
        fileExists: existsSync,
      })
      if (realSh === undefined) {
        throw new Error('the rig has no sh on PATH to compare against')
      }
      const realShDir = path.dirname(realSh)
      const plantedShell = path.join(binDir, 'sh')
      const deps = (shell: string | undefined) => ({
        platform: PLATFORM,
        listFiles: (): Promise<readonly string[]> => Promise.resolve([]),
        systemRoot: undefined,
        env: (): NodeJS.ProcessEnv => ({
          PATH: [binDir, realShDir].join(':'),
          ...(shell !== undefined && { SHELL: shell }),
        }),
        searchWorkerPath: '',
        log: () => undefined,
        unsavedFiles: (): readonly string[] => [],
      })
      // Without a workspace the configured shell answers, as before.
      expect(hookProgramFor(deps(plantedShell), plantedShell, undefined)).toBe(plantedShell)
      // Inside the workspace it is ignored: sh resolves outside instead.
      expect(
        hookProgramFor(deps(plantedShell), plantedShell, {
          workspaceRoot: root,
          realpath: realpathSync,
        }),
      ).toBe(realSh)
      // A configured shell outside the workspace still answers.
      expect(
        hookProgramFor(deps(realSh), realSh, {
          workspaceRoot: root,
          realpath: realpathSync,
        }),
      ).toBe(realSh)
    },
  )

  it.runIf(PLATFORM !== 'win32')(
    'the playbook hands the admission a git outside the workspace',
    () => {
      // The planted git stands first on PATH, inside the workspace: the
      // admitted command must be the real git beyond it. The admission
      // refuses, so nothing spawns; the verdict is the lookup itself.
      const savedPath = process.env['PATH']
      process.env['PATH'] = [binDir, realGitDir].join(':')
      try {
        const seen: string[] = []
        const outcomes = new PlaybookOutcomes(root, {
          admit: (effect) => {
            seen.push(effect.command)
            return false
          },
        })
        expect(() => outcomes.snapshot()).toThrow()
        expect(seen.length).toBeGreaterThan(0)
        for (const command of seen) {
          expect(path.isAbsolute(command)).toBe(true)
          expect(command).not.toBe(path.join(binDir, 'git'))
          expect(command).toBe(path.join(realGitDir, 'git'))
        }
      } finally {
        process.env['PATH'] = savedPath
      }
    },
  )
})
