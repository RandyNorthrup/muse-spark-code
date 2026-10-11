import { vi } from 'vitest'
import type { PlaybookDecision, PlaybookWhyNote } from '../../../src/shared/playbook'
import {
  PlaybookIntegration,
  type PlaybookWork,
} from '../../../src/core/orchestration/playbookIntegration'
import {
  PanelPlaybook,
  type PanelPlaybookRegistry,
} from '../../../src/core/orchestration/panelPlaybook'
import { policyFixture, REVIEW_AGENTS } from '../playbookPolicyFixture'
import { FAKE_PLAYBOOK_MODULE, FakePlaybookBoard } from './playbook/fakes'

export function integrationFixture() {
  const fixture = policyFixture()
  const board = new FakePlaybookBoard()
  const events = {
    note: vi.fn<(note: PlaybookWhyNote) => void>(),
    offerRedesign: vi.fn(),
    hookOutput: vi.fn(),
    failure: vi.fn(),
  }
  const integration = new PlaybookIntegration(fixture.policy, board, events)
  const work: PlaybookWork = {
    id: 'panel-dispatch-1',
    module: structuredClone(FAKE_PLAYBOOK_MODULE),
    refs: ['refs/heads/implementation'],
    requester: { agentId: 'lead', teamId: 'panel' },
    brief: {
      objective: 'Implement # claim',
      scope: ['src/core/schedules/store.ts'],
      acceptance: ['The claim is atomic'],
      baseCommit: 'a'.repeat(40),
    },
    commands: [
      {
        kind: 'edit',
        paths: FAKE_PLAYBOOK_MODULE.files,
        effect: 'write',
        subject: FAKE_PLAYBOOK_MODULE.files[0]!,
      },
    ],
  }
  const registry: PanelPlaybookRegistry = {
    dispatch: vi.fn(() => work),
    review: vi.fn(() => ({ module: work.module, agents: REVIEW_AGENTS })),
    reviewParts: vi.fn<PanelPlaybookRegistry['reviewParts']>((parts) => parts),
    waitForCompletion: vi.fn(() => Promise.resolve()),
    stopReview: vi.fn(),
    recordDispatch: vi.fn(),
    snapshotRepositoryConfig: vi.fn(() => 'configuration-digest'),
    recordRepositoryDrift: vi.fn(),
  }
  const allowed: PlaybookDecision = {
    kind: 'allow',
    note: { rule: 'neverAround', code: 'checksPassed', needsUser: false, at: 100 },
  }
  // These tests isolate the integration's calls. Native Git verdicts are covered
  // separately by playbookOutcomes.test.ts; no production stand-in is installed.
  const begin = vi.spyOn(fixture.policy, 'beginWork').mockReturnValue('work-1')
  const verify = vi
    .spyOn(fixture.policy, 'verifyWork')
    .mockReturnValue({ decision: allowed, output: '' })
  const finish = vi.spyOn(fixture.policy, 'finishWork').mockReturnValue(allowed)
  const push = vi.spyOn(fixture.policy, 'beforePush').mockReturnValue(allowed)
  return {
    ...fixture,
    integration,
    panel: new PanelPlaybook(integration, registry),
    board,
    work,
    registry,
    events,
    begin,
    verify,
    finish,
    push,
  }
}
