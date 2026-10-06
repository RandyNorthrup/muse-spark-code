import { onTestFinished, vi } from 'vitest'
import { spawnSync, type SpawnSyncOptions } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { PLAYBOOK_FINDING_CLASSES } from '../../src/shared/constants'
import type {
  PlaybookDesignDecision,
  PlaybookLease,
  PlaybookModule,
  PlaybookRecord,
  PlaybookReviewAgents,
  PlaybookRound,
} from '../../src/shared/playbook'
import type { ReviewBlock } from '../../src/shared/reviewFindings'
import { OrchestratorPlaybook } from '../../src/core/orchestration/playbook/policy'
import type { PlaybookHookEffect } from '../../src/core/orchestration/playbook/outcomes'
import type { PlaybookJournal } from '../../src/core/orchestration/playbook/journal'
import { FAKE_PLAYBOOK_MODULE } from './helpers/playbook/fakes'

export const REVIEW_AGENTS: PlaybookReviewAgents = {
  implementerId: 'implementer',
  reviewerId: 'reviewer',
  implementerSessionId: 'implementation-session',
  reviewerSessionId: 'review-session',
}

export function policyFixture(inputWorkspace?: string) {
  const workspaceFolder = inputWorkspace ?? mkdtempSync(path.join(tmpdir(), 'm116p-policy-'))
  if (inputWorkspace === undefined)
    onTestFinished(() => {
      rmSync(workspaceFolder, { recursive: true, force: true })
    })
  let records: readonly unknown[] = []
  let now = 100
  const authority = vi.fn(() => false)
  const journal: PlaybookJournal = {
    read: () => structuredClone(records),
    replace: vi.fn((next: readonly PlaybookRecord[], expected: readonly unknown[]) => {
      if (JSON.stringify(records) !== JSON.stringify(expected)) throw new Error('Stale journal')
      records = structuredClone(next)
    }),
  }
  const options = {
    journal,
    workspaceFolder,
    teamId: 'panel',
    laneId: 'panel',
    hookAdmission: {
      admit: vi.fn((_effect: PlaybookHookEffect) => true),
      // Containment is a test double for short fixture hooks on Windows;
      // production adapters must use their prepared job/tree registry.
      runContained: vi.fn((effect: PlaybookHookEffect, spawnOptions: SpawnSyncOptions) =>
        spawnSync(effect.command, [...effect.args], { ...spawnOptions, encoding: 'buffer' }),
      ),
    },
    now: () => now,
    authorizeOverride: authority,
    drillRequirements: { guards: vi.fn(() => ['rounds']) },
    checkAdmission: { admit: vi.fn(() => true) },
  }
  const policy = new OrchestratorPlaybook(options)
  return {
    policy,
    journal,
    authority,
    options,
    advance: (ms: number) => {
      now += ms
    },
    tamper: (next: readonly unknown[]) => {
      records = structuredClone(next)
    },
  }
}

export function reviewBlock(
  className: string | undefined = 'concurrency',
  severity = 'P2',
): ReviewBlock {
  return {
    findings: [
      {
        file: FAKE_PLAYBOOK_MODULE.files[0]!,
        title: 'An actual finding',
        severity,
        ...(className && { class: className }),
      },
    ],
    coverage: [...PLAYBOOK_FINDING_CLASSES],
  }
}

export function latestRound(
  policy: OrchestratorPlaybook,
  module: PlaybookModule = FAKE_PLAYBOOK_MODULE,
): PlaybookRound {
  const record = policy
    .getRecord()
    .findLast(
      (entry) =>
        entry.kind === 'round' &&
        entry.value.class === undefined &&
        entry.value.module.id === module.id,
    )
  if (record?.kind !== 'round') throw new Error('Expected recorded round')
  return record.value
}

export function answerAll(
  policy: OrchestratorPlaybook,
  module: PlaybookModule = FAKE_PLAYBOOK_MODULE,
) {
  return policy.answerFindings(
    module,
    latestRound(policy, module).findings.map((finding) => ({
      findingId: finding.id,
      status: 'fixed',
    })),
  )
}

export function strike(
  policy: OrchestratorPlaybook,
  module: PlaybookModule = FAKE_PLAYBOOK_MODULE,
): void {
  for (let round = 0; round < 3; round += 1) {
    completeReview(policy, module, reviewBlock(), REVIEW_AGENTS)
    answerAll(policy, module)
  }
}

export function design(module: PlaybookModule = FAKE_PLAYBOOK_MODULE): PlaybookDesignDecision {
  return {
    id: 'atomic-claim',
    module,
    failureClass: 'concurrency',
    whyPatchesFailed: 'Each patch retained a multi-step claim.',
    structuralChange: 'Replace the read and write with one atomic claim.',
    planLocation: 'PLAN.md#D96',
    redesignLane: 'R',
    outcome: 'pending',
    at: 100,
  }
}

/** Exercise the real admission/completion protocol rather than forge tokens. */
export function completeReview(
  policy: OrchestratorPlaybook,
  module: PlaybookModule,
  input: ReviewBlock,
  agents: PlaybookReviewAgents,
  token?: PlaybookLease,
) {
  const admission = policy.beforeReview(module, agents, token)
  return admission.kind === 'refuse'
    ? admission
    : policy.afterReview(module, input, agents, admission.lease)
}
