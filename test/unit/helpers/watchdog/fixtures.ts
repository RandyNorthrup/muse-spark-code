// Shared watchdog-test data: the watched repository and a findings builder,
// so no test repeats the literal.
import { triageFindingsSchema, type TriageFindings } from '../../../../src/shared/watchdog'

export const WATCHDOG_REPOSITORY = 'RandyNorthrup/muse-spark-code'

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
