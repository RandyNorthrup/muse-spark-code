// Masking for the import from other agents (M83, PLAN.md D49): every value
// the preview shows or the user copies passes through here, so a secret in
// another agent's MCP server, hook or file never reaches the screen, the
// clipboard or the log. What the user copies is masked too; they fill the
// masked values in by hand in the file it goes into.
//
// Three layers, strictest first:
//   - an MCP server's `env` and `headers` values are masked whole, whatever
//     their names (Muse Code's own MCP view shows only their names, M31);
//   - a URL keeps its scheme, host and path, with user-info and every query
//     value masked; a value after a credential-like flag (`--api-key x`,
//     `--token=x`) or in a credential-like assignment (`GITHUB_TOKEN=x`) is
//     masked;
//   - every other string is swept by the log redactor and for the token
//     shapes it does not know (GitHub, OpenAI and Anthropic, Slack, AWS,
//     Google, Stripe).
// Harmless values are sometimes masked too (`--keyring`); that errs safe.
// Pure; no `vscode` import.

import { redactSecrets } from '../redact'

/** The log redactor's own replacement, shown as the import's mask word instead. */
const REDACTOR_MARK = '[redacted]'
// `auth` but not `author`: a commit's author is no secret.
const CREDENTIAL = '(?:key|token|secret|passw(?:or)?d|auth(?!or)|bearer|credential|cookie)'
const TOKEN_SHAPE = new RegExp(
  [
    String.raw`\bgh[pousr]_\w{20,}`,
    String.raw`\bgithub_pat_\w{20,}`,
    String.raw`\bsk-[\w-]{16,}`,
    String.raw`\bxox[abprs]-[\w-]{10,}`,
    String.raw`\bAKIA[0-9A-Z]{16}\b`,
    String.raw`\bAIza[\w-]{30,}`,
    String.raw`\b[rs]k_live_\w{16,}`,
  ].join('|'),
  'g',
)
const CREDENTIAL_FLAG = new RegExp(String.raw`^--?[\w.-]*${CREDENTIAL}[\w.-]*$`, 'i')
const CREDENTIAL_FLAG_WITH_VALUE = new RegExp(String.raw`^(--?[\w.-]*${CREDENTIAL}[\w.-]*=).`, 'i')
// A bare value ends at a space, a quote, or a separator of queries and commands.
const VALUE = String.raw`("[^"]*"|'[^']*'|[^\s"'&;]+)`
const COMMAND_FLAG_VALUE = new RegExp(
  String.raw`(--?[\w.-]*${CREDENTIAL}[\w.-]*)(=|\s+)${VALUE}`,
  'gi',
)
const COMMAND_ASSIGNMENT = new RegExp(String.raw`\b(\w*${CREDENTIAL}\w*=)${VALUE}`, 'gi')
const QUERY_SEPARATOR = '&'
const QUERY_ASSIGN = '='
// A URL in text runs to whitespace, `<`, `>` or a quote mark or backtick, as
// the close of a shell argument or a Markdown code span ends it...
const URL_IN_TEXT = /\b[a-z][a-z\d+.-]*:\/\/[^\s<>"'`]+/giu
// ...unless the mark quotes part of a value (`?signature='x'`), which a shell
// joins into one word with the text either side (`'a'"b"`): a closed quote
// goes on the URL, and so does one left open where a value starts, after `=`,
// as far as a URL can run. Whitespace ends both, so a stray mark never takes
// the rest of a sentence.
const QUOTED_URL_VALUE =
  /(?:'[^\s<>']*'|"[^\s<>"]*"|`[^\s<>`]*`|(?<==)(?:'[^\s<>']+|"[^\s<>"]+|`[^\s<>`]+))[^\s<>"'`]*/uy
// After the mark a URL is wrapped in, a word character carries the value on,
// as in the shell's `'https://…?k='value''`; anything else closes the wrap.
const WORD_CHARACTER = /\w/u
const URL_TRAILING_PUNCTUATION = /[),.;]+$/u

/** Free text (a command line, a file's body) with every secret-looking value masked. */
export function maskText(text: string, mask: string): string {
  let urlsMasked = ''
  let copied = 0
  for (const found of text.matchAll(URL_IN_TEXT)) {
    // A URL inside a quoted value was masked with the URL that holds it.
    if (found.index < copied) {
      continue
    }
    const end = urlEnd(text, found.index, found.index + found[0].length)
    const url = text.slice(found.index, end)
    const suffix = URL_TRAILING_PUNCTUATION.exec(url)?.[0] ?? ''
    urlsMasked += `${text.slice(copied, found.index)}${maskUrl(url.slice(0, url.length - suffix.length), mask)}${suffix}`
    copied = end
  }
  return maskPlainText(`${urlsMasked}${text.slice(copied)}`, mask)
}

// Where a URL found at `start` ends: past each quoted part, unless its mark
// is the one the URL is wrapped in and closes the wrap (`curl "https://…?q="`,
// `fetch("https://…?q=")`, `["https://…?q=1","https://…"]`).
function urlEnd(text: string, start: number, plainEnd: number): number {
  const wrap = text.charAt(start - 1)
  let end = plainEnd
  QUOTED_URL_VALUE.lastIndex = end
  while (QUOTED_URL_VALUE.test(text)) {
    if (text.charAt(end) === wrap && !WORD_CHARACTER.test(text.charAt(end + 1))) {
      break
    }
    end = QUOTED_URL_VALUE.lastIndex
  }
  return end
}

// Shared final sweep: maskUrl uses it directly so embedded URLs do not recurse.
function maskPlainText(text: string, mask: string): string {
  return redactSecrets(text)
    .replaceAll(REDACTOR_MARK, () => mask)
    .replaceAll(TOKEN_SHAPE, () => mask)
    .replaceAll(COMMAND_ASSIGNMENT, (_match: string, name: string) => `${name}${mask}`)
    .replaceAll(
      COMMAND_FLAG_VALUE,
      (_match: string, flag: string, separator: string) => `${flag}${separator}${mask}`,
    )
}

/** Argument vectors: the value after a credential-like flag is masked whole. */
export function maskArgs(args: readonly string[], mask: string): readonly string[] {
  return args.map((arg, index) => {
    const withValue = CREDENTIAL_FLAG_WITH_VALUE.exec(arg)
    if (withValue?.[1] !== undefined) {
      return `${withValue[1]}${mask}`
    }
    const previous = args[index - 1]
    return previous !== undefined && CREDENTIAL_FLAG.test(previous) ? mask : maskText(arg, mask)
  })
}

/** Scheme, host and path kept; user-info and every query value masked; unparsable, masked whole. */
export function maskUrl(url: string, mask: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return mask
  }
  const userInfo = parsed.username === '' && parsed.password === '' ? '' : `${mask}@`
  const query = Array.from(
    parsed.searchParams.keys(),
    (name) => `${encodeURIComponent(name)}${QUERY_ASSIGN}${mask}`,
  ).join(QUERY_SEPARATOR)
  return maskPlainText(
    `${parsed.protocol}//${userInfo}${parsed.host}${parsed.pathname}${query === '' ? '' : `?${query}`}`,
    mask,
  )
}

/** Every value of a name-to-value table masked; the names stay, so the user knows what to fill in. */
export function maskValues(
  table: Readonly<Record<string, string>>,
  mask: string,
): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.keys(table).map((name) => [name, mask]))
}
