// Headless `playbook run <name>` (M116, PLAN.md D213): one of the
// workspace's check commands through the same admission, journal and
// report as the panel. No process, filesystem, backend or credential
// access: the settings text, the resource reading and the spawn all
// arrive through injected ports, so this module rides the lazy playbook
// bundle and the engine keeps its own effects.
import {
  checkCommandLine,
  checkCommandsSchema,
  checkTimeoutMs,
} from '../../core/verify/checkCommands'
import { failureForLog } from '../../core/backends/musecode/logText'
import { stripJsonc } from '../../core/jsonc'
import { createFileJournalPolicy } from '../../core/orchestration/playbook/policy'
import {
  createCapacityAdmission,
  createReadingHolder,
} from '../../core/orchestration/playbook/readingHolder'
import { CLI_EXIT, type CheckCommandSetting } from '../../shared/constants'
import { fill, UI_TEXT } from '../../shared/l10n/text'
import type { PlaybookBoard } from '../../shared/playbook'
import type { ResourceStatus } from '../../shared/resources'
import { playbookText } from './text'

/** The engine's one-shot check spawn, with the check's exit code. */
export interface PlaybookRunSpawn {
  run(
    line: string,
    timeoutMs: number,
  ): Promise<
    | { readonly ok: true; readonly code: number }
    | { readonly ok: false; readonly reason: 'timeout' | 'unavailable' }
  >
}

export interface PlaybookCheckCliDeps {
  /** Trusted agent data folder; the journal file lives under it. */
  readonly agentDataFolder: string
  /** Trusted canonical workspace; never a model-supplied path. */
  readonly workspaceFolder: string
  /** The journal's team and lane, the surface's own, so the run's notes land in the record it reads. */
  readonly teamId: string
  readonly laneId: string
  readonly platform: NodeJS.Platform
  readonly now?: () => number
  /** The workspace `.vscode/settings.json` text, or undefined when the workspace has none. Throws when it cannot be read. */
  readonly readSettingsFile: () => string | undefined
  /** The latest resource reading, or undefined while unknown (unknown never pauses the run). */
  readonly readResourceStatus: () => Promise<ResourceStatus | undefined>
  readonly spawn: PlaybookRunSpawn
  readonly writeStdout: (text: string) => void
  readonly printError: (text: string) => void
  /** The engine's log; failures land here redacted, never with their text. */
  readonly log: (message: string) => void
}

function parseRunArgs(
  argv: readonly string[],
): { name: string; isHeavy: boolean; isFullGate: boolean } | undefined {
  const [name, ...flags] = argv
  if (name === undefined || name.startsWith('-')) return undefined
  let isHeavy = false
  let isFullGate = false
  for (const flag of flags) {
    if (flag === '--heavy') isHeavy = true
    else if (flag === '--full-gate') isFullGate = true
    else return undefined
  }
  return { name, isHeavy, isFullGate }
}

type ResolvedChecks =
  | { readonly ok: true; readonly checks: readonly CheckCommandSetting[] }
  | { readonly ok: false; readonly invalid: 'file' | 'setting' }

/** The workspace's check commands: absent reads as none (the panel's default); malformed names which half failed. Settings files are JSONC, like the panel reads, with the flat dotted key first and the nested object behind it. */
function resolveChecks(text: string): ResolvedChecks {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonc(text))
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error
    return { ok: false, invalid: 'file' }
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: true, checks: [] }
  const section: unknown = 'museSpark' in parsed ? parsed.museSpark : undefined
  const nested: unknown =
    typeof section === 'object' && section !== null && 'checkCommands' in section
      ? section.checkCommands
      : undefined
  const raw: unknown =
    'museSpark.checkCommands' in parsed ? parsed['museSpark.checkCommands'] : nested
  if (raw === undefined) return { ok: true, checks: [] }
  const result = checkCommandsSchema.safeParse(raw)
  if (!result.success) return { ok: false, invalid: 'setting' }
  // The schema's optionals may read undefined-valued; the setting's may
  // only be absent, so absent stays absent.
  const checks: readonly CheckCommandSetting[] = result.data.map((check) => ({
    name: check.name,
    command: check.command,
    ...(check.changedFiles !== undefined && { changedFiles: check.changedFiles }),
    ...(check.timeoutSeconds !== undefined && { timeoutSeconds: check.timeoutSeconds }),
  }))
  return { ok: true, checks }
}

