// The two bundled skills commands (M89, PLAN.md D6, D68), inside the
// installer's own bundle (dist/bundledSkills.js): they run the installer,
// say what it did in the user's language, and then offer the restart a skill
// change needs (a running `muse serve` keeps the skills it started with, as
// for Manage Skills). The bundle is required the first time a command or the
// panel's offer needs it, so these bodies stay out of the activation bundle;
// bundledSkillsEntry.ts installs the caller's language table before either
// runs. Every VS Code interaction is injected.

import { UI_TEXT } from '../../shared/constants'
import { fill, plural } from '../../shared/l10n/text'
import type { Logger } from '../logger'
import {
  type BundledSkillsFailure,
  type BundledSkillsPaths,
  installBundledSkills,
  removeBundledSkills,
} from './bundledSkillsInstall'

const LIST_SEPARATOR = ', '
const NONE = '—'

export interface BundledSkillsCommandDeps {
  /** Read at each run: the config home follows `museSpark.environmentVariables`. */
  readonly paths: () => BundledSkillsPaths
  readonly platform: NodeJS.Platform
  readonly now: () => number
  readonly newId: () => string
  readonly showInformation: (message: string) => void
  /** Said and logged (`loggedPopups`). */
  readonly showError: (message: string) => void
  /** Whether a `muse serve` runs that started with the old skills. */
  readonly isMuseCodeRunning: () => boolean
  /** The skill commands' restart offer; true when the user chose to. */
  readonly confirmRestart: () => Promise<boolean>
  readonly restart: () => Promise<void>
  readonly log: Logger
}

function listedSkills(ids: readonly string[]): string {
  return ids.length === 0 ? NONE : ids.join(LIST_SEPARATOR)
}

function reasonText(failure: BundledSkillsFailure): string {
  return failure.reason.kind === 'notOurs' ? UI_TEXT.bundledSkillsNotOurs : failure.reason.message
}

function failureText(template: string, failure: BundledSkillsFailure): string {
  return fill(template, { folder: failure.folder, reason: reasonText(failure) })
}

async function offerRestart(deps: BundledSkillsCommandDeps): Promise<void> {
  if (!deps.isMuseCodeRunning() || !(await deps.confirmRestart())) {
    return
  }
  await deps.restart()
  deps.showInformation(UI_TEXT.restartedNotice)
}

/** Install for Muse Code, or update the extension's copy: the same steps, said once done. */
export async function runBundledSkillsInstall(deps: BundledSkillsCommandDeps): Promise<void> {
  const result = await installBundledSkills({
    ...deps.paths(),
    platform: deps.platform,
    now: deps.now,
    newId: deps.newId,
  })
  const tag = result.tag ?? NONE
  deps.log.info(
    `Bundled skills ${tag}: installed [${result.installed.join(', ')}], skipped [${result.skipped.join(', ')}], removed [${result.removed.join(', ')}]`,
  )
  const said = [
    ...(result.installed.length === 0
      ? []
      : [
          plural(UI_TEXT.bundledSkillsInstalled, result.installed.length, {
            tag,
            skills: listedSkills(result.installed),
          }),
        ]),
    ...(result.skipped.length === 0
      ? []
      : [
          plural(UI_TEXT.bundledSkillsSkipped, result.skipped.length, {
            skills: listedSkills(result.skipped),
          }),
        ]),
    ...(result.removed.length === 0
      ? []
      : [
          plural(UI_TEXT.bundledSkillsRemoved, result.removed.length, {
            skills: listedSkills(result.removed),
          }),
        ]),
  ]
  if (said.length > 0) {
    deps.showInformation(said.join('. '))
  }
  for (const failure of [result.failure, result.undoFailure]) {
    if (failure !== undefined) {
      deps.showError(failureText(UI_TEXT.bundledSkillsInstallFailed, failure))
    }
  }
  if (result.failure === undefined) {
    await offerRestart(deps)
  }
}

/** Remove what the install made, and only that. */
export async function runBundledSkillsRemove(deps: BundledSkillsCommandDeps): Promise<void> {
  const result = await removeBundledSkills(deps.paths())
  if (!result.hadCopy) {
    deps.showInformation(UI_TEXT.bundledSkillsNothingToRemove)
    return
  }
  deps.log.info(`Bundled skills removed: [${result.removed.join(', ')}]`)
  // A removal that stopped before its first link says only why.
  if (result.failure === undefined || result.removed.length > 0) {
    deps.showInformation(
      plural(UI_TEXT.bundledSkillsRemoved, result.removed.length, {
        skills: listedSkills(result.removed),
      }),
    )
  }
  if (result.failure !== undefined) {
    deps.showError(failureText(UI_TEXT.bundledSkillsRemoveFailed, result.failure))
    // Nothing removed, nothing for a restart to pick up.
    if (result.removed.length === 0) {
      return
    }
  }
  await offerRestart(deps)
}
