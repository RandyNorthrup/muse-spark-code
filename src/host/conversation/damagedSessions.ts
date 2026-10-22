// Damaged-session markers (CLI recovery): a session whose Muse Code
// event log failed takes no new message. Every marker is kept — forgetting
// one only bought its next message Muse Code's own error again. Pure.

/** Mark one session damaged, keeping every marker; remarking changes nothing. */
export function markedDamagedIds(damaged: readonly string[], sessionId: string): readonly string[] {
  return damaged.includes(sessionId) ? damaged : [...damaged, sessionId]
}
