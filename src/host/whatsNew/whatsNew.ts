// What's New after an update, as activation sees it (M99, PLAN.md D79).
//
// - Activation compares the running version with the newest one What's New
//   ran for (`globalState`, synced with Settings Sync). A fresh install only
//   records it; an upgrade shows once; the same or an older version shows
//   nothing (a downgrade keeps the newer record, so going back up shows
//   nothing again).
// - Several windows activate together after an update. One claim file per
//   version under the extension's global storage, created exclusively,
//   decides which one shows it; the others see the file and stay quiet.
// - It shows some time after activation, and only while no turn runs and no
//   document was edited for a while; the tab opens without taking the
//   keyboard. An update whose releases have Highlights opens the page; a
//   patch of fixes only shows a quiet notification offering it.
// - The page, its renderer and its content are dist/whatsNew.js, required
//   here on the first page or notice (PLAN.md D6). Only types come from that
//   side: a value imported from there would carry it into dist/extension.js,
//   which the bundle-split gate refuses.

import { mkdir, open } from 'node:fs/promises'
import path from 'node:path'
import { decideUpdate, isVersion, hasHighlights } from '../../core/whatsNew/whatsNewVersions'
import {
  UI_TEXT,
  WHATS_NEW_CLAIM_SUFFIX,
  WHATS_NEW_IDLE_POLL_MS,
  WHATS_NEW_QUIET_MS,
  WHATS_NEW_SETTLE_MS,
} from '../../shared/constants'
import { fill, uiLocale } from '../../shared/l10n/text'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type * as WhatsNewEntry from './whatsNewEntry'
import type { WhatsNewPages, WhatsNewPagesDeps } from './whatsNewPanel'

const ALREADY_CLAIMED = 'EEXIST'

/** The bundle's one export. */
export interface WhatsNewBundle {
  readonly createWhatsNewPages: typeof WhatsNewEntry.createWhatsNewPages
}

/** Whether a required module exports the page's factory. */
export function isWhatsNewBundle(value: unknown): value is WhatsNewBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createWhatsNewPages' in value &&
    typeof value.createWhatsNewPages === 'function'
  )
}

export interface WhatsNewLoaderDeps {
  /** dist/whatsNew.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

/** The bundle, required on the first page or notice and kept from then on. */
export function whatsNewLoader(deps: WhatsNewLoaderDeps): () => WhatsNewBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: isWhatsNewBundle,
    label: 'What’s New bundle',
    unavailable: () => UI_TEXT.whatsNewUnavailable,
  })
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}

/**
 * Claims showing `version` for this window: true when this window created
 * the version's claim file, false when another window already had. Any other
 * failure (a read-only folder) lets this window show it, logged: a second
 * tab is better than none. Keep other versions' claims: windows running
 * different builds must not delete each other's claim and show twice.
 */
export async function hasClaimedVersion(
  dir: string,
  version: string,
  log: Logger,
): Promise<boolean> {
  // The version names a file: only a semantic version may.
  const refusal = `Not a semantic version: ${version}`
  if (!isVersion(version)) {
    throw new Error(refusal)
  }
  const name = `${version}${WHATS_NEW_CLAIM_SUFFIX}`
  const canShowUnclaimed = (error: unknown): boolean => {
    log.warn(
      `What’s New could not record its claim (${errorCode(error) ?? 'unknown'}); this window shows it`,
    )
    return true
  }
  try {
    await mkdir(dir, { recursive: true })
  } catch (error: unknown) {
    return canShowUnclaimed(error)
  }
  try {
    const handle = await open(path.join(dir, name), 'wx')
    await handle.close()
  } catch (error: unknown) {
    return errorCode(error) !== ALREADY_CLAIMED && canShowUnclaimed(error)
  }
  return true
}

/** Runs `run` once after `ms`; the returned function cancels it. */
export type WhatsNewSchedule = (run: () => void, ms: number) => () => void

