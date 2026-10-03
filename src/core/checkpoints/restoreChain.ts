// Restore by the tools' own writes (M86, PLAN.md D63): which files a restore
// or a Redo writes back, and why it leaves the others as they are
// (docs/design/m86-restore-by-tool-writes.md, sections 3, 4, 6.4, 8 and 9).
// A restore reverses only writes the model's own file tools made, and only
// along an unbroken chain of bytes that ends in exactly what is on disk now:
// the first write's before goes back while the file still holds the last
// write's after. Pure: the host reads the unit records, the other writes and
// each path's state now (under the same canonical keys the writes use) and
// carries out what comes back.

import type {
  ContentState,
  FoldedWrite,
  PathDecision,
  PathRefusal,
  RangeDecision,
  RangeInput,
  RangeRefusal,
  UnitRecord,
  WriteRecord,
} from './toolWrites'

type AnyUnit = RangeInput['units'][number]
type LegacyUnit = Extract<AnyUnit, { readonly legacy: true }>

/** Why the writes to one path across windows cannot be put in order (spec 4). */
type OrderRefusal = 'orderUnknown' | 'changedBetween'

/** A path's writes in the order they were published, or why that order cannot be told. */
type Ordered =
  | { readonly kind: 'ordered'; readonly writes: readonly FoldedWrite[] }
  | {
      readonly kind: 'refused'
      readonly reason: OrderRefusal
      /** Known when exactly one write could have come first. */
      readonly first: FoldedWrite | undefined
    }

type Range =
  | { readonly ok: true; readonly start: UnitRecord; readonly units: readonly UnitRecord[] }
  | { readonly ok: false; readonly reason: RangeRefusal }

interface PathWrites {
  readonly path: string
  /** The range's writes to the path that may have changed it (aborted ones did not). */
  readonly writes: readonly FoldedWrite[]
  readonly order: Ordered
}

interface PathContext {
  readonly path: string
  readonly current: ContentState
  /** Writes to the path by other conversations and by this one's units before the range. */
  readonly foreign: readonly WriteRecord[]
}

/**
 * Bytes and presence decide; the mode never does (spec 3.7). A file whose
 * bytes are not known matches nothing.
 */
function isSameContent(left: ContentState, right: ContentState): boolean {
  return left.present
    ? right.present && left.oid !== undefined && left.oid === right.oid
    : !right.present
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): ReadonlyMap<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const group = groups.get(key)
    if (group === undefined) {
      groups.set(key, [item])
    } else {
      group.push(item)
    }
  }
  return groups
}

function isLegacy(unit: AnyUnit): unit is LegacyUnit {
  return 'legacy' in unit
}

function isFromUnit(unit: AnyUnit, from: RangeInput['from']): boolean {
  return isLegacy(unit)
    ? from.unitKind === 'turn' && unit.turnId === from.unitId
    : unit.owner.unitKind === from.unitKind && unit.owner.unitId === from.unitId
}

/**
 * Spec 3.1 and 7: the range is every unit of the conversation numbered from
 * the start on, its own restore and Redo batches included. An M72 unit in it
 * refuses the whole range: its writes were never recorded one by one.
 */
function selectRange(input: RangeInput): Range {
  const start = input.units.find((unit) => isFromUnit(unit, input.from))
  if (start === undefined) {
    return { ok: false, reason: 'writesIncomplete' }
  }
  const inRange = input.units.filter((unit) => unit.sequence >= start.sequence)
  return isLegacy(start) || inRange.some((unit) => isLegacy(unit))
    ? { ok: false, reason: 'legacyInRange' }
    : { ok: true, start, units: inRange.flatMap((unit) => (isLegacy(unit) ? [] : [unit])) }
}

/**
 * Spec 3.2: every turn the transcript lists from the start on, the turns of
 * the child sessions they started included, has a record in the range, and
 * every unit in the range is complete. Otherwise a turn may have written
 * files nobody recorded, and restoring the rest would undo only part of it.
 */
function isComplete(units: readonly UnitRecord[], transcriptTurnIds: readonly string[]): boolean {
  const recordedTurns = new Set(
    units.filter((unit) => unit.owner.unitKind === 'turn').map((unit) => unit.owner.unitId),
  )
  return (
    units.every((unit) => unit.status === 'complete') &&
    transcriptTurnIds.every((turnId) => recordedTurns.has(turnId))
  )
}

/**
 * Spec 4, across windows: merges the windows' lists taking list heads only.
 * It starts from the one head whose before no other write left behind, then
 * always takes the one head that starts from the bytes the last one left.
 * Two candidates refuse (`orderUnknown`) even where only one would complete:
 * any two merges the bytes allow share the first before and the last after,
 * so the refusal never hides a different answer. No candidate after the
 * start means something else changed the file between them.
 */
