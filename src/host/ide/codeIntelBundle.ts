// The `ide` server's code intelligence answers as the activation bundle sees
// them (M67, PLAN.md D6 2026-10-03): dist/codeIntel.js, built from
// codeIntelEntry.ts and required on the first code intelligence call. Only
// types come from core/codeIntel/** here: a value imported from there would
// carry the queries, the repo map, the rename's plan and their model text
// back into dist/extension.js, which the bundle-split gate refuses. The tool
// list (names, descriptions, schemas) stays at activation.
//
// There is no fallback without it: a call that cannot load the bundle is
// answered as a failed call with the reason (`codeIntelUnavailable`; the log
// has the cause), and the next call tries again.

import type { CodeIntelAnswer, CodeIntelDeps } from '../../core/codeIntel/codeIntelQuery'
import type { CodeIntelReadTool } from '../../core/codeIntel/codeIntelTools'
import type { RenamePlan, RenamePlanResult } from '../../core/codeIntel/rename'
import { MODEL_TEXT, UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { uiLocale } from '../../shared/l10n/text'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'

/** What the `ide` server's tools use of the bundle: the Model API's own answers. */
export interface CodeIntelAnswers {
  /** A read tool's answer, or its refusal. */
  readonly answer: (
    tool: CodeIntelReadTool,
    args: unknown,
    intel: CodeIntelDeps,
  ) => Promise<CodeIntelAnswer>
  /** The rename's edits, planned and never written. */
  readonly planRename: (args: unknown, intel: CodeIntelDeps) => Promise<RenamePlanResult>
  /** A planned rename as the unified diff Muse Code applies itself. */
  readonly renameDiff: (plan: RenamePlan) => string
}

/** What the bundle's factory installs before it answers (PLAN.md D33). */
export interface CodeIntelBundleDeps {
  readonly uiText: UiText
  readonly uiLocale: string
}

/** The bundle's one export. */
interface CodeIntelBundle {
  readonly createCodeIntelAnswers: (deps: CodeIntelBundleDeps) => CodeIntelAnswers
}

/**
 * Whether a required module is the bundle: its factory is a function. The
 * factory's signature is taken on trust (PLAN.md §8): both bundles come from
 * one source tree, one `npm run build` and one package.
 */
export function isCodeIntelBundle(value: unknown): value is CodeIntelBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createCodeIntelAnswers' in value &&
    typeof value.createCodeIntelAnswers === 'function'
  )
}

export interface CodeIntelLoaderDeps {
  /** dist/codeIntel.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** How the bundle is loaded: Node's `require` unless a test hands in the module. */
  readonly loadBundle?: ((file: string) => unknown) | undefined
}

/**
 * The answers, the bundle required the first time they are asked for and
 * kept from then on. A missing or corrupt bundle throws
 * `codeIntelUnavailable` and is tried again on the next call.
 */
export function codeIntelLoader(deps: CodeIntelLoaderDeps): () => CodeIntelAnswers {
  const load = lazyBundleLoader({
    ...deps,
    isBundle: isCodeIntelBundle,
    label: 'code intelligence bundle',
    unavailable: () => MODEL_TEXT.codeIntelUnavailable,
  })
  let answers: CodeIntelAnswers | undefined
  return () => {
    answers ??= load().createCodeIntelAnswers({ uiText: UI_TEXT, uiLocale: uiLocale() })
    return answers
  }
}
