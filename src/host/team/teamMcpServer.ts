// T2 owns the fixed tool list; M96/X2 owns loopback transport, per-session
// bearer tokens and registration. Build this list once, never on tools/list.
import type { McpTool } from '../../core/mcp'

/** Workers may collect their own children through M96's scoped runtime, but
 * only the orchestrator may enqueue landings or reschedule the board. */
export function teamServerToolList(
  tools: readonly McpTool[],
  caller: 'orchestrator' | 'worker',
): readonly McpTool[] {
  return tools
    .filter(
      (tool) =>
        caller === 'orchestrator' ||
        ['roster', 'delegate', 'collect', 'cancel'].includes(tool.name),
    )
    .map((tool) => ({
      ...tool,
      inputSchema: structuredClone(tool.inputSchema),
      annotations:
        tool.name === 'roster' || tool.name === 'collect'
          ? { ...tool.annotations, readOnlyHint: true }
          : structuredClone(tool.annotations ?? {}),
    }))
}
