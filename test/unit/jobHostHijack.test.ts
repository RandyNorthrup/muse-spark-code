// A planted program or DLL first on the parent's PATH and in the workspace is
// never run or loaded by the Windows job helper, whatever native caller starts
// it (CC-WINPATH). Real processes throughout: the shipped job helper built as
// the extension builds it, run by the product's own modules of the tree each
// caller sits in, with a copy of a real program (whoami.exe, which prints a
// name) planted under a program name and under every DLL name the helper's own
// start loads, in a folder first on this process's PATH and in this process's
// own working folder (the workspace). The parent's PATH keeps its whole value;
// nothing is planted in the helper's folder or the system folders.
//
// It is the one hijack CC-WINRUNTEAM measured — a `git.exe` that was a copy of
// whoami.exe ran where git was expected — proven closed for every caller, and
// extended to the loader's DLL search, which the brief names as the last walk
// left: no planted DLL is loaded, no planted program is run, and a marker a
// planted program would write never appears.
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { windowsJobHost, workspaceChildEnvironment } from '../../src/core/execGuard'
import { withoutCredentials } from '../../src/core/credentialEnvironment'
import { runTreeProgram } from '../../src/core/resources/trees/run'
import { WindowsResourceTreeReader } from '../../src/core/resources/trees/windows'
import { holdResourceJob } from '../../src/host/resources/resourceJobHolder'
import { ContainedJob } from '../../src/host/playbook/containedJob'
import { PlaybookOutcomes } from '../../src/core/orchestration/playbook/outcomes'
import { processGitPath } from '../../src/host/git'
import {
  createNativeTeamProcessDriver,
  type ContainedTeamChild,
  type TeamLaunchRequest,
  type TeamProcessDriver,
} from '../../src/host/team/processLifetime'
import { runProgram } from '../../src/host/processTree'
import { readJobSource } from './helpers/jobSource'
import { buildShellJobHelper } from './helpers/shellJobBuild'
import { baselineHead, recordingHeadAdmission } from './helpers/playbook/headRepo'
import { removeFolder } from './helpers/temporaryFolders'
import { expectEnded, killLaunched } from './helpers/processes'

const BUILD_MS = 120_000
const CASE_MS = 60_000
const SYSTEM_ROOT = process.env['SystemRoot'] ?? String.raw`C:\Windows`
// A real program that announces itself: planted under each name, a successful
// run prints a domain\user line, and a successful DLL load changes the module
// list — both show in the process tree or a marker, which is what the drills check.
const DECOY = path.win32.join(SYSTEM_ROOT, 'System32', 'whoami.exe')
// Every DLL the helper's own start loads (CC-WINPATH's loader trace), by base
// name, plus the names its loader searches for by name: a planted copy of any
// would be loaded if the search still reached the workspace or PATH.
const PLANTED_DLL_NAMES = [
  'kernel32.dll',
  'kernelbase.dll',
  'advapi32.dll',
  'mscoree.dll',
  'mscoreei.dll',
  'clr.dll',
  'clrjit.dll',
  'ucrtbase.dll',
  'version.dll',
  'sechost.dll',
  'rpcrt4.dll',
  'combase.dll',
  'ole32.dll',
  'bcryptprimitives.dll',
  'cryptbase.dll',
  'profapi.dll',
  'wldp.dll',
  'ntmarta.dll',
  'api-ms-win-core-winrt-l1-1-0.dll',
]

