// Settings Sync for the prompt library and the bookmarks (M88, PLAN.md
// D67, lane P): one machine-scoped opt-in,
// `museSpark.syncPromptsAndBookmarks`, registers both keys; off, nothing
// leaves the computer. "This workspace" prompts live in `workspaceState`,
// which Settings Sync never carries, so no key can move them.

import { BOOKMARK_SYNC_KEY, PROMPT_SYNC_KEY } from '../shared/constants'

/** The library keys Settings Sync carries: both while the setting is on, none while off. */
export function librarySyncKeys(isSyncOn: boolean): readonly string[] {
  return isSyncOn ? [PROMPT_SYNC_KEY, BOOKMARK_SYNC_KEY] : []
}

/** Register the library keys beside the host's own synced keys. */
export function applyLibrarySyncKeys(
  state: { setKeysForSync(keys: readonly string[]): void },
  isSyncOn: boolean,
  ownKeys: readonly string[],
): void {
  state.setKeysForSync([...ownKeys, ...librarySyncKeys(isSyncOn)])
}
