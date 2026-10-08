import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  lstatSync,
  readdirSync,
  existsSync,
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { GIT_TIMEOUT_MS } from '../../src/shared/constants'
import { runTreeSync } from '../../src/host/processTree'
import { posixQuoted } from '../../src/core/shellQuote'
import { expectEnded } from './helpers/processes'
import { withoutCredentials } from '../../src/core/credentialEnvironment'
import { OrchestratorPlaybook } from '../../src/core/orchestration/playbook/policy'
import { moduleStates } from '../../src/core/orchestration/playbook/modules'
import { FAKE_PLAYBOOK_MODULE as MODULE } from './helpers/playbook/fakes'
import { policyFixture } from './playbookPolicyFixture'

const template = { directory: '' }
const ownedDirectories: string[] = []
const gitEnvironment = () => ({
  ...withoutCredentials(process.env),
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
})
beforeAll(() => {
  template.directory = mkdtempSync(path.join(tmpdir(), 'm116p-hook-template-'))
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: template.directory, env: gitEnvironment(), stdio: 'pipe' })
  git(['init', '--initial-branch=main'])
  writeFileSync(path.join(template.directory, 'file.txt'), 'baseline\n')
  git(['add', 'file.txt'])
  git(['commit', '-m', 'baseline'])
  git(['commit', '--allow-empty', '-m', 'second baseline'])
})
afterAll(() => {
  for (const directory of ownedDirectories) rmSync(directory, { recursive: true, force: true })
  if (template.directory) rmSync(template.directory, { recursive: true, force: true })
})

function repository(workspace: string) {
  const fixture = policyFixture(workspace)
  cpSync(template.directory, workspace, { recursive: true, preserveTimestamps: true })
  const env = gitEnvironment()
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: workspace, env, encoding: 'utf8', stdio: 'pipe' }).trim()
  const hook = (name: string, body: string) => {
    const file = path.join(workspace, '.git', 'hooks', name)
    writeFileSync(file, `#!/bin/sh\n${body}\n`)
    chmodSync(file, 0o755)
  }
  // A configured hook set must contain every hook the verifier requires.
  for (const name of ['pre-commit', 'commit-msg', 'pre-push']) hook(name, 'exit 0')
  const range = () => ({
    remote: 'origin',
    url: path.join(workspace, 'destination'),
    updates: [
      {
        localRef: 'refs/heads/main',
        localOid: git(['rev-parse', 'HEAD']),
        remoteRef: 'refs/heads/main',
        remoteOid: '0'.repeat(40),
      },
    ],
  })
  return {
    ...fixture,
    workspace,
    git,
    hook,
    range,
    shell: (command: string) =>
      execFileSync('sh', ['-c', command], { cwd: workspace, env, stdio: 'pipe' }),
  }
}

/** Real pinned Husky layout and committed bodies in an owned fixture. */
function huskyHooks(
  fixture: ReturnType<typeof repository>,
  directory: string,
  preCommitBody: string | undefined,
): string {
  const hooks = path.join(fixture.workspace, directory, '_')
  mkdirSync(hooks, { recursive: true })
  writeFileSync(path.join(hooks, 'h'), readFileSync(path.resolve('.husky/_/h')))
  for (const name of ['pre-commit', 'commit-msg', 'pre-push']) {
    const wrapper = path.join(hooks, name)
    writeFileSync(wrapper, readFileSync(path.resolve('.husky/_', name)))
    chmodSync(wrapper, 0o755)
    const body = name === 'pre-commit' ? preCommitBody : 'exit 0\n'
    if (body !== undefined) writeFileSync(path.join(fixture.workspace, directory, name), body)
  }
  fixture.git(['add', directory])
  fixture.git(['commit', '-n', '-m', 'native hook layout'])
  fixture.git(['config', 'core.hooksPath', `${directory}/_`])
  return hooks
}

function expectFailedCommit(policy: OrchestratorPlaybook, commit: string): void {
  expect(policy.getRecord()).toContainEqual(
    expect.objectContaining({
      kind: 'verification',
      value: expect.objectContaining({ commit, scope: 'commit', result: 'fail' }),
    }),
  )
}

function expectUnverifiedOutcome(
  before: ReturnType<OrchestratorPlaybook['finishWork']>,
  checked: ReturnType<OrchestratorPlaybook['verifyWork']>,
  marker: string,
): void {
  expect(before.note.code).toBe('unverifiedCommit')
  expect(checked.decision.kind).toBe('refuse')
  expect(checked.output).toContain(marker)
}

/** Real Git/hook setup is shared by the outcome and cleanup assertions. The
 * repository's default hook and test deadlines are unchanged. */
