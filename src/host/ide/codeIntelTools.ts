// The code intelligence tools the `ide` server offers Muse Code (M67,
// PLAN.md D49): the same answers as the Model API's native tools, as
// `mcp__ide__findDefinition` and the rest. Every one changes nothing, so
// each declares `readOnlyHint` (D49's rule for tools on `ide`) and all are
// listed in Restricted Mode too. `renameSymbol` never writes: it returns the
// edits as a diff, and Muse Code's own edit tool applies them under its
// approvals and rewind. Listed only with a folder open.

import { IDE_CODE_INTEL_TOOLS, MCP_ANNOTATIONS_READ_ONLY } from '../../shared/constants'
import type { CodeIntelDeps } from '../../core/codeIntel/codeIntelQuery'
import { answerCodeIntel, type CodeIntelReadTool } from '../../core/codeIntel/codeIntelTools'
import {
  type CodeIntelDefinition,
  IDE_CODE_INTEL_DEFINITIONS,
} from '../../core/codeIntel/definitions'
import { planRename, renameDiff } from '../../core/codeIntel/rename'
import type { McpTool } from '../../core/mcp'

async function read(
  tool: CodeIntelReadTool,
  args: Readonly<Record<string, unknown>>,
  intel: CodeIntelDeps,
): Promise<string> {
  const answer = await answerCodeIntel(tool, args, intel)
  if (!answer.ok) {
    throw new Error(answer.reason)
  }
  return answer.text
}

async function renameEdits(
  args: Readonly<Record<string, unknown>>,
  intel: CodeIntelDeps,
): Promise<string> {
  const planned = await planRename(args, intel)
  if (!planned.ok) {
    throw new Error(planned.reason)
  }
  return renameDiff(planned.plan)
}

function toolFor(definition: CodeIntelDefinition, intel: CodeIntelDeps): McpTool {
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
    // A refusal rejects, so the server answers with an error result the model reads.
    call: async (args) =>
      tool === 'renameSymbol' ? await renameEdits(args, intel) : await read(tool, args, intel),
  }
}

/** The tools as they stand: none with no folder open. */
export function ideCodeIntelTools(intel: CodeIntelDeps | undefined): readonly McpTool[] {
  return intel === undefined
    ? []
    : IDE_CODE_INTEL_DEFINITIONS.map((definition) => toolFor(definition, intel))
}
