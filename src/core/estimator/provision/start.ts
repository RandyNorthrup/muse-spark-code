import { z } from 'zod/mini'
import {
  estimateInputsSchema,
  type EstimateInputs,
  type EstimateStartPort,
} from '../../../shared/estimate'
import { UI_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { prepareEstimateSchedule } from '../schedule'
import { compareEstimateIds } from '../goal'
import { EstimateSerialOwner } from './owner'

const auditSchema = z.strictObject({
  allowed: z.boolean(),
  missingPrerequisites: z.array(z.string().check(z.minLength(1))),
})

/** One owner per board/run. M96 supplies atomic live resource claims and
 * across-process idempotency. Returned IDs mean submitted, not completed.
 */
export class EstimateWaveStarter {
  private readonly owner = new EstimateSerialOwner()
  private readonly submitted = new Set<string>()

  constructor(private readonly board: EstimateStartPort) {}

  start(input: EstimateInputs): Promise<readonly string[]> {
    // Clone/validate before queuing, so a caller cannot alter pending work.
    const inputs = estimateInputsSchema.parse(input)
    return this.owner.run(async () => {
      const byId = new Map(inputs.lanes.map((lane) => [lane.id, lane]))
      const isContractsPending = inputs.lanes.some(
        (lane) => lane.kind === 'contracts' && lane.state !== 'merged',
      )
      // Ordinary planned work cannot consume the slots needed by lane 0.
      // Running/merged work still reserves resources/satisfies dependencies.
      const lanes = isContractsPending
        ? inputs.lanes.filter((lane) => lane.kind === 'contracts' || lane.state !== 'planned')
        : inputs.lanes
      const included = new Set(lanes.map((lane) => lane.id))
      if (lanes.some((lane) => lane.dependencies.some((id) => !included.has(id))))
        throw new Error(UI_TEXT.estimatePrerequisites)
      const schedule = prepareEstimateSchedule(lanes, inputs.fleet).run()
      if (schedule.unknownLimits.length > 0)
        throw new Error(fill(UI_TEXT.estimateFailed, { detail: 'unknown-capacity' }))
      const first = schedule.schedule
        .filter((entry) => {
          const lane = byId.get(entry.laneId)
          return (
            lane?.state === 'planned' &&
            Date.parse(entry.start) === Date.parse(inputs.fleet.asOf) &&
            !this.submitted.has(lane.id) &&
            lane.dependencies.every((id) => byId.get(id)?.state === 'merged')
          )
        })
        .map((entry) => byId.get(entry.laneId))
        .filter((lane) => lane !== undefined)
        .toSorted((a, b) => a.estimatedHours - b.estimatedHours || compareEstimateIds(a.id, b.id))
      const laneIds = first.map((lane) => lane.id)
      if (laneIds.length === 0) return []
      let audit: z.infer<typeof auditSchema>
      try {
        audit = auditSchema.parse(await this.board.audit(laneIds))
      } catch {
        throw new Error(fill(UI_TEXT.estimateFailed, { detail: 'prerequisite-audit' }))
      }
      if (!audit.allowed || audit.missingPrerequisites.length > 0)
        throw new Error(UI_TEXT.estimatePrerequisites)
      // Claim before the asynchronous dispatch. A lost response cannot cause
      // duplicate work. Reconciliation/retry needs M96's outcome receipt.
      for (const id of laneIds) this.submitted.add(id)
      try {
        await this.board.start(laneIds)
      } catch {
        throw new Error(fill(UI_TEXT.estimateFailed, { detail: 'dispatch-uncertain' }))
      }
      return laneIds
    })
  }
}