function scenario<T extends ReturnType<typeof repository>>(
  name: string,
  prepare: (fixture: ReturnType<typeof repository>) => T,
  check: (fixture: T) => void,
) {
  describe(name, () => {
    const state: { fixture?: T } = {}
    beforeAll(() => {
      const workspace = mkdtempSync(path.join(tmpdir(), 'm116p-hook-case-'))
      ownedDirectories.push(workspace)
      state.fixture = prepare(repository(workspace))
    })
    it(name, () => {
      if (!state.fixture) throw new Error('Fixture not prepared')
      check(state.fixture)
    })
    it('removes the isolated verification worktree', () => {
      if (!state.fixture) throw new Error('Fixture not prepared')
      expect(
        state.fixture.git(['worktree', 'list', '--porcelain']).match(/^worktree /gmu),
      ).toHaveLength(1)
    })
  })
}

const BYPASSES = [
  ['comment', '# harmless\ngit commit -n -m bypass'],
  [
    'backslash-newline',
    String.raw`gi\
t commit -n -m bypass`,
  ],
  ['xargs stdin', String.raw`printf "%s\n" -n | xargs git commit -m bypass`],
  ['rebase exec', 'git rebase --exec="git commit --allow-empty -n -m bypass" HEAD~1'],
  ['alias', "alias bypass='git commit -n -m bypass'\nbypass"],
  ['sh -c', 'sh -c "git commit -n -m bypass"'],
  ['env', 'env git commit -n -m bypass'],
] as const

for (const [name, command] of BYPASSES)
  scenario(
    `detects actual ${name} commits and refuses push/done with failing repository hooks`,
    (fixture) => {
      fixture.hook('pre-commit', 'echo fixture-hook-failure >&2; exit 1')
      const work = fixture.policy.beginWork(MODULE, ['refs/heads/main'])
      const before = fixture.git(['rev-parse', 'HEAD'])
      if (name !== 'rebase exec') {
        writeFileSync(path.join(fixture.workspace, 'file.txt'), `${name}\n`)
        fixture.git(['add', 'file.txt'])
      }
      fixture.shell(command)
      const commit = fixture.git(['rev-parse', 'HEAD'])
      const range = fixture.range()
      const unverified = fixture.policy.beforePush(work, range)
      const checked = fixture.policy.verifyWork(work, range)
      return { ...fixture, work, before, commit, rangeValue: range, unverified, checked }
    },
    (fixture) => {
      expect(fixture.commit).not.toBe(fixture.before)
      expect(fixture.unverified.kind).toBe('refuse')
      expect(fixture.checked.decision.note.code).toBe('hookVerificationFailed')
      expect(fixture.checked.output).toContain('fixture-hook-failure')
      const restarted = new OrchestratorPlaybook(fixture.options)
      expect(restarted.beforePush(fixture.work, fixture.rangeValue).kind).toBe('refuse')
      expect(restarted.finishWork(fixture.work).kind).toBe('refuse')
      expectFailedCommit(fixture.policy, fixture.commit)
      expect(moduleStates(fixture.policy.getRecord()).get(MODULE.id)?.strikes).toBe(1)
    },
  )

for (const target of ['completion', 'push'])
  scenario(
    `records passing receipts for a normal commit before ${target}`,
    (fixture) => {
      fixture.hook(
        'pre-commit',
        'test "$(git show :file.txt)" = checked && test -n "$(git diff --cached --name-only)"',
      )
      fixture.hook('commit-msg', 'grep -q approved "$1"')
      fixture.hook(
        'pre-push',
        'git diff --cached --quiet && test "$1" = origin && read local_ref local_oid remote_ref remote_oid && test "$local_ref" = refs/heads/main',
      )
      const work = fixture.policy.beginWork(MODULE, ['refs/heads/main'])
      writeFileSync(path.join(fixture.workspace, 'file.txt'), 'checked\n')
      fixture.git(['add', 'file.txt'])
      fixture.git(['commit', '-m', 'approved'])
      const range = fixture.range()
      const unverified = fixture.policy.beforePush(work, range)
      const checked = fixture.policy.verifyWork(work, target === 'push' ? range : undefined)
      return { ...fixture, work, rangeValue: range, unverified, checked }
    },
    (fixture) => {
      expect(fixture.unverified.note.code).toBe('unverifiedCommit')
      expect(fixture.checked.decision.kind).toBe('allow')
      expect(fixture.policy.finishWork(fixture.work).kind).toBe('allow')
      expect(fixture.policy.beforePush(fixture.work, fixture.rangeValue).kind).toBe(
        target === 'push' ? 'allow' : 'refuse',
      )
      const receipts = fixture.policy.getRecord().filter((record) => record.kind === 'verification')
      expect(receipts).toHaveLength(target === 'push' ? 2 : 1)
      expect(
        receipts.every(
          (record) => record.value.result === 'pass' && record.value.hookDigest.length === 64,
        ),
      ).toBe(true)
    },
  )

