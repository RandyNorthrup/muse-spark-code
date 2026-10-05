// Import and export (M96 lane F, PLAN.md D75): a team is exported as
// JSON — roles and their charters' user text, keys and tool sets, pools
// as model references with their caps, and policies — and an import opens
// as a draft. Pure; no `vscode` import.
//
// An export never holds a credential, an endpoint, a provider definition
// or a command line (M95's trust rule): the builder only copies the
// allowlisted fields, so those shapes cannot reach the file. An import is
// parsed with zod and refused whole on an unknown key; an entry whose
// model or agent the user does not have is marked missing, to be mapped
// to one they have or removed.

import * as z from 'zod/mini'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { TeamCapDraft, TeamDraft, TeamEntryDraft, TeamRoleDraft } from './templates'

/** The export format marker and version. */
export const TEAM_EXPORT_FORMAT = 'muse-spark-team'
export const TEAM_EXPORT_VERSION = 1

const teamCapSchema = z.object({
  measure: z.enum(['tokens', 'usd', 'tasks', 'minutes']),
  window: z.enum(['task', 'day', 'lifetime']),
  amount: z.number(),
})

const teamEntrySchema = z.object({
  modelRef: z.string(),
  caps: z.array(teamCapSchema),
})

const teamRoleSchema = z.object({
  role: z.string(),
  mode: z.enum(['read-only', 'own-branch', 'in-place']),
  toolGroups: z.array(z.string()),
  charterText: z.optional(z.string()),
  pool: z.array(teamEntrySchema),
})

/**
 * The import schema: strict — an unknown key refuses the file whole
 * (D75). `z.object` in zod-mini strips unknown keys, so the check below
 * compares the parsed keys against the raw ones explicitly.
 */
const teamImportSchema = z.object({
  format: z.literal(TEAM_EXPORT_FORMAT),
  version: z.literal(TEAM_EXPORT_VERSION),
  template: z.enum(['solo', 'pair', 'full', 'custom']),
  roles: z.array(teamRoleSchema),
})

export type TeamImportDocument = z.infer<typeof teamImportSchema>

const KNOWN_TOP_KEYS: readonly string[] = ['format', 'version', 'template', 'roles']
const KNOWN_ROLE_KEYS: readonly string[] = ['role', 'mode', 'toolGroups', 'charterText', 'pool']
const KNOWN_ENTRY_KEYS: readonly string[] = ['modelRef', 'caps']
const KNOWN_CAP_KEYS: readonly string[] = ['measure', 'window', 'amount']

function unknownKeyOf(value: unknown, known: readonly string[]): string | undefined {
  return typeof value !== 'object' || value === null || Array.isArray(value)
    ? undefined
    : Object.keys(value).find((key) => !known.includes(key))
}

/** One field off a raw object, without a cast. */
function fieldOf(value: unknown, name: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === name) {
      return entry
    }
  }
  return undefined
}

function arrayOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

/** A draft entry whose model or agent the user lacks, to map or remove. */
export interface TeamMissingEntry {
  readonly role: string
  readonly modelRef: string
  readonly message: string
}

/** An import opened as a draft, with its missing entries marked. */
export interface TeamImportDraft {
  readonly draft: TeamDraft
  /** Each role's charter user text (lane R restores it onto the role). */
  readonly charters: Readonly<Record<string, string>>
  readonly missing: readonly TeamMissingEntry[]
}

/** Why an import was refused whole. */
export interface TeamImportRefusal {
  readonly reason: string
}

/**
 * Parses an import: refused whole on an unknown key or a schema failure.
 * `knownModelRefs` are the model references the user has (M95's picker
 * rows); anything else is marked missing.
 */
