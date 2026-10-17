const NUL = '\0'

/** What names a turn in the window's running list and among its open turns. */
export function turnKey(sessionId: string, turnId: string): string {
  return `${sessionId}${NUL}${turnId}`
}
