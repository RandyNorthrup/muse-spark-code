// Lane T's tunables (PLAN.md M96 lane T). LANE-T-SEAM (lane 0): relocate
// these into the Team region of `src/shared/constants.ts` at integration,
// beside `TEAM_MODEL_TEXT`; until then this module is their one home, so no
// value is written twice.

/** The MCP server's name on Muse Code sessions; a user's server may not use it. */
export const TEAM_MCP_SERVER_NAME = 'team'

/** `delegate` takes one to six tasks per call (PLAN.md D75). */
export const TEAM_DELEGATE_MAX = 6

/** `collect` pages a large part this many characters at a time. */
export const TEAM_COLLECT_PAGE_CHARS = 16_000

/**
 * The longest a `collect` waits, in seconds. PENDING step 1 (lane P): the
 * measured safe wait under `muse serve`'s MCP call timeout, less a margin.
 * Until it lands, 300 s clamps from above only: a collect that returns early
 * is correct, just less patient, so this errs safe.
 */
export const TEAM_COLLECT_WAIT_MAX_SECONDS = 300

/** The brief a task carries is at most this many characters. */
export const TEAM_BRIEF_MAX_CHARS = 8000

const BYTES_PER_KIB = 1024
const BRIEF_FILES_MAX_KIB = 64
/** Small text files named by a task are inlined up to this many bytes. */
export const TEAM_BRIEF_FILES_MAX_BYTES = BRIEF_FILES_MAX_KIB * BYTES_PER_KIB

/** Random bytes per `team` server session token. */
export const TEAM_MCP_TOKEN_BYTES = 32

/** The rubric's reason codes (PLAN.md D75): every `delegate` task and kept plan item carries one. */
export const TEAM_REASON_CODES = [
  'small',
  'quick_edit',
  'needs_context',
  'handoff_costlier',
  'coupled',
  'asked_you',
  'parallel',
  'specialty',
  'different_model',
  'context_size',
  'long_running',
] as const
export type TeamReasonCode = (typeof TEAM_REASON_CODES)[number]
