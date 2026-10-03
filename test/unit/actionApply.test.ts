// M80 lane C: the apply sub-action (SPEC §6.6, G25). A real proposal is made
// by the run owner with the fake agent, copied into an apply invocation as
// the download step would, then prepared and pushed against a local bare
// origin with a lease on the exact head. Mismatched digests, heads, runs and
// missing patches refuse; no proposal script runs in push (only Git), and no
// planted or inherited Git program runs.

import { copyFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyProposal, checkPullForPush } from '../../action/apply/lib/apply.mjs'
import { childEnvironment } from '../../action/lib/lifecycle.mjs'
import { runProposal } from '../../action/lib/run-exec.mjs'
import captures from '../action/captures.json'
import {
  allocate,
  completedResult,
  gitPath,
  jsonFetch,
  NODE,
  plainGit,
  preparedRun,
  PROCESS_SUITE,
  SENTINEL,
  sentinelHits,
  tempLayout,
  TEST_TOKEN,
  testOwner,
  type FixtureRepo,
  type TempLayout,
} from './helpers/actionFixtures'

const REPO = captures.repository.full_name

function openPull(repo: FixtureRepo, headSha = repo.head) {
  return {
    number: 72,
    state: 'open',
    head: { sha: headSha, ref: 'feature', repo: { full_name: REPO } },
  }
}

