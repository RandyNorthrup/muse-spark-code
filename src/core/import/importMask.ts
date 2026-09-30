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

/** Free text (a command line, a file's body) with every secret-looking value masked. */
export function maskText(text: string, mask: string): string {
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
  return maskText(
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
