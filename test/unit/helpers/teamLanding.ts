import { open, readFile } from 'node:fs/promises'
import path from 'node:path'
import { vi } from 'vitest'
import {
  TeamLanding,
  type LandingAdmission,
  type LandingIntent,
  type TeamLandingDeps,
} from '../../../src/core/team/teamMerge'
import { canonicalPath, isMissingPath } from '../../../src/host/canonicalPath'
import { writeFileAtomically } from '../../../src/host/fsAtomic'
import { knownRepositoryHolder, takeIndexLock } from '../../../src/host/team/gitIndexLock'
import { LandingJournal, landingFileAccess } from '../../../src/host/team/landingJournal'
import type { teamRepository } from './teamRepository'

const DEFAULT_CHANGES = { 'a.txt': 'landed-a\n' }
export async function teamLandingFixture(
  repo: Awaited<ReturnType<typeof teamRepository>>,
  changes: Readonly<Record<string, string | Buffer>> = DEFAULT_CHANGES,
  id = 'landing-one',
) {
  const snapshot = await repo.staging.snapshot(repo.root)
  const copy = path.join(repo.storage, `staging-${id}`)
  await repo.staging.clone(repo.root, snapshot, copy)
  for (const [name, bytes] of Object.entries(changes)) await repo.write(name, bytes, copy)
  const final = await repo.staging.snapshot(copy)
  await repo.git(['fetch', '--no-tags', '--no-write-fetch-head', copy, final.commit])
  const admission: LandingAdmission = {
    id,
    snapshot,
    final,
    checkIdentity: 'checks-one',
    owners: new Map(Object.keys(changes).map((name) => [name, ['task-one']])),
  }
  const journalFile = path.join(repo.storage, 'landing.json')
  const journal = new LandingJournal({
    read: async () => {
      const value: unknown = JSON.parse(await readFile(journalFile, 'utf8'))
      return value
    },
    write: async (record) => {
      await writeFileAtomically(journalFile, JSON.stringify(record), {
        sleep: () => Promise.resolve(),
      })
      const handle = await open(journalFile, 'r+')
      try {
        await handle.sync()
      } finally {
        await handle.close()
      }
    },
  })
  const validateTarget = vi.fn().mockResolvedValue(undefined)
  const access = landingFileAccess(repo.root, repo.staging, { validateTarget })
  const gitDirectory = await repo.staging.gitDirectory(repo.root)
  const deps: TeamLandingDeps = {
    windowInstanceId: 'window-one',
    canonicalRoot: canonicalPath,
    hasOpenLanding: async () => {
      try {
        const record = await journal.read(id)
        return record.status === 'open'
      } catch (error: unknown) {
        if (isMissingPath(error)) return false
        throw error
      }
    },
    snapshot: (root) => repo.staging.snapshot(root),
    checkIdentity: () => Promise.resolve('checks-one'),
    invalidate: vi.fn().mockResolvedValue(undefined),
    knownHolder: () => knownRepositoryHolder(repo.root, gitDirectory, 'window-one', []),
    takeLock: async (_root, id) => {
      const result = await takeIndexLock(
        gitDirectory,
        { landingId: id, windowInstanceId: 'window-one' },
        { now: Date.now, sleep: () => Promise.resolve(), waitMs: 0 },
      )
      return result.kind === 'taken' ? result.lease : null
    },
    defer: (_root, item) => repo.staging.landingBranch(repo.root, item.final, item.id, copy),
    confirmLanding: vi.fn().mockResolvedValue(true),
    confirmWithoutChecks: vi.fn().mockResolvedValue(false),
    prepare: (intent) => journal.prepare(intent),
    close: (intent, status, conflicts) => journal.close(intent, status, conflicts),
    replace: (_root, file) => access.replace(file.path, file.before, file.after),
    recover: (intent: LandingIntent) => journal.recover(intent, access),
    undo: (intent, taskId) => journal.undo(intent, taskId, access),
    authorizeRecovery: vi.fn().mockResolvedValue(true),
  }
  return {
    admission,
    copy,
    journal,
    journalFile,
    access,
    validateTarget,
    deps,
    landing: new TeamLanding(deps),
    gitDirectory,
  }
}
