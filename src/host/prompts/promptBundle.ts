import type { Logger } from '../logger'
import { lazyBundleLoader } from '../lazyBundle'
import { UI_TEXT } from '../../shared/constants'
import type * as Entry from './promptEntry'

interface PromptBundle {
  readonly runPromptCommand: typeof Entry.runPromptCommand
}
function isPromptBundle(value: unknown): value is PromptBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runPromptCommand' in value &&
    typeof value.runPromptCommand === 'function'
  )
}

/** W builds promptEntry into dist/prompts.js; only types cross activation. */
export function promptBundleLoader(bundlePath: string, log: Logger): () => PromptBundle {
  return lazyBundleLoader({
    bundlePath,
    log,
    isBundle: isPromptBundle,
    label: 'prompt library bundle',
    unavailable: () => UI_TEXT.promptFileInvalid,
  })
}
