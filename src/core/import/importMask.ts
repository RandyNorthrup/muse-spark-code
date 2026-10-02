// Masking for the import from other agents (M83, PLAN.md D49): every value
// the preview shows or the user copies passes through here, so a secret in
// another agent's MCP server, hook or file never reaches the screen, the
// clipboard or the log. What the user copies is masked too; they fill the
// masked values in by hand in the file it goes into.
//
// Dedicated fields are masked whole: an MCP server's `env` and `headers`
// values, whatever their names (Muse Code's own MCP view shows only their
// names, M31), and a URL field's user-info and query values, its scheme,
// host, path and query names kept.
//
// Free text (a command line, a file's body) fails closed, line by line: from
// the first credential cue on a line, everything to the end of the line is
// masked. Nothing tries to find where a value ends. Quote marks, a shell's
// word-joining and Markdown each end one differently, and three reviews each
// found a new leak in the patterns that tried. The cues:
//   - a URL with a query or user-info: `://`, then, before any whitespace,
//     a `?` (masked from just after it) or an `@` (masked from just after
//     `://`, where user-info starts);
//   - a name holding a credential word (`GITHUB_TOKEN`, `--api-key`,
//     `"client_secret"`), then `=`, `:` or whitespace, then a value;
//   - a known token shape (GitHub, OpenAI and Anthropic, Slack, AWS, Google,
//     Stripe) or the start of a JSON Web Token.
// An argument vector is masked the same way, each argument standing for a
// line, and the argument after a bare credential flag (`--token x`) is
// masked whole. The log redactor then sweeps what is left for its shapes.
// The rest of a line goes with the value, harmless text too at times
// (`keyboard shortcuts`, `--keyring`); that errs safe, and the preview shows
// it. Each scan reads a character a bounded number of times, so a long line
// costs milliseconds.
// Pure; no `vscode` import.

import { redactSecrets } from '../redact'

/** The log redactor's own replacement, shown as the import's mask word instead. */
const REDACTOR_MARK = '[redacted]'
// `auth` but not `author`: a commit's author is no secret, though an
// `Authorization` header is.
const CREDENTIAL = '(?:key|token|secret|passw(?:or)?d|auth(?!or(?!i))|bearer|credential|cookie)'
const CREDENTIAL_WORD = new RegExp(CREDENTIAL, 'i')
const QUOTE_MARKS = `["'\`]`
// A name holding a credential word, then its value; the match ends where the
// value starts. The name is a run of `[\w.-]` of any length, tried only where
// a run starts, so a long run is read a bounded number of times however many
// credential words it holds, not once from each of its characters. Quote
// marks may close the name (`"token": …`).
const NAMED_VALUE = new RegExp(
  String.raw`(?<![\w.-])(?=[\w.-]*?${CREDENTIAL})[\w.-]+${QUOTE_MARKS}*(?:\s*[=:]|\s)\s*(?=\S)`,
  'iu',
)
// Token shapes the log redactor does not know, and the start of a JSON Web
// Token (`eyJ`, base64url for `{"`). Masking a line from `eyJ` on also keeps
// the redactor's own token pattern, which retries at every `eyJ` of a long
// near-miss (`eyJa-eyJa-…`), from ever reading such a run.
const TOKEN_SHAPE = new RegExp(
  [
    String.raw`\bgh[pousr]_\w{20,}`,
    String.raw`\bgithub_pat_\w{20,}`,
    String.raw`\bsk-[\w-]{16,}`,
    String.raw`\bxox[abprs]-[\w-]{10,}`,
    String.raw`\bAKIA[0-9A-Z]{16}\b`,
    String.raw`\bAIza[\w-]{30,}`,
    String.raw`\b[rs]k_live_\w{16,}`,
    String.raw`\beyJ[\w-]`,
  ].join('|'),
  'u',
)
// Any scheme, however long: no scheme is parsed, `://` alone marks a URL.
const URL_MARK = '://'
// After `://`: a query mark with something after it, user-info's `@`, or
// the whitespace that ends the URL.
const URL_STOP = /\?(?=\S)|[@\s]/gu
const QUERY_MARK = '?'
const USER_INFO_MARK = '@'
// A line of free text, the farthest a credential's mask runs.
const LINE = /[^\r\n]+/gu
// A bare flag (`--token`, `-api-key`), whose value is the next argument.
const FLAG = /^--?[\w.-]*$/u
const QUERY_SEPARATOR = '&'
const QUERY_ASSIGN = '='

/** Free text (a command line, a file's body), each line masked from its first credential to its end. */
export function maskText(text: string, mask: string): string {
  return sweep(
    text.replaceAll(LINE, (line) => maskFromCredential(line, mask)),
    mask,
  )
}

/** Argument vectors: each argument masked as a line; the value after a credential flag masked whole. */
export function maskArgs(args: readonly string[], mask: string): readonly string[] {
  return args.map((arg, index) => {
    const previous = args[index - 1]
    return previous !== undefined && FLAG.test(previous) && CREDENTIAL_WORD.test(previous)
      ? mask
      : sweep(maskFromCredential(arg, mask), mask)
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
  // The host, path and query names are swept as free text apart: as one URL,
  // the `@` and `?` built here would mask the host and the names too.
  const query = Array.from(
    parsed.searchParams.keys(),
    (name) => `${maskText(encodeURIComponent(name), mask)}${QUERY_ASSIGN}${mask}`,
  ).join(QUERY_SEPARATOR)
  const hostAndPath = maskText(`${parsed.host}${parsed.pathname}`, mask)
  return `${parsed.protocol}//${userInfo}${hostAndPath}${query === '' ? '' : `?${query}`}`
}

/** Every value of a name-to-value table masked; the names stay, so the user knows what to fill in. */
export function maskValues(
  table: Readonly<Record<string, string>>,
  mask: string,
): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.keys(table).map((name) => [name, mask]))
}

// A line, or an argument, masked from its first credential value to its end.
function maskFromCredential(line: string, mask: string): string {
  const starts = [urlCredential(line), namedValue(line), TOKEN_SHAPE.exec(line)?.index].filter(
    (start) => start !== undefined,
  )
  return starts.length === 0 ? line : `${line.slice(0, Math.min(...starts))}${mask}`
}

// Where a URL's query or user-info starts. A URL with neither ends at
// whitespace, and the search goes on from there: any other `://` before that
// whitespace would stop at the same place, so it is not read again.
function urlCredential(line: string): number | undefined {
  let mark = line.indexOf(URL_MARK)
  while (mark !== -1) {
    const userInfo = mark + URL_MARK.length
    URL_STOP.lastIndex = userInfo
    const stop = URL_STOP.exec(line)
    if (stop === null) {
      return undefined
    }
    if (stop[0] === QUERY_MARK) {
      return stop.index + QUERY_MARK.length
    }
    if (stop[0] === USER_INFO_MARK) {
      return userInfo
    }
    mark = line.indexOf(URL_MARK, stop.index + 1)
  }
  return undefined
}

// Where the value of the first credential-like name starts.
function namedValue(line: string): number | undefined {
  const found = NAMED_VALUE.exec(line)
  return found === null ? undefined : found.index + found[0].length
}

// The log redactor's shapes in what is left, its mark shown as the mask word.
function sweep(text: string, mask: string): string {
  return redactSecrets(text).replaceAll(REDACTOR_MARK, () => mask)
}
