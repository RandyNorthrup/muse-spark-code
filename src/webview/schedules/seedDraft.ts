// Pre-filling the opening schedule editor's prompt: `/schedule add`
// (M115) stashes its prompt, and Schedule This Prompt (M88, D67 item
// 15) seeds the composer's own draft, read live at render. Pure and
// English-free, so the chat's first paint carries none of the schedule
// surfaces' words (STARTUP017). The editor snapshots its draft on
// mount, so a later draft never disturbs an open editor.
import type { ScheduleDraft } from '../../shared/scheduleV2'

export function seedScheduleDraft(
  draft: ScheduleDraft,
  pendingPrompt: string | undefined,
  composerDraft: string | undefined,
): ScheduleDraft {
  const seed =
    pendingPrompt ??
    (composerDraft !== undefined && composerDraft.trim() !== '' ? composerDraft : undefined)
  return seed === undefined ? draft : { ...draft, action: { kind: 'prompt', prompt: seed } }
}
