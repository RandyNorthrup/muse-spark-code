// M105 RLF-RECORDING: the recorder helpers' line discipline, shared by the
// Windows, macOS and Linux launch ports. Newline framing with a per-line
// bound: a line past the bound is corruption, so the framer latches silent
// and the run settles on the helper's exit instead of reading further.
import { SCREEN_RECORDING_LINE_MAX_BYTES } from '../../shared/constants'

export interface HelperLineFramer {
  /** The lines this chunk completes; over-long input latches the framer silent. */
  readonly push: (chunk: string) => string[]
  /** The trailing partial line, if any is still deliverable. */
  readonly end: () => string[]
}

/**
The launch ports' line discipline: newline framing with a per-line bound. A
line past the bound is corruption, so the framer latches silent and the
run settles on the helper's exit instead of reading further.
*/
export function createHelperLineFramer(
  maxLineBytes: number = SCREEN_RECORDING_LINE_MAX_BYTES,
): HelperLineFramer {
  let buffered = ''
  let isLatched = false
  const isBounded = (line: string): boolean => Buffer.byteLength(line, 'utf8') <= maxLineBytes
  return {
    push: (chunk) => {
      if (isLatched) return []
      buffered += chunk
      const lines: string[] = []
      for (;;) {
        const index = buffered.indexOf('\n')
        if (index === -1) break
        const line = buffered.slice(0, index).replace(/\r$/, '')
        buffered = buffered.slice(index + 1)
        if (!isBounded(line)) {
          isLatched = true
          buffered = ''
          return lines
        }
        lines.push(line)
      }
      // An unterminated run past the bound can never become a valid line.
      if (!isBounded(buffered)) {
        isLatched = true
        buffered = ''
      }
      return lines
    },
    end: () => {
      if (isLatched || buffered === '') return []
      const line = buffered
      buffered = ''
      return isBounded(line) ? [line] : []
    },
  }
}
