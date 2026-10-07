import { describe, expect, it } from 'vitest'
import { PLAYBOOK_LAUNDER_WINDOW_MS } from '../../src/shared/constants'
import { OrchestratorPlaybook } from '../../src/core/orchestration/playbook/policy'
import { FakePlaybookDelegate } from './helpers/playbook/fakes'
import { policyFixture } from './playbookPolicyFixture'

const REQUESTER = { agentId: 'lead', teamId: 'team' }
const DELEGATE = { agentId: 'delegate', teamId: 'other-team' }
const ACTION = { effect: 'push', subject: 'repo:main' }
const COMMAND = { ...ACTION, kind: 'shell' as const, command: 'git push origin main' }

describe('M116 advisory hook warning and durable refusal guard', () => {
  it.each([
    'git commit --no-verify',
    'git commit -n',
    'git commit -an -m sample',
    'git push --no-verify',
    'git merge --no-verify',
    'git rebase --no-verify',
    'git am --no-verify',
    'git cherry-pick --no-verify',
    'git revert --no-verify',
    'git -ccore.hooksPath=empty commit',
    'git -c hook.pre-commit.command=true commit',
    'env HUSKY=0 git commit',
    'export HUSKY=0; git commit',
    'git commit --no-v',
    'git status\ngit commit -n',
    'git -c core.hooksPath=/tmp/empty commit',
    'git -c "core.hooksPath=/tmp/empty" commit',
    'git config core.hooksPath empty',
    'git config --local core.hooksPath empty',
    "git config core.'hooksPath' empty",
    'HUSKY=0 git commit',
    'rm .husky/pre-commit',
  ])('refuses hook tampering: %s', (command) => {
    const { policy } = policyFixture()
    expect(policy.beforeCommand({ ...COMMAND, command }, REQUESTER)).toMatchObject({
      kind: 'refuse',
      note: { code: 'hookTampering', needsUser: true },
    })
    expect(JSON.stringify(policy.getRecord())).not.toContain(command)
  })
  it.each([
    'git commit -am sample',
    'git commit -m "-n"',
    'git push -n',
    'git merge -n',
    'git rebase -n',
    'git status && git diff',
    'env LANG=C git status',
    'xargs -n1 git status',
    'sh -c "git status"',
    'git -c "alias.safe=status" safe',
  ])('admits parsed positive control: %s', (command) => {
    const { policy } = policyFixture()
    expect(policy.beforeCommand({ ...COMMAND, command }, REQUESTER).kind).toBe('allow')
  })
  it.each(['.husky/pre-commit', 'repo/.husky/_/pre-commit', String.raw`C:\repo\.husky\pre-commit`])(
    'refuses edits to %s',
    (path) => {
      const { policy } = policyFixture()
      expect(
        policy.beforeCommand({ ...ACTION, kind: 'edit', paths: [path] }, REQUESTER).note.code,
      ).toBe('hookTampering')
    },
  )
  it('refuses skipped gates and shell skip flags, while admitting ordinary commands and similarly named paths', () => {
    const { policy } = policyFixture()
    expect(
      policy.beforeCommand({ ...ACTION, kind: 'gate', gate: 'quality', skip: true }, REQUESTER).note
        .code,
    ).toBe('gateSkipped')
    expect(
      policy.beforeCommand({ ...COMMAND, command: 'runner --skip-gates' }, REQUESTER).kind,
    ).toBe('refuse')
    expect(
      policy.beforeCommand({ ...COMMAND, effect: 'read', command: 'git status' }, REQUESTER).kind,
    ).toBe('allow')
    expect(
      policy.beforeCommand(
        { ...ACTION, effect: 'edit', kind: 'edit', paths: ['src/husky.ts'] },
        REQUESTER,
      ).kind,
    ).toBe('allow')
  })
  it('blocks delegated and same-agent retries by effect and subject across teams and restart', () => {
    const fixture = policyFixture()
    expect(
      new FakePlaybookDelegate(fixture.policy).reask(COMMAND, REQUESTER, DELEGATE),
    ).toMatchObject({ kind: 'refuse', note: { code: 'permissionLaundering', needsUser: true } })
    const policy = new OrchestratorPlaybook(fixture.options)
    expect(
      policy.beforeCommand({ ...COMMAND, command: 'another-tool push main' }, REQUESTER).kind,
    ).toBe('refuse')
    expect(policy.beforeCommand({ ...COMMAND, subject: 'repo:other' }, DELEGATE).kind).toBe('allow')
    expect(policy.beforeCommand({ ...COMMAND, effect: 'read' }, DELEGATE).kind).toBe('allow')
    fixture.advance(PLAYBOOK_LAUNDER_WINDOW_MS - 1)
    expect(policy.beforeCommand(COMMAND, DELEGATE).kind).toBe('refuse')
    fixture.advance(1)
    expect(policy.beforeCommand(COMMAND, DELEGATE).kind).toBe('allow')
  })
  it('keeps classifier blocks forever, including after a later permission refusal', () => {
    const fixture = policyFixture()
    new FakePlaybookDelegate(fixture.policy).reask(COMMAND, REQUESTER, DELEGATE, 'classifier')
    fixture.advance(PLAYBOOK_LAUNDER_WINDOW_MS * 2)
    fixture.policy.recordRefusal(COMMAND, REQUESTER, 'permission')
    expect(
      new OrchestratorPlaybook(fixture.options).beforeCommand(COMMAND, DELEGATE),
    ).toMatchObject({ kind: 'refuse', note: { code: 'classifierBlocked', needsUser: true } })
  })
  it('retains policy safety refusals across restart and a different tool or agent', () => {
    const fixture = policyFixture()
    const action = { effect: 'skip-gate', subject: 'quality' }
    expect(
      fixture.policy.beforeCommand(
        { ...action, kind: 'gate', gate: 'quality', skip: true },
        REQUESTER,
      ).kind,
    ).toBe('refuse')
    const restarted = new OrchestratorPlaybook(fixture.options)
    expect(
      restarted.beforeCommand({ ...action, kind: 'shell', command: 'delegate quality' }, DELEGATE),
    ).toMatchObject({ kind: 'refuse', note: { code: 'permissionLaundering' } })
    expect(
      restarted.beforeCommand(
        { ...action, subject: 'other', kind: 'shell', command: 'delegate quality' },
        DELEGATE,
      ).kind,
    ).toBe('allow')
  })
  it('does not expose subjects, commands or credentials in refusal history', () => {
    const { policy } = policyFixture()
    const subject = 'LLM_' + 'A'.repeat(32)
    policy.recordRefusal({ ...ACTION, subject }, REQUESTER, 'permission')
    expect(JSON.stringify(policy.getRecord())).not.toContain(subject)
  })
})
