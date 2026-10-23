import wrapAnsi from 'wrap-ansi'

/** Word-wrap a painted log line the way the bottom pane shows it:
wrap-ansi re-seats the SGR on every continued line, so colour never
bleeds across the break. Callers of BottomPane wrap long lines with
this before passing them in. */
export function wrapColored(line: string, width: number): readonly string[] {
  return wrapAnsi(line, Math.max(1, width), { hard: true, trim: false }).split('\n')
}