scenario(
  'missing even one commit receipt blocks push after real hook verification',
  (fixture) => {
    fixture.hook('pre-commit', 'exit 0')
    fixture.hook('pre-push', 'git diff --cached --quiet && echo pre-push-once')
    const work = fixture.policy.beginWork(MODULE, ['refs/heads/main'])
    for (const file of ['first.txt', 'second.txt']) {
      writeFileSync(path.join(fixture.workspace, file), file)
      fixture.git(['add', file])
      fixture.git(['commit', '-m', file])
    }
    const range = fixture.range()
    const checked = fixture.policy.verifyWork(work, range)
    return { ...fixture, work, rangeValue: range, checked }
  },
  (fixture) => {
    expect(fixture.checked.decision.kind).toBe('allow')
    expect(fixture.checked.output.match(/pre-push-once/gu)).toHaveLength(1)
    expect(
      fixture.policy.getRecord().filter((record) => record.kind === 'verification'),
    ).toHaveLength(3)
    fixture.tamper(
      fixture.policy
        .getRecord()
        .filter(
          (record) =>
            record.kind !== 'verification' ||
            record.value.commit === fixture.rangeValue.updates[0]!.localOid,
        ),
    )
    expect(fixture.policy.beforePush(fixture.work, fixture.rangeValue).kind).toBe('refuse')
    expect(fixture.policy.finishWork(fixture.work).kind).toBe('refuse')
  },
)

scenario(
  'a new work item cannot launder an earlier unverified commit',
  (fixture) => {
    fixture.hook('pre-commit', 'test "$(git show :file.txt)" != bad')
    fixture.policy.beginWork(MODULE, ['refs/heads/main'])
    writeFileSync(path.join(fixture.workspace, 'file.txt'), 'bad\n')
    fixture.git(['add', 'file.txt'])
    fixture.shell('git commit -n -m bypass')
    const badCommit = fixture.git(['rev-parse', 'HEAD'])
    const work = fixture.policy.beginWork(MODULE, ['refs/heads/main'])
    writeFileSync(path.join(fixture.workspace, 'file.txt'), 'good\n')
    fixture.git(['add', 'file.txt'])
    fixture.git(['commit', '-m', 'fixed tip'])
    const own = fixture.policy.verifyWork(work)
    const range = fixture.range()
    const checked = fixture.policy.verifyWork(work, range)
    return { ...fixture, work, badCommit, own, rangeValue: range, checked }
  },
  (fixture) => {
    expect(fixture.own.decision.kind).toBe('allow')
    expect(fixture.checked.decision.note.code).toBe('hookVerificationFailed')
    expect(fixture.policy.beforePush(fixture.work, fixture.rangeValue).kind).toBe('refuse')
    expect(fixture.policy.getRecord()).toContainEqual(
      expect.objectContaining({
        kind: 'verification',
        value: expect.objectContaining({
          commit: fixture.badCommit,
          scope: 'commit',
          result: 'fail',
        }),
      }),
    )
  },
)

for (const cause of ['executable', 'admission', 'changed'])
  scenario(
    `fails closed when hook verification is unavailable: ${cause}`,
    (fixture) => {
      fixture.hook('pre-commit', 'exit 0')
      const work = fixture.policy.beginWork(MODULE, ['refs/heads/main'])
      fixture.git(['commit', '--allow-empty', '-m', 'approved'])
      if (cause === 'executable')
        chmodSync(path.join(fixture.workspace, '.git/hooks/pre-commit'), 0o644)
      else if (cause === 'changed') fixture.hook('pre-commit', 'echo changed; exit 0')
      else
        fixture.options.hookAdmission.admit.mockImplementation((effect) => effect.kind !== 'hook')
      return { ...fixture, work, checked: fixture.policy.verifyWork(work) }
    },
    (fixture) => {
      expect(fixture.checked.decision.kind).toBe('refuse')
      expect(fixture.policy.finishWork(fixture.work).kind).toBe('refuse')
    },
  )

for (const name of ['pre-commit', 'commit-msg', 'pre-push'])
  scenario(
    `blocks hook-modified trees or failures: ${name}`,
    (fixture) => {
      fixture.hook(
        name,
        name === 'pre-commit'
          ? 'echo changed > file.txt; git add file.txt'
          : 'echo rejected >&2; exit 1',
      )
      const work = fixture.policy.beginWork(MODULE, ['refs/heads/main'])
      fixture.shell('git commit --allow-empty -n -m bypass')
      return { ...fixture, checked: fixture.policy.verifyWork(work, fixture.range()) }
    },
    (fixture) => {
      expect(fixture.checked.decision.kind).toBe('refuse')
    },
  )

