import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
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
      expect(fixture.policy.getRecord()).toContainEqual(
        expect.objectContaining({
          kind: 'verification',
          value: expect.objectContaining({
            commit: fixture.commit,
            scope: 'commit',
            result: 'fail',
          }),
        }),
      )
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
