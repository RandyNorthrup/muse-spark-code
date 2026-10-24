// M116 (D218): the team runner's rounds through the window's playbook, as the
// extension binds them: the team host's facts go to the real window, which
// asks its real worker code (behind an in-process thread that copies every
// message), whose real policy writes a real journal and reads real git (on
// Windows inside the worker's real contained job). A task's round journals
// its dispatch brief and work, a second round on the same files is refused
// with the policy's why-note, a brief the policy cannot record refuses its
// own task before any round, and a released round leaves its lease
// released. Only the transport between window and worker is in-process.
import { execFileSync } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  FilePlaybookJournal,
  validatedRecords,
} from '../../src/core/orchestration/playbook/journal'
import type { TeamPlaybookStart } from '../../src/core/team/teamPlaybookBoard'
import {
  createPlaybookWindow,
  type PlaybookTeamWindow,
} from '../../src/host/playbook/playbookWindow'
import { servePlaybook } from '../../src/host/playbook/playbookWorker'
import { teamPlaybookRounds } from '../../src/host/playbook/teamPlaybook'
import type { PlaybookRecord } from '../../src/shared/playbook'
import { compiledJobAssembly, SYSTEM_ROOT } from './helpers/playbook/jobAssembly'
import { GOVERNED_ROUND_TIMEOUT_MS } from './helpers/playbook/panelRepository'
import { thread } from './helpers/playbook/workerThread'
import { errorLogger } from './helpers/collectingLogger'
import { removeFolder } from './helpers/temporaryFolders'

const IS_WINDOWS = process.platform === 'win32'
const shared: { storage?: string; assembly?: string } = {}
const cleanups: (() => Promise<void> | void)[] = []

beforeAll(async () => {
  if (!IS_WINDOWS) return
  shared.storage = await mkdtemp(path.join(tmpdir(), 'm116-team-rounds-job-'))
  shared.assembly = await compiledJobAssembly(shared.storage)
}, GOVERNED_ROUND_TIMEOUT_MS)
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup()
})
afterAll(async () => {
  if (shared.storage !== undefined) await removeFolder(shared.storage)
})

/** A real repository with one commit, and a data folder for its journal. */
async function workspace(): Promise<{ repo: string; data: string; head: string }> {
  const repo = await mkdtemp(path.join(tmpdir(), 'm116-team-rounds-'))
  const data = await mkdtemp(path.join(tmpdir(), 'm116-team-rounds-data-'))
  cleanups.push(
    () => removeFolder(repo),
    () => removeFolder(data),
  )
  execFileSync('git', ['init', '-b', 'main'], { cwd: repo })
  const identity = ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid']
  execFileSync('git', [...identity, 'commit', '--allow-empty', '-m', 'base'], { cwd: repo })
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
  return { repo, data, head }
}

/** The window over its real worker code. */
function window(repo: string, data: string, errors: string[]): PlaybookTeamWindow {
  const opened = createPlaybookWindow({
    bundlePath: 'dist/playbook.js',
    startWorker: (_file, workerData) => {
      const boundary = thread()
      servePlaybook(boundary.port, structuredClone(workerData))
      return boundary.handle
    },
    agentDataFolder: data,
    workspaceRoot: repo,
    isWorkspaceTrusted: () => true,
    platform: process.platform,
    systemRoot: IS_WINDOWS ? SYSTEM_ROOT : undefined,
    shellJobAssembly: IS_WINDOWS ? () => Promise.resolve(shared.assembly) : undefined,
    reviewCharter: () => '',
    log: errorLogger(errors),
  })
  cleanups.push(() => {
    opened.dispose()
  })
  return opened
}

function start(
  taskId: string,
  head: string,
  files: readonly string[],
  brief = 'Rework the retry helper',
): TeamPlaybookStart {
  return {
    task: { taskId, brief, files, reason: 'parallel', sessionId: 's1' },
    head: { ref: 'refs/heads/main', commit: head },
    entries: [{ id: 'e1', running: 0, usable: true }],
    branches: [],
  }
}

function records(data: string, repo: string): PlaybookRecord[] {
  return validatedRecords(new FilePlaybookJournal(data, repo).read())
}

describe('team rounds through the window playbook', () => {
  it(
    'journals a task round, refuses a second on the same files, and releases',
    async () => {
      const { repo, data, head } = await workspace()
      const errors: string[] = []
      const rounds = teamPlaybookRounds(window(repo, data, errors), () => ({
        ci: { known: false },
        capacity: undefined,
      }))
      await expect(rounds.start(start('task-1', head, ['src/team/retry.ts']))).resolves.toEqual({
        started: true,
      })
      const started = records(data, repo)
      const brief = started.find((record) => record.kind === 'note')
      expect(brief).toMatchObject({
        kind: 'note',
        value: { code: 'briefRecorded', module: 'src/team' },
      })
      expect(brief?.kind === 'note' && brief.value.reason).toContain(head)
      expect(
        started.some((record) => record.kind === 'work' && record.value.moduleId === 'team:task-1'),
      ).toBe(true)

      const second = await rounds.start(start('task-2', head, ['src/team/retry.ts']))
      expect(second).toHaveProperty('refused')

      const before = records(data, repo).length
      await expect(
        rounds.start(start('task-3', head, ['src/team/other.ts'], 'Rework {{the thing}}')),
      ).resolves.toEqual({ briefInvalid: true })
      expect(records(data, repo)).toHaveLength(before)

      await rounds.release('task-1')
      await vi.waitFor(() => {
        expect(
          records(data, repo).some(
            (record) => record.kind === 'lease' && record.value.status === 'released',
          ),
        ).toBe(true)
      })
      expect(errors).toEqual([])
    },
    GOVERNED_ROUND_TIMEOUT_MS,
  )
})