scenario(
  'runs commit-msg on the exact original non-UTF8 message bytes',
  (fixture) => {
    fixture.hook('commit-msg', String.raw`printf 'message\377\n' | cmp - "$1"`)
    const work = fixture.policy.beginWork(MODULE, ['refs/heads/main'])
    fixture.shell(
      String.raw`printf 'message\377\n' | git -c i18n.commitEncoding=ISO-8859-1 commit --allow-empty -F -`,
    )
    return { ...fixture, checked: fixture.policy.verifyWork(work) }
  },
  (fixture) => {
    expect(fixture.checked.decision.kind).toBe('allow')
  },
)

scenario(
  'verifies a newly created root commit against an unborn index without leaving refs',
  (fixture) => {
    fixture.git(['checkout', '--orphan', 'fresh'])
    fixture.hook('pre-commit', 'git diff --cached --name-only | grep -q file.txt')
    const work = fixture.policy.beginWork(MODULE, ['refs/heads/fresh'])
    fixture.git(['commit', '-m', 'root'])
    return { ...fixture, work, checked: fixture.policy.verifyWork(work) }
  },
  (fixture) => {
    expect(fixture.checked.decision.kind).toBe('allow')
    expect(fixture.policy.finishWork(fixture.work).kind).toBe('allow')
    expect(fixture.git(['for-each-ref', '--format=%(refname)'])).not.toContain(
      'muse-playbook-verification',
    )
  },
)

scenario(
  'preserves relative configured hook wrappers without modifying repository hooks',
  (fixture) => {
    mkdirSync(path.join(fixture.workspace, '.husky', '_'), { recursive: true })
    const wrapper = path.join(fixture.workspace, '.husky', '_', 'pre-commit')
    writeFileSync(wrapper, '#!/bin/sh\nsh .husky/pre-commit\n')
    writeFileSync(path.join(fixture.workspace, '.husky', '_', 'h'), 'exit 0\n')
    for (const name of ['commit-msg', 'pre-push']) {
      const file = path.join(fixture.workspace, '.husky', '_', name)
      writeFileSync(file, '#!/bin/sh\nexit 0\n')
      chmodSync(file, 0o755)
      writeFileSync(path.join(fixture.workspace, '.husky', name), 'exit 0\n')
    }
    chmodSync(wrapper, 0o755)
    writeFileSync(
      path.join(fixture.workspace, '.husky', 'pre-commit'),
      'test "$(git show :file.txt)" = baseline\n',
    )
    fixture.git(['add', '.husky/pre-commit'])
    fixture.git(['commit', '-m', 'configured wrapper'])
    // Fixture configuration only; the lane/hub repository config is untouched.
    fixture.git(['config', 'core.hooksPath', '.husky/_'])
    const work = fixture.policy.beginWork(MODULE, ['refs/heads/main'])
    fixture.git(['commit', '--allow-empty', '-m', 'approved'])
    return { ...fixture, wrapper, checked: fixture.policy.verifyWork(work) }
  },
  (fixture) => {
    expect(fixture.checked.decision.kind).toBe('allow')
    expect(readFileSync(fixture.wrapper, 'utf8')).toBe('#!/bin/sh\nsh .husky/pre-commit\n')
  },
)