function mergeHeads(lists: readonly (readonly FoldedWrite[])[]): Ordered {
  const all = lists.flat()
  const merged: FoldedWrite[] = []
  let rest = lists
  while (merged.length < all.length) {
    const last = merged.at(-1)
    const isNext = (head: FoldedWrite): boolean =>
      last === undefined
        ? all.every((other) => other === head || !isSameContent(other.after, head.before))
        : isSameContent(head.before, last.after)
    const candidates = rest.flatMap((list) => {
      const [head, ...tail] = list
      return head !== undefined && isNext(head) ? [{ list, head, tail }] : []
    })
    const [next, ...others] = candidates
    if (next === undefined || others.length > 0) {
      const reason = next === undefined && last !== undefined ? 'changedBetween' : 'orderUnknown'
      return { kind: 'refused', reason, first: merged[0] }
    }
    merged.push(next.head)
    rest = rest.map((list) => (list === next.list ? next.tail : list))
  }
  return { kind: 'ordered', writes: merged }
}

/**
 * Spec 4: one window's writes go by its own counter, across every owner (a
 * parent turn, its child turns, batches), as one lock per path made the
 * counter's order the order of publication.
 */
function inSeqOrder(writes: readonly FoldedWrite[]): readonly FoldedWrite[] {
  return writes.toSorted((left, right) => left.seq - right.seq)
}

/** Spec 4: one window's writes in its own order; several windows' merged by bytes. */
function orderWrites(writes: readonly FoldedWrite[]): Ordered {
  const lists = Array.from(groupBy(writes, (write) => write.instance).values(), (list) =>
    inSeqOrder(list),
  )
  return lists.length > 1 ? mergeHeads(lists) : { kind: 'ordered', writes: lists[0] ?? [] }
}

/**
 * Spec 6.4: an unsettled write (its outcome never reached the journal) is
 * judged by the file's bytes only as its path's known last write in the
 * range. Anywhere else, or where the order cannot be told, it is unknown
 * whether the chain passes through it.
 */
function hasUnsettledElsewhere({ writes, order }: PathWrites): boolean {
  const last = order.kind === 'ordered' ? order.writes.at(-1) : undefined
  return writes.some((write) => write.outcome === 'unsettled' && write !== last)
}

/**
 * Spec 6.4: an unsettled last write happened when the file holds its after,
 * and did not when it holds its before (it then drops out); anything else
 * changed the file after it.
 */
function settleLast(
  order: readonly FoldedWrite[],
  current: ContentState,
): readonly FoldedWrite[] | 'changedAfter' {
  const last = order.at(-1)
  if (last?.outcome !== 'unsettled' || isSameContent(current, last.after)) {
    return order
  }
  return isSameContent(current, last.before) ? order.slice(0, -1) : 'changedAfter'
}

/**
 * Spec 3.3: a foreign write breaks the chain when its place is known, that
 * is, its window wrote the path in the chain both before and after it,
 * whatever bytes it wrote. Another window's writes have no known place:
 * bytes judge them (the ABA limit, spec 12).
 */
function isBetween(foreign: WriteRecord, chain: readonly FoldedWrite[]): boolean {
  const sameWindow = chain.filter((write) => write.instance === foreign.instance)
  return (
    sameWindow.some((write) => write.seq < foreign.seq) &&
    sameWindow.some((write) => write.seq > foreign.seq)
  )
}

/** Spec 3.3: each write starts from the bytes the one before it left. */
function isUnbroken(chain: readonly FoldedWrite[]): boolean {
  return chain.every((write, index) => {
    const previous = chain[index - 1]
    return previous === undefined || isSameContent(previous.after, write.before)
  })
}

/**
 * Spec 9: every folder the chain's writes created, innermost first. They are
 * all folders above one path, so a longer name is a deeper folder.
 */
function createdFolders(chain: readonly FoldedWrite[]): readonly string[] {
  return [...new Set(chain.flatMap((write) => write.createdFolders))].toSorted(
    (left, right) => right.length - left.length,
  )
}

function refused(context: PathContext, reason: PathRefusal): PathDecision {
  return { kind: 'refused', path: context.path, reason }
}

/**
 * Spec 3.4 first, then 9: a file that already holds the first write's before
 * is unchanged, whatever happened since; otherwise one write whose copy was
 * not kept leaves the whole path unrestorable. `undefined`: neither applies.
 */
