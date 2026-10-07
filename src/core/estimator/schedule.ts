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
  const classIds = new Set(machines.map((machine) => machine.classId))
  const base = new Map(dag.nodes.map((node) => [node.laneId, node.durationHours]))
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
  const slotsByMachine = new Map<Machine, Map<string, Slot[]>>()
  const laneSlots = (lane: EstimateLane, machine: Machine): Slot[] => {
    let kinds = slotsByMachine.get(machine)
    if (!kinds) {
      kinds = new Map()
      slotsByMachine.set(machine, kinds)
    }
    let slots = kinds.get(lane.kind)
    if (!slots) {
      slots = fleet.slots
        .filter(
          (slot) =>
            slot.machineId === machine.id && roles.get(slot.roleId)?.laneKinds.includes(lane.kind),
        )
        .toSorted((a, b) => compareEstimateIds(a.id, b.id))
      kinds.set(lane.kind, slots)
    }
    return slots
  }
  const accountsByLane = new Map(
    lanes.map((lane) => [
      lane,
      new Set(
        (candidates.get(lane.id) ?? []).flatMap((machine) =>
          laneSlots(lane, machine).map((slot) => slot.accountId),
        ),
      ),
    ]),
  )
  const ratesByLane = new Map<EstimateLane, Map<Window['unit'], number>>()
  const laneRate = (lane: EstimateLane, unit: Window['unit']): number => {
    let rates = ratesByLane.get(lane)
    if (!rates) {
      rates = new Map()
      ratesByLane.set(lane, rates)
    }
    let value = rates.get(unit)
    if (value === undefined) {
      value = rate(lane, unit)
      rates.set(unit, value)
    }
    return value
  }
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
  const volumesByLane = new Map<EstimateLane, Map<Machine, Machine['disks']>>()
  const usedVolumes = (lane: EstimateLane, machine: Machine): Machine['disks'] => {
    let volumes = volumesByLane.get(lane)
    if (!volumes) {
      volumes = new Map()
      volumesByLane.set(lane, volumes)
    }
    let used = volumes.get(machine)
    if (!used) {
      used = machine.disks.filter((volume) =>
        lane.resources.disk.some((disk) => volume.roles.includes(disk.role)),
      )
      volumes.set(machine, used)
    }
    return used
  }
  const usersByAccount = new Map(
    accounts.map((account) => [
      account,
      lanes.filter((lane) => lane.state !== 'merged' && accountsByLane.get(lane)?.has(account.id)),
    ]),
  )
  // Upper bounds use each lane's whole demand, so proving co-fit never
  // assumes a favourable slot/account split or widens an admission guard.
  const rateAccounts = accounts.filter((account) => {
    const users = usersByAccount.get(account) ?? []
    return (
      users.reduce((sum, lane) => sum + laneRate(lane, 'requests'), 0) >
        account.requestsPerMinute * MINUTES_PER_HOUR ||
      (account.tokensPerMinute !== undefined &&
        users.reduce((sum, lane) => sum + laneRate(lane, 'tokens'), 0) >
          account.tokensPerMinute * MINUTES_PER_HOUR)
    )
  })
  const constrainedCi = fleet.ci.filter(
    (ci) =>
      lanes
        .filter((lane) => lane.state !== 'merged' && lane.resources.ciId === ci.id)
        .reduce(
          (sum, lane) => sum + known(lane.resources.ciJobs, `${lane.id}:ciJobs`),
          ci.occupiedJobs,
        ) > ci.concurrentJobs,
  )
  for (const account of accounts) {
    if (account.usageLimits === undefined) unknownLimits.add(`${account.id}:usageLimits`)
    if (account.tokensPerMinute === undefined) unknownLimits.add(`${account.id}:tokensPerMinute`)
  }
  for (const ci of fleet.ci)
    if (ci.minutesRemaining === undefined) unknownLimits.add(`${ci.id}:minutesRemaining`)

  let quotaHints: number[] = []
  function isFeasible(
    all: Reservation[],
    candidate: Reservation,
    windowsByAccount: ReadonlyMap<Account, Window[]>,
  ): boolean {
    quotaHints = []
    const { lane, machine, start, end } = candidate
    const kindSlots = machine.capacityByKind.find((entry) => entry.kind === lane.kind)?.slots ?? 0
    const requiresTimeline =
      relaxation === 'slots' ||
      (relaxation !== 'machines' && laneSlots(lane, machine).length > kindSlots) ||
      (relaxation !== 'accountRate' && rateAccounts.length > 0) ||
      (relaxation !== 'ci' && constrainedCi.length > 0)
    const overlapping = requiresTimeline
      ? all.filter((entry) => entry.start < end && start < entry.end)
      : []
    const points = requiresTimeline
      ? [
          ...new Set([start, end, ...overlapping.flatMap((entry) => [entry.start, entry.end])]),
        ].toSorted((a, b) => a - b)
      : []
    let cachedPoints: number[] | undefined
    const allPoints = (): number[] =>
      (cachedPoints ??= [...new Set(all.flatMap((entry) => [entry.start, entry.end]))].toSorted(
        (a, b) => a - b,
      ))
    const demand = known(lane.resources.slots, `${lane.id}:slots`)
    if (demand !== candidate.slots.length) return false
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
      if (relaxation !== 'accountRate') {
        for (const account of rateAccounts) {
          const users = active.filter((entry) => accountShare(entry, account.id) > 0)
          const used = (unit: Window['unit']): number =>
            users.reduce(
              (sum, entry) => sum + laneRate(entry.lane, unit) * accountShare(entry, account.id),
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
        for (const ci of constrainedCi) {
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
        const windows = windowsByAccount.get(account) ?? []
        if (windows.length === 0) continue
        const users = all.filter((entry) => accountShare(entry, account.id) > 0)
        if (users.length === 0) continue
        for (const window of windows) {
          const total = users.reduce(
            (sum, entry) =>
              sum +
              laneRate(entry.lane, window.unit) *
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
                  laneRate(entry.lane, window.unit) *
                    accountShare(entry, account.id) *
                    (next - time),
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
                    laneRate(entry.lane, window.unit) *
                      accountShare(entry, account.id) *
                      Math.max(0, Math.min(entry.end, renewal) - Math.max(entry.start, previous)),
                  0,
                )
              const candidateRate =
                laneRate(lane, window.unit) * accountShare(candidate, account.id)
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
      const hours = (lane: EstimateLane, machine: Machine): number => {
        const value = durations ? durations.get(lane.id)?.get(machine.classId) : base.get(lane.id)
        if (value === undefined) refuse('invalid-duration')
        return value
      }
      const maximumHours = new Map(
        lanes.map((lane) => [
          lane,
          lane.state === 'merged'
            ? 0
            : Math.max(
                0,
                ...(candidates.get(lane.id) ?? []).map((machine) => hours(lane, machine)),
              ),
        ]),
      )
      const windowsByAccount = new Map(
        accounts.map((account) => [
          account,
          (account.usageLimits ?? []).filter(
            (window) =>
              (usersByAccount.get(account) ?? []).reduce(
                (sum, lane) => sum + laneRate(lane, window.unit) * (maximumHours.get(lane) ?? 0),
                0,
              ) > window.remaining,
          ),
        ]),
      )
      const searchWindows: Window[] = []
      for (const windows of windowsByAccount.values()) searchWindows.push(...windows)
      const runUnknownLimits = new Set(unknownLimits)
      const assigned: Reservation[] = []
      const assignedById = new Map<string, Reservation>()
      const reservationsBySlot = new Map<string, Reservation[]>()
      let reservationPoints: number[] = []
      const finishes = new Map<string, number>()
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
      const comparePriority = (a: EstimateLane, b: EstimateLane): number =>
        (priority.get(b.id) ?? 0) - (priority.get(a.id) ?? 0) || compareEstimateIds(a.id, b.id)
      const ready = lanes.filter((lane) => lane.dependencies.length === 0).toSorted(comparePriority)
      const completed = (lane: EstimateLane, finish: number): void => {
        finishes.set(lane.id, finish)
        const children = childrenById.get(lane.id) ?? []
        for (const child of children) {
          if (child.dependencies.some((id) => !finishes.has(id))) continue
          const index = ready.findIndex((other) => comparePriority(child, other) < 0)
          ready.splice(index === -1 ? ready.length : index, 0, child)
        }
      }
      while (finishes.size < lanes.length) {
        const lane = ready.shift() ?? refuse('schedule-cycle')
        const earliest = Math.max(0, ...lane.dependencies.map((id) => finishes.get(id) ?? 0))
        if (lane.state === 'merged') {
          completed(lane, earliest)
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
          let lastReset: number | undefined
          const finalBoundary = (): number => {
            lastReset ??= Math.max(
              earliest,
              ...searchWindows.map((window) => {
                const next = resetsFor(window, asOf + lastEnd * HOUR_MS).find(
                  (instant) => instant > asOf + lastEnd * HOUR_MS,
                )
                return next === undefined ? earliest : (next - asOf) / HOUR_MS
              }),
            )
            return Math.max(lastEnd, lastReset)
          }
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
                      (reservationsBySlot.get(slot.id) ?? []).every(
                        (entry) => !(entry.start < end && start < entry.end),
                      ),
                    )
              if (relaxation !== 'slots' && available.length < count) {
                // Jump directly to the first interval with enough actual slots.
                // Each slot's reservations are sorted once when a lane is placed;
                // gaps remain available, including work inserted before a wait.
                const times = eligible
                  .map((slot) => {
                    let free = start
                    const reservations = reservationsBySlot.get(slot.id) ?? []
                    for (const entry of reservations) {
                      if (entry.start >= free + duration) return free
                      if (entry.start < free + duration && free < entry.end) free = entry.end
                    }
                    return free
                  })
                  .toSorted((a, b) => a - b)
                start = times[count - 1] ?? refuse('missing-slot')
                if (best && start + duration > best.end) return undefined
                continue
              }
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
                  if (isFeasible([...assigned, candidate], candidate, windowsByAccount))
                    return { candidate, isLimited: false }
                  hints.push(...quotaHints)
                }
                return { candidate: undefined, isLimited: false }
              }
              // The common single-account case has exactly one allocation.
              // Avoid constructing a recursive generator for each trial/lane.
              const single = groups.length === 1 ? groups[0] : undefined
              const slots = single
                ? Array.from(
                    { length: count },
                    (_, index) => single[index % single.length] ?? refuse('missing-slot'),
                  )
                : undefined
              const singleCandidate = slots ? { lane, machine, slots, start, end } : undefined
              const match = singleCandidate
                ? {
                    candidate: isFeasible(
                      [...assigned, singleCandidate],
                      singleCandidate,
                      windowsByAccount,
                    )
                      ? singleCandidate
                      : undefined,
                    isLimited: false,
                  }
                : exact()
              if (singleCandidate && !match.candidate) hints.push(...quotaHints)
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
                  if (isFeasible([...assigned, candidate], candidate, windowsByAccount))
                    return candidate
                  hints.push(...quotaHints)
                }
                if (hints.length === 0 && start >= lastEnd && start >= finalBoundary())
                  refuse(`account-selection-limit:${lane.id}`)
              }
              // After all existing reservations finish and every reported window
              // renews, more identical empty periods cannot cure a structural
              // capacity/rate/retention failure for a nonpreemptive lane.
              if (hints.length === 0 && start >= lastEnd && start >= finalBoundary())
                return undefined
              const future = [...hints, ...reservationPoints.filter((time) => time > start)]
              for (const window of searchWindows) {
                const next = resetsFor(window, asOf + start * HOUR_MS).find(
                  (instant) => instant > asOf + start * HOUR_MS,
                )
                if (next !== undefined) future.push((next - asOf) / HOUR_MS)
              }
              if (future.length === 0) return undefined
              start = Math.min(...future)
              if (best && start + duration > best.end) return undefined
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
        for (const slot of best.slots) {
          const reservations = reservationsBySlot.get(slot.id) ?? []
          reservations.push(best)
          reservations.sort((a, b) => a.start - b.start)
          reservationsBySlot.set(slot.id, reservations)
        }
        reservationPoints = [...new Set([...reservationPoints, best.start, best.end])].toSorted(
          (a, b) => a - b,
        )
        assignedById.set(lane.id, best)
        completed(lane, best.end)
      }
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
        const entry = assignedById.get(id)
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
        const entry = assignedById.get(id)
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
        finishHours: Math.max(0, ...finishes.values()),
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
