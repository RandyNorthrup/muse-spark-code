import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { describe, expect, it, vi } from 'vitest'
import {
  deferredCohort,
  sharedValidation,
  sharedUiText,
  sharedWire,
} from '../../scripts/lib/deferredBundles.mjs'
import { deferredTeamView } from '../../scripts/lib/deferredTeamView.mjs'
import { EN } from '../../src/shared/l10n/en'

const require = createRequire(import.meta.url)

describe('packaged team factories', () => {
  it('loads working scheduler and runner capabilities on demand with no constructor dispatch', async () => {
    const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'm96-runtime-package-')))
    try {
      const common = {
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node20.18',
        minify: true,
        logLevel: 'silent',
      }
      await build({
        ...common,
        entryPoints: {
          team: 'src/core/team/teamEntry.ts',
          teamScheduler: 'src/core/team/teamSchedulerEntry.ts',
          teamRunners: 'src/host/runners/teamRunnersEntry.ts',
        },
        outdir: folder,
        plugins: [sharedUiText, sharedValidation, deferredCohort, sharedWire],
      })
      await build({
        ...common,
        entryPoints: {
          validation: 'src/shared/validationEntry.ts',
          uiText: 'src/shared/l10n/en.ts',
        },
        outdir: folder,
      })
      await build({
        ...common,
        entryPoints: ['src/shared/wireEntry.ts'],
        outfile: path.join(folder, 'wire.js'),
        plugins: [sharedUiText, sharedValidation, deferredTeamView],
      })
      const runtime = require(path.join(folder, 'team.js')).createTeamRuntime(EN, 'en')
      const schedulerFile = path.join(folder, 'teamScheduler.js')
      const runnersFile = path.join(folder, 'teamRunners.js')
      expect(require.cache[schedulerFile]).toBeUndefined()
      expect(require.cache[runnersFile]).toBeUndefined()
      const scheduler = await runtime.loadScheduler()
      const runners = await runtime.loadRunners()
      expect(require.cache[schedulerFile]).toBeDefined()
      expect(require.cache[runnersFile]).toBeDefined()
      const dispatch = vi.fn(() => {
        throw new Error('unexpected dispatch')
      })
      const board = new scheduler.TaskBoard('workspace', 'window', {
        workspaceFor: vi.fn(),
        workspaceMode: () => 'own-branch',
        report: () => '',
        countAttempt: dispatch,
        archive: dispatch,
        archivedTask: vi.fn(),
      })
      const slots = new scheduler.SchedulerSlots('workspace', () => ({
        workers: 1,
        processWorkers: 1,
        role: () => 1,
        entry: () => 1,
        agent: () => 1,
      }))
      expect(board.snapshot().tasks).toEqual([])
      expect(slots.snapshot()).toEqual([])
      const request = {
        taskId: 'task',
        attempt: 1,
        workspaceId: 'workspace',
        roleId: 'engineering',
        entryId: 'entry',
        agentProfileId: 'agent',
        kind: 'engine',
      }
      expect(slots.reserve(request)).toEqual({ ok: true })
      expect(slots.reserve(request)).toEqual({
        ok: false,
        reason: 'duplicate',
        recovery: 'selfOrRaiseLimit',
      })
      board.submit(
        [
          {
            id: 'task',
            parentSessionId: 'session',
            roleId: 'engineering',
            workspaceMode: 'own-branch',
            fields: { priority: 'normal', size: 'M', overlap: 'serialize' },
          },
        ],
        1,
      )
      expect(board.task('task').state).toBe('ready')
      expect(scheduler.createSchedulerTeamTools).toBeTypeOf('function')
      expect(runners.SshRunner).toBeTypeOf('function')
      expect(runners.CheckSlots).toBeTypeOf('function')
      expect(await runners.readRunnerConfig('/config', vi.fn())).toEqual([])
      expect(await runners.handleTrafficMessage({ type: 'traffic/unknown' }, {})).toEqual({
        handled: false,
      })
      expect(await runners.handleRunnersMessage({ type: 'runners/unknown' }, {})).toEqual({
        handled: false,
      })
      expect(runners.runnerEnvironment({ PATH: '/bin', GIT_ASKPASS: 'forbidden' })).toEqual({
        PATH: '/bin',
      })
      expect(dispatch).not.toHaveBeenCalled()
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })
})
