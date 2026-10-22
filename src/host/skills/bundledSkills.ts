// The bundled skills for Muse Code as the activation bundle sees them (M89,
// PLAN.md D6, D68): the installer's bundle, dist/bundledSkills.js, required
// the first time it is needed (only types come from its side here), and the
// panel's one-time offer. The two commands, which say what the installer did
// in the user's language and then offer the restart a skill change needs,
// live in that bundle (bundledSkillsCommands.ts), so they load with the
// installer they run. Every VS Code interaction is injected.

import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { NoticeAction } from '../../shared/protocol'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type * as Entry from './bundledSkillsEntry'
import type { BundledSkillsPaths, BundledSkillsStatus } from './bundledSkillsInstall'
import type { PlaybookCharterTarget } from './playbookReviewerCharter'

export type { BundledSkillsCommandDeps } from './bundledSkillsCommands'

/** The installer, its two commands and the playbook charter, shipped and loaded together. */
export interface BundledSkillsBundle {
  readonly bundledSkillsStatus: (paths: BundledSkillsPaths) => Promise<BundledSkillsStatus>
  /** Install for Muse Code, or update the extension's copy, in the caller's language. */
  readonly runBundledSkillsInstall: typeof Entry.runBundledSkillsInstall
  /** Remove what the install made, and only that, in the caller's language. */
  readonly runBundledSkillsRemove: typeof Entry.runBundledSkillsRemove
  /** I binds this only to playbook reviews; ordinary request builders never read it. */
  readonly playbookReviewerCharter: (targets?: readonly PlaybookCharterTarget[]) => string
}

const BUNDLE_FUNCTIONS = [
  'bundledSkillsStatus',
  'runBundledSkillsInstall',
  'runBundledSkillsRemove',
  'playbookReviewerCharter',
]

/** Whether the module exports these entries (signatures trusted from the same build, PLAN.md §8). */
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
  The notice for a Muse Code conversation that just started, at most once
  per window: the install while there is no copy and Not now was never
  said, the update while the copy's release is not the vendored one and
  its Not now named another release.
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

/** What a shown notice answered: the install, or this release's update. */
type ShownOffer = { readonly kind: 'install' } | { readonly kind: 'update'; readonly tag: string }

/**
What a Not now answers when this window showed nothing (F66): the offer
the copy's state would make now. A current copy or someone else's folder
offers nothing, so there is nothing to remember either.
*/
function readShown(status: BundledSkillsStatus): ShownOffer | undefined {
  let answer: ShownOffer | undefined
  if (status.kind === 'notInstalled') {
    answer = { kind: 'install' }
  } else if (status.kind === 'installed' && status.installedTag !== status.vendorTag) {
    answer = { kind: 'update', tag: status.vendorTag }
  }
  return answer
}

/**
The remembered answer for a stray Not now (F66): the copy's state read
now; a broken read keeps nothing rather than a wrong memory.
*/
async function readStrayAnswer(
  readStatus: () => Promise<BundledSkillsStatus>,
): Promise<ShownOffer | undefined> {
  try {
    return readShown(await readStatus())
  } catch {
    return undefined
  }
}

/** Remembers a shown notice's Not now: the install, or this release's update. */
async function rememberDecline(
  update: (key: string, value: unknown) => PromiseLike<void>,
  keys: BundledSkillsOfferKeys,
  answer: ShownOffer,
): Promise<void> {
  if (answer.kind === 'install') {
    await update(keys.installDeclined, true)
  } else {
    await update(keys.updateDeclined, answer.tag)
  }
}

export function createBundledSkillsOffer(deps: BundledSkillsOfferDeps): BundledSkillsOffer {
  let isClaimed = false
  let shown: ShownOffer | undefined
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
      // A Not now is remembered even when this window never showed the
      // notice itself (F66): a host restart between the offer and the click,
      // or a second window's session, leaves `shown` empty while the panel
      // still shows the button. The copy's state then says which answer to
      // keep.
      const answer = shown ?? (await readStrayAnswer(deps.status))
      if (answer === undefined) {
        return
      }
      await rememberDecline((key, value) => deps.state.update(key, value), deps.keys, answer)
    },
  }
}
