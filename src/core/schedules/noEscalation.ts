import {
  scheduleGrantSchema,
  type ScheduleGrant,
  type ScheduleGrantRule,
  type ScheduleNoEscalation,
} from '../../shared/scheduleV2'

/** Exact selectors avoid guessing command tokenization or glob containment.
 * U still validates canonical paths and denies protected/physical actions.
 * A broader glob/prefix can be added only with a proven subset matcher. */
function isContained(parent: ScheduleGrantRule, requested: ScheduleGrantRule): boolean {
  switch (requested.kind) {
    case 'tool': {
      return parent.kind === 'tool' && parent.name === requested.name
    }
    case 'command': {
      return parent.kind === 'command' && parent.prefix === requested.prefix
    }
    case 'path': {
      return (
        parent.kind === 'path' &&
        parent.glob === requested.glob &&
        (parent.access === 'edit' || requested.access === 'read')
      )
    }
  }
}

/** Never turns a request or consent into new authority. Inputs are snapshots,
 * not mutated; the same intersection applies to report destination ids. */
export class AgentScheduleNoEscalation implements ScheduleNoEscalation {
  public bounded(request: ScheduleGrant, creator: ScheduleGrant): ScheduleGrant {
    const wanted = scheduleGrantSchema.parse(request)
    const held = scheduleGrantSchema.parse(creator)
    return {
      rules: wanted.rules.filter((rule) => held.rules.some((parent) => isContained(parent, rule))),
      destinationIds: wanted.destinationIds.filter((id) => held.destinationIds.includes(id)),
      paidCapUsd: Math.min(wanted.paidCapUsd, held.paidCapUsd),
    }
  }
}
