// Shared watchdog-test data: the watched repository, its API base and
// the fixed clock, with findings builders and the served routes several
// suites read, so no test repeats the literal.
import { triageFindingsSchema, type TriageFindings } from '../../../../src/shared/watchdog'
import { watchdogCaptured } from './servedGithub'

export const WATCHDOG_REPOSITORY = 'RandyNorthrup/muse-spark-code'
export const WATCHDOG_NAMED = { owner: 'RandyNorthrup', name: 'muse-spark-code' }
export const WATCHDOG_BASE = 'https://api.github.com/repos/RandyNorthrup/muse-spark-code'
export const WATCHDOG_NOW = 1_700_000_000_000

export function findingsFor(verdict: TriageFindings['verdict'], summary: string): TriageFindings {
  return triageFindingsSchema.parse({
    version: 1,
    verdict,
    summary,
    questions: verdict === 'needsInfo' ? ['What did you do?'] : [],
    ...(verdict === 'duplicate' && { duplicateOf: 3 }),
    ...(verdict === 'alreadyFixed' && { fixedIn: '0.19.0' }),
    ...(verdict === 'inHand' && { inHandRef: 'PLAN.md M115' }),
  })
}

export type WatchdogTestRoutes = Record<string, { status: number; body: unknown }>

/** The release, tag and commit-search rows the triage reads. */
export function releaseRoutes(): WatchdogTestRoutes {
  return {
    [`GET ${WATCHDOG_BASE}/releases`]: { status: 200, body: watchdogCaptured('github-releases') },
    [`GET ${WATCHDOG_BASE}/tags`]: { status: 200, body: watchdogCaptured('github-tags') },
    ['GET https://api.github.com/search/commits']: {
      status: 200,
      body: watchdogCaptured('github-search-commits'),
    },
  }
}

/** The captured comments, proved a non-empty list. */
export function capturedComments(): unknown[] {
  const comments = watchdogCaptured('github-issue-comments')
  if (!Array.isArray(comments) || comments.length === 0)
    throw new TypeError('the capture holds comments')
  const list: unknown[] = comments
  return list
}
