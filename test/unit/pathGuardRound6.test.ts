// PATHGUARD round 6 (Grok re-review of PR #249): the compiler now finds
// every call site (required ExecutableScope, branded GuardedChildEnv), and
// these tests drive the real code for each round-6 cause fix: a planted
// workspace program never runs from the team probe, the report's `gh`, a
// linked playbook worktree, or the Linux recorder lookup.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chmodSync, existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { execResourceFile } from '../../src/core/resources/commands'
import { ghReportTransport } from '../../src/core/reporting/sources/github'
import { locateCaptureHelper } from '../../src/core/voice/helperLocation'
import { PlaybookOutcomes } from '../../src/core/orchestration/playbook/outcomes'
import { GITHUB_API_BASE_URL } from '../../src/shared/constants'
import type { SpawnSyncReturns } from 'node:child_process'

const PLATFORM = process.platform

const slashed = (value: string): string => value.replaceAll('\\', '/')

describe('round-6 planted programs (real filesystem)', () => {
  let root = ''
  let binDir = ''
  let outsideDir = ''

  beforeAll(async () => {
    root = realpathSync(await mkdtemp(path.join(tmpdir(), 'muse-pathguard-r6-')))
    binDir = path.join(root, 'bin')
    outsideDir = realpathSync(await mkdtemp(path.join(tmpdir(), 'muse-pathguard-r6-out-')))
    await mkdir(binDir, { recursive: true })
    for (const name of ['gh', 'xdg-open', 'arecord']) {
      const planted = path.join(binDir, name)
      await writeFile(planted, '#!/bin/sh\necho planted\n')
      chmodSync(planted, 0o755)
    }
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outsideDir, { recursive: true, force: true })
  })

  it.runIf(PLATFORM !== 'win32')(
    'an absolute planting inside the workspace is refused at the governed boundary',
    async () => {
      // Before the fix resolveCommand returned any absolute command without
      // the workspace check, so this planted `gh` would have run with the
      // person's login. It is refused before any spawn.
      await expect(
        execResourceFile('probe', path.join(binDir, 'gh'), ['api'], {
          env: { PATH: '/usr/bin' },
          cwd: root,
          timeout: 10_000,
        }),
      ).rejects.toThrow('Governed command unavailable')
    },
  )

  it.runIf(PLATFORM !== 'win32')(
    'the report gh resolves outside the workspace and threads it to the exec',
    async () => {
      // A real outside `gh` beside the planting: the lookup must skip the
      // workspace entry (links followed) and hand the exec the same root.
      const realGh = path.join(outsideDir, 'gh')
      await writeFile(realGh, '#!/bin/sh\necho unreachable\n')
      chmodSync(realGh, 0o755)
      const seen: { file: string; workspaceRoot: string | undefined }[] = []
      const transport = ghReportTransport({
        environment: { PATH: [binDir, outsideDir].join(':') },
        maxBytes: 1_000_000,
        workspaceRoot: root,
        probe: {
          platform: PLATFORM,
          pathVariable: [binDir, outsideDir].join(':'),
          fileExists: existsSync,
          scope: { workspaceRoot: root, realpath: realpathSync },
        },
        run: (file, _args, options) => {
          seen.push({ file, workspaceRoot: options.workspaceRoot })
          return Promise.resolve({
            stdout: 'HTTP/1.1 200 OK\nContent-Type: application/json\n\n[]',
            stderr: '',
          })
        },
      })
      const response = await transport(
        { url: `${GITHUB_API_BASE_URL}/repos/o/r` },
        null,
        AbortSignal.timeout(10_000),
      )
      expect(response.status).toBe(200)
      expect(seen).toHaveLength(1)
      expect(seen[0]?.file).toBe(realGh)
      expect(seen[0]?.workspaceRoot).toBe(root)
    },
  )

  it.runIf(PLATFORM !== 'win32')('the recorder lookup refuses the workspace planting', () => {
    // Only the planted `arecord` is on PATH: the lookup excludes the
    // workspace (links followed), so nothing resolves and the planting the
    // recorder child would have started never does.
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

  it.runIf(PLATFORM !== 'win32')(
    'a linked worktree outside the main workspace is sanitized too',
    () => {
      // The effect runs with the linked checkout as its cwd: the child PATH
      // must exclude the linked directory as well as the main workspace, so
      // a helper git starts by bare name never runs from either planting.
      const linked = path.join(outsideDir, 'linked-checkout')
      const seen: string[] = []
      const outcomes = new PlaybookOutcomes(root, {
        admit: () => true,
        runContained: (effect, options) => {
          seen.push(options.env['PATH'] ?? '')
          const empty: SpawnSyncReturns<Buffer> = {
            pid: 0,
            output: [null, Buffer.alloc(0), Buffer.alloc(0)],
            stdout: Buffer.alloc(0),
            stderr: Buffer.alloc(0),
            status: 0,
            signal: null,
            error: undefined,
          }
          if (effect.args.includes('worktree')) {
            return {
              ...empty,
              stdout: Buffer.from(`worktree ${linked}\0HEAD ${'0'.repeat(40)}\0`),
            }
          }
          return empty
        },
      })
      expect(outcomes.snapshot()).toEqual([])
      expect(seen.length).toBeGreaterThan(0)
      for (const pathValue of seen) {
        for (const entry of pathValue.split(':')) {
          const slashedEntry = slashed(entry)
          expect(slashedEntry).not.toBe(slashed(linked))
          expect(slashedEntry.startsWith(`${slashed(linked)}/`)).toBe(false)
          expect(slashedEntry).not.toBe(slashed(root))
          expect(slashedEntry.startsWith(`${slashed(root)}/`)).toBe(false)
        }
      }
    },
  )
})

describe('round-6 team probe (real driver start)', () => {
  it.runIf(PLATFORM === 'linux')(
    'never executes a program planted on a workspace PATH entry',
    async () => {
      // The probe runs before any launch directory is known, so it must never
      // search PATH: only the fixed /usr/bin tools with an absolute true. A
      // planted `setpriv` or `true` on an absolute PATH entry must not run.
      const dir = realpathSync(await mkdtemp(path.join(tmpdir(), 'muse-pathguard-r6-probe-')))
      try {
        const setprivMarker = path.join(dir, 'setpriv.marker')
        const trueMarker = path.join(dir, 'true.marker')
        await writeFile(
          path.join(dir, 'setpriv'),
          `#!/bin/sh\necho planted >> ${JSON.stringify(setprivMarker)}\nexit 0\n`,
        )
        await writeFile(
          path.join(dir, 'true'),
          `#!/bin/sh\necho planted >> ${JSON.stringify(trueMarker)}\nexit 0\n`,
        )
        chmodSync(path.join(dir, 'setpriv'), 0o755)
        chmodSync(path.join(dir, 'true'), 0o755)
        const savedPath = process.env['PATH']
        process.env['PATH'] = [dir, savedPath ?? ''].filter(Boolean).join(':')
        try {
          const { createNativeTeamProcessDriver } =
            await import('../../src/host/team/processLifetime')
          await createNativeTeamProcessDriver({ killGraceMs: 1 })
        } finally {
          if (savedPath === undefined) delete process.env['PATH']
          else process.env['PATH'] = savedPath
        }
        expect(existsSync(setprivMarker)).toBe(false)
        expect(existsSync(trueMarker)).toBe(false)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  )
})