export function parseTeamImport(
  raw: unknown,
  knownModelRefs: readonly string[],
): TeamImportDraft | TeamImportRefusal {
  // Unknown keys are checked on the raw value first: zod strips them
  // while parsing, so a post-parse check would miss them.
  const topUnknown = unknownKeyOf(raw, KNOWN_TOP_KEYS)
  if (topUnknown !== undefined) {
    return { reason: fill(UI_TEXT.teamImportUnknownKey, { key: topUnknown }) }
  }
  const rawRoles = arrayOf(fieldOf(raw, 'roles'))
  for (const role of rawRoles) {
    const roleUnknown = unknownKeyOf(role, KNOWN_ROLE_KEYS)
    if (roleUnknown !== undefined) {
      return { reason: fill(UI_TEXT.teamImportUnknownKey, { key: roleUnknown }) }
    }
    const rawEntries = arrayOf(fieldOf(role, 'pool'))
    for (const entry of rawEntries) {
      const entryUnknown = unknownKeyOf(entry, KNOWN_ENTRY_KEYS)
      if (entryUnknown !== undefined) {
        return { reason: fill(UI_TEXT.teamImportUnknownKey, { key: entryUnknown }) }
      }
      const rawCaps = arrayOf(fieldOf(entry, 'caps'))
      for (const cap of rawCaps) {
        const capUnknown = unknownKeyOf(cap, KNOWN_CAP_KEYS)
        if (capUnknown !== undefined) {
          return { reason: fill(UI_TEXT.teamImportUnknownKey, { key: capUnknown }) }
        }
      }
    }
  }
  const parsed = teamImportSchema.safeParse(raw)
  if (!parsed.success) {
    const [issue] = parsed.error.issues
    const where = issue?.path.map(String).join('.')
    return {
      reason: fill(UI_TEXT.teamImportUnknownKey, {
        key: where === undefined || where === '' ? 'document' : where,
      }),
    }
  }
  const missing: TeamMissingEntry[] = []
  const charters: Record<string, string> = {}
  for (const role of parsed.data.roles) {
    if (role.charterText !== undefined) {
      charters[role.role] = role.charterText
    }
  }
  const draft: TeamDraft = {
    template: parsed.data.template,
    roles: parsed.data.roles.map((role) => ({
      role: role.role,
      mode: role.mode,
      toolGroups: [...role.toolGroups],
      pool: role.pool.map((entry) => {
        if (!knownModelRefs.includes(entry.modelRef)) {
          missing.push({
            role: role.role,
            modelRef: entry.modelRef,
            message: fill(UI_TEXT.teamImportMissingEntry, { model: entry.modelRef }),
          })
        }
        const caps: TeamCapDraft[] = entry.caps.map((cap) => ({ ...cap }))
        const draftEntry: TeamEntryDraft = { modelRef: entry.modelRef, caps }
        return draftEntry
      }),
    })),
  }
  return { draft, charters, missing }
}

/**
 * A stored role as the workspace keeps it. Entries may carry live
 * sensitive shapes — a credential record, an endpoint, a provider
 * definition or an external agent's command line — which the export
 * leaves behind (M95's trust rule).
 */
export interface TeamStoredRole {
  readonly role: string
  readonly mode: TeamRoleDraft['mode']
  readonly toolGroups: readonly string[]
  readonly charterText: string | undefined
  readonly pool: readonly {
    readonly modelRef: string
    readonly caps: readonly TeamCapDraft[]
    readonly credentialRecord?: unknown
    readonly endpoint?: unknown
    readonly provider?: unknown
    readonly commandLine?: unknown
  }[]
}

/**
 * Builds the export document from stored roles. Only the allowlisted
 * fields are copied: credentials, endpoints, provider definitions and
 * command lines the stored entries may carry never reach the file, and
 * the test asserts their absence.
 */
export function buildTeamExport(
  template: TeamDraft['template'],
  roles: readonly TeamStoredRole[],
): TeamImportDocument {
  return {
    format: TEAM_EXPORT_FORMAT,
    version: TEAM_EXPORT_VERSION,
    template,
    roles: roles.map((role) => ({
      role: role.role,
      mode: role.mode,
      toolGroups: [...role.toolGroups],
      ...(role.charterText !== undefined && { charterText: role.charterText }),
      pool: role.pool.map((entry) => ({
        modelRef: entry.modelRef,
        caps: entry.caps.map((cap) => ({ ...cap })),
      })),
    })),
  }
}

/** Whether a parsed value is an import refusal. */
export function isTeamImportRefusal(
  value: TeamImportDraft | TeamImportRefusal,
): value is TeamImportRefusal {
  return 'reason' in value
}
