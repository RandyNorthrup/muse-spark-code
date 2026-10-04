// The `ide` server's code intelligence answers as a bundle of their own (M67,
// PLAN.md D6 2026-10-03): esbuild builds this file into dist/codeIntel.js,
// which `codeIntelLoader` requires on the first code intelligence call, so
// the queries, the repo map, the rename's plan and their model text stay out
// of the bundle VS Code loads at activation. Like the review's bundle it
// carries its own copy of every module it shares with dist/extension.js, the
// display language's table among them, so the factory installs the
// activation bundle's table before it answers. Nothing it bundles may import
// `vscode`: the language services come in through `CodeIntelDeps`.

import { answerCodeIntel } from '../../core/codeIntel/codeIntelTools'
import { planRename, renameDiff } from '../../core/codeIntel/rename'
import { setUiText } from '../../shared/l10n/text'
import type { CodeIntelAnswers, CodeIntelBundleDeps } from './codeIntelBundle'

/** The answers over the activation bundle's table and language. */
export function createCodeIntelAnswers(deps: CodeIntelBundleDeps): CodeIntelAnswers {
  setUiText(deps.uiText, deps.uiLocale)
  return {
    answer: async (tool, args, intel) => await answerCodeIntel(tool, args, intel),
    planRename,
    renameDiff,
  }
}
