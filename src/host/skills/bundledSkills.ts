// The bundled skills for Muse Code as the activation bundle sees them (M89,
// PLAN.md D6, D68): the installer's bundle, dist/bundledSkills.js, required
// the first time it is needed (only types come from its side here); the
// panel's one-time offer; and the two commands, which say what the installer
// did in the user's language and then offer the restart a skill change needs
// (a running `muse serve` keeps the skills it started with, as for Manage
// Skills). Every VS Code interaction is injected.

import { UI_TEXT } from '../../shared/constants'
import { fill, plural } from '../../shared/l10n/text'
import type { NoticeAction } from '../../shared/protocol'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type {
  BundledSkillsFailure,
  BundledSkillsInstallDeps,
  BundledSkillsInstallResult,
  BundledSkillsPaths,
  BundledSkillsRemoveResult,
  BundledSkillsStatus,
} from './bundledSkillsInstall'

/** The installer's three entries, shipped and loaded together. */
export interface BundledSkillsBundle {
  readonly bundledSkillsStatus: (paths: BundledSkillsPaths) => Promise<BundledSkillsStatus>
  readonly installBundledSkills: (
    deps: BundledSkillsInstallDeps,
  ) => Promise<BundledSkillsInstallResult>
  readonly removeBundledSkills: (paths: BundledSkillsPaths) => Promise<BundledSkillsRemoveResult>
}

const BUNDLE_FUNCTIONS = ['bundledSkillsStatus', 'installBundledSkills', 'removeBundledSkills']

/** Whether a required module exports the three entries (their signatures taken on trust, PLAN.md §8). */
export function isBundledSkillsBundle(value: unknown): value is BundledSkillsBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    BUNDLE_FUNCTIONS.every((name) => typeof Reflect.get(value, name) === 'function')
  )
}

export interface BundledSkillsLoaderDeps {
  /** dist/bundledSkills.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

/** The installer, required the first time it is asked for and kept from then on. */
export function bundledSkillsLoader(deps: BundledSkillsLoaderDeps): () => BundledSkillsBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: isBundledSkillsBundle,
    label: 'bundled skills installer',
    unavailable: () => UI_TEXT.bundledSkillsUnavailable,
  })
}

/** The keys of the two answers the offer remembers (GLOBAL_STATE_KEYS). */
export interface BundledSkillsOfferKeys {
  readonly installDeclined: string
  readonly updateDeclined: string
}

export interface BundledSkillsOfferDeps {
  /** `museSpark.bundledSkills`: off, nothing is offered. */
  readonly isEnabled: () => boolean
  /** The extension's `globalState`: Not now outlives the window. */
  readonly state: {
    get(key: string): unknown
    update(key: string, value: unknown): PromiseLike<void>
  }
  readonly keys: BundledSkillsOfferKeys
  /** The vendored release against the copy in Muse Code's config home. */
  readonly status: () => Promise<BundledSkillsStatus>
}

/** A panel notice and the ways on it offers (D26's notice actions). */
export interface BundledSkillsNotice {
  readonly text: string
  readonly actions: readonly NoticeAction[]
}

export interface BundledSkillsOffer {
  /**
   * The notice for a Muse Code conversation that just started, at most once
   * per window: the install while there is no copy and Not now was never
   * said, the update while the copy's release is not the vendored one and
   * its Not now named another release.
   */
  next(): Promise<BundledSkillsNotice | undefined>
  /** Not now on the notice shown: remembered for the install, or for this release's update. */
  decline(): Promise<void>
}

const LIST_SEPARATOR = ', '
const NONE = '—'

function listed(ids: readonly string[]): string {
  return ids.length === 0 ? NONE : ids.join(LIST_SEPARATOR)
}

export function createBundledSkillsOffer(deps: BundledSkillsOfferDeps): BundledSkillsOffer {
  let isClaimed = false
  let shown:
    { readonly kind: 'install' } | { readonly kind: 'update'; readonly tag: string } | undefined
  const noticeFor = (status: BundledSkillsStatus): BundledSkillsNotice | undefined => {
    if (status.kind === 'notInstalled' && deps.state.get(deps.keys.installDeclined) !== true) {
      shown = { kind: 'install' }
      return {
        text: fill(UI_TEXT.bundledSkillsOffer, { skills: listed(status.skillIds) }),
        actions: ['installBundledSkills', 'declineBundledSkills'],
      }
    }
    if (
      status.kind === 'installed' &&
      status.installedTag !== status.vendorTag &&
      deps.state.get(deps.keys.updateDeclined) !== status.vendorTag
    ) {
      shown = { kind: 'update', tag: status.vendorTag }
      return {
        text: fill(UI_TEXT.bundledSkillsUpdateOffer, { tag: status.vendorTag }),
        actions: ['updateBundledSkills', 'declineBundledSkills'],
      }
    }
    return undefined
  }
  // Claimed before the read, so two conversations starting together offer
  // once; given back when there was nothing to offer or the read failed.
  const claimAndRead = async (): Promise<BundledSkillsNotice | undefined> => {
    isClaimed = true
    let notice: BundledSkillsNotice | undefined
    try {
      notice = noticeFor(await deps.status())
    } finally {
      if (notice === undefined) {
        isClaimed = false
      }
    }
    return notice
  }
  return {
    next: async () => (isClaimed || !deps.isEnabled() ? undefined : await claimAndRead()),
    decline: async () => {
      if (shown === undefined) {
        return
      }
      await (shown.kind === 'install'
        ? deps.state.update(deps.keys.installDeclined, true)
        : deps.state.update(deps.keys.updateDeclined, shown.tag))
    },
  }
}

export interface BundledSkillsCommandDeps {
  readonly bundle: () => BundledSkillsBundle
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
  const result = await deps.bundle().installBundledSkills({
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
            skills: listed(result.installed),
          }),
        ]),
    ...(result.skipped.length === 0
      ? []
      : [
          plural(UI_TEXT.bundledSkillsSkipped, result.skipped.length, {
            skills: listed(result.skipped),
          }),
        ]),
    ...(result.removed.length === 0
      ? []
      : [
          plural(UI_TEXT.bundledSkillsRemoved, result.removed.length, {
            skills: listed(result.removed),
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
  const result = await deps.bundle().removeBundledSkills(deps.paths())
  if (!result.hadCopy) {
    deps.showInformation(UI_TEXT.bundledSkillsNothingToRemove)
    return
  }
  deps.log.info(`Bundled skills removed: [${result.removed.join(', ')}]`)
  // A removal that stopped before its first link says only why.
  if (result.failure === undefined || result.removed.length > 0) {
    deps.showInformation(
      plural(UI_TEXT.bundledSkillsRemoved, result.removed.length, {
        skills: listed(result.removed),
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
