// Code intelligence's shipped CommonJS bundle (M67, PLAN.md D6): the queries,
// the read tools' answers, the repo map and the rename's diff behind Muse
// Code's `ide` tools. esbuild builds this file into dist/codeIntel.js, which
// `codeIntelLoader` requires on the first call, so none of it is in the
// bundle VS Code loads at activation; the tool list (names, descriptions,
// schemas) stays there. The Model API backend keeps its own copy in
// dist/modelApi.js. Each call receives the installed display table.

import type { CodeIntelDeps } from '../../core/codeIntel/codeIntelQuery'
import { answerCodeIntel } from '../../core/codeIntel/codeIntelTools'
import { planRename, renameDiff } from '../../core/codeIntel/rename'
import type { CodeIntelTool } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'

/**
 * One `ide` tool's answer. A refusal rejects with its reason, so the server
 * answers with an error result the model reads. `renameSymbol` writes
 * nothing: it returns the edits as a diff.
 */
export async function callCodeIntel(
  tool: CodeIntelTool,
  args: Readonly<Record<string, unknown>>,
  intel: CodeIntelDeps,
  table: UiText,
  locale: string,
): Promise<string> {
  setUiText(table, locale)
  if (tool === 'renameSymbol') {
    const planned = await planRename(args, intel)
    if (!planned.ok) {
      throw new Error(planned.reason)
    }
    return renameDiff(planned.plan)
  }
  const answer = await answerCodeIntel(tool, args, intel)
  if (!answer.ok) {
    throw new Error(answer.reason)
  }
  return answer.text
}
