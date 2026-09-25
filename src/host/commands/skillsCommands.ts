// `Muse Spark: Manage Skills` and `Muse Spark: Import Skills from Claude Code
// or Codex` (M30, PLAN.md D30), on the Muse Code CLI's own skill commands
// (MSP has none). A running `muse serve` keeps the skills it started with,
// so a change ends with the offer to restart it. Every VS Code and process
// interaction is injected.

import {
  type ActivationChange,
  activationArgs,
  activationChanges,
  type CatalogSkill,
  type ImportEntry,
  type ImportReport,
  isSkillOn,
  parseImportReport,
  parseSkillCatalog,
  scopeFlagValue,
  skillImportArgs,
  skillsListArgs,
} from '../../core/backends/musecode/skillsCli'
import { clipForLog } from '../../core/logging'
import { type SkillImportSource, UI_TEXT } from '../../shared/constants'
import type { PluralForms } from '../../shared/l10n/forms'
import { fill, plural } from '../../shared/l10n/text'
import type { ProcessResult } from '../backend/sandboxSetup'
import type { Logger } from '../logger'

export interface SkillsCliDeps {
  /** The CLI with these arguments, run to completion; undefined when it is not installed. */
  readonly runCli: (args: readonly string[]) => Promise<ProcessResult> | undefined
  readonly workspaceRoot: string | undefined
  readonly isWorkspaceTrusted: () => boolean
  readonly showInformation: (message: string) => void
  readonly showError: (message: string) => void
  /** Offers to restart Muse Code; true when the user chose to. */
  readonly confirmRestart: () => Promise<boolean>
  readonly restart: () => Promise<void>
  readonly log: Logger
}

/** One row of the skills pick: checked when the skill is on. */
export interface SkillPickItem {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly detail: string
  readonly picked: boolean
}

export interface ManageSkillsDeps extends SkillsCliDeps {
  /** A multi-select pick; the ids left checked, or undefined when dismissed. */
  readonly pickSkills: (items: readonly SkillPickItem[]) => Promise<ReadonlySet<string> | undefined>
}

export interface ImportSkillsDeps extends SkillsCliDeps {
  /** Where to import from, or undefined when dismissed. */
  readonly pickSource: () => Promise<SkillImportSource | undefined>
  /** A modal listing what would be imported; true to go ahead. */
  readonly confirmImport: (message: string, detail: string) => Promise<boolean>
}

const LINE_BREAK = /\r?\n/
const LIST_SEPARATOR = ', '
const NO_SKILLS = '—'

/** Where a skill comes from, in the display language; an unknown scope shows its id. */
function scopeLabel(scope: string): string {
  const labels: Readonly<Record<string, string>> = UI_TEXT.skillScopes
  return labels[scope] ?? scope
}

