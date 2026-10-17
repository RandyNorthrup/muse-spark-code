// Loaded only for a board/best-of-N action; window coordination stays eager.
import { BestOfNManager, type BestOfNManagerDeps } from './bestOfN/bestOfNManager'
import { collectSessionBoard, type SessionBoardDeps } from './sessionBoard'
import { setUiText } from '../shared/l10n/text'
import type { UiText } from '../shared/l10n/en'

/** Install the caller's display language before constructing the manager. */
export function createBestOfNManager(deps: BestOfNManagerDeps, table: UiText, locale: string) {
  setUiText(table, locale)
  return new BestOfNManager(deps)
}

/** A board read runs only when requested, in the caller's display language. */
export async function readSessionBoard(deps: SessionBoardDeps, table: UiText, locale: string) {
  setUiText(table, locale)
  return await collectSessionBoard(deps)
}
