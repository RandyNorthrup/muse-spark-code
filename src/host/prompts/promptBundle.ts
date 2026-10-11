import type { Logger } from '../logger'
import { lazyBundleLoader } from '../lazyBundle'
import { UI_TEXT } from '../../shared/constants'
import type * as Entry from './promptEntry'

interface PromptBundle {
  readonly createPromptHost: typeof Entry.createPromptHost
}
function isPromptBundle(value: unknown): value is PromptBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createPromptHost' in value &&
    typeof value.createPromptHost === 'function'
  )
}

/** W builds promptEntry into dist/prompts.js; only types cross activation. */
export function promptBundleLoader(bundlePath: string, log: Logger): () => PromptBundle {
  return lazyBundleLoader({
    bundlePath,
    log,
    isBundle: isPromptBundle,
    label: 'prompts',
    unavailable: () => UI_TEXT.promptFileInvalid,
  })
}
