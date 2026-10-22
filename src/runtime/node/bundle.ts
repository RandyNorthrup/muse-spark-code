// Loaded by filename only after `node`; no node schemas/engine in ACP stdio.
import { createRequire } from 'node:module'
import { UI_TEXT } from '../../shared/constants'
import type { NodeCommandDeps } from './main'
import type { UiText } from '../../shared/l10n/en'

interface NodeModule {
  runNodeArgs(
    argv: readonly string[],
    deps: NodeCommandDeps,
    table: UiText,
    locale: string,
  ): Promise<number>
}
function isNodeModule(value: unknown): value is NodeModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runNodeArgs' in value &&
    typeof value.runNodeArgs === 'function'
  )
}
export function nodeModule(file: string): NodeModule {
  const loaded: unknown = createRequire(file)(file)
  if (!isNodeModule(loaded)) throw new Error(UI_TEXT.nodeErrors.unavailable)
  return loaded
}
