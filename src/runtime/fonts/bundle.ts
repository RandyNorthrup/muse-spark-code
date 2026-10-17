import { lazyBundleLoader } from '../../host/lazyBundle'
import type { Logger } from '../../host/logger'
import { UI_TEXT } from '../../shared/constants'
import type { installFonts } from './fontsEntry'

interface FontsBundle {
  readonly installFonts: typeof installFonts
}

/** Signature trusted across entries from the same verified build/package (PLAN §8). */
function isFontsBundle(value: unknown): value is FontsBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'installFonts' in value &&
    typeof value.installFonts === 'function'
  )
}

export function fontsBundle(bundlePath: string, log: Logger): () => FontsBundle {
  return lazyBundleLoader({
    bundlePath,
    log,
    isBundle: isFontsBundle,
    label: 'font installer',
    unavailable: () => UI_TEXT.acpFontInstallFailed,
  })
}