function decideBeforeChain(
  context: PathContext,
  first: FoldedWrite | undefined,
  chainWrites: readonly FoldedWrite[],
): PathDecision | undefined {
  if (first !== undefined && isSameContent(context.current, first.before)) {
    return { kind: 'unchanged', path: context.path }
  }
  return chainWrites.some((write) => !write.isKept) ? refused(context, 'notKept') : undefined
}

/**
 * Spec 3.3, 3.5, 3.6 and 3.7 on the writes that happened, in order: an
 * unbroken chain whose last after the file still holds goes back to the
 * first before. An existing file keeps its current mode; a recreated one
 * gets the first before's.
 */
function decideChain(context: PathContext, chain: readonly FoldedWrite[]): PathDecision {
  const [first] = chain
  const last = chain.at(-1)
  if (first === undefined || last === undefined) {
    // No write happened (an unsettled one did not): the file is as before.
    return { kind: 'unchanged', path: context.path }
  }
  if (!isUnbroken(chain) || context.foreign.some((write) => isBetween(write, chain))) {
    return refused(context, 'changedBetween')
  }
  if (!isSameContent(context.current, last.after)) {
    return refused(context, 'changedAfter')
  }
  const { before } = first
  return {
    kind: 'restore',
    path: context.path,
    expect: context.current,
    target:
      before.present && context.current.present
        ? { ...before, mode: context.current.mode }
        : before,
    removeFolders: before.present ? [] : createdFolders(chain),
  }
}

/** Spec 3 for a restore: the range's writes to the path make the chain. */
function decideRestore(context: PathContext, { writes, order }: PathWrites): PathDecision {
  const first = order.kind === 'ordered' ? order.writes[0] : order.first
  const early = decideBeforeChain(context, first, writes)
  if (early !== undefined) {
    return early
  }
  if (order.kind === 'refused') {
    return refused(context, order.reason)
  }
  const happened = settleLast(order.writes, context.current)
  return happened === 'changedAfter' ? refused(context, happened) : decideChain(context, happened)
}

/**
 * Spec 8: a Redo of batch B undoes B's own writes to the path by the same
 * rule, and a write any later unit made to the path breaks it, wherever it
 * falls. A path already at B's befores (the Redo's targets) is unchanged.
 */
function decideRedo(
  context: PathContext,
  { writes, order }: PathWrites,
  batchWriteIds: ReadonlySet<string>,
): PathDecision {
  // B ran in one window, so its own writes go by that window's counter.
  const batchWrites = inSeqOrder(writes.filter((write) => batchWriteIds.has(write.id)))
  const early = decideBeforeChain(context, batchWrites[0], batchWrites)
  if (early !== undefined) {
    return early
  }
  // An order that cannot be told takes two windows, and B ran in one: a
  // later unit wrote the path, which the next check refuses.
  const happened = order.kind === 'ordered' ? settleLast(order.writes, context.current) : writes
  if (happened === 'changedAfter') {
    return refused(context, happened)
  }
  return happened.some((write) => !batchWriteIds.has(write.id))
    ? refused(context, 'changedBetween')
    : decideChain(context, happened)
}

function currentState(input: RangeInput, path: string): ContentState {
  const current = input.current.get(path)
  if (current === undefined) {
    throw new Error(`The restore was not given the current state of ${path}`)
  }
  return current
}

/** What a restore from `input.from` on, or a Redo of it, does with each path. */
export function decideRange(input: RangeInput): RangeDecision {
  const range = selectRange(input)
  if (!range.ok) {
    return range
  }
  if (!isComplete(range.units, input.transcriptTurnIds)) {
    return { ok: false, reason: 'writesIncomplete' }
  }
  const counted = range.units
    .flatMap((unit) => unit.writes)
    .filter((write) => write.outcome !== 'aborted')
  const paths: PathWrites[] = [...groupBy(counted, (write) => write.path)].map(
    ([path, writes]) => ({ path, writes, order: orderWrites(writes) }),
  )
  if (paths.some((entry) => hasUnsettledElsewhere(entry))) {
    return { ok: false, reason: 'writesIncomplete' }
  }
  const batchWriteIds = new Set(range.start.writes.map((write) => write.id))
  const decided =
    input.mode === 'restore'
      ? paths
      : paths.filter((entry) => entry.writes.some((write) => batchWriteIds.has(write.id)))
  return {
    ok: true,
    paths: decided.map((entry) => {
      const context: PathContext = {
        path: entry.path,
        current: currentState(input, entry.path),
        foreign: input.foreignWrites.filter((write) => write.path === entry.path),
      }
      return input.mode === 'restore'
        ? decideRestore(context, entry)
        : decideRedo(context, entry, batchWriteIds)
    }),
    ranProcesses: range.units.some((unit) => unit.ranProcesses),
  }
}
