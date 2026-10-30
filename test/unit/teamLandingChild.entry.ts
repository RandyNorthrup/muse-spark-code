// The lander process for test/unit/teamLandingKilled.test.ts, bundled with
// esbuild by that suite. It runs the product's own checked landing and
// stops inside target validation — after the landing journal is prepared
// and the index lock is held, before any user-tree rename — until the
// parent kills it. Knip does not trace the esbuild bundle, so this file is
// a declared entry in knip.jsonc.
import { readFile, writeFile } from 'node:fs/promises'
import { landTeamTask } from '../../src/host/team/teamLandingEntry'
import type { WindowIdentity } from '../../src/host/team/windowIdentity'
import { EN } from '../../src/shared/l10n/en'
import { landingRunGit, landingTask, type LandingFixture } from './helpers/teamLandingFixture'

interface ChildPlan {
  readonly root: string
  readonly storage: string
  readonly workerCopy: string
  readonly baseCommit: string
  readonly head: string
  readonly agentsRef: string
  readonly taskId: string
  readonly readyFile: string
  readonly owner: WindowIdentity
}

function isChildPlan(value: unknown): value is ChildPlan {
  if (typeof value !== 'object' || value === null) return false
  const plan = value as Record<string, unknown>
  const owner = plan['owner']
  return (
    typeof plan['root'] === 'string' &&
    typeof plan['storage'] === 'string' &&
    typeof plan['workerCopy'] === 'string' &&
    typeof plan['baseCommit'] === 'string' &&
    typeof plan['head'] === 'string' &&
    typeof plan['agentsRef'] === 'string' &&
    typeof plan['taskId'] === 'string' &&
    typeof plan['readyFile'] === 'string' &&
    typeof owner === 'object' &&
    owner !== null &&
    typeof (owner as Record<string, unknown>)['instanceId'] === 'string' &&
    typeof (owner as Record<string, unknown>)['startedAt'] === 'number'
  )
}

const planFile = process.argv[2]
if (planFile === undefined) throw new Error('plan file argument missing')
const parsed: unknown = JSON.parse(await readFile(planFile, 'utf8'))
if (!isChildPlan(parsed)) throw new Error('plan file is not a landing child plan')
const fixture: LandingFixture = {
  root: parsed.root,
  storage: parsed.storage,
  workerCopy: parsed.workerCopy,
  baseCommit: parsed.baseCommit,
  head: parsed.head,
  agentsRef: parsed.agentsRef,
  taskId: parsed.taskId,
  dispose: () => Promise.resolve(),
}
await landTeamTask(
  EN,
  'en',
  {
    root: parsed.root,
    storage: parsed.storage,
    platform: process.platform,
    isTrusted: () => true,
    runGit: landingRunGit,
    writePaths: undefined,
    policy: {
      owner: parsed.owner,
      checks: () => ({
        commands: [{ name: 'check', command: 'true', timeoutSeconds: 60 }],
        platform: process.platform,
        setupCommand: '',
        cacheKey: '',
      }),
      runChecks: () => Promise.resolve({ passed: true }),
      confirmWithoutChecks: () => Promise.resolve(false),
      // The kill point: the journal intent is durable and the index lock is
      // held; the first rename has not happened. Never returns.
      validateTarget: async () => {
        await writeFile(parsed.readyFile, 'ready\n')
        await new Promise<never>(() => undefined)
      },
      hints: () => Promise.resolve([]),
    },
  },
  landingTask(fixture),
  new AbortController().signal,
  { allowProtected: false },
)
