// Whether a message is exactly one of our sentence templates with its slots
// filled by plain names. A boundary that lets only our own sentences leave
// (the ACP agent's) uses this: a slot can hold a file name, a command, a
// number or a fixed error word, never a prompt, a path with an account or a key.

/** What a template's slot may hold: a file or app name, a command, a platform or processor name, a number. */
const PLAIN_SLOT_VALUE = /^[\w./: -]{1,64}$/u

/** A failure's fixed-vocabulary cause: a plain name, plus the parentheses of `kind (MSP error 12)`. */
export const CAUSE_SLOT_VALUE = /^[\w./: ()-]{1,64}$/u

/**
Whether `message` is exactly one of `templates` (`{name}` slots) with each
slot filled by a value `slot` accepts.
*/
export function isFilledSentence(
  message: string,
  templates: Iterable<string>,
  slot: RegExp = PLAIN_SLOT_VALUE,
): boolean {
  return [...templates].some((template) => {
    const [first = '', ...rest] = template.split(/\{[a-z]+\}/u)
    if (!message.startsWith(first)) return false
    let remaining = message.slice(first.length)
    for (const fixed of rest) {
      const end = fixed === '' ? remaining.length : remaining.indexOf(fixed)
      if (end < 0 || !slot.test(remaining.slice(0, end))) return false
      remaining = remaining.slice(end + fixed.length)
    }
    return remaining === ''
  })
}
