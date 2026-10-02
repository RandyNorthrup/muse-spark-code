// Restore by the tools' own writes (M86, PLAN.md D63): the shared shapes.
//
// A restore reverses only writes the model's own file tools made, and only
// along an unbroken chain of bytes that ends in exactly what is on disk now.
// The recorder (host) journals each write; the unit store (host) folds a
// unit's writes into its record; the engine (core, pure) decides each path.
// These types are the contract between them; change them only through the
// lead (scratchpad m86/SPEC.md is the design).

/** A file's content as far as a restore cares: presence, bytes, execute bit. */
export interface ContentState {
  readonly present: boolean
  /** The git blob id of the bytes (`gitBlobOid`); absent when not present. */
  readonly oid?: string | undefined
  /** `100644` or `100755`; absent when not present or not known. */
  readonly mode?: string | undefined
}

/** A turn of a conversation, or a restore or Redo of it (a batch). */
export type UnitKind = 'turn' | 'batch'

/** Who made a write: one unit of one conversation, in one extension-host lifetime. */
export interface Owner {
  /** One extension-host lifetime of one window; a reload is a new instance. */
  readonly instance: string
  readonly sessionId: string
  readonly unitKind: UnitKind
  /** The turn id, or the batch id. */
  readonly unitId: string
}

/** One recorded publication by an owner to one file. */
export interface WriteRecord {
  readonly id: string
  readonly instance: string
  /** The instance's own counter, taken at intent time: its writes' order. */
  readonly seq: number
  readonly owner: Owner
  /** Canonical workspace-relative path, `/`-separated, compared exactly. */
  readonly path: string
  readonly before: ContentState
  readonly after: ContentState
  /** Every folder this write created, outermost first. */
  readonly createdFolders: readonly string[]
  /** False when a blob this write needs (its before, or its after for Redo) was not kept. */
  readonly isKept: boolean
}

/** One line of an instance's journal. */
export type JournalEntry =
  | { readonly kind: 'intent'; readonly write: WriteRecord }
  | { readonly kind: 'done'; readonly id: string }
  | { readonly kind: 'aborted'; readonly id: string }
  /** The unit passed its intent budget: written before the first unrecorded write. */
  | { readonly kind: 'incomplete'; readonly owner: Owner }
  | { readonly kind: 'seal'; readonly owner: Owner }

/** How a write ended, as its unit's fold records it (spec 6.3). */
export type WriteOutcome = 'done' | 'aborted' | 'unsettled'

/** A write as its unit's record keeps it. */
export interface FoldedWrite extends WriteRecord {
  readonly outcome: WriteOutcome
}

/** A unit's stored record (a CAS ref under the M86 root). */
export interface UnitRecord {
  readonly owner: Owner
  /** From the conversation's CAS allocator: unique within the conversation. */
  readonly sequence: number
  readonly createdAt: number
  readonly endedAt?: number | undefined
  /**
   * `complete`: sealed (or recovered) with no `incomplete` marker and no
   * unparsed torn journal line; unsettled writes stay as outcomes and are
   * decided at restore time (spec 6.4). Otherwise `incomplete`.
   */
  readonly status: 'complete' | 'incomplete'
  /** It invoked a process-starting tool, a hook or an MCP tool, or had a background task alive. */
  readonly ranProcesses: boolean
  /** Every write of the unit, by write id, with its outcome. */
  readonly writes: readonly FoldedWrite[]
}

/** Why one path is not restored. */
export type PathRefusal =
  | 'changedAfter'
  | 'changedBetween'
  | 'orderUnknown'
  | 'unsaved'
  | 'linked'
  | 'notKept'
  | 'tooLarge'
  | 'failed'

/** What a restore does with one path. */
export type PathDecision =
  | {
      readonly kind: 'restore'
      readonly path: string
      /** What the file must still be at the moment of the write. */
      readonly expect: ContentState
      /** What it becomes (absent: deleted). */
      readonly target: ContentState
      /** Folders to remove, innermost first, when empty after a deletion. */
      readonly removeFolders: readonly string[]
    }
  | { readonly kind: 'unchanged'; readonly path: string }
  | { readonly kind: 'refused'; readonly path: string; readonly reason: PathRefusal }

/** Why a whole range is refused. */
export type RangeRefusal = 'writesIncomplete' | 'legacyInRange' | 'legacyWindowOpen'

/** The engine's answer for a restore or Redo. */
export type RangeDecision =
  | {
      readonly ok: true
      readonly paths: readonly PathDecision[]
      /** A unit in range ran processes: the outcome says their changes are not undone. */
      readonly ranProcesses: boolean
    }
  | { readonly ok: false; readonly reason: RangeRefusal }

/** Everything the pure engine needs, read by the host before it decides. */
export interface RangeInput {
  /** Every unit of the conversation (any instance), legacy ones flagged. */
  readonly units: readonly (
    UnitRecord | { readonly legacy: true; readonly sequence: number; readonly turnId: string }
  )[]
  /** The unit the restore starts at (a turn id), or the batch a Redo replays. */
  readonly from: { readonly unitKind: UnitKind; readonly unitId: string }
  /** `restore`: from `from` onward; `redo`: the batch's writes reversed, with later units as breakers. */
  readonly mode: 'restore' | 'redo'
  /** The transcript's turn ids of the conversation from `from` on (spec 3.2). */
  readonly transcriptTurnIds: readonly string[]
  /** Writes by other conversations (and units of this one outside the range), for barriers. */
  readonly foreignWrites: readonly WriteRecord[]
  /** Each path's state on disk now, re-resolved canonically. */
  readonly current: ReadonlyMap<string, ContentState>
}
