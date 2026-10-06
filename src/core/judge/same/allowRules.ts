// The Muse Code judge's user-settings allow-rule check (M98 lane S, PLAN.md
// D77): before each batch, the extension reads the CLI's user-level settings
// and turns the judge off on any standing always-allow rule for shell, write
// or network, since MSP cannot disable native tools (D69).
//
// Shapes below are captured from the installed Muse Code 1.4.2 binary
// (about 175 offline probes: `serve --provider echo` plus `skills list` and
// `config status`, no model call; docs/certification/m98-s.md names each
// observation): settings.json needs `schema_version: 1`; the `permissions`
// block needs its own `schema_version: 1` and holds `default_profile` (a
// dangling name is refused per session as "profile does not exist") and
// `profiles` (anything else in the block is refused as "unknown user
// permissions field"); a profile holds `description` (a string), `extends`
// (a parent's name, refused when missing), `workspace_roots`, `network` and
// `filesystem` (anything else is refused as "unknown field"), and a
// parentless profile must define all four dimensions; `network` is a struct
// with `mode` (`restricted`, `proxy_only` and `enabled` observed; `enabled`
// is unrestricted network) and `targets` (a map); `filesystem` takes
// `{"mode": ...}` with `read`, `write` and `deny` observed (`write` edits
// without asking). `run.code_mode` is an `enabled`/`off` toggle of unknown
// purpose and is not read here.
//
// The check is a guard, not a proof (D77): it fails closed. Anything it
// cannot verify — an unreadable or malformed file, a dangling profile, an
// unrecognized filesystem or network value, a non-empty network target map,
// or a dimension beyond the captured ones (the parentless profile needs two
// more than `network` and `filesystem`, whose names are unidentified, and
// either may allow shell) — turns the judge off. Unknown fields elsewhere
// are kept, not dropped (D36, M43). Pure; no `vscode` import.

import * as z from 'zod/mini'

/** Standing allow rules turn the Muse Code judge off; this says which check. */
export type StandingAllowVerdict =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: StandingAllowBlocker }

/**
 * Why the judge stays off. Reason codes, not user text: lane U says them
 * through lane 0's strings.
 */
export type StandingAllowBlocker =
  /** No settings text to read (no file): no evidence of standing rules. */
  | 'no-settings'
  /** The settings cannot be verified: unreadable, malformed or dangling. */
  | 'settings-unreadable'
  /** A standing always-allow rule for shell, write or network. */
  | 'standing-allow-rules'

const settingsSchema = z.looseObject({
  schema_version: z.literal(1),
  permissions: z.optional(z.unknown()),
})

const permissionsSchema = z.looseObject({
  schema_version: z.literal(1),
  default_profile: z.optional(z.string().check(z.minLength(1))),
  profiles: z.optional(z.record(z.string(), z.unknown())),
})

/** A profile as far as the check reads it; every other field is kept aside. */
const profileSchema = z.looseObject({
  description: z.optional(z.string()),
  extends: z.optional(z.string().check(z.minLength(1))),
  workspace_roots: z.optional(z.unknown()),
  network: z.optional(z.unknown()),
  filesystem: z.optional(z.unknown()),
})

const dimensionSchema = z.looseObject({
  mode: z.optional(z.string()),
  targets: z.optional(z.unknown()),
})

/** Dimension keys the capture identifies; anything else fails closed. */
const KNOWN_PROFILE_KEYS: ReadonlySet<string> = new Set([
  'description',
  'extends',
  'workspace_roots',
  'network',
  'filesystem',
])

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Follow `extends` to the standing profile; undefined when it cannot resolve. */
function resolveProfile(
  profiles: Readonly<Record<string, unknown>>,
  name: string,
  seen: readonly string[] = [],
): Readonly<Record<string, unknown>> | undefined {
  if (seen.includes(name)) {
    return undefined
  }
  const raw = profiles[name]
  if (!isRecord(raw)) {
    return undefined
  }
  const parsed = profileSchema.safeParse(raw)
  if (!parsed.success) {
    return undefined
  }
  const parent = parsed.data.extends
  if (parent === undefined) {
    return parsed.data
  }
  const resolved = resolveProfile(profiles, parent, [...seen, name])
  return resolved === undefined ? undefined : { ...resolved, ...parsed.data }
}

/** Whether the resolved default profile provably allows nothing standing. */
function isRestrictive(profile: Readonly<Record<string, unknown>>): boolean {
  for (const key of Object.keys(profile)) {
    if (!KNOWN_PROFILE_KEYS.has(key)) {
      // An unidentified dimension: a parentless profile needs two more than
      // `network` and `filesystem`, and either may allow shell. Unverified
      // means off.
      return false
    }
  }
  // Both captured dimensions must be present and restrictive: a profile the
  // CLI would refuse (a parentless one missing dimensions) governs no
  // session, and an absent dimension proves nothing about what it allows.
  const filesystem = profile['filesystem']
  if (!isRecord(filesystem)) {
    return false
  }
  // `write` edits without asking (a standing write allow); only `read` and
  // `deny` provably allow nothing.
  if (filesystem['mode'] !== 'read' && filesystem['mode'] !== 'deny') {
    return false
  }
  const network = profile['network']
  const parsed = dimensionSchema.safeParse(network)
  if (!parsed.success) {
    return false
  }
  // `enabled` is unrestricted network (a standing network allow); only
  // `restricted` and `proxy_only` provably allow nothing standing.
  if (parsed.data.mode !== 'restricted' && parsed.data.mode !== 'proxy_only') {
    return false
  }
  // A non-empty target map may hold standing per-target allows.
  const targets = parsed.data.targets
  return targets === undefined || (isRecord(targets) && Object.keys(targets).length === 0)
}

/**
 * Whether the Muse Code judge may run under the user's CLI settings text
 * (undefined when the file is missing). Missing settings mean the CLI's own
 * defaults, which hold no standing allows. Anything unverifiable, or any
 * standing always-allow for shell, write or network, turns the judge off.
 */
export function checkStandingAllowRules(settingsText: string | undefined): StandingAllowVerdict {
  if (settingsText === undefined) {
    return { allowed: true }
  }
  let settings: unknown
  try {
    settings = JSON.parse(settingsText) as unknown
  } catch {
    return { allowed: false, reason: 'settings-unreadable' }
  }
  const parsedSettings = settingsSchema.safeParse(settings)
  if (!parsedSettings.success) {
    return { allowed: false, reason: 'settings-unreadable' }
  }
  const permissions = parsedSettings.data.permissions
  if (permissions === undefined) {
    return { allowed: true }
  }
  const parsedPermissions = permissionsSchema.safeParse(permissions)
  if (!parsedPermissions.success) {
    return { allowed: false, reason: 'settings-unreadable' }
  }
  const { default_profile: defaultProfile, profiles } = parsedPermissions.data
  if (defaultProfile === undefined) {
    // No standing selection: new sessions run the CLI's built-in default.
    return { allowed: true }
  }
  if (profiles === undefined) {
    return { allowed: false, reason: 'settings-unreadable' }
  }
  const resolved = resolveProfile(profiles, defaultProfile)
  if (resolved === undefined) {
    return { allowed: false, reason: 'settings-unreadable' }
  }
  return isRestrictive(resolved)
    ? { allowed: true }
    : { allowed: false, reason: 'standing-allow-rules' }
}
