// The seams lane T builds against while lanes R (roles, `sameModel`), A
// (pools, meters, the ledger, paid `teamWorkers`) and K (probes, process
// lifetime) land in parallel (PLAN.md M96 lanes table). Every seam is an
// explicit interface plus an injected dependency: production code here never
// fakes what those lanes own, it refuses or stays single-model without them.

/** Where a pool entry's model runs (PLAN.md D75). */
export type TeamAgentKind = 'engine' | 'musecode' | 'external'

/**
 * One custom (non-Default) pool entry as the single-model check sees it.
 * Lane R (`teamConfig.ts`) owns the full entry; this is the projection the
 * declaration rule needs.
 */
export interface TeamCustomEntryRef {
  /** Stable within the workspace team; used only to match probe results. */
  readonly entryId: string
  /** The model id M95's registry gives it, whatever serves it. */
  readonly modelId: string
  readonly kind: TeamAgentKind
  /** An engine entry billed to a key: it needs `teamWorkers` on. */
  readonly billsKey: boolean
  /** Installed, signed in, its key present, its provider reachable. */
  readonly isAvailable: boolean
}

/**
 * Everything `decideTeamConversationMode` needs, read where the conversation
 * starts. Lane R supplies the entries and `sameModel`; lane K the probe
 * results behind `isEntryReady`; lane A the paid `teamWorkers` gate behind
 * `teamWorkersOn`. The host reads each once per conversation start: no probe
 * runs on a conversation's path.
 */
export interface TeamDecisionSource {
  /** `museSpark.team`, on by default. */
  readonly teamSwitchOn: boolean
  /** The workspace uses the Solo template: no team tools, ever. */
  readonly soloTemplate: boolean
  /** The orchestrator slot's model id (the picker, or the workspace override). */
  readonly orchestratorModelId: string
  /** Custom entries across every role (Default is never listed: it resolves to the slot). */
  readonly customEntries: readonly TeamCustomEntryRef[]
  /** Lane R's `sameModel`: model ids compared whatever serves them. */
  readonly isSameModel: (a: string, b: string) => boolean
  /**
   * The entry's latest probe in this window showed its own model observably
   * loaded (listed, served, or selected). Unknown entries are not ready.
   */
  readonly isEntryReady: (entryId: string) => boolean
  /** Lane A's paid `teamWorkers`: key-billed tasks ask the D48 popup. */
  readonly teamWorkersOn: boolean
}

/** What `roster` may show: the pools as set, without live numbers. */
export interface TeamStableEntry {
  readonly entryId: string
  readonly agentLabel: string
  readonly modelId: string
  readonly kind: TeamAgentKind
  /** Caps as set, e.g. "200K tokens/task". */
  readonly caps: readonly string[]
}

/** One role as the roster's stable part shows it. */
export interface TeamStableRole {
  readonly roleId: string
  readonly workspaceMode: 'read-only' | 'own-branch' | 'in-place'
  /** Tool groups, e.g. ["read", "codeIntel"]. */
  readonly toolGroups: readonly string[]
  readonly pool: readonly TeamStableEntry[]
  readonly exhaustedPolicy: 'ask' | 'queue' | 'self'
  /** The routing text, at most 240 characters. */
  readonly whenToUse: string
}

/** What the roster's live part shows: headroom and states, never caps as set. */
export interface TeamLiveEntry {
  readonly entryId: string
  readonly roleId: string
  /** e.g. "3/5 free, 0.4M of 2.0M tokens today". */
  readonly headroom: string
  /** ready, capped and why, rate-limited until, at its usage limit until, unavailable and why. */
  readonly state: string
}

/** The live numbers behind one `roster` answer; lane A supplies them. */
export interface TeamRosterLive {
  readonly entries: readonly TeamLiveEntry[]
  readonly queueDepth: number
  readonly unmergedTasks: number
  /** e.g. "$3.20 of $10.00 left today". */
  readonly budgetLeft: string
}

/**
 * The team runner lanes A (pools, admission), W (workers) and I (merge)
 * supply. Lane T declares the tools and refuses honestly without one: a
 * missing runner is an explicit error, never an empty success.
 */
export interface TeamToolRunner {
  readonly delegate: (args: Readonly<Record<string, unknown>>) => Promise<TeamToolResult>
  readonly collect: (args: Readonly<Record<string, unknown>>) => Promise<TeamToolResult>
  readonly cancel: (args: Readonly<Record<string, unknown>>) => Promise<TeamToolResult>
  readonly merge: (args: Readonly<Record<string, unknown>>) => Promise<TeamToolResult>
}

/** One answered team tool call, as the model and the transcript read it. */
export interface TeamToolResult {
  readonly output: string
  readonly visibleOutput: string
}
