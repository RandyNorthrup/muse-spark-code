import {
  fleetSnapshotSchema,
  estimateLaneSchema,
  type EstimateLane,
  type EstimateSection,
  type FleetSnapshot,
} from '../../shared/estimate'
import {
  DAYS_PER_WEEK,
  ESTIMATE_MAX_ITEMS,
  MILLISECONDS_PER_DAY,
  MILLISECONDS_PER_SECOND,
  MINUTES_PER_HOUR,
  SECONDS_PER_MINUTE,
} from '../../shared/constants'
import { UI_TEXT, fill } from '../../shared/l10n/text'
import { buildEstimateDag } from './dag'
import { compareEstimateIds } from './goal'

const HOUR_MS = MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE * MINUTES_PER_HOUR
const MONTHS_PER_YEAR = 12
const MAX_ISO_YEAR = 9999
type Machine = FleetSnapshot['machines'][number]
type Slot = FleetSnapshot['slots'][number]
type Account = FleetSnapshot['accounts'][number]
type Window = NonNullable<Account['usageLimits']>[number]
type Quantity = EstimateLane['resources']['ciMinutes']
export type EstimateRelaxation = 'machines' | 'slots' | 'accountRate' | 'ci' | 'disk'

interface Reservation {
  lane: EstimateLane
  machine: Machine
  slots: Slot[]
  start: number
  end: number
  approximate?: boolean
}

export interface EstimateSchedule {
  schedule: EstimateSection['schedule']
  finishHours: number
  criticalPath: string[]
  criticalPathHours: number
  /** Missing supply measurements qualify the forecast; never imply infinity. */
  unknownLimits: string[]
}

export interface EstimateScheduler {
  run(durations?: ReadonlyMap<string, ReadonlyMap<string, number>>): EstimateSchedule
}

function refuse(detail: string): never {
  throw new Error(fill(UI_TEXT.estimateFailed, { detail }))
}

function known(quantity: Quantity, detail: string): number {
  if (quantity.status === 'unknown') refuse(`unknown-demand:${detail}`)
  return quantity.value
}

export function canEstimateMachineRun(lane: EstimateLane, machine: Machine): boolean {
  const affinity = lane.affinity
  return (
    (affinity.os.length === 0 || affinity.os.includes(machine.os)) &&
    (affinity.architectures.length === 0 ||
      affinity.architectures.includes(machine.architecture)) &&
    (affinity.machineClassIds.length === 0 || affinity.machineClassIds.includes(machine.classId)) &&
    (!affinity.gpuRequired || (machine.gpu?.count ?? 0) > 0)
  )
}

function localStamp(instant: number, formatter: Intl.DateTimeFormat): number {
  const parts = formatter.formatToParts(instant)
  const part = (name: string): number => Number(parts.find((entry) => entry.type === name)?.value)
  return (
    Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
      part('second'),
    ) + new Date(instant).getUTCMilliseconds()
  )
}

/** Recurrence stays anchored to the original civil day/time (Jan 31 -> Feb
 * end -> Mar 31). DST folds choose the earlier instant; gaps shift forward.
 * This is a scheduling assumption, not a claim about a provider's behavior.
 */
function renewals(window: Window, until: number): number[] {
  const anchor = Date.parse(window.resetsAt)
  const formatter = new Intl.DateTimeFormat('en', {
    timeZone: window.timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  })
  const local = new Date(localStamp(anchor, formatter))
  const output: number[] = []
  for (let index = 0; index < ESTIMATE_MAX_ITEMS; index++) {
    let next: number
    if (window.kind === 'rolling') {
      next = anchor + index * window.periodSeconds * MILLISECONDS_PER_SECOND
    } else {
      const civil = new Date(local)
      if (window.period === 'month') {
        const month = local.getUTCMonth() + index
        const year = local.getUTCFullYear() + Math.floor(month / MONTHS_PER_YEAR)
        const lastDay = new Date(Date.UTC(year, (month % MONTHS_PER_YEAR) + 1, 0)).getUTCDate()
        civil.setUTCDate(1)
        civil.setUTCFullYear(year, month % MONTHS_PER_YEAR, Math.min(local.getUTCDate(), lastDay))
      } else {
        civil.setUTCDate(
          local.getUTCDate() + index * (window.period === 'week' ? DAYS_PER_WEEK : 1),
        )
      }
      const stamp = civil.getTime()
      const candidates = [-MILLISECONDS_PER_DAY, 0, MILLISECONDS_PER_DAY].map((offset) => {
        const guess = stamp + offset
        return stamp - (localStamp(guess, formatter) - guess)
      })
      const exact = candidates.filter((candidate) => localStamp(candidate, formatter) === stamp)
      next = exact.length > 0 ? Math.min(...exact) : Math.max(...candidates)
      if (index === 0) next = anchor
    }
    output.push(next)
    if (next > until) return output
  }
  return refuse('quota-horizon')
}

