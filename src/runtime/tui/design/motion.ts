/** Rising bar spinner: smooth block steps where the tier carries blocks,
ASCII where it does not. */
const BLOCK_SPINNER = ['▁', '▃', '▄', '▅', '▆', '▇', '█', '▇', '▆', '▅', '▄', '▃']
const ASCII_SPINNER = ['|', '/', '-', '\\']

/** One spinner frame: pure in the tick, so goldens pin exact frames. */
export function spinnerFrame(tick: number, isAscii: boolean): string {
  const frames = isAscii ? ASCII_SPINNER : BLOCK_SPINNER
  return frames[((tick % frames.length) + frames.length) % frames.length] ?? ''
}

/** A filling bar `fraction` full over `width` cells. Fractions outside
0..1 clamp: a bar never overflows or inverts. */
export function progressBar(width: number, fraction: number, isAscii: boolean): string {
  const full = isAscii ? '#' : '█'
  const empty = isAscii ? '.' : '░'
  const clamped = Math.min(1, Math.max(0, fraction))
  const filled = Math.round(clamped * width)
  return full.repeat(filled) + empty.repeat(Math.max(0, width - filled))
}

/** Splash frames: the mark revealed top-down over its last rows, then
held. Reduced motion plays only the complete frame. */
export function splashFrames(
  art: readonly string[],
  hasReducedMotion: boolean,
): readonly (readonly string[])[] {
  if (hasReducedMotion || art.length === 0) return [art]
  // The reveal answers in whole rows: a partial row would tear the mark.
  return art.map((_, end) => art.slice(0, end + 1))
}
