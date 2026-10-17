import type { UiText } from '../../../shared/l10n/en'
import { setUiText } from '../../../shared/l10n/text'
import { McpServerPool, type McpPoolDeps } from './mcp/pool'
export function createMcpPool(deps: McpPoolDeps, table: UiText, locale: string): McpServerPool {
  setUiText(table, locale)
  return new McpServerPool(deps)
}