for (const target of ['branch', 'tag', 'notes', 'detached HEAD', 'worktree HEAD'] as const)
  scenario(
    `discovers unregistered ${target} commits before completion`,
    (fixture) => {
      fixture.hook('pre-commit', 'echo unregistered-hook-failure >&2; exit 1')
      const work = fixture.policy.beginWork(MODULE, ['refs/heads/main'])
      const commit = fixture.git(['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'unregistered'])
      if (target === 'detached HEAD') fixture.git(['checkout', '--detach', commit])
      else if (target === 'worktree HEAD') {
        const extra = path.join(fixture.workspace, 'extra')
        fixture.git(['worktree', 'add', '--detach', extra, commit])
      } else {
        const namespaces = { branch: 'heads', tag: 'tags', notes: 'notes' }
        fixture.git(['update-ref', `refs/${namespaces[target]}/unregistered`, commit])
      }
      const before = fixture.policy.finishWork(work)
      const checked = fixture.policy.verifyWork(work)
      if (target === 'worktree HEAD')
        fixture.git(['worktree', 'remove', '--force', path.join(fixture.workspace, 'extra')])
      return { ...fixture, work, commit, before, checked }
    },
    (fixture) => {
      expectUnverifiedOutcome(fixture.before, fixture.checked, 'unregistered-hook-failure')
      expect(fixture.policy.finishWork(fixture.work).kind).toBe('refuse')
      expectFailedCommit(fixture.policy, fixture.commit)
    },
  )

for (const namespace of ['worktree', 'bisect', 'rewritten'])
  for (const change of ['new', 'moved'])
    scenario(
      `discovers ${change} private refs/${namespace} commits in another worktree`,
      (fixture) => {
        const extra = path.join(fixture.workspace, 'extra tree')
        fixture.git(['worktree', 'add', '--detach', extra, 'HEAD'])
        const ref = `refs/${namespace}/bypass`
        if (change === 'moved') fixture.git(['-C', extra, 'update-ref', ref, 'HEAD'])
        fixture.hook('pre-commit', 'echo private-ref-hook-failure >&2; exit 1')
        const work = fixture.policy.beginWork(MODULE, ['refs/heads/main'])
        const head = fixture.git(['-C', extra, 'rev-parse', 'HEAD'])
        const commit = fixture.git([
          '-C',
          extra,
          'commit-tree',
          'HEAD^{tree}',
          '-p',
          'HEAD',
          '-m',
          'private bypass',
        ])
        fixture.git(['-C', extra, 'update-ref', ref, commit])
        expect(fixture.git(['-C', extra, 'rev-parse', 'HEAD'])).toBe(head)
        expect(fixture.git(['for-each-ref', '--format=%(objectname)'])).not.toContain(commit)
        const before = fixture.policy.finishWork(work)
        const checked = fixture.policy.verifyWork(work)
        fixture.git(['worktree', 'remove', '--force', extra])
        return { ...fixture, work, commit, before, checked }
      },
      (fixture) => {
        expectUnverifiedOutcome(fixture.before, fixture.checked, 'private-ref-hook-failure')
        expectFailedCommit(fixture.policy, fixture.commit)
        expect(new OrchestratorPlaybook(fixture.options).finishWork(fixture.work).kind).toBe(
          'refuse',
        )
      },
    )

for (const isConfigured of [false, true])
  scenario(
    `uses Git missing-hook behavior with configured hooks=${String(isConfigured)}`,
    (fixture) => {
      for (const hook of ['pre-commit', 'commit-msg', 'pre-push'])
        rmSync(path.join(fixture.workspace, '.git/hooks', hook))
      if (isConfigured) fixture.git(['config', 'core.hooksPath', '.missing-hooks'])
      const work = fixture.policy.beginWork(MODULE, ['refs/heads/main'])
      fixture.git(['commit', '--allow-empty', '-m', 'missing hooks'])
      return { ...fixture, checked: fixture.policy.verifyWork(work) }
    },
    (fixture) => {
      expect(fixture.checked.decision.kind).toBe(isConfigured ? 'refuse' : 'allow')
      if (isConfigured) expect(fixture.checked.output).toContain('cannot find a hook named')
    },
  )

for (const cause of ['HUSKY=0', 'missing dispatcher', 'missing hook'])
  scenario(
    `fails closed with real Husky wrappers: ${cause}`,
    (fixture) => {
      const hooks = huskyHooks(fixture, '.husky', 'echo husky-body-failure >&2; exit 1\n')
      const work = fixture.policy.beginWork(MODULE, ['refs/heads/main'])
      const commit = fixture.git(['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'bypass'])
      fixture.git(['update-ref', 'refs/heads/main', commit])
      if (cause.startsWith('missing')) {
        const file = path.join(hooks, cause === 'missing hook' ? 'pre-commit' : 'h')
        rmSync(file)
        // Capture the missing layout at work start as well: no digest-change
        // rejection may stand in for the missing-file guard under test.
        const nextWork = fixture.policy.beginWork(MODULE, ['refs/heads/main'])
        const next = fixture.git(['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'bypass again'])
        fixture.git(['update-ref', 'refs/heads/main', next])
        return { ...fixture, checked: fixture.policy.verifyWork(nextWork) }
      }
      try {
        vi.stubEnv('HUSKY', '0')
        return { ...fixture, checked: fixture.policy.verifyWork(work) }
      } finally {
        vi.unstubAllEnvs()
      }
    },
    (fixture) => {
      expect(fixture.checked.decision.kind).toBe('refuse')
      if (cause === 'HUSKY=0') expect(fixture.checked.output).toContain('husky-body-failure')
      else if (cause === 'missing hook')
        expect(fixture.checked.output).toContain('cannot find a hook named')
    },
  )

scenario(
  'second-scrubs outer verification admission errors',
  (fixture) => {
    const work = fixture.policy.beginWork(MODULE, ['refs/heads/main'])
    fixture.options.hookAdmission.admit.mockImplementation(() => {
      throw new Error('https://fixture-user:fixture-password@example.invalid/path')
    })
    const checked = fixture.policy.verifyWork(work)
    fixture.options.hookAdmission.admit.mockReturnValue(true)
    return { ...fixture, checked }
  },
  (fixture) => {
    expect(fixture.checked.decision.kind).toBe('refuse')
    expect(fixture.checked.output).not.toContain('fixture-password')
    expect(fixture.checked.output).toContain('[redacted]')
  },
)

scenario(
  'removes and prunes a worktree registered before post-checkout failure',
  (fixture) => {
    fixture.hook('post-checkout', 'echo partial-add-failure >&2; exit 1')
    const work = fixture.policy.beginWork(MODULE, ['refs/heads/main'])
    fixture.git(['commit', '--allow-empty', '-m', 'approved'])
    const checked = fixture.policy.verifyWork(work)
    return {
      ...fixture,
      checked,
      cleanupCommands: fixture.options.hookAdmission.admit.mock.calls.map(([effect]) =>
        effect.args.join(' '),
      ),
    }
  },
  (fixture) => {
    expect(fixture.checked.decision.kind).toBe('refuse')
    expect(fixture.checked.output).toContain('partial-add-failure')
    const args = fixture.cleanupCommands
    expect(args.some((command) => command.startsWith('worktree remove --force '))).toBe(true)
    expect(args).toContain('worktree prune')
  },
)

for (const target of ['annotated tag', 'deletion', 'mixed deletion and tag'] as const)
  scenario(
    `admits valid ${target} push ranges`,
    (fixture) => {
      fixture.hook('pre-push', 'echo native-pre-push; cat')
      const work = fixture.policy.beginWork(MODULE, ['refs/heads/main'])
      fixture.git(['tag', '-a', 'approved', '-m', 'approved'])
      const tag = {
        ...fixture.range().updates[0]!,
        localRef: 'refs/tags/approved',
        remoteRef: 'refs/tags/approved',
        localOid: fixture.git(['rev-parse', 'refs/tags/approved']),
      }
      const deletion = {
        ...fixture.range().updates[0]!,
        localRef: '(delete)',
        localOid: '0'.repeat(40),
        remoteOid: fixture.git(['rev-parse', 'HEAD']),
      }
      const updatesByTarget = {
        'annotated tag': [tag],
        deletion: [deletion],
        'mixed deletion and tag': [deletion, tag],
      }
      const range = { ...fixture.range(), updates: updatesByTarget[target] }
      return {
        ...fixture,
        work,
        rangeValue: range,
        checked: fixture.policy.verifyWork(work, range),
      }
    },
    (fixture) => {
      expect(fixture.checked.decision.kind).toBe('allow')
      expect(fixture.policy.beforePush(fixture.work, fixture.rangeValue).kind).toBe('allow')
      const push = fixture.policy
        .getRecord()
        .filter((record) => record.kind === 'verification' && record.value.scope === 'push')
      expect(push).toHaveLength(target === 'deletion' ? 0 : 1)
      if (target !== 'deletion')
        expect(push[0]).toMatchObject({
          value: { commit: fixture.git(['rev-parse', 'HEAD']), result: 'pass' },
        })
    },
  )

scenario(
  'allows a repository with no configured hook set',
  (fixture) => {
    for (const name of ['pre-commit', 'commit-msg', 'pre-push'])
      rmSync(path.join(fixture.workspace, '.git/hooks', name))
    const work = fixture.policy.beginWork(MODULE, ['refs/heads/main'])
    fixture.git(['commit', '--allow-empty', '-m', 'no hooks'])
    return { ...fixture, checked: fixture.policy.verifyWork(work) }
  },
  (fixture) => {
    expect(fixture.checked.decision.kind).toBe('allow')
  },
)

for (const hasRunner of [false, true])
  scenario(
    `requires Windows job containment before hook dispatch: ${String(hasRunner)}`,
    (fixture) => {
      const marker = path.join(fixture.workspace, 'post-checkout.marker')
      fixture.hook('post-checkout', `echo dispatched > "${marker.replaceAll('\\', '/')}"`)
      const work = fixture.policy.beginWork(MODULE, ['refs/heads/main'])
      fixture.git(['commit', '--allow-empty', '-m', 'approved'])
      const policy = hasRunner
        ? fixture.policy
        : new OrchestratorPlaybook({
            ...fixture.options,
            hookAdmission: { admit: fixture.options.hookAdmission.admit },
          })
      const platform = process.platform
      try {
        Object.defineProperty(process, 'platform', { value: 'win32' })
        vi.stubEnv('HUSKY', '0')
        vi.stubEnv('HUSKY_SKIP_HOOKS', '1')
        vi.stubEnv('GIT_CONFIG_COUNT', '1')
        vi.stubEnv('GIT_CONFIG_KEY_0', 'core.hooksPath')
        vi.stubEnv('GIT_CONFIG_VALUE_0', path.join(fixture.workspace, 'missing'))
        const checked = policy.verifyWork(work)
        const calls = fixture.options.hookAdmission.runContained.mock.calls.map(
          ([effect, options]) => ({ kind: effect.kind, args: effect.args, env: options.env }),
        )
        return {
          ...fixture,
          checked,
          marker,
          calls,
          sourceHooks: fixture.git(['rev-parse', '--path-format=absolute', '--git-path', 'hooks']),
        }
      } finally {
        vi.unstubAllEnvs()
        Object.defineProperty(process, 'platform', { value: platform })
      }
    },
    (fixture) => {
      expect(fixture.checked.decision.kind).toBe(hasRunner ? 'allow' : 'refuse')
      expect(existsSync(fixture.marker)).toBe(hasRunner)
      if (!hasRunner) return
      expect(
        fixture.calls.some(
          (call) =>
            call.kind === 'hook' &&
            call.args[0] === '-c' &&
            call.args[1]?.replaceAll('\\', '/') ===
              `core.hooksPath=${fixture.sourceHooks.replaceAll('\\', '/')}`,
        ),
      ).toBe(true)
      for (const call of fixture.calls) {
        expect(call.env).not.toHaveProperty('HUSKY')
        expect(call.env).not.toHaveProperty('HUSKY_SKIP_HOOKS')
        expect(call.env).not.toHaveProperty('GIT_CONFIG_COUNT')
        expect(call.env).not.toHaveProperty('GIT_CONFIG_KEY_0')
        expect(call.env).not.toHaveProperty('GIT_CONFIG_VALUE_0')
      }
    },
  )
for (const isDetached of [false, true])
  it(
    `ends every hook descendant on the production timeout: detached=${String(isDetached)}`,
    async () => {
      const workspace = mkdtempSync(path.join(tmpdir(), 'm116p-hook-timeout-'))
      ownedDirectories.push(workspace)
      const fixture = repository(workspace)
      const marker = path.join(workspace, 'hook-child.pid')
      const childScript = path.join(workspace, 'hook-child.cjs')
      const groupMarker = path.join(workspace, 'hook-group.pid')
      const parentMarker = path.join(workspace, 'hook-parent.pid')
      writeFileSync(
        childScript,
        `const cp = require('node:child_process'); const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(groupMarker)}, cp.execFileSync('/bin/ps', ['-o', 'pgid=', '-p', String(process.pid)], {encoding: 'utf8'})); fs.writeFileSync(${JSON.stringify(parentMarker)}, String(process.pid)); const child = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {detached: ${String(isDetached)}, stdio: 'ignore'}); fs.writeFileSync(${JSON.stringify(marker)}, String(child.pid)); setInterval(() => {}, 1000);`,
      )
      // Hook command text is fixture-only and quotes owned paths literally.
      fixture.hook('pre-commit', `${posixQuoted(process.execPath)} ${posixQuoted(childScript)}`)
      const policy = new OrchestratorPlaybook({
        ...fixture.options,
        hookAdmission: { admit: fixture.options.hookAdmission.admit },
      })
      const work = fixture.policy.beginWork(MODULE, ['refs/heads/main'])
      fixture.shell('git commit --allow-empty -n -m timeout')
      let descendant: number | undefined
      try {
        const checked = policy.verifyWork(work)
        expect(checked.decision.kind).toBe('refuse')
        if (process.platform === 'win32') {
          expect(existsSync(marker)).toBe(false)
          return
        }
        descendant = Number(readFileSync(marker, 'utf8'))
        await expectEnded(descendant)
        await expectEnded(Number(readFileSync(parentMarker, 'utf8')))
        expect(
          fixture.git(['worktree', 'list', '--porcelain']).match(/^worktree /gmu),
        ).toHaveLength(1)
      } finally {
        // The drill can disable tree cleanup. These markers own the exact
        // group and detached child, so no drill process can be left behind.
        if (existsSync(groupMarker)) {
          const group = Number(readFileSync(groupMarker, 'utf8').trim())
          if (group > 0) {
            try {
              process.kill(-group, 'SIGKILL')
            } catch {
              /* The owned group has already ended. */
            }
          }
        }
        if (descendant === undefined && existsSync(marker))
          descendant = Number(readFileSync(marker, 'utf8'))
        if (descendant !== undefined) {
          try {
            process.kill(descendant, 'SIGKILL')
          } catch {
            /* This owned fixture child has already ended. */
          }
        }
      }
      // This regression deliberately reaches the real 15-second Git deadline.
    },
    GIT_TIMEOUT_MS * 2,
  )

for (const directory of ['.husky', 'custom-hooks'])
  scenario(
    `records native Husky passing receipts: ${directory}`,
    (fixture) => {
      huskyHooks(fixture, directory, 'echo native-husky-pass\nexit 0\n')
      const policy =
        process.platform === 'win32'
          ? fixture.policy
          : new OrchestratorPlaybook({
              ...fixture.options,
              hookAdmission: {
                admit: fixture.options.hookAdmission.admit,
                // Keep metadata setup cheap; the actual hook uses the native
                // supervisor and Git, never a fabricated success result.
                runContained: (effect, options) =>
                  effect.kind === 'hook'
                    ? runTreeSync(effect.command, effect.args, options)
                    : fixture.options.hookAdmission.runContained(effect, options),
              },
            })
      const work = policy.beginWork(MODULE, ['refs/heads/main'])
      fixture.git(['commit', '--allow-empty', '-m', 'approved'])
      return { ...fixture, policy, work, checked: policy.verifyWork(work) }
    },
    (fixture) => {
      expect(fixture.checked.decision.kind).toBe('allow')
      expect(fixture.checked.output).toContain('native-husky-pass')
      expect(fixture.policy.finishWork(fixture.work).kind).toBe('allow')
      expect(fixture.policy.getRecord()).toContainEqual(
        expect.objectContaining({
          kind: 'verification',
          value: expect.objectContaining({ scope: 'commit', result: 'pass' }),
        }),
      )
    },
  )

for (const directory of ['.husky', 'custom-hooks'])
  scenario(
    `invalidates cached receipts when source hook bodies change: ${directory}`,
    (fixture) => {
      huskyHooks(fixture, directory, 'exit 0\n')
      const work = fixture.policy.beginWork(MODULE, ['refs/heads/main'])
      fixture.git(['commit', '--allow-empty', '-m', 'approved'])
      const checked = fixture.policy.verifyWork(work)
      writeFileSync(path.join(fixture.workspace, directory, 'pre-commit'), 'exit 1\n')
      return { ...fixture, checked, admission: fixture.policy.finishWork(work) }
    },
    (fixture) => {
      expect(fixture.checked.decision.kind).toBe('allow')
      expect(fixture.admission.kind).toBe('refuse')
    },
  )

for (const epoch of ['', 'playbook/source-hooks/v2'])
  scenario(
    `rejects cached passing receipts from prior hook runner: ${epoch || 'legacy'}`,
    (fixture) => {
      fixture.hook('pre-commit', 'echo legacy-skipped-body >&2; exit 1')
      const work = fixture.policy.beginWork(MODULE, ['refs/heads/main'])
      fixture.shell('git commit --allow-empty -n -m legacy')
      const commit = fixture.git(['rev-parse', 'HEAD'])
      // Reconstruct either published prior digest in this disposable repository.
      // Its config was empty; traversal order and mode/byte framing were public.
      const hooks = fixture.git(['rev-parse', '--path-format=absolute', '--git-path', 'hooks'])
      const hash = createHash('sha256').update(epoch)
      const entries = [hooks]
      while (entries.length > 0) {
        const entry = entries.pop()
        if (!entry) throw new Error('Missing fixture entry')
        const stat = lstatSync(entry)
        hash.update(path.relative(hooks, entry).replaceAll('\\', '/')).update(String(stat.mode))
        if (stat.isDirectory())
          entries.push(
            ...readdirSync(entry)
              .toSorted((a, b) => b.localeCompare(a))
              .map((name) => path.join(entry, name)),
          )
        else hash.update(readFileSync(entry))
      }
      const legacyDigest = hash.digest('hex')
      fixture.tamper([
        ...fixture.policy
          .getRecord()
          .map((record) =>
            record.kind === 'work' && record.value.id === work
              ? { ...record, value: { ...record.value, hookDigest: legacyDigest } }
              : record,
          ),
        {
          kind: 'verification',
          value: {
            workId: work,
            moduleId: MODULE.id,
            commit,
            hookDigest: legacyDigest,
            scope: 'commit',
            result: 'pass',
            at: 100,
          },
        },
      ])
      const before = fixture.policy.finishWork(work)
      return { ...fixture, before, checked: fixture.policy.verifyWork(work) }
    },
    (fixture) => {
      expect(fixture.before.kind).toBe('refuse')
      expect(fixture.checked.decision.kind).toBe('refuse')
    },
  )

scenario(
  'uses the native Husky startup exit verdict without interpreting its script',
  (fixture) => {
    huskyHooks(fixture, '.husky', 'echo husky-body-failure >&2; exit 1\n')
    const work = fixture.policy.beginWork(MODULE, ['refs/heads/main'])
    fixture.shell('git commit --allow-empty -n -m native-startup')
    const config = path.join(fixture.workspace, 'profile')
    mkdirSync(path.join(config, 'husky'), { recursive: true })
    writeFileSync(path.join(config, 'husky/init.sh'), 'export HUSKY=0\n')
    try {
      vi.stubEnv('XDG_CONFIG_HOME', config)
      return { ...fixture, checked: fixture.policy.verifyWork(work) }
    } finally {
      vi.unstubAllEnvs()
    }
  },
  (fixture) => {
    expect(fixture.checked.decision.kind).toBe('allow')
    expect(fixture.checked.output).not.toContain('husky-body-failure')
  },
)
