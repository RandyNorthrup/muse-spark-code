// The lander process for the M96c landing proofs (teamLandingPause and
// teamLandingKilled), bundled with esbuild through helpers/teamLander.ts. It
// runs the product's own checked landing, or its recovery, and stops inside
// target validation, with the landing journal durable and the index lock held:
// at the first check of one file, or at the last check before that file's
// rename, with its replacement already staged beside it. There it waits, alive,
// until the parent kills it or lets it go on. Knip does not trace the esbuild
// bundle, so this file is a declared entry in knip.jsonc.
import { access, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { landTeamTask, recoverOpenLandings } from '../../src/host/team/teamLandingEntry'
import { ATOMIC_TEMPORARY_SUFFIX } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import {
  landingDeps,
  landingPolicy,
  landingTask,
  type LandingFixture,
} from './helpers/teamLandingFixture'

const planSchema = z.strictObject({
  root: z.string(),
  storage: z.string(),
  workerCopy: z.string(),
  baseCommit: z.string(),
  head: z.string(),
  agentsRef: z.string(),
  taskId: z.string(),
  changedFiles: z.array(z.string()),
  owner: z.strictObject({ instanceId: z.uuid(), startedAt: z.number() }),
  readyFile: z.string(),
  releaseFile: z.string(),
  resultFile: z.string(),
  stopFile: z.string(),
  stopAtRename: z.boolean(),
  isRecovery: z.boolean(),
})

const planFile = process.argv[2]
if (planFile === undefined) throw new Error('plan file argument missing')
const POLL_MS = 25
const plan = planSchema.parse(JSON.parse(await readFile(planFile, 'utf8')))
const fixture: LandingFixture = { ...plan, dispose: () => Promise.resolve() }

/** Whether this check of `target` is the one the plan stops at. */
async function isStopPoint(target: string): Promise<boolean> {
  const name = path.basename(target)
  if (name !== plan.stopFile) return false
  if (!plan.stopAtRename) return true
  const stage = `${name}.`
  const entries = await readdir(path.dirname(target))
  return entries.some((entry) => entry.startsWith(stage) && entry.endsWith(ATOMIC_TEMPORARY_SUFFIX))
}

async function isReleased(): Promise<boolean> {
  try {
    await access(plan.releaseFile)
    return true
  } catch {
    // Not released yet: the parent writes this file when the pause ends.
    return false
  }
}

const reached = { isStopped: false }
const deps = landingDeps(
  plan,
  landingPolicy(plan.owner, {
    confirmTakeover: () => Promise.resolve(true),
    validateTarget: async (target) => {
      if (reached.isStopped || !(await isStopPoint(target))) return
      reached.isStopped = true
      await writeFile(plan.readyFile, 'ready\n')
      // The timer keeps this process alive through the pause: with nothing
      // left to wait for, Node would end it by itself and no kill would land.
      while (!(await isReleased())) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      }
    },
  }),
)
const signal = new AbortController().signal
const result = plan.isRecovery
  ? { status: 'recovered', count: await recoverOpenLandings(EN, 'en', deps, signal) }
  : await landTeamTask(EN, 'en', deps, landingTask(fixture), signal, { allowProtected: false })
await writeFile(plan.resultFile, JSON.stringify(result))
