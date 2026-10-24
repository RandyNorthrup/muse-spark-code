import { lazyBundleLoader } from '../../host/lazyBundle'
import type { CoreLogger } from '../../core/logging'
import { UI_TEXT } from '../../shared/l10n/text'
import type * as WatchdogBundle from './watchdogEntry'

type Bundle = typeof WatchdogBundle
/** Same-build signatures are trusted after checking every exported function (PLAN §8). */
export function isWatchdogBundle(value: unknown): value is Bundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'parseWatchdogCommand' in value &&
    typeof value.parseWatchdogCommand === 'function' &&
    'createWatchdogSurface' in value &&
    typeof value.createWatchdogSurface === 'function' &&
    'runWatchdogCommand' in value &&
    typeof value.runWatchdogCommand === 'function' &&
    'runWatchdogCli' in value &&
    typeof value.runWatchdogCli === 'function' &&
    'requiresWatchdogGitHub' in value &&
    typeof value.requiresWatchdogGitHub === 'function'
  )
}

export function watchdogLoader(bundlePath: string, log: CoreLogger) {
  return lazyBundleLoader({
    bundlePath,
    log,
    isBundle: isWatchdogBundle,
    label: 'Watchdog',
    unavailable: () => UI_TEXT.watchdog.cli.unavailable,
  })
}