// Runs the named check: the holder takes the latest resource reading, the
// policy admits against it over a workerless, CI-less board (headless runs
// no team and reaches no CI), and the check spawns only on allow. The
// decision's note is journaled either way and the record follows the
// outcome line, so a refusal always carries its why. Exit failures are
// explicit; output contains validated data only, never exception text.
export async function runPlaybookCheckCli(
  argv: readonly string[],
  deps: PlaybookCheckCliDeps,
): Promise<number> {
  const parsed = parseRunArgs(argv)
  if (parsed === undefined) {
    deps.printError(UI_TEXT.playbookCommandUsage)
    return CLI_EXIT.usage
  }
  try {
    const text = deps.readSettingsFile()
    if (text === undefined) {
      deps.printError(UI_TEXT.playbookNoChecks)
      return CLI_EXIT.usage
    }
    const resolved = resolveChecks(text)
    if (!resolved.ok) {
      deps.printError(
        resolved.invalid === 'file'
          ? UI_TEXT.playbookSettingsInvalid
          : UI_TEXT.playbookChecksInvalid,
      )
      return CLI_EXIT.usage
    }
    if (resolved.checks.length === 0) {
      deps.printError(UI_TEXT.playbookNoChecks)
      return CLI_EXIT.usage
    }
    const check = resolved.checks.find((candidate) => candidate.name === parsed.name)
    if (check === undefined) {
      deps.printError(
        fill(UI_TEXT.playbookUnknownCheck, {
          name: parsed.name,
          checks: resolved.checks.map((candidate) => candidate.name).join(', '),
        }),
      )
      return CLI_EXIT.usage
    }
    const holder = createReadingHolder<ResourceStatus>()
    await holder.refresh(deps.readResourceStatus)
    const policy = createFileJournalPolicy(deps, {
      // The caller answers for the person at the terminal: the run is their
      // own check operation. Stamping still comes from here.
      authorizeOverride: () => true,
      drillRequirements: { guards: () => ['rounds'] },
      checkAdmission: createCapacityAdmission(holder),
      hookAdmission: { admit: () => true },
    })
    const board: PlaybookBoard = { lanes: [], mergedPrerequisites: [], workers: [], hasCi: false }
    const decision = policy.beforeCheck(
      { id: check.name, heavy: parsed.isHeavy, fullGate: parsed.isFullGate },
      board,
    )
    const report = () =>
      playbookText('record', {
        settings: policy.getSettings(),
        records: [...policy.getRecord()],
      })
    if (decision.kind === 'refuse') {
      deps.writeStdout(fill(UI_TEXT.checkOutcomes.notRun, { name: check.name }))
      deps.writeStdout(report())
      return CLI_EXIT.failure
    }
    const line = checkCommandLine(check, [], deps.platform)
    if (!line.ok) {
      deps.printError(line.reason)
      return CLI_EXIT.failure
    }
    const ran = await deps.spawn.run(line.line, checkTimeoutMs(check))
    if (!ran.ok) {
      if (ran.reason === 'timeout') {
        deps.writeStdout(fill(UI_TEXT.checkOutcomes.timedOut, { name: check.name }))
        deps.writeStdout(report())
        return CLI_EXIT.failure
      }
      deps.printError(UI_TEXT.playbookCommandFailed)
      return CLI_EXIT.failure
    }
    deps.writeStdout(
      fill(ran.code === CLI_EXIT.ok ? UI_TEXT.checkOutcomes.passed : UI_TEXT.checkOutcomes.failed, {
        name: check.name,
      }),
    )
    deps.writeStdout(report())
    return ran.code
  } catch (error: unknown) {
    deps.log(`playbook run failed: ${failureForLog(error)}`)
    deps.printError(UI_TEXT.playbookCommandFailed)
    return CLI_EXIT.failure
  }
}
