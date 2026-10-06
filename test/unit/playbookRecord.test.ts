import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PLAYBOOK_RECORD_MAX } from '../../src/shared/constants'
import {
  FilePlaybookJournal,
  retainRecords,
  validatedRecords,
} from '../../src/core/orchestration/playbook/journal'
import { OrchestratorPlaybook } from '../../src/core/orchestration/playbook/policy'
import { FAKE_PLAYBOOK_MODULE as MODULE } from './helpers/playbook/fakes'
import {
  answerAll,
  latestRound,
  policyFixture,
  REVIEW_AGENTS,
  reviewBlock,
  strike,
} from './playbookPolicyFixture'

const tempDirectories: string[] = []
afterEach(() => {
  for (const directory of tempDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

function diskJournal() {
  const directory = mkdtempSync(path.join(tmpdir(), 'm116-p-record-'))
  tempDirectories.push(directory)
  const workspace = path.join(directory, 'workspace')
  mkdirSync(workspace)
  const journal = new FilePlaybookJournal(path.join(directory, 'data'), workspace)
  return { directory, workspace, journal }
}

describe('M116 durable record', () => {
  it('roundtrips JSONL on disk, shares aliases, and recovers strikes after a new policy instance', () => {
    const { directory, workspace, journal } = diskJournal()
    const options = { ...policyFixture().options, journal, now: () => 100 }
    const policy = new OrchestratorPlaybook(options)
    strike(policy)
    const alias = path.join(directory, 'alias')
    symlinkSync(workspace, alias, process.platform === 'win32' ? 'junction' : 'dir')
    expect(new FilePlaybookJournal(path.join(directory, 'data'), alias).file).toBe(journal.file)
    expect(new OrchestratorPlaybook(options).beforeFixRound(MODULE).kind).toBe('refuse')
    expect(readFileSync(journal.file, 'utf8').trim().split('\n').length).toBeLessThanOrEqual(
      PLAYBOOK_RECORD_MAX,
    )
  })

  it('shares the journal across renamed lanes and Git worktrees via the common directory', () => {
    const { directory, workspace } = diskJournal()
    const common = path.join(workspace, '.git')
    mkdirSync(common)
    const worktree = path.join(directory, 'new-lane')
    mkdirSync(worktree)
    const gitDir = path.join(common, 'worktrees', 'new-lane')
    mkdirSync(gitDir, { recursive: true })
    writeFileSync(path.join(gitDir, 'commondir'), '../..\n')
    writeFileSync(path.join(worktree, '.git'), `gitdir: ${gitDir}\n`)
    const data = path.join(directory, 'data')
    const original = new FilePlaybookJournal(data, workspace)
    const other = new FilePlaybookJournal(data, worktree)
    expect(other.file).toBe(original.file)
    const options = {
      ...policyFixture().options,
      journal: original,
      teamId: 'original-lane',
      now: () => 100,
      authorizeOverride: () => false,
    }
    strike(new OrchestratorPlaybook(options))
    expect(
      new OrchestratorPlaybook({
        ...options,
        journal: other,
        teamId: 'new-branch-and-lane',
      }).beforeFixRound(MODULE).kind,
    ).toBe('refuse')
  })

  it('preserves the exact evidence inherited at a split when the parent answers later', () => {
    const fixture = policyFixture()
    fixture.policy.afterReview(MODULE, reviewBlock(), REVIEW_AGENTS)
    const child = {
      ...MODULE,
      id: 'child',
      key: 'src/child',
      files: ['src/child/a.ts'],
      lineage: { splitFrom: MODULE.id },
    }
    fixture.policy.declareModule(child)
    answerAll(fixture.policy)
    const record = fixture.policy.getRecord()
    const filler = record.find(
      (entry) => entry.kind === 'note' && entry.value.code === 'checksPassed',
    )!
    fixture.tamper(
      retainRecords([...Array.from({ length: PLAYBOOK_RECORD_MAX }, () => filler), ...record]),
    )
    expect(
      new OrchestratorPlaybook(fixture.options).beforeReview(child, REVIEW_AGENTS).note.code,
    ).toBe('answersPending')
  })

  it('rejects journal symlinks and recovery with conflicting reviewers or invalid prior ids', () => {
    const { directory, journal } = diskJournal()
    mkdirSync(path.dirname(journal.file), { recursive: true })
    const target = path.join(directory, 'other-file')
    writeFileSync(target, '{}\n')
    symlinkSync(target, journal.file)
    expect(() => journal.read()).toThrow()
    const fixture = policyFixture()
    fixture.policy.afterReview(MODULE, reviewBlock(), REVIEW_AGENTS)
    const records = fixture.policy.getRecord()
    for (const patch of [
      { reviewerId: REVIEW_AGENTS.implementerId },
      { reviewerSessionId: REVIEW_AGENTS.implementerSessionId },
      { answers: [{ findingId: 'unknown', status: 'fixed' }] },
      { round: 3 },
    ]) {
      fixture.tamper(
        records.map((record) =>
          record.kind === 'round' && record.value.class === undefined
            ? { ...record, value: { ...record.value, ...patch } }
            : record,
        ),
      )
      expect(() => new OrchestratorPlaybook(fixture.options)).toThrow()
    }
  })

  it('throws on malformed, truncated, unregistered-module and oversized history; no empty recovery', () => {
    const { journal } = diskJournal()
    mkdirSync(path.join(journal.file, '..'), { recursive: true })
    for (const text of [
      '{"kind":',
      '\n',
      '{"kind":"unknown"}\n',
      'null\n'.repeat(PLAYBOOK_RECORD_MAX + 1),
    ]) {
      writeFileSync(journal.file, text)
      expect(
        () =>
          new OrchestratorPlaybook({
            ...policyFixture().options,
            journal,
            teamId: 'panel',
            now: () => 100,
            authorizeOverride: () => false,
          }),
      ).toThrow()
    }
    const fixture = policyFixture()
    fixture.policy.afterReview(MODULE, reviewBlock(), REVIEW_AGENTS)
    fixture.tamper([{ kind: 'round', value: latestRound(fixture.policy) }])
    expect(() => new OrchestratorPlaybook(fixture.options)).toThrow()
  })

  it('refuses stale writers and an occupied lock without overwriting or deleting it', () => {
    const { journal } = diskJournal()
    const fixture = policyFixture()
    fixture.policy.beforeFixRound(MODULE)
    const records = fixture.policy.getRecord()
    journal.replace(records, [])
    expect(() => {
      journal.replace(records, [])
    }).toThrow()
    expect(journal.read()).toEqual(records)
    mkdirSync(`${journal.file}.lock`)
    expect(() => {
      journal.replace(records, records)
    }).toThrow()
    expect(readFileSync(journal.file, 'utf8')).toContain('module')
  })

  it('never returns an allow after publication fails, and reloads other teams writes', () => {
    const fixture = policyFixture()
    const other = new OrchestratorPlaybook({ ...fixture.options, teamId: 'other' })
    strike(other)
    expect(fixture.policy.beforeFixRound(MODULE).kind).toBe('refuse')
    vi.mocked(fixture.journal.replace).mockImplementationOnce(() => {
      throw new Error('Disk full')
    })
    expect(() =>
      fixture.policy.beforeCommand(
        { effect: 'read', subject: 'repo', kind: 'shell', command: 'git status' },
        { agentId: 'reader', teamId: 'panel' },
      ),
    ).toThrow('Disk full')
  })

  it('bounds retention without losing counters, identities, designs or safety refusals', () => {
    const fixture = policyFixture()
    strike(fixture.policy)
    fixture.policy.recordRefusal(
      { effect: 'push', subject: 'repo' },
      { agentId: 'lead', teamId: 'panel' },
      'classifier',
    )
    const record = fixture.policy.getRecord()
    const filler = record.find(
      (entry) => entry.kind === 'note' && entry.value.code === 'checksPassed',
    )!
    expect(() =>
      validatedRecords(Array.from({ length: PLAYBOOK_RECORD_MAX + 1 }, () => filler)),
    ).toThrow()
    const retained = retainRecords([
      ...Array.from({ length: PLAYBOOK_RECORD_MAX }, () => filler),
      ...record,
    ])
    expect(retained.length).toBe(PLAYBOOK_RECORD_MAX)
    fixture.tamper(retained)
    expect(fixture.policy.beforeFixRound(MODULE).kind).toBe('refuse')
    const refusal = record.find(
      (entry) => entry.kind === 'note' && entry.value.code === 'classifierBlocked',
    )!
    expect(() =>
      retainRecords(Array.from({ length: PLAYBOOK_RECORD_MAX + 1 }, () => refusal)),
    ).toThrow()
  })

  it('refuses empty publication, empty or unterminated disk history, and over-limit raw JSONL', () => {
    const { journal } = diskJournal()
    expect(() => {
      journal.replace([], [])
    }).toThrow()
    mkdirSync(path.dirname(journal.file), { recursive: true })
    for (const text of ['', '{}', 'null\n'.repeat(PLAYBOOK_RECORD_MAX + 1)]) {
      writeFileSync(journal.file, text)
      expect(() => journal.read()).toThrow()
    }
  })

  it('does not expose malformed journal text in a parser exception', () => {
    const { journal } = diskJournal()
    mkdirSync(path.dirname(journal.file), { recursive: true })
    const text = 'LLM_' + 'A'.repeat(32)
    writeFileSync(journal.file, `${text}\n`)
    let failure: unknown
    try {
      journal.read()
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    if (!(failure instanceof Error)) throw new Error('Expected refusal')
    expect(failure.message).not.toContain('LLM_')
    expect(failure.cause).toBeUndefined()
  })

  it('second-scrubs every free-text field on publication and recovery, and returns detached records', () => {
    const fixture = policyFixture()
    fixture.policy.afterReview(MODULE, reviewBlock('docs', 'P3'), REVIEW_AGENTS)
    const findingId = latestRound(fixture.policy).findings[0]!.id
    const secret = 'LLM_' + 'A'.repeat(32)
    fixture.policy.answerFindings(MODULE, [
      { findingId, status: 'disputed', reason: `The owner stated ${secret}.` },
    ])
    expect(JSON.stringify(fixture.policy.getRecord())).not.toContain(secret)
    const record = fixture.policy.getRecord()
    const last = record.findLast((entry) => entry.kind === 'round')!
    last.value.answers[0] = { findingId, status: 'disputed', reason: secret }
    expect(JSON.stringify(validatedRecords(record))).not.toContain(secret)
    expect(JSON.stringify(fixture.policy.getRecord())).not.toContain(secret)
    expect(answerAll(fixture.policy).kind).toBe('allow')
  })
})