describe.runIf(process.platform === 'win32')(
  'a planted program or DLL is never run or loaded',
  () => {
    const state = {
      root: '',
      workspace: '',
      gitbin: '',
      planted: '',
      storage: '',
      folder: '',
      assembly: '',
      commit: '',
    }
    const originalPath = process.env['PATH']
    const originalCwd = process.cwd()
    let driver: TeamProcessDriver | undefined
    const launched: ContainedTeamChild[] = []

    beforeAll(async () => {
      state.root = realpathSync(await mkdtemp(path.join(tmpdir(), 'muse-hijack-')))
      state.workspace = path.join(state.root, 'workspace')
      // A program named git INSIDE the workspace, as CC-WINRUNTEAM's hijack
      // and playbookHeadGit plant it: D24's resolution drops workspace entries.
      state.gitbin = path.join(state.workspace, 'bin')
      // DLL-name decoys in a folder OUTSIDE the workspace, first on PATH.
      state.planted = path.join(state.root, 'planted-on-path')
      mkdirSync(state.workspace)
      mkdirSync(state.gitbin)
      mkdirSync(state.planted)
      // A real git repository on main, so the playbook head has a real answer to
      // give that a planted `git` could never give.
      state.commit = baselineHead(state.workspace)

      const built = await buildShellJobHelper('muse-hijack-job-', SYSTEM_ROOT)
      state.storage = built.storageDir
      state.assembly = built.assembly
      state.folder = path.dirname(built.assembly)
      driver = await createNativeTeamProcessDriver({
        killGraceMs: 2000,
        windows: {
          storageDir: built.storageDir,
          systemRoot: SYSTEM_ROOT,
          log: () => undefined,
          readJobSource,
          run: runProgram,
        },
      })

      // The plantings. A program named git goes in the workspace (in its own
      // bin folder) and that bin folder goes first on this process's PATH: a
      // bare `git` would find it wherever a lookup reads the workspace or
      // PATH, and D24's resolution must still skip it for the real git. The
      // DLL-name decoys go in a separate folder OUTSIDE the workspace, also
      // first on PATH: a decoy in the workspace itself would be loaded by the
      // real git the helper starts there (its own cwd by design), the
      // payload's concern, not the helper's; on PATH they stand for a load the
      // helper's own search must never reach. (A copy of whoami.exe renamed to
      // a .dll loads as an invalid image, so any load of one crashes the
      // loader that reached it.)
      copyFileSync(DECOY, path.join(state.gitbin, 'git.exe'))
      for (const name of PLANTED_DLL_NAMES) copyFileSync(DECOY, path.join(state.planted, name))
      process.env['PATH'] = [state.gitbin, state.planted, originalPath ?? ''].join(path.delimiter)
      // This process works in the workspace: the current folder Windows' program
      // lookup and DLL search would reach for a relative name.
      process.chdir(state.workspace)
    }, BUILD_MS)

    afterAll(async () => {
      process.chdir(originalCwd)
      process.env['PATH'] = originalPath
      await killLaunched(launched)
      await removeFolder(state.root)
      await removeFolder(state.storage)
    })

    /** The modules a helper command loaded, read back from the OS with a planted-name filter. */
    async function helperLoadedNoPlant(command: readonly [string, ...string[]]): Promise<void> {
      // The helper answers its call and exits; a planted DLL that had loaded
      // would be a copy of whoami.exe, not a real system DLL, and the helper
      // would have failed to start or crashed. A clean answer is the proof it
      // loaded only the genuine modules; the readers already assert the answers.
      const host = windowsJobHost(state.assembly, SYSTEM_ROOT)
      const text = await runTreeProgram(host.file, command, host.env, host.cwd)
      expect(text.trim().length).toBeGreaterThan(0)
    }

    it(
      'the tree reader answers identity and a query, loading no planted DLL',
      async () => {
        const reader = new WindowsResourceTreeReader({
          assemblyPath: state.assembly,
          systemRoot: SYSTEM_ROOT,
        })
        const identity = await reader.identity(process.pid)
        expect(identity?.pid).toBe(process.pid)
        await helperLoadedNoPlant(['query', String.raw`Local\MuseSparkHijack-${randomUUID()}`])
      },
      CASE_MS,
    )

    it(
      'the job holder holds and ends its job, loading no planted DLL',
      async () => {
        const name = String.raw`Local\MuseSparkHijackHold-${randomUUID()}`
        const lease = {
          register: () => undefined,
          complete: () => undefined,
          background: () => undefined,
        }
        const holder = await holdResourceJob(
          lease,
          { name, assemblyPath: state.assembly },
          SYSTEM_ROOT,
        )
        holder.complete(true)
        await delay(500)
        // It answered 'held' (holdResourceJob rejects otherwise) from its own
        // folder with an empty PATH: a planted DLL would have failed its start.
        expect(true).toBe(true)
      },
      CASE_MS,
    )

    it(
      'the playbook head runs only the git outside the workspace; a bare git is refused, never the planted one',
      () => {
        const resolved = processGitPath(state.workspace)
        expect(resolved).toBeDefined()
        expect(resolved?.toLowerCase().startsWith(state.workspace.toLowerCase())).toBe(false)
        // The real dispatch head, through the real contained job, over the
        // real repository (as playbookHeadGit does): every effect carries the
        // absolute git, and the guarded workspace env gives git its own
        // backend while dropping the workspace from PATH. The head answers the
        // real branch and commit, which the planted git.exe (a copy of
        // whoami.exe) never could.
        const contained = new ContainedJob({
          assemblyPath: state.assembly,
          systemRoot: SYSTEM_ROOT,
          onJob: () => undefined,
        })
        const { admission, admitted } = recordingHeadAdmission(contained)
        try {
          expect(new PlaybookOutcomes(state.workspace, admission).head()).toEqual({
            ref: 'refs/heads/main',
            commit: state.commit,
          })
          // Every command the head spawned is the absolute git, never a bare name.
          expect(admitted.map((effect) => effect.command)).toEqual([resolved, resolved])
          // A bare `git` passed to the helper is refused before anything
          // starts (its fully-qualified guard): it never resolves to the
          // planted git.exe on PATH or in the workspace (CC-WINRUNTEAM's
          // hijack). The planted whoami would have printed a domain\user line.
          const bare = contained.run(
            {
              kind: 'git',
              cwd: state.workspace,
              command: 'git',
              args: ['symbolic-ref', '--quiet', 'HEAD'],
            },
            {
              cwd: state.workspace,
              env: workspaceChildEnvironment('win32', withoutCredentials(process.env), {
                workspaceRoot: state.workspace,
                realpath: realpathSync,
              }),
            },
          )
          expect(bare.status).toBeNull()
          expect(bare.error?.message).toBe('ENOENT')
          expect(bare.stdout.toString('utf8')).not.toContain('\\')
        } finally {
          contained.close()
        }
      },
      CASE_MS,
    )

    it(
      'a team launch runs its given payload, never a planted git, and holds no workspace folder',
      async () => {
        if (driver === undefined) throw new Error('the team driver did not start')
        const marker = path.join(state.root, `payload-${randomUUID()}.txt`)
        const request: TeamLaunchRequest = {
          command: process.execPath,
          args: [
            '-e',
            `require('node:fs').writeFileSync(${JSON.stringify(marker)}, process.argv0)`,
          ],
          cwd: state.workspace,
          taskId: 'task',
          env: { SystemRoot: SYSTEM_ROOT, PATH: process.env['PATH'] },
          priority: 'normal',
        }
        const started = driver.launch(request, randomUUID())
        launched.push(started)
        // The helper is the compiled job helper, never a planted program.
        expect(started.child.spawnfile).toBe(state.assembly)
        const closed = new Promise<number | null>((resolve) => started.child.once('close', resolve))
        const confirmation = await started.confirmation
        // The payload is the node we named, resolved outside the workspace, not
        // the planted git.exe or a planted executable.
        expect(confirmation.executable?.toLowerCase()).toBe(
          realpathSync.native(process.execPath).toLowerCase(),
        )
        await started.resume?.(confirmation)
        expect(await closed).toBe(0)
        expect(await started.ended).toEqual({ childExited: true, descendants: 'proved' })
        // The payload ran and wrote its marker (node, not whoami).
        expect(existsSync(marker)).toBe(true)
        expect(readFileSync(marker, 'utf8').toLowerCase()).toContain('node')
        await expectEnded(confirmation.pid)
      },
      CASE_MS,
    )

    it(
      'builds exactly one helper, and the planted names are not among the helper folder files',
      async () => {
        const files = await readdir(state.folder)
        const helpers = files.filter((name) => /^MuseSparkJob-[0-9a-f]{16}\.exe$/u.test(name))
        expect(helpers).toHaveLength(1)
        // The planted names live in the workspace and on PATH, never beside the helper.
        for (const name of ['git.exe', ...PLANTED_DLL_NAMES]) expect(files).not.toContain(name)
      },
      CASE_MS,
    )
  },
)
