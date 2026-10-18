/**
 * The sharing commands' flag tables (PLAN.md D119): one source read by the
 * owner parser (`src/runtime/sharing/args.ts`, which composes them per
 * action) and by the help registry (`src/runtime/cliOptions.ts`, which
 * renders the widest shape a screen can show: a repeated save `--tag`
 * where list takes one, a confirmation value for share where use takes a
 * bare `--confirm`). Plain data with no Node import, so the reference and
 * the webview can read it too; frozen literals keep every flag's name.
 */

/** One sharing flag: the subset of parseArgs option shapes sharing uses. */
export interface SharingFlag {
  readonly type: 'string' | 'boolean'
  readonly short?: string
  readonly multiple?: boolean
}

/** One sharing flag table: frozen literals, so readers keep their names. */
export type SharingFlagTable = Readonly<Record<string, SharingFlag>>

export const SHARING_BASE_FLAGS = {
  cwd: { type: 'string' },
  // Scripts pass --json to receive the machine-readable result; without
  // it the terminal prints only the human preview and review transcript.
  json: { type: 'boolean' },
} as const satisfies SharingFlagTable

export const SHARE_FLAGS = {
  mode: { type: 'string' },
  format: { type: 'string' },
  destination: { type: 'string' },
  out: { type: 'string' },
  from: { type: 'string' },
  to: { type: 'string' },
  'no-code-blocks': { type: 'boolean' },
  'no-attachment-names': { type: 'boolean' },
  diffs: { type: 'boolean' },
  'attachment-content': { type: 'string', multiple: true },
  'exported-at': { type: 'string' },
  confirm: { type: 'string' },
} as const satisfies SharingFlagTable

export const PROMPTS_SCOPE_FLAG = {
  scope: { type: 'string' },
} as const satisfies SharingFlagTable

export const PROMPTS_LIST_FLAGS = {
  search: { type: 'string' },
  tag: { type: 'string' },
} as const satisfies SharingFlagTable

export const PROMPTS_SAVE_FLAGS = {
  title: { type: 'string' },
  tag: { type: 'string', multiple: true },
} as const satisfies SharingFlagTable

export const PROMPTS_USE_FLAGS = {
  chat: { type: 'string' },
  // Scripts supply variables as --var name=value and confirm without
  // the interactive review as --confirm; the terminal prints the
  // prepared text either way (nothing is inserted into an editor).
  var: { type: 'string', multiple: true },
  confirm: { type: 'boolean' },
} as const satisfies SharingFlagTable