function accountShare(reservation: Reservation, accountId: string): number {
  return (
    reservation.slots.filter((slot) => slot.accountId === accountId).length /
    reservation.slots.length
  )
}

function rate(lane: EstimateLane, unit: Window['unit']): number {
  const resources = lane.resources
  const quantities = {
    requests: resources.accountRequestsPerHour,
    tokens: resources.accountTokensPerHour,
    usd: resources.accountUsdPerHour,
    percent: resources.accountPercentPerHour,
  }
  return known(quantities[unit], `${lane.id}:${unit}`)
}

function diskLoad(
  reservations: Reservation[],
  machineId: string,
  volume: Machine['disks'][number],
  time: number,
): number {
  return reservations
    .filter((entry) => entry.machine.id === machineId && entry.start <= time)
    .reduce(
      (total, entry) =>
        total +
        entry.lane.resources.disk
          .filter((disk) => volume.roles.includes(disk.role))
          .reduce(
            (bytes, disk) =>
              bytes +
              known(time < entry.end ? disk.peakBytes : disk.steadyBytes, `${entry.lane.id}:disk`),
            0,
          ),
      0,
    )
}

/** Validate once; Monte Carlo and R's setup search reuse this prepared engine.
 * Rates are constant over a nonpreemptive lane; multiple accounts split its
 * total demand in proportion to their allocated slots. CI jobs are held for
 * the lane, reported minutes are charged once, disk steady demand is retained.
 */