function firstLine(text: string): string {
  return text.trim().split(LINE_BREAK, 1)[0] ?? ''
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Why a finished CLI run failed, in one line. */
function failureOf(result: ProcessResult): string {
  return (
    firstLine(result.stderr) ||
    firstLine(result.stdout) ||
    fill(UI_TEXT.processExitCode, { code: String(result.exitCode) })
  )
}

/** The CLI's stdout, or undefined after telling the user why there is none. */
async function runForOutput(
  deps: SkillsCliDeps,
  args: readonly string[],
  failure: string,
): Promise<string | undefined> {
  const running = deps.runCli(args)
  if (running === undefined) {
    deps.showError(UI_TEXT.skillsCliMissing)
    return undefined
  }
  const result = await running
  if (result.exitCode !== 0) {
    deps.log.warn(`muse ${args.join(' ')} failed: ${clipForLog(result.stderr.trim())}`)
    deps.showError(`${failure}: ${failureOf(result)}`)
    return undefined
  }
  return result.stdout
}

async function offerRestart(deps: SkillsCliDeps): Promise<void> {
  if (!(await deps.confirmRestart())) {
    return
  }
  await deps.restart()
  deps.showInformation(UI_TEXT.restartedNotice)
}

function pickItemOf(skill: CatalogSkill): SkillPickItem {
  return {
    id: skill.id,
    label: skill.displayName,
    description: scopeLabel(skill.scope),
    detail: skill.description,
    picked: isSkillOn(skill),
  }
}

async function applyChange(
  deps: SkillsCliDeps,
  change: ActivationChange,
): Promise<string | undefined> {
  const running = deps.runCli(activationArgs(change, deps.workspaceRoot, deps.isWorkspaceTrusted()))
  if (running === undefined) {
    return `${change.skill.name}: ${UI_TEXT.skillsCliMissing}`
  }
  const result = await running
  return result.exitCode === 0 ? undefined : `${change.skill.name}: ${failureOf(result)}`
}

export async function manageSkills(deps: ManageSkillsDeps): Promise<void> {
  const stdout = await runForOutput(
    deps,
    skillsListArgs(deps.workspaceRoot, deps.isWorkspaceTrusted()),
    UI_TEXT.skillsListFailed,
  )
  if (stdout === undefined) {
    return
  }
  let skills: readonly CatalogSkill[]
  try {
    skills = parseSkillCatalog(stdout).filter((skill) => scopeFlagValue(skill.scope) !== undefined)
  } catch (error: unknown) {
    deps.showError(`${UI_TEXT.skillsListFailed}: ${describe(error)}`)
    return
  }
  const picked = await deps.pickSkills(skills.map((skill) => pickItemOf(skill)))
  if (picked === undefined) {
    return
  }
  const changes = activationChanges(skills, picked)
  if (changes.length === 0) {
    deps.showInformation(UI_TEXT.skillsUnchanged)
    return
  }
  // One at a time: each command rewrites the same settings file.
  const failures: string[] = []
  for (const change of changes) {
    const failure = await applyChange(deps, change)
    if (failure !== undefined) {
      failures.push(failure)
    }
  }
  const changed = changes.length - failures.length
  if (failures.length > 0) {
    deps.log.warn(`Skill changes that failed: ${failures.join('; ')}`)
    deps.showError(fill(UI_TEXT.skillsChangeFailed, { skills: failures.join('; ') }))
  }
  if (changed === 0) {
    return
  }
  deps.log.info(`Skills changed: ${String(changed)} of ${String(changes.length)}`)
  await offerRestart(deps)
}

function entryLine(entry: ImportEntry): string {
  return entry.isValid ? entry.id : `${entry.id} (${UI_TEXT.importInvalid})`
}

function importSummary(report: ImportReport): string {
  const installed = report.installed.map((entry) => entry.id).join(LIST_SEPARATOR)
  const parts = [
    plural(UI_TEXT.importInstalledSummary, report.installed.length, {
      skills: installed === '' ? NO_SKILLS : installed,
    }),
  ]
  const counts: readonly (readonly [readonly ImportEntry[], PluralForms])[] = [
    [report.skipped, UI_TEXT.importSkippedSummary],
    [report.quarantined, UI_TEXT.importQuarantinedSummary],
    [report.failed, UI_TEXT.importFailedSummary],
  ]
  for (const [entries, summary] of counts) {
    if (entries.length === 0) {
      continue
    }
    const reasons = entries.map((entry) =>
      entry.reason === undefined ? entry.id : `${entry.id} (${entry.reason})`,
    )
    parts.push(plural(summary, entries.length, { skills: reasons.join(LIST_SEPARATOR) }))
  }
  return parts.join('. ')
}

function parsedReport(deps: SkillsCliDeps, stdout: string): ImportReport | undefined {
  try {
    return parseImportReport(stdout)
  } catch (error: unknown) {
    deps.showError(`${UI_TEXT.importFailed}: ${describe(error)}`)
    return undefined
  }
}

export async function importSkills(deps: ImportSkillsDeps): Promise<void> {
  const source = await deps.pickSource()
  if (source === undefined) {
    return
  }
  const preview = await runForOutput(deps, skillImportArgs(source, true), UI_TEXT.importFailed)
  const planned = preview === undefined ? undefined : parsedReport(deps, preview)
  if (planned === undefined) {
    return
  }
  if (planned.candidates.length === 0) {
    deps.showInformation(fill(UI_TEXT.importNothingFrom, { source: planned.sourcePath ?? source }))
    return
  }
  const isConfirmed = await deps.confirmImport(
    UI_TEXT.importConfirm,
    planned.candidates.map((entry) => entryLine(entry)).join('\n'),
  )
  if (!isConfirmed) {
    return
  }
  const output = await runForOutput(deps, skillImportArgs(source, false), UI_TEXT.importFailed)
  const report = output === undefined ? undefined : parsedReport(deps, output)
  if (report === undefined) {
    return
  }
  const summary = importSummary(report)
  deps.log.info(`muse skills import --from ${source}: ${summary}`)
  deps.showInformation(summary)
  if (report.installed.length > 0) {
    await offerRestart(deps)
  }
}