describe('the apply sub-action (G25)', PROCESS_SUITE, () => {
  let layout: TempLayout
  beforeEach(() => {
    layout = tempLayout()
  })
  afterEach(() => {
    layout.cleanup()
  })

  /** A published proposal from a real run, and the apply side ready to use it. */
  async function proposal() {
    const run = await preparedRun(layout, {
      mode: 'fix',
      exec: {
        result: completedResult(),
        writes: [
          { path: 'notes.txt', text: 'first\nsecond\nproposed\n' },
          { path: '.gitattributes', text: '* filter=evil\n' },
        ],
      },
    })
    const report = await runProposal(run.input)
    await run.test.owner.cleanup()
    expect(report.patchPublished).toBe(true)
    return { run, artifactName: `muse-spark-${run.input.identity.invocation}` }
  }

  function applySide(
    repo: FixtureRepo,
    source: ActionPaths,
    parentEnv: Record<string, string | undefined> = process.env,
  ) {
    const paths = allocate(layout, 'apply')
    copyFileSync(source.patch, path.join(paths.download, 'fix.patch'))
    copyFileSync(source.manifest, path.join(paths.download, 'manifest.json'))
    const test = testOwner(paths)
    const children: string[] = []
    const owner = new Proxy(test.owner, {
      get(target, property, receiver): unknown {
        if (property === 'child') {
          return (input: Parameters<LauncherOwner['child']>[0]) => {
            children.push(input.file)
            return target.child(input)
          }
        }
        return Reflect.get(target, property, receiver)
      },
    })
    const baseEnv = childEnvironment({
      platform: process.platform,
      parentEnv,
      paths,
      nodePath: NODE,
    })
    return { paths, test, owner, children, baseEnv, repo }
  }

  async function apply(
    side: ReturnType<typeof applySide>,
    mode: 'prepare' | 'push',
    artifactName: string,
    pull?: unknown,
  ) {
    return await applyProposal({
      owner: side.owner,
      paths: side.paths,
      git: gitPath(layout),
      mode,
      artifactName,
      runId: '4242',
      repository: REPO,
      githubToken: TEST_TOKEN,
      fetch: jsonFetch(pull ?? openPull(side.repo)),
      apiUrl: 'https://api.example.test',
      remote: side.repo.bare,
      baseEnv: side.baseEnv,
    })
  }

  it('prepares the exact patch on the exact head, then pushes it with a lease', async () => {
    const { run, artifactName } = await proposal()
    const prepare = applySide(run.repo, run.paths)
    expect(await apply(prepare, 'prepare', artifactName)).toEqual({ ready: true, commitSha: null })
    expect(plainGit(layout, prepare.paths.checkout, ['diff', '--cached', '--name-only'])).toBe(
      '.gitattributes\nnotes.txt',
    )
    await prepare.test.owner.cleanup()

    const push = applySide(run.repo, run.paths)
    const pushed = await apply(push, 'push', artifactName)
    expect(pushed.ready).toBe(true)
    expect(plainGit(layout, run.repo.bare, ['rev-parse', 'refs/heads/feature'])).toBe(
      pushed.commitSha,
    )
    expect(plainGit(layout, run.repo.bare, ['rev-parse', `${pushed.commitSha ?? ''}^`])).toBe(
      run.repo.head,
    )
    expect(new Set(push.children)).toEqual(new Set([gitPath(layout)]))
    expect(sentinelHits(layout)).toEqual([])
    await push.test.owner.cleanup()
  })

  it('refuses a changed digest, a missing patch, another run and a malformed manifest before any Git', async () => {
    const { run, artifactName } = await proposal()
    // [case, downloaded file to overwrite (or none), its new content, artifact, refusal]
    const cases: [string, string | null, string, string, RegExp][] = [
      ['digest', 'fix.patch', 'changed', artifactName, /digest/],
      ['no patch', 'fix.patch', '', artifactName, /empty/],
      ['other artifact', null, '', 'muse-spark-1-1-x-0000000000000000', /does not belong/],
      ['manifest', 'manifest.json', '{"headSha":"x"}', artifactName, /malformed/],
    ]
    for (const [name, file, content, artifact, expected] of cases) {
      const side = applySide(run.repo, run.paths)
      if (file !== null) writeFileSync(path.join(side.paths.download, file), content)
      await expect(apply(side, 'prepare', artifact), name).rejects.toThrow(expected)
      expect(side.children, name).toEqual([])
      await side.test.owner.cleanup()
    }
  })

  it('push refuses a head that moved (API) and a lease that no longer holds (origin)', async () => {
    const { run, artifactName } = await proposal()
    const moved = applySide(run.repo, run.paths)
    await expect(
      apply(moved, 'push', artifactName, openPull(run.repo, run.repo.base)),
    ).rejects.toThrow(/head changed/)
    expect(moved.children).toEqual([])
    await moved.test.owner.cleanup()
    const closed = applySide(run.repo, run.paths)
    await expect(
      apply(closed, 'push', artifactName, { ...openPull(run.repo), state: 'closed' }),
    ).rejects.toThrow(/not open/)
    await closed.test.owner.cleanup()

    const racer = path.join(layout.root, 'racer')
    plainGit(layout, layout.root, ['clone', '--quiet', '--branch', 'feature', run.repo.bare, racer])
    writeFileSync(path.join(racer, 'race.txt'), 'someone else\n')
    plainGit(layout, racer, ['add', '--all'])
    plainGit(layout, racer, ['commit', '--quiet', '-m', 'race'])
    plainGit(layout, racer, ['push', '--quiet', 'origin', 'feature'])
    const raced = plainGit(layout, run.repo.bare, ['rev-parse', 'refs/heads/feature'])
    const leased = applySide(run.repo, run.paths)
    await expect(apply(leased, 'push', artifactName)).rejects.toThrow(/git push failed/)
    expect(plainGit(layout, run.repo.bare, ['rev-parse', 'refs/heads/feature'])).toBe(raced)
    await leased.test.owner.cleanup()
  })

  it('runs no inherited or planted Git program while preparing and pushing', async () => {
    const { run, artifactName } = await proposal()
    const command = `"${NODE.replaceAll('\\', '/')}" "${SENTINEL.replaceAll('\\', '/')}" "${layout.sentinels.replaceAll('\\', '/')}"`
    const hostile = {
      ...process.env,
      GIT_CONFIG_COUNT: '3',
      GIT_CONFIG_KEY_0: 'core.fsmonitor',
      GIT_CONFIG_VALUE_0: `${command} fsmonitor`,
      GIT_CONFIG_KEY_1: 'filter.evil.smudge',
      GIT_CONFIG_VALUE_1: `${command} filter-smudge`,
      GIT_CONFIG_KEY_2: 'gpg.program',
      GIT_CONFIG_VALUE_2: `${command} gpg`,
      GIT_CONFIG_PARAMETERS: "'commit.gpgsign'='true'",
    }
    const side = applySide(run.repo, run.paths, hostile)
    const contaminated = {
      ...side,
      baseEnv: {
        ...side.baseEnv,
        ...Object.fromEntries(Object.entries(hostile).filter(([name]) => name.startsWith('GIT_'))),
      },
    }
    const pushed = await apply(contaminated, 'push', artifactName)
    expect(pushed.ready).toBe(true)
    expect(sentinelHits(layout)).toEqual([])
    await side.test.owner.cleanup()
  })

  it('reads the pull request head ref only after validating it', () => {
    expect(
      checkPullForPush(
        { state: 'open', head: { sha: 'a', ref: 'feature/x', repo: { full_name: REPO } } },
        REPO,
        'a',
      ),
    ).toBe('feature/x')
    expect(() =>
      checkPullForPush(
        { state: 'open', head: { sha: 'a', ref: '-x', repo: { full_name: REPO } } },
        REPO,
        'a',
      ),
    ).toThrow(/ref/)
    expect(() =>
      checkPullForPush(
        { state: 'open', head: { sha: 'a', ref: 'x', repo: { full_name: 'fork/x' } } },
        REPO,
        'a',
      ),
    ).toThrow(/not open/)
  })
})
