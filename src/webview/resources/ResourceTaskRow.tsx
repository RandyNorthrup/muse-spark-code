import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { ResourceClass, ResourceKind } from '../../shared/resources'

/** M96c V/R bind these to the actual admission/retirement handles, never ordinary approvals. */
export interface ResourceTaskRowProps {
  readonly kind: ResourceKind
  readonly workClass: ResourceClass
  readonly phase: 'queued' | 'running' | 'admitted'
  readonly runNow?: () => void
  readonly target?: {
    readonly name: string
    readonly move: () => void
    readonly keepHere: () => void
  }
}

/** The row used by Traffic and task surfaces; routing authority stays in R/M100. */
export function ResourceTaskRow({ kind, workClass, phase, runNow, target }: ResourceTaskRowProps) {
  if (phase === 'admitted')
    return target === undefined ? null : (
      <div className="resource-task-row">
        {fill(UI_TEXT.resourceRelocatedNotice, { device: target.name })}
      </div>
    )
  const canMove =
    target !== undefined && (kind === 'check' || (kind === 'worker' && phase === 'queued'))
  return (
    <div className="resource-task-row">
      {phase === 'queued' || canMove ? <span>{UI_TEXT.resourceWaiting}</span> : null}
      {phase !== 'queued' || workClass !== 'foreground' || runNow === undefined ? null : (
        <button type="button" className="button-secondary" onClick={runNow}>
          {UI_TEXT.resourceRunNow}
        </button>
      )}
      {canMove ? (
        <>
          <span>
            {UI_TEXT.resourceRelocate}: <b dir="auto">{target.name}</b>
          </span>
          <button type="button" className="button-secondary" onClick={target.move}>
            {fill(UI_TEXT.resourceMoveTo, { device: target.name })}
          </button>
          <button type="button" className="button-secondary" onClick={target.keepHere}>
            {UI_TEXT.resourceKeepHere}
          </button>
        </>
      ) : null}
    </div>
  )
}
