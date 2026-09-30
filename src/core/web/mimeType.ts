// A Content-Type header's parameters (M69, PLAN.md D49), read as the MIME
// Sniffing standard's "parse a MIME type" reads them: a name up to `=` or
// `;`, ASCII lower-cased; a value that is a quoted string (backslash escapes
// resolved, the rest up to the next `;` dropped) or runs to the next `;`
// with trailing white space removed; the first valid parameter of a name
// kept. So `x="charset=utf-16"; charset=utf-8` has the charset utf-8, and
// `xcharset=utf-16` has none.

const PARAMETER_SEPARATOR = ';'
const ASSIGN = '='
const QUOTE = '"'
const ESCAPE = '\\'
const HTTP_WHITESPACE = new Set([' ', '\t', '\n', '\r'])
// RFC 9110 token characters, as the standard checks a parameter's name.
const TOKEN = /^[\w!#$%&'*+.^`|~-]+$/
// What a parameter's value may hold: tab, and the visible and Latin-1 range.
const QUOTED_STRING_TOKEN = /^[\t\u{20}-\u{7E}\u{80}-\u{FF}]*$/u

function skipWhitespace(text: string, from: number): number {
  let index = from
  while (index < text.length && HTTP_WHITESPACE.has(text[index] ?? '')) {
    index += 1
  }
  return index
}

/** A quoted string at `start` (its `"`): its value, and where reading resumes. */
function quotedString(text: string, start: number): { value: string; next: number } {
  let value = ''
  let index = start + 1
  while (index < text.length) {
    const char = text[index] ?? ''
    if (char === QUOTE) {
      return { value, next: index + 1 }
    }
    if (char === ESCAPE && index + 1 < text.length) {
      value += text[index + 1] ?? ''
      index += 2
      continue
    }
    value += char
    index += 1
  }
  return { value, next: index }
}

/** The header's parameters, first of each valid name kept. */
function parametersOf(contentType: string): ReadonlyMap<string, string> {
  const parameters = new Map<string, string>()
  let index = contentType.indexOf(PARAMETER_SEPARATOR)
  if (index === -1) {
    return parameters
  }
  while (index < contentType.length) {
    index = skipWhitespace(contentType, index + 1)
    let nameEnd = index
    while (
      nameEnd < contentType.length &&
      contentType[nameEnd] !== PARAMETER_SEPARATOR &&
      contentType[nameEnd] !== ASSIGN
    ) {
      nameEnd += 1
    }
    const name = contentType.slice(index, nameEnd).toLowerCase()
    index = nameEnd
    if (index >= contentType.length) {
      break
    }
    if (contentType[index] === PARAMETER_SEPARATOR) {
      continue
    }
    index += 1
    let value: string
    if (contentType[index] === QUOTE) {
      const read = quotedString(contentType, index)
      value = read.value
      index = read.next
      while (index < contentType.length && contentType[index] !== PARAMETER_SEPARATOR) {
        index += 1
      }
    } else {
      let end = index
      while (end < contentType.length && contentType[end] !== PARAMETER_SEPARATOR) {
        end += 1
      }
      let trimmed = end
      while (trimmed > index && HTTP_WHITESPACE.has(contentType[trimmed - 1] ?? '')) {
        trimmed -= 1
      }
      value = contentType.slice(index, trimmed)
      index = end
      if (value === '') {
        continue
      }
    }
    if (TOKEN.test(name) && QUOTED_STRING_TOKEN.test(value) && !parameters.has(name)) {
      parameters.set(name, value)
    }
  }
  return parameters
}

/** A Content-Type parameter's value (`charset`), undefined when the header has none. */
export function mimeParameter(contentType: string, name: string): string | undefined {
  return parametersOf(contentType).get(name)
}