export interface WhatsNewDeps extends WhatsNewLoaderDeps {
  /** What the bundle's tab needs, minus the log. */
  readonly pages: Omit<WhatsNewPagesDeps, 'log'>
  /** The extension's `globalState`. */
  readonly state: {
    get(key: string): unknown
    update(key: string, value: unknown): PromiseLike<void>
  }
  /** GLOBAL_STATE_KEYS.whatsNewLastSeenVersion. */
  readonly lastSeenKey: string
  readonly current: string
  /** Signs of use before this version (stored state, folders): an upgrade, not a fresh install. */
  readonly hasEarlierUse: boolean
  /** `museSpark.showWhatsNewOnUpdate`. */
  readonly isEnabled: () => boolean
  /** "Don't show again" on the notification: the setting off. */
  readonly disable: () => PromiseLike<void>
  /** `hasClaimedVersion` in the claims folder. */
  readonly claim: (version: string) => Promise<boolean>
  /** Whether a turn runs in any conversation of the window. */
  readonly isBusy: () => boolean
  /** Milliseconds since a document was last edited in the window (Infinity when never). */
  readonly msSinceLastEdit: () => number
  /** A non-modal information message with buttons; resolves to the one chosen. */
  readonly notify: (message: string, ...actions: string[]) => PromiseLike<string | undefined>
  readonly schedule?: WhatsNewSchedule | undefined
}

export interface WhatsNew {
  /**
   * Activation's check: records the version, and after an upgrade schedules
   * the page or the notification. Resolves once decided, not once shown.
   */
  readonly check: () => Promise<void>
  /** The command and the panel's item: this version's page, now, with the keyboard. */
  readonly show: () => void
  readonly dispose: () => void
}

const scheduleOnTimer: WhatsNewSchedule = (run, ms) => {
  const handle = setTimeout(run, ms)
  return () => {
    clearTimeout(handle)
  }
}

export function createWhatsNew(deps: WhatsNewDeps): WhatsNew {
  const schedule = deps.schedule ?? scheduleOnTimer
  const load = whatsNewLoader(deps)
  let pages: WhatsNewPages | undefined
  const pagesNow = (): WhatsNewPages => {
    pages ??= load().createWhatsNewPages({ ...deps.pages, log: deps.log }, UI_TEXT, uiLocale())
    return pages
  }
  let cancelWait: (() => void) | undefined
  let isDisposed = false

  const present = async (from: string | undefined): Promise<void> => {
    if (!deps.isEnabled()) {
      return
    }
    const releases = pagesNow().releases(from)
    if (releases.length === 0) {
      deps.log.info(`What’s New: no release notes for ${deps.current}; nothing shown`)
      return
    }
    if (hasHighlights(releases)) {
      pagesNow().open(from, true)
      return
    }
    const answer = await deps.notify(
      fill(UI_TEXT.whatsNewUpdatedNotice, { version: deps.current }),
      UI_TEXT.whatsNewOpen,
      UI_TEXT.whatsNewDontShowAgain,
    )
    if (isDisposed) {
      return
    }
    if (answer === UI_TEXT.whatsNewOpen) {
      pagesNow().open(from, false)
    } else if (answer === UI_TEXT.whatsNewDontShowAgain) {
      await deps.disable()
    }
  }
  // Said in the log only: an update never interrupts with an error.
  const presentLogged = async (from: string | undefined): Promise<void> => {
    try {
      await present(from)
    } catch (error: unknown) {
      deps.log.error(
        `What’s New after the update failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const waitForQuiet = (from: string | undefined, delayMs: number): void => {
    cancelWait = schedule(() => {
      cancelWait = undefined
      if (isDisposed) {
        return
      }
      if (deps.isBusy() || deps.msSinceLastEdit() < WHATS_NEW_QUIET_MS) {
        waitForQuiet(from, WHATS_NEW_IDLE_POLL_MS)
        return
      }
      void presentLogged(from)
    }, delayMs)
  }

  return {
    check: async () => {
      const decision = decideUpdate({
        previous: deps.state.get(deps.lastSeenKey),
        current: deps.current,
        hasEarlierUse: deps.hasEarlierUse,
      })
      if (decision.kind === 'notNewer') {
        return
      }
      if (decision.kind === 'firstInstall' || !deps.isEnabled()) {
        await deps.state.update(deps.lastSeenKey, deps.current)
        return
      }
      if (!(await deps.claim(deps.current))) {
        deps.log.info(`What’s New for ${deps.current}: another window shows it`)
        return
      }
      await deps.state.update(deps.lastSeenKey, deps.current)
      deps.log.info(
        `What’s New: updated from ${decision.from ?? 'a version before it'} to ${deps.current}`,
      )
      waitForQuiet(decision.from, WHATS_NEW_SETTLE_MS)
    },
    show: () => {
      pagesNow().open(undefined, false)
    },
    dispose: () => {
      isDisposed = true
      cancelWait?.()
      pages?.dispose()
    },
  }
}
