// The Muse Code CLI's skill commands (M30, PLAN.md D30), which MSP does not
// carry: `muse skills list --json` (every skill with its scope and
// activation), `muse skills enable|disable <name> --scope <scope>`, and
// `muse skills import --from claude|codex [--dry-run] --json`. Shapes were
// read from Muse Code 1.3.0's own output on 2026-09-24. A running
// `muse serve` keeps the activation it started with (verified the same day:
// a disabled skill stays listed, even in a new session on that host), so a
// change takes effect when the host restarts.
//
// Pure: the host runs the commands and hands the output here.

import * as z from 'zod/mini'
import type { SkillImportSource } from '../../../shared/constants'

const JSON_FLAG = '--json'
const WORKSPACE_FLAG = '--workspace'
const TRUST_FLAG = '--trust-workspace'
const SCOPE_FLAG = '--scope'
const OFF_ACTIVATION = 'off'
// `muse skills import` copies into the user's own skills folder.
const IMPORT_SCOPE = 'user'

// `list` reports a skill's scope as `bundled`; `enable`/`disable` spell the
// same scope `built-in`.
const SCOPE_FLAG_VALUES: Readonly<Record<string, string>> = {
  bundled: 'built-in',
  user: 'user',
  project: 'project',
  plugin: 'plugin',
}

const catalogSchema = z.object({
  skills: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      display_name: z.optional(z.nullable(z.string())),
      description: z.optional(z.nullable(z.string())),
      scope: z.string(),
      activation: z.string(),
    }),
  ),
})

/** One skill as `muse skills list --json` reports it. */
export interface CatalogSkill {
  /** `bundled:grill`, `user:caveman`: unique across scopes. */
  readonly id: string
  /** What `enable`/`disable` take, with the scope. */
  readonly name: string
  readonly displayName: string
  readonly description: string
  readonly scope: string
  /** `on`, `off`, or `user-only` (invocable by the user, never by the model). */
  readonly activation: string
}

/** An activation change the user asked for. */
export interface ActivationChange {
  readonly skill: CatalogSkill
  readonly isOn: boolean
}

function parseJson(stdout: string, what: string): unknown {
  try {
    return JSON.parse(stdout)
  } catch {
    throw new Error(`Muse Code's ${what} output is not JSON`)
  }
}

/** Throws when the output is not the documented shape: never an empty list that reads as "no skills". */
export function parseSkillCatalog(stdout: string): readonly CatalogSkill[] {
  const parsed = catalogSchema.safeParse(parseJson(stdout, 'skills list'))
  if (!parsed.success) {
    throw new Error(
      `Muse Code's skills list has an unexpected shape: ${z.prettifyError(parsed.error)}`,
    )
  }
  return parsed.data.skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    displayName: skill.display_name ?? skill.name,
    description: skill.description ?? '',
    scope: skill.scope,
    activation: skill.activation,
  }))
}

export function isSkillOn(skill: CatalogSkill): boolean {
  return skill.activation !== OFF_ACTIVATION
}

/** The `--scope` value for a listed scope; undefined for one the CLI cannot toggle. */
export function scopeFlagValue(scope: string): string | undefined {
  return SCOPE_FLAG_VALUES[scope]
}

function workspaceArgs(workspaceRoot: string | undefined, isTrusted: boolean): readonly string[] {
  if (workspaceRoot === undefined) {
    return []
  }
  // Project skills load only in a trusted workspace, as in the panel (D13).
  return [WORKSPACE_FLAG, workspaceRoot, ...(isTrusted ? [TRUST_FLAG] : [])]
}

export function skillsListArgs(
  workspaceRoot: string | undefined,
  isTrusted: boolean,
): readonly string[] {
  return ['skills', 'list', ...workspaceArgs(workspaceRoot, isTrusted), JSON_FLAG]
}

/** The rows whose checkbox changed; a skill with a scope the CLI cannot toggle is left alone. */
export function activationChanges(
  skills: readonly CatalogSkill[],
  pickedIds: ReadonlySet<string>,
): readonly ActivationChange[] {
  return skills
    .filter((skill) => scopeFlagValue(skill.scope) !== undefined)
    .filter((skill) => isSkillOn(skill) !== pickedIds.has(skill.id))
    .map((skill) => ({ skill, isOn: pickedIds.has(skill.id) }))
}

export function activationArgs(
  change: ActivationChange,
  workspaceRoot: string | undefined,
  isTrusted: boolean,
): readonly string[] {
  const scope = scopeFlagValue(change.skill.scope)
  if (scope === undefined) {
    throw new Error(`Muse Code cannot turn ${change.skill.scope} skills on or off`)
  }
  return [
    'skills',
    change.isOn ? 'enable' : 'disable',
    change.skill.name,
    SCOPE_FLAG,
    scope,
    ...workspaceArgs(workspaceRoot, isTrusted),
    JSON_FLAG,
  ]
}

export function skillImportArgs(source: SkillImportSource, isDryRun: boolean): readonly string[] {
  return [
    'skills',
    'import',
    '--from',
    source,
    SCOPE_FLAG,
    IMPORT_SCOPE,
    ...(isDryRun ? ['--dry-run'] : []),
    JSON_FLAG,
  ]
}

// A candidate's `diagnostics` and the other lists' entries carry more than
// this; only what the panel shows is read.
const importEntrySchema = z.object({
  id: z.string(),
  action: z.optional(z.string()),
  valid: z.optional(z.boolean()),
  reason: z.optional(z.nullable(z.string())),
  error: z.optional(z.nullable(z.string())),
})

const importReportSchema = z.object({
  source: z.object({ type: z.string(), path: z.optional(z.nullable(z.string())) }),
  dry_run: z.boolean(),
  candidates: z.array(importEntrySchema),
  installed: z.array(importEntrySchema),
  quarantined: z.array(importEntrySchema),
  skipped: z.array(importEntrySchema),
  failed: z.array(importEntrySchema),
})

export interface ImportEntry {
  readonly id: string
  /** `copy` and so on; the CLI's own word. */
  readonly action: string | undefined
  readonly isValid: boolean
  /** Why it was skipped, quarantined or failed, when the CLI says. */
  readonly reason: string | undefined
}

export interface ImportReport {
  /** Where the CLI looked, when it says. */
  readonly sourcePath: string | undefined
  readonly isDryRun: boolean
  readonly candidates: readonly ImportEntry[]
  readonly installed: readonly ImportEntry[]
  readonly quarantined: readonly ImportEntry[]
  readonly skipped: readonly ImportEntry[]
  readonly failed: readonly ImportEntry[]
}

function entryOf(entry: z.infer<typeof importEntrySchema>): ImportEntry {
  return {
    id: entry.id,
    action: entry.action,
    isValid: entry.valid ?? true,
    reason: entry.reason ?? entry.error ?? undefined,
  }
}

export function parseImportReport(stdout: string): ImportReport {
  const parsed = importReportSchema.safeParse(parseJson(stdout, 'skills import'))
  if (!parsed.success) {
    throw new Error(
      `Muse Code's skills import report has an unexpected shape: ${z.prettifyError(parsed.error)}`,
    )
  }
  const report = parsed.data
  return {
    sourcePath: report.source.path ?? undefined,
    isDryRun: report.dry_run,
    candidates: report.candidates.map((entry) => entryOf(entry)),
    installed: report.installed.map((entry) => entryOf(entry)),
    quarantined: report.quarantined.map((entry) => entryOf(entry)),
    skipped: report.skipped.map((entry) => entryOf(entry)),
    failed: report.failed.map((entry) => entryOf(entry)),
  }
}
