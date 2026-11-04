// A governed git that could not run at all (CC-WINLAND2). Callers read a TeamGitError as an answer
// about the repository, so a launch that never ran must not become one: it told the merge card a
// ref had moved, and exec and ACP recovery that a landing could not be read. The governor is
// configured with neither the created-path helper nor the Windows job, as a damaged installation
// has it, and the launch fails for real. Real git, the real engine ports.
import { realpath } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { configureResources } from '../../src/core/resources/admission'
import { isGovernedRefusal } from '../../src/core/resources/launch'
import { isTeamGitError } from '../../src/core/team/teamGit'
import { processTeamGit } from '../../src/core/team/workers/workerOpsEntry'
import { isNativeHelperError } from '../../src/shared/nativeHelperError'
import { landingFixturesIn } from './helpers/teamLander'
import { landingTask, productLandingPorts } from './helpers/teamLandingFixture'

const state: { dispose?: () => void } = {}
beforeAll(() => {
  state.dispose = configureResources({ inspect: () => ({}), onError: () => undefined })
})
afterAll(() => {
  state.dispose?.()
})

async function failureOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work
    return undefined
  } catch (error: unknown) {
    return error
  }
}

/** POSIX misses the created-path helper; Windows has no job to launch under. */
const isLauncherFailure = (failure: unknown): boolean =>
  isNativeHelperError(failure) || isGovernedRefusal(failure)

describe('a governed git that could not run', () => {
  const fixtureFor = landingFixturesIn('asCreated')

  it('is no git failure, and keeps its own type and words', async () => {
    const fixture = await fixtureFor('task-unrun')
    // One that writes: a read owns no temp root, so on POSIX it needs no such helper and still runs.
    const failure = await failureOf(
      processTeamGit(process.platform)(['hash-object', '-w', '--stdin'], fixture.root, 'bytes'),
    )
    expect(isTeamGitError(failure)).toBe(false)
    expect(isLauncherFailure(failure)).toBe(true)
  }, 60_000)

  it('never tells the merge card a ref moved', async () => {
    const fixture = await fixtureFor('task-unread')
    const task = landingTask(fixture)
    const { merges } = productLandingPorts(fixture, undefined, processTeamGit(process.platform))
    const failure = await failureOf(
      merges.plan({
        ...task,
        outcome: { ...task.outcome, folder: await realpath(fixture.workerCopy) },
      }),
    )
    expect(isLauncherFailure(failure)).toBe(true)
    expect(String(failure)).not.toContain('moved ref')
  }, 60_000)
})
