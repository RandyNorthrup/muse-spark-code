// The claiming process for test/unit/scheduleBoardClaim.test.ts, bundled
// with esbuild by that suite. It builds the real schedule engine and the
// real team host over the shared store, joins the hold's immediate poll,
// and reports what it admitted. Two of these race one due role fire; the
// dispatch lease admits exactly one. Knip does not trace the esbuild
// bundle, so this file is a declared entry in knip.jsonc.
import { readFile, writeFile } from 'node:fs/promises'
import { boardRig, boardTasks, closeRig, QUEUE_CAPS } from './helpers/scheduleBoardRig'

interface ChildPlan {
  readonly root: string
  readonly cwd: string
  readonly storage: string
  readonly resultFile: string
}

function isChildPlan(value: unknown): value is ChildPlan {
  if (typeof value !== 'object' || value === null) return false
  const plan = value as Record<string, unknown>
  return (
    typeof plan['root'] === 'string' &&
    typeof plan['cwd'] === 'string' &&
    typeof plan['storage'] === 'string' &&
    typeof plan['resultFile'] === 'string'
  )
}

const planFile = process.argv[2]
if (planFile === undefined) throw new Error('plan file argument missing')
const parsed: unknown = JSON.parse(await readFile(planFile, 'utf8'))
if (!isChildPlan(parsed)) throw new Error('plan file is not a board claim child plan')
// Holding the workspace starts the engine's immediate poll tick; awaiting
// the workspace poll joins it, so this process attempts the due fire
// exactly once through the real claim path.
const rig = await boardRig({
  pays: 'local',
  caps: QUEUE_CAPS,
  root: parsed.root,
  cwd: parsed.cwd,
  storage: parsed.storage,
})
try {
  await rig.engine.pollWorkspace(rig.key)
  const tasks = boardTasks(rig)
  await writeFile(
    parsed.resultFile,
    JSON.stringify({
      admitted: tasks.length > 0,
      teamFor: rig.calls.teamFor,
      boardKeys: tasks.map((task) => task.key),
      boardRoles: tasks.map((task) => task.roleId),
      runs: rig.runs.length,
      startWorker: rig.calls.startWorker.length,
      listModels: rig.calls.listModels.length,
      allowKeyTasks: rig.calls.allowKeyTasks.length,
      cards: rig.calls.cards.length,
    }),
  )
} finally {
  await closeRig(rig)
}