export function prepareEstimateSchedule(
  input: readonly EstimateLane[],
  fleetInput: FleetSnapshot,
  relaxation?: EstimateRelaxation,
): EstimateScheduler {
  const dag = buildEstimateDag(input)
  const fleet = fleetSnapshotSchema.parse(fleetInput)
  const asOf = Date.parse(fleet.asOf)
  const lanes = input
    .map((lane) => estimateLaneSchema.parse(lane))
    .toSorted((a, b) => compareEstimateIds(a.id, b.id))
  const lanesById = new Map(lanes.map((lane) => [lane.id, lane]))
  const childrenById = new Map(
    lanes.map((lane) => [lane.id, lanes.filter((child) => child.dependencies.includes(lane.id))]),
  )
  const machines = fleet.machines.toSorted((a, b) => compareEstimateIds(a.id, b.id))
  const roles = new Map(fleet.roles.map((role) => [role.id, role]))
  const unknownLimits = new Set<string>()
  const renewalCache = new WeakMap<Window, number[]>()
  const resetsFor = (window: Window, until: number): number[] => {
    const cached = renewalCache.get(window)
    if (cached && (cached.at(-1) ?? -Infinity) > until) return cached
    const resets = renewals(window, until)
    renewalCache.set(window, resets)
    return resets
  }
  const candidates = new Map(
    lanes.map((lane) => [
      lane.id,
      machines.filter((machine) => canEstimateMachineRun(lane, machine)),
    ]),
  )
  const diskFitsTogether = new Map<Machine['disks'][number], boolean>()
  for (const machine of machines) {
    for (const volume of machine.disks) {
      if (volume.status === 'unknown') continue
      const matching = lanes.filter(
        (lane) => lane.state !== 'merged' && candidates.get(lane.id)?.includes(machine),
      )
      let peak = 0
      for (const lane of matching)
        for (const disk of lane.resources.disk) {
          if (!volume.roles.includes(disk.role)) continue
          known(disk.steadyBytes, `${lane.id}:disk`)
          peak += known(disk.peakBytes, `${lane.id}:disk`)
        }
      diskFitsTogether.set(volume, peak <= volume.headroomBytes)
    }
  }
  const laneSlots = (lane: EstimateLane, machine: Machine): Slot[] =>
    fleet.slots
      .filter(
        (slot) =>
          slot.machineId === machine.id && roles.get(slot.roleId)?.laneKinds.includes(lane.kind),
      )
      .toSorted((a, b) => compareEstimateIds(a.id, b.id))
  const usableAccountIds = new Set(
    lanes
      .filter((lane) => lane.state !== 'merged')
      .flatMap((lane) =>
        (candidates.get(lane.id) ?? []).flatMap((machine) =>
          laneSlots(lane, machine).map((slot) => slot.accountId),
        ),
      ),
  )
  const accounts = fleet.accounts.filter((account) => usableAccountIds.has(account.id))
  const usedVolumes = (lane: EstimateLane, machine: Machine): Machine['disks'] =>
    machine.disks.filter((volume) =>
      lane.resources.disk.some((disk) => volume.roles.includes(disk.role)),
    )
  for (const account of accounts) {
    if (account.usageLimits === undefined) unknownLimits.add(`${account.id}:usageLimits`)
    if (account.tokensPerMinute === undefined) unknownLimits.add(`${account.id}:tokensPerMinute`)
  }
  for (const ci of fleet.ci)
    if (ci.minutesRemaining === undefined) unknownLimits.add(`${ci.id}:minutesRemaining`)

  let quotaHints: number[] = []
  function isFeasible(all: Reservation[], candidate: Reservation): boolean {
    quotaHints = []
    const { lane, machine, start, end } = candidate
    const overlapping = all.filter((entry) => entry.start < end && start < entry.end)
    const points = [
      ...new Set([start, end, ...overlapping.flatMap((entry) => [entry.start, entry.end])]),
    ].toSorted((a, b) => a - b)
    const allPoints = (): number[] =>
      [...new Set(all.flatMap((entry) => [entry.start, entry.end]))].toSorted((a, b) => a - b)
    const demand = known(lane.resources.slots, `${lane.id}:slots`)
    const kindSlots = machine.capacityByKind.find((entry) => entry.kind === lane.kind)?.slots ?? 0
    for (const time of points) {
      if (time < start || time >= end) continue
      const active = overlapping.filter((entry) => entry.start <= time && time < entry.end)
      const onMachine =
        relaxation === 'machines'
          ? [candidate]
          : active.filter((entry) => entry.machine.id === machine.id)
      {
        if (
          onMachine.reduce((sum, entry) => sum + entry.slots.length, 0) >
            Math.min(machine.governorSlots, machine.caps.slots) ||
          onMachine
            .filter((entry) => entry.lane.kind === lane.kind)
            .reduce((sum, entry) => sum + entry.slots.length, 0) > kindSlots
        )
          return false
      }
      if (demand !== candidate.slots.length) return false
      if (relaxation !== 'accountRate') {
        for (const account of accounts) {
          const users = active.filter((entry) => accountShare(entry, account.id) > 0)
          const used = (unit: Window['unit']): number =>
            users.reduce(
              (sum, entry) => sum + rate(entry.lane, unit) * accountShare(entry, account.id),
              0,
            )
          if (used('requests') > account.requestsPerMinute * MINUTES_PER_HOUR) return false
          if (
            account.tokensPerMinute !== undefined &&
            used('tokens') > account.tokensPerMinute * MINUTES_PER_HOUR
          )
            return false
        }
      }
      if (relaxation !== 'ci') {
        for (const ci of fleet.ci) {
          const jobs = active
            .filter((entry) => entry.lane.resources.ciId === ci.id)
            .reduce(
              (sum, entry) => sum + known(entry.lane.resources.ciJobs, `${entry.lane.id}:ciJobs`),
              ci.occupiedJobs,
            )
          if (jobs > ci.concurrentJobs) return false
        }
      }
    }
    if (relaxation !== 'disk') {
      for (const disk of lane.resources.disk) {
        known(disk.peakBytes, `${lane.id}:disk`)
        known(disk.steadyBytes, `${lane.id}:disk`)
      }
      for (const volume of usedVolumes(lane, machine)) {
        if (volume.status === 'unknown' || diskFitsTogether.get(volume)) continue
        if (
          allPoints().some(
            (time) =>
              diskLoad(relaxation === 'machines' ? [candidate] : all, machine.id, volume, time) >
              volume.headroomBytes,
          )
        )
          return false
      }
      if (
        lane.resources.disk.some((disk) =>
          machine.disks.every((volume) => !volume.roles.includes(disk.role)),
        )
      )
        return false
    }
    if (relaxation !== 'ci') {
      const jobs = known(lane.resources.ciJobs, `${lane.id}:ciJobs`)
      const minutes = known(lane.resources.ciMinutes, `${lane.id}:ciMinutes`)
      const ci = fleet.ci.find((ci) => ci.id === lane.resources.ciId)
      if (!ci && (jobs > 0 || minutes > 0)) return false
      if (ci?.minutesRemaining !== undefined) {
        const used = all
          .filter((entry) => entry.lane.resources.ciId === ci.id)
          .reduce(
            (sum, entry) =>
              sum + known(entry.lane.resources.ciMinutes, `${entry.lane.id}:ciMinutes`),
            0,
          )
        if (used > ci.minutesRemaining) return false
        if (
          minutes > 0 &&
          ci.periodEndsAt !== undefined &&
          asOf + end * HOUR_MS > Date.parse(ci.periodEndsAt)
        )
          return false
      }
    }
    if (relaxation !== 'accountRate') {
      const horizon = Math.max(...all.map((entry) => entry.end))
      for (const account of accounts) {
        const users = all.filter((entry) => accountShare(entry, account.id) > 0)
        if (users.length === 0) continue
        const windows = account.usageLimits ?? []
        for (const window of windows) {
          const total = users.reduce(
            (sum, entry) =>
              sum +
              rate(entry.lane, window.unit) *
                accountShare(entry, account.id) *
                (entry.end - entry.start),
            0,
          )
          if (total <= window.remaining) continue
          const resets = resetsFor(window, asOf + horizon * HOUR_MS).map(
            (instant) => (instant - asOf) / HOUR_MS,
          )
          const boundaries = [
            ...new Set([
              0,
              horizon,
              ...allPoints(),
              ...resets.filter((reset) => reset > 0 && reset < horizon),
            ]),
          ].toSorted((a, b) => a - b)
          let remaining = resets.some((reset) => reset <= 0) ? window.allowance : window.remaining
          for (let index = 0; index < boundaries.length - 1; index++) {
            const time = boundaries[index] ?? refuse('missing-boundary')
            const next = boundaries[index + 1] ?? refuse('missing-boundary')
            if (resets.includes(time)) remaining = window.allowance
            remaining -= users
              .filter((entry) => entry.start <= time && time < entry.end)
              .reduce(
                (sum, entry) =>
                  sum +
                  rate(entry.lane, window.unit) * accountShare(entry, account.id) * (next - time),
                0,
              )
            if (remaining < -Number.EPSILON * Math.max(1, window.allowance) * ESTIMATE_MAX_ITEMS) {
              const renewal = resets.find((reset) => reset > time) ?? Infinity
              const previous = resets.findLast((reset) => reset <= time) ?? 0
              const allowance = resets.some((reset) => reset <= time)
                ? window.allowance
                : window.remaining
              const others = users
                .filter((entry) => entry !== candidate)
                .reduce(
                  (sum, entry) =>
                    sum +
                    rate(entry.lane, window.unit) *
                      accountShare(entry, account.id) *
                      Math.max(0, Math.min(entry.end, renewal) - Math.max(entry.start, previous)),
                  0,
                )
              const candidateRate = rate(lane, window.unit) * accountShare(candidate, account.id)
              const hint = renewal - Math.max(0, allowance - others) / candidateRate
              if (hint > start && Number.isFinite(hint)) quotaHints.push(hint)
              return false
            }
          }
        }
      }
    }
    return true
  }

  return {
    run(durations) {
      if (
        durations &&
        (durations.size !== lanes.length || lanes.some((lane) => !durations.has(lane.id)))
      )
        refuse('duration-coverage')
      const classIds = new Set(machines.map((machine) => machine.classId))
      if (durations)
        for (const lane of lanes) {
          const classes = durations.get(lane.id) ?? refuse('duration-coverage')
          for (const [classId, duration] of classes) {
            if (!classIds.has(classId)) refuse('duration-class')
            if (!Number.isFinite(duration) || duration < 0) refuse('invalid-duration')
            if (duration !== 0 && lane.state === 'merged') refuse('merged-duration')
            if (lane.state === 'running' && duration < lane.minimumRemainingHours)
              refuse('minimum-duration')
          }
        }
      const base = new Map(dag.nodes.map((node) => [node.laneId, node.durationHours]))
      const hours = (lane: EstimateLane, machine: Machine): number => {
        const value = durations ? durations.get(lane.id)?.get(machine.classId) : base.get(lane.id)
        if (value === undefined) refuse('invalid-duration')
        return value
      }
      const runUnknownLimits = new Set(unknownLimits)
      const assigned: Reservation[] = []
      const finishes = new Map<string, number>()
      const pending = new Set(lanes.map((lane) => lane.id))
      const priority = new Map(dag.nodes.map((node) => [node.laneId, node.tailHours]))
      if (durations) {
        for (const id of dag.topologicalOrder.toReversed()) {
          const lane = lanesById.get(id) ?? refuse('missing-lane')
          const children = childrenById.get(id) ?? []
          const possible = candidates.get(id) ?? []
          const duration =
            lane.state === 'merged'
              ? 0
              : Math.min(...possible.map((machine) => hours(lane, machine)))
          priority.set(
            id,
            duration + Math.max(0, ...children.map((child) => priority.get(child.id) ?? 0)),
          )
        }
      }
      while (pending.size > 0) {
        const ready = lanes
          .filter(
            (lane) => pending.has(lane.id) && lane.dependencies.every((id) => finishes.has(id)),
          )
          .toSorted(
            (a, b) =>
              (priority.get(b.id) ?? 0) - (priority.get(a.id) ?? 0) ||
              compareEstimateIds(a.id, b.id),
          )
        const lane = ready[0] ?? refuse('schedule-cycle')
        const earliest = Math.max(0, ...lane.dependencies.map((id) => finishes.get(id) ?? 0))
        if (lane.state === 'merged') {
          finishes.set(lane.id, earliest)
          pending.delete(lane.id)
          continue
        }
        const count = known(lane.resources.slots, `${lane.id}:slots`)
        let best: Reservation | undefined
        const eligibleMachines = candidates.get(lane.id) ?? []
        for (const machine of eligibleMachines) {
          const eligible = laneSlots(lane, machine)
          if (eligible.length === 0) continue
          if (
            count >
              (machine.capacityByKind.find((entry) => entry.kind === lane.kind)?.slots ?? 0) ||
            count > Math.min(machine.governorSlots, machine.caps.slots) ||
            (relaxation !== 'slots' && eligible.length < count)
          )
            continue
          const duration = hours(lane, machine)
          let start = earliest
          const lastEnd = Math.max(earliest, ...assigned.map((entry) => entry.end))
          const lastReset = Math.max(
            earliest,
            ...accounts.flatMap((account) =>
              (account.usageLimits ?? []).map((window) => {
                const next = resetsFor(window, asOf + lastEnd * HOUR_MS).find(
                  (instant) => instant > asOf + lastEnd * HOUR_MS,
                )
                return next === undefined ? earliest : (next - asOf) / HOUR_MS
              }),
            ),
          )
          function place(): Reservation | undefined {
            for (let attempt = 0; attempt < ESTIMATE_MAX_ITEMS; attempt++) {
              const end = start + duration
              if (
                !Number.isFinite(end) ||
                !Number.isFinite(new Date(asOf + end * HOUR_MS).getTime()) ||
                new Date(asOf + end * HOUR_MS).getUTCFullYear() > MAX_ISO_YEAR
              )
                refuse('schedule-date-overflow')
              const available =
                relaxation === 'slots' || relaxation === 'machines'
                  ? eligible
                  : eligible.filter((slot) =>
                      assigned.every(
                        (entry) =>
                          !(
                            entry.start < end &&
                            start < entry.end &&
                            entry.slots.some((other) => other.id === slot.id)
                          ),
                      ),
                    )
              const accountOrder = [...new Set(available.map((slot) => slot.accountId))].toSorted(
                compareEstimateIds,
              )
              const hints: number[] = []
              const groups = accountOrder.map((id) =>
                available.filter((slot) => slot.accountId === id),
              )
              // Slots on one account are equivalent for admission. Enumerate
              // account counts, not every physical subset, in stable ID order.
              function* allocations(
                index: number,
                remaining: number,
                selected: Slot[],
              ): Generator<Slot[]> {
                if (remaining === 0) {
                  yield selected
                  return
                }
                const group = groups[index]
                if (!group) return
                const capacity = relaxation === 'slots' ? count : group.length
                const rest =
                  relaxation === 'slots'
                    ? count
                    : groups.slice(index + 1).reduce((sum, slots) => sum + slots.length, 0)
                for (
                  let take = Math.min(remaining, capacity);
                  take >= Math.max(0, remaining - rest);
                  take--
                ) {
                  const slots = Array.from(
                    { length: take },
                    (_, offset) => group[offset % group.length] ?? refuse('missing-slot'),
                  )
                  yield* allocations(index + 1, remaining - take, [...selected, ...slots])
                }
              }
              function exact(): { candidate: Reservation | undefined; isLimited: boolean } {
                let attempts = 0
                for (const slots of allocations(0, count, [])) {
                  if (attempts++ >= ESTIMATE_MAX_ITEMS) {
                    return { candidate: undefined, isLimited: true }
                  }
                  const candidate = { lane, machine, slots, start, end }
                  if (isFeasible([...assigned, candidate], candidate))
                    return { candidate, isLimited: false }
                  hints.push(...quotaHints)
                }
                return { candidate: undefined, isLimited: false }
              }
              const match = exact()
              if (match.candidate) return match.candidate
              // Large account products fall back to deterministic greedy
              // priorities; the selected lane explicitly reports approximation.
              if (match.isLimited) {
                for (const first of accountOrder) {
                  const ordered = available.toSorted(
                    (a, b) =>
                      Number(b.accountId === first) - Number(a.accountId === first) ||
                      compareEstimateIds(a.id, b.id),
                  )
                  const slots =
                    relaxation === 'slots'
                      ? Array.from(
                          { length: count },
                          (_, index) => ordered[index % ordered.length] ?? refuse('missing-slot'),
                        )
                      : ordered.slice(0, count)
                  const candidate = { lane, machine, slots, start, end, approximate: true }
                  if (isFeasible([...assigned, candidate], candidate)) return candidate
                  hints.push(...quotaHints)
                }
                if (hints.length === 0 && start >= Math.max(lastEnd, lastReset))
                  refuse(`account-selection-limit:${lane.id}`)
              }
              // After all existing reservations finish and every reported window
              // renews, more identical empty periods cannot cure a structural
              // capacity/rate/retention failure for a nonpreemptive lane.
              if (hints.length === 0 && start >= Math.max(lastEnd, lastReset)) return undefined
              const future = [
                ...hints,
                ...assigned
                  .flatMap((entry) => [entry.start, entry.end])
                  .filter((time) => time > start),
              ]
              for (const account of accounts) {
                const windows = account.usageLimits ?? []
                for (const window of windows) {
                  const next = resetsFor(window, asOf + start * HOUR_MS).find(
                    (instant) => instant > asOf + start * HOUR_MS,
                  )
                  if (next !== undefined) future.push((next - asOf) / HOUR_MS)
                }
              }
              if (future.length === 0) return undefined
              start = Math.min(...future)
              if (best && start + duration >= best.end) return undefined
            }
            return undefined
          }
          const candidate = place()
          if (
            candidate &&
            (!best ||
              candidate.end < best.end ||
              (candidate.end === best.end &&
                (usedVolumes(lane, machine).filter((volume) => volume.status === 'unknown').length -
                  usedVolumes(lane, best.machine).filter((volume) => volume.status === 'unknown')
                    .length || compareEstimateIds(machine.id, best.machine.id)) < 0))
          )
            best = candidate
        }
        if (!best) refuse(`unschedulable:${lane.id}`)
        if (best.approximate) runUnknownLimits.add(`${lane.id}:account-selection-approximate`)
        if (relaxation !== 'disk')
          for (const volume of usedVolumes(lane, best.machine))
            if (volume.status === 'unknown')
              runUnknownLimits.add(`${lane.id}:disk:${best.machine.id}:${volume.volumeId}`)
        assigned.push(best)
        finishes.set(lane.id, best.end)
        pending.delete(lane.id)
      }
      const sampled = new Map(
        lanes.map((lane) => [
          lane.id,
          assigned.find((entry) => entry.lane.id === lane.id)?.end ?? 0,
        ]),
      )
      // Dependency-only lower bound uses the durations actually selected, never
      // divides a lane by machines or slots. G's topology is reused without reparsing.
      const pathFinishes = new Map<string, number>()
      const paths = new Map<string, string[]>()
      for (const id of dag.topologicalOrder) {
        const lane = lanesById.get(id) ?? refuse('missing-lane')
        const parent = lane.dependencies.toSorted(
          (a, b) =>
            (pathFinishes.get(b) ?? 0) - (pathFinishes.get(a) ?? 0) || compareEstimateIds(a, b),
        )[0]
        const entry = assigned.find((entry) => entry.lane.id === id)
        const duration = entry ? entry.end - entry.start : 0
        pathFinishes.set(id, (parent ? (pathFinishes.get(parent) ?? 0) : 0) + duration)
        paths.set(id, [...(parent ? (paths.get(parent) ?? []) : []), ...(duration > 0 ? [id] : [])])
      }
      const endpoint = lanes.toSorted(
        (a, b) =>
          (pathFinishes.get(b.id) ?? 0) - (pathFinishes.get(a.id) ?? 0) ||
          compareEstimateIds(a.id, b.id),
      )[0]?.id
      const criticalPathHours = endpoint ? (pathFinishes.get(endpoint) ?? 0) : 0
      const latestStarts = new Map<string, number>()
      const slack = new Map<string, number>()
      const epsilon = Number.EPSILON * criticalPathHours * Math.max(1, lanes.length)
      for (const id of dag.topologicalOrder.toReversed()) {
        const entry = assigned.find((entry) => entry.lane.id === id)
        const duration = entry ? entry.end - entry.start : 0
        const children = childrenById.get(id) ?? []
        const finish =
          children.length === 0
            ? criticalPathHours
            : Math.min(...children.map((child) => latestStarts.get(child.id) ?? criticalPathHours))
        latestStarts.set(id, finish - duration)
        const delta = finish - (pathFinishes.get(id) ?? 0)
        slack.set(id, Math.abs(delta) <= epsilon ? 0 : delta)
      }
      return {
        finishHours: Math.max(0, ...sampled.values()),
        criticalPath: endpoint ? (paths.get(endpoint) ?? []) : [],
        criticalPathHours,
        unknownLimits: [...runUnknownLimits].toSorted(compareEstimateIds),
        schedule: assigned
          .toSorted((a, b) => a.start - b.start || compareEstimateIds(a.lane.id, b.lane.id))
          .map((entry) => ({
            laneId: entry.lane.id,
            machineId: entry.machine.id,
            slotIds: [...new Set(entry.slots.map((slot) => slot.id))].toSorted(compareEstimateIds),
            accountIds: [...new Set(entry.slots.map((slot) => slot.accountId))].toSorted(
              compareEstimateIds,
            ),
            start: new Date(asOf + entry.start * HOUR_MS).toISOString(),
            end: new Date(asOf + entry.end * HOUR_MS).toISOString(),
            slackHours: slack.get(entry.lane.id) ?? 0,
            critical: entry.end > entry.start && slack.get(entry.lane.id) === 0,
          })),
      }
    },
  }
}
