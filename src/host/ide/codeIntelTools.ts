// The code intelligence tools the `ide` server offers Muse Code (M67,
// PLAN.md D49): the same answers as the Model API's native tools, as
// `mcp__ide__findDefinition` and the rest. Every one changes nothing, so
// each declares `readOnlyHint` (D49's rule for tools on `ide`) and all are
// listed in Restricted Mode too. `renameSymbol` never writes: it returns the
// edits as a diff, and Muse Code's own edit tool applies them under its
// approvals and rewind. Listed only with a folder open. The answers are
// dist/codeIntel.js (D6), loaded on the first call.

import { IDE_CODE_INTEL_TOOLS, MCP_ANNOTATIONS_READ_ONLY, UI_TEXT } from '../../shared/constants'
import type { CodeIntelDeps } from '../../core/codeIntel/codeIntelQuery'
import {
  type CodeIntelDefinition,
  IDE_CODE_INTEL_DEFINITIONS,
} from '../../core/codeIntel/definitions'
import type { McpTool } from '../../core/mcp'
import { uiLocale } from '../../shared/l10n/text'
import type { CodeIntelBundle } from './codeIntelBundle'

function toolFor(
  definition: CodeIntelDefinition,
  intel: CodeIntelDeps,
  bundle: () => CodeIntelBundle,
): McpTool {
  const { tool } = definition
  return {
    name: IDE_CODE_INTEL_TOOLS[tool],
    description: definition.description,
    inputSchema: {
      type: 'object',
      properties: definition.properties,
      required: [...definition.required],
      additionalProperties: false,
    },
    annotations: MCP_ANNOTATIONS_READ_ONLY,
    // A refusal, or a bundle that cannot load, rejects, so the server
    // answers with an error result the model reads.
    call: async (args) => await bundle().callCodeIntel(tool, args, intel, UI_TEXT, uiLocale()),
  }
}

/** The tools as they stand: none with no folder open. */
export function ideCodeIntelTools(
  intel: CodeIntelDeps | undefined,
  bundle: () => CodeIntelBundle,
): readonly McpTool[] {
  return intel === undefined
    ? []
    : IDE_CODE_INTEL_DEFINITIONS.map((definition) => toolFor(definition, intel, bundle))
}
