// The plan reader as the activation bundle sees it (M79, PLAN.md D6):
// dist/planMarkdown.js, built from planMarkdownEntry.ts and required on the
// first plan action. Only a type comes from core/plans/planMarkdown's side
// here: a value imported from there would carry the parser back into
// dist/extension.js, which the bundle-split gate refuses.
//
// There is no fallback without it: the reader is what says whether a plan
// holds raw HTML and what the model is sent, so a plan action that cannot load it
// is refused with the reason, and the next action tries again.

import type { PlanMarkdown } from '../core/plans/planDocument'
import { UI_TEXT } from '../shared/constants'
import { forgetFile, requireFile } from './lazyBundle'
import type { Logger } from './logger'

const READER_FUNCTIONS = ['topHeading', 'listItems', 'hasRawHtml', 'briefText'] as const

/** The bundle's one export. */
interface PlanMarkdownBundle {
  readonly planMarkdown: PlanMarkdown
}

/**
 * Whether a required module is the bundle: its reader has the three
 * functions. Their signatures are taken on trust (PLAN.md §8): both bundles
 * come from one source tree, one `npm run build` and one package.
 */
export function isPlanMarkdownBundle(value: unknown): value is PlanMarkdownBundle {
  if (typeof value !== 'object' || value === null || !('planMarkdown' in value)) {
    return false
  }
  const { planMarkdown } = value
  return (
    typeof planMarkdown === 'object' &&
    planMarkdown !== null &&
    READER_FUNCTIONS.every((name) => typeof Reflect.get(planMarkdown, name) === 'function')
  )
}

export interface PlanMarkdownLoaderDeps {
  /** dist/planMarkdown.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The reader, required the first time it is asked for and kept from then
 * on. A missing or corrupt bundle throws `planMarkdownUnavailable` (the log
 * has the cause) and is tried again on the next call.
 */
export function planMarkdownLoader(deps: PlanMarkdownLoaderDeps): () => PlanMarkdown {
  let reader: PlanMarkdown | undefined
  return () => {
    if (reader !== undefined) {
      return reader
    }
    const { bundlePath, loadBundle = requireFile } = deps
    let loaded: unknown
    try {
      loaded = loadBundle(bundlePath)
    } catch (error: unknown) {
      deps.log.error(`The plan reader ${bundlePath} could not be loaded: ${describe(error)}`)
      throw new Error(UI_TEXT.planMarkdownUnavailable, { cause: error })
    }
    if (!isPlanMarkdownBundle(loaded)) {
      deps.log.error(`${bundlePath} does not export the plan reader`)
      if (deps.loadBundle === undefined) {
        forgetFile(bundlePath)
      }
      throw new Error(UI_TEXT.planMarkdownUnavailable)
    }
    reader = loaded.planMarkdown
    return reader
  }
}
