// Secret redaction for anything that reaches a log, and for a session export
// (M84), which adds only the key digest. Pure; no `vscode` import. This is
// the one list of credential shapes the extension knows: a secret in any
// other shape is not recognised.
//
// Patterns cover the credential shapes this extension can encounter:
//   - Meta Model API keys: `LLM_` and at least 16 of `[A-Za-z0-9_-]` (the
//     current shape), or the older `LLM|<numeric id>|<secret>`; the same
//     shapes `MODEL_API_KEY_PATTERN` accepts
//   - HTTP bearer and basic credentials: `Bearer <token>`, `Basic <base64>`
//   - JSON Web Tokens (the CLI's OAuth access tokens are JWT-shaped):
//     three base64url parts, the first two starting `eyJ`, redacted from
//     the first `eyJ` on whatever is glued before it (`x-`, `x_`, `abc`)
//   - Environment assignments of the known key variables: `META_API_KEY=...`,
//     `MODEL_API_KEY=...`
//   - Token and secret fields in JSON, query strings or `key=value` text:
//     `access_token`, `refresh_token`, `id_token`, `client_secret`,
//     `api_key` / `apikey`, `password`
//   - Credentials in a URL's user-info part: `https://user:secret@host`
//   - Common services' keys and tokens, wherever they appear (a tool's
//     output, `cat .env`, a config file): a PEM private key; GitHub, GitLab,
//     npm, Google API and Muse Gadgets SDK tokens; AWS access key ids; Slack
//     tokens; `sk-` and `sk_live_` style API keys
//   - Secrets named by their key, the value replaced and the name kept: an
//     upper-case environment name that says so (`GITHUB_TOKEN=`), an
//     `api-key` header, `Authorization: token …`, a quoted JSON field, a URL
//     parameter, `~/.aws/credentials` lines in any case, an Azure connection
//     string's `AccountKey=`, and `.npmrc`'s `_authToken=`
//
// Every pattern scans in linear time (no nested quantifiers; each run is
// bounded or anchored on a literal): the session export runs them over
// whole conversations, and a crafted import file's text reaches the log.
// Replacements are functions, not strings, so no `$` sequence in the mark is
// interpreted (unicorn/no-unsafe-string-replacement).

import { REDACTED_MARK } from './constants'

/** T's broker-backed service. Hosts inject it at each outgoing/storage boundary. */
export interface SecretScrubPort {
  scrub(text: string): Promise<string>
  /**
   * Rotation counter the sender reads around awaits: when it moves between
   * the scrub and the dispatch, the body is rebuilt from current values. A
   * Lock in the same window fails the rebuild, so it never sends either.
   * Absent for foreign ports, which the sender treats as unchanging.
   */
  readonly generation?: number | undefined
}

/** Scrub exact vault values before patterns; service failures never fall back to delivery. */
export async function scrubSecrets(
  text: string,
  service?: SecretScrubPort,
  literals: readonly string[] = [],
): Promise<string> {
  return redactSecrets(service === undefined ? text : await service.scrub(text), literals)
}

/** The mark alone, in place of the whole match. */
function mark(): string {
  return REDACTED_MARK
}

/** The mark after the match's first group (the field name or scheme it follows). */
function markAfter(_match: string, lead: string): string {
  return `${lead}${REDACTED_MARK}`
}

/** A quoted value: its name and both quotes stay. */
function markQuoted(_match: string, lead: string, quote: string): string {
  return `${lead}${quote}${REDACTED_MARK}${quote}`
}

/** URL user-info: the scheme and the `@` stay. */
function markUserInfo(_match: string, lead: string): string {
  return `${lead}${REDACTED_MARK}@`
}

// A token's first two parts are base64url JSON, which starts `{"`.
const TOKEN_HEAD = 'eyJ'

function isTokenPayload(part: string | undefined): boolean {
  return part !== undefined && part.startsWith(TOKEN_HEAD) && part.length > TOKEN_HEAD.length
}

/**
 * `words` (three or more dotted words) with every token in it redacted: a
 * word holding `eyJ` and more, then a word starting `eyJ` and more, then any
 * word. A token is redacted from its first `eyJ` through its third word;
 * tokens that share a word are one redaction. Words without `eyJ` come back
 * as they were.
 */
function redactTokens(words: string): string {
  if (!words.includes(TOKEN_HEAD)) {
    return words
  }
  const parts = words.split('.')
  const kept: string[] = []
  // The index of the last part inside a token found so far.
  let redactedThrough = -1
  for (const [index, part] of parts.entries()) {
    const head = part.indexOf(TOKEN_HEAD)
    const isTokenStart =
      head !== -1 &&
      head + TOKEN_HEAD.length < part.length &&
      index + 2 < parts.length &&
      isTokenPayload(parts[index + 1])
    if (index > redactedThrough) {
      kept.push(isTokenStart ? `${part.slice(0, head)}${REDACTED_MARK}` : part)
    }
    if (isTokenStart) {
      redactedThrough = index + 2
    }
  }
  return kept.join('.')
}

/** One credential shape, applied in list order. */
export interface SecretRule {
  readonly pattern: RegExp
  /**
   * Lower case; every match of `pattern` that `replace` changes holds at
   * least one of these, case ignored. `MAY_HOLD_SECRET` must find each, or
   * the pattern never runs: redact.test.ts checks both against real-shaped
   * matches.
   */
  readonly literals: readonly string[]
  readonly replace: (match: string, lead: string, quote: string) => string
}

// The fields `QUOTED_SECRET_FIELD` and `SECRET_FIELD` name.
const SECRET_FIELD_LITERALS = ['token', 'secret', 'apikey', 'api_key', 'password']
// A PEM private key, its body to the END line. The one rule whose match runs
// on over line breaks other than in the white space after a name, `=` or `:`
// (`redactableSlices` relies on that).
const PEM_PRIVATE_KEY =
  /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----|$)/g

// Muse Gadgets SDK tokens (M92): `mgst_` and 43 base64url characters holding
// 32 bytes, so the last one is constrained to the endings those bytes take —
// the shape the SDK's own installer validates. The boundaries are explicit
// lookarounds over the token alphabet: `\b` treats `-` as a boundary, but
// `-` is in the alphabet, so a valid-length prefix of a longer run (a token
// with `-` or `-extra` glued on) must not match.
const GADGET_SDK_TOKEN_PREFIX = 'mgst_'
const GADGET_SDK_TOKEN_BODY = '[A-Za-z0-9_-]{42}'
const GADGET_SDK_TOKEN_LAST = '[AEIMQUYcgkosw048]'
const GADGET_SDK_TOKEN_EDGE = '[A-Za-z0-9_-]'
const GADGET_SDK_TOKEN_PATTERN = new RegExp(
  `(?<!${GADGET_SDK_TOKEN_EDGE})${GADGET_SDK_TOKEN_PREFIX}${GADGET_SDK_TOKEN_BODY}${GADGET_SDK_TOKEN_LAST}(?!${GADGET_SDK_TOKEN_EDGE})`,
  'g',
)

export const SECRET_RULES: readonly SecretRule[] = [
  // M71: redact whole PEM blocks before any rule can consume a boundary.
  { pattern: PEM_PRIVATE_KEY, literals: ['private key'], replace: mark },
  // Meta Model API keys.
  { pattern: /LLM_[\w-]{16,}|LLM\|\d+\|[\w+./=-]+/g, literals: ['llm'], replace: mark },
  { pattern: /(\bBearer\s+)[\w+./=~-]+/gi, literals: ['bearer'], replace: markAfter },
  { pattern: /(\bBasic\s+)[\w+/=]{8,}/gi, literals: ['basic'], replace: markAfter },
  // JSON Web Tokens, inside three or more words joined by dots, matched
  // whole. The lookbehind lets a match start only where a word starts, so a
  // long word is not read again from each of its characters; the tokens are
  // then found inside the match (`redactTokens`), so one glued after a dash,
  // an underscore or a letter is still found. Matched from each `eyJ`
  // instead (`\beyJ[\w-]+\.eyJ[\w-]+\.[\w-]+`), the rest of the word was read
  // again from every `eyJ` in it: quadratic, seconds for a 64,000-character
  // line of `eyJa-eyJa-…`.
  {
    pattern: /(?<![\w-])[\w-]+(?:\.[\w-]+){2,}/g,
    literals: ['eyj'],
    replace: (words) => redactTokens(words),
  },
  // The known key variables.
  { pattern: /((?:META|MODEL)_API_KEY\s*=\s*)\S+/g, literals: ['api_key'], replace: markAfter },
  {
    pattern:
      /((?:access_token|refresh_token|id_token|client_secret|api_?key|password)["']?\s*[:=]\s*)(["'])(?:\\.|[^\r\n\\])*?\2/gi,
    literals: SECRET_FIELD_LITERALS,
    replace: markQuoted,
  },
  {
    pattern:
      /((?:access_token|refresh_token|id_token|client_secret|api_?key|password)["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi,
    literals: SECRET_FIELD_LITERALS,
    replace: markAfter,
  },
  // Credentials in a URL. The scheme is bounded (real ones are a few
  // letters): unbounded, a long run such as `a.b.c.…` took quadratic time.
  {
    pattern: /(\b[a-z][\w+.-]{0,31}:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
    literals: ['://'],
    replace: markUserInfo,
  },
  // Whole tokens, recognised by their shape and replaced entirely.
  // GitHub tokens, GitLab personal access tokens, npm tokens.
  {
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,})/g,
    literals: ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_'],
    replace: mark,
  },
  { pattern: /\bglpat-[\w-]{20,255}/g, literals: ['glpat-'], replace: mark },
  { pattern: /\bnpm_[A-Za-z0-9]{36,255}/g, literals: ['npm_'], replace: mark },
  // Google API keys: `AIza` and 35 more.
  { pattern: /\bAIza[\w-]{35}/g, literals: ['aiza'], replace: mark },
  // Muse Gadgets SDK tokens.
  { pattern: GADGET_SDK_TOKEN_PATTERN, literals: ['mgst_'], replace: mark },
  // AWS access key ids, Slack tokens, and `sk-` / `sk_live_` style API keys.
  { pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, literals: ['akia', 'asia'], replace: mark },
  { pattern: /\bxox[abeposr]-[A-Za-z0-9-]{10,}/g, literals: ['xox'], replace: mark },
  {
    pattern: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,255}|\bsk-[\w-]{20,255}/g,
    literals: ['_live_', '_test_', 'sk-'],
    replace: mark,
  },
  // Secrets named by their key: the value after the name is replaced, the
  // name stays. This one is upper case only, so ordinary words
  // (`inputTokens: 12`) keep their values; the AWS file's lower-case names
  // have their own pattern.
  {
    pattern:
      /(\b[A-Z][A-Z0-9_]{0,60}(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIALS?)[A-Z0-9_]{0,60}\s{0,5}[=:]\s{0,5}["']?)[^\s"'&,;}]{1,4096}/g,
    literals: [
      'secret',
      'token',
      'passw',
      'api_key',
      'apikey',
      'access_key',
      'private_key',
      'credential',
    ],
    replace: markAfter,
  },
  {
    pattern:
      /(\baws_(?:secret_access_key|session_token)\s{0,5}[=:]\s{0,5}["']?)[^\s"'&,;}]{1,4096}/gi,
    literals: ['aws_secret_access_key', 'aws_session_token'],
    replace: markAfter,
  },
  {
    pattern: /(\b(?:Account|SharedAccess)Key\s{0,5}=\s{0,5})[^\s"';]{1,4096}/gi,
    literals: ['accountkey', 'sharedaccesskey'],
    replace: markAfter,
  },
  // Not after a dot or a word character, so code's `self._auth = …` stays.
  {
    pattern: /(?<![\w.])(_auth(?:Token)?\s{0,5}=\s{0,5}["']?)[^\s"'&,;}]{1,4096}/gi,
    literals: ['_auth'],
    replace: markAfter,
  },
  {
    pattern: /(\b(?:x-)?api-key\s{0,5}[:=]\s{0,5}["']?)[^\s"'&,;}]{1,4096}/gi,
    literals: ['api-key'],
    replace: markAfter,
  },
  {
    pattern: /(\bAuthorization\s{0,5}:\s{0,5}token\s{1,5})[^\s"'&,;}]{1,4096}/gi,
    literals: ['token'],
    replace: markAfter,
  },
  {
    pattern:
      /(["'][\w-]{0,40}(?:token|secret|passw(?:or)?d|api[_-]?key|private[_-]?key)["']\s{0,5}:\s{0,5}["'])[^"'\r\n]{1,4096}/gi,
    literals: [
      'token',
      'secret',
      'passw',
      'apikey',
      'api_key',
      'api-key',
      'privatekey',
      'private_key',
      'private-key',
    ],
    replace: markAfter,
  },
  {
    pattern: /([?&](?:token|key|secret|sig|signature|auth)=)[^&#\s"']{1,4096}/gi,
    literals: [
      'token',
      'secret',
      '?key=',
      '&key=',
      '?sig=',
      '&sig=',
      '?signature=',
      '&signature=',
      '?auth=',
      '&auth=',
    ],
    replace: markAfter,
  },
]

// Every rule's literals, case ignored: text with none of them, which is most
// of a conversation and most log lines, skips all the patterns in one linear
// scan instead of one scan each (RV84 #9). Kept as a literal pattern; a rule
// whose literal this misses would never run, so redact.test.ts proves it
// finds every rule's literals and every rule's real-shaped matches.
export const MAY_HOLD_SECRET =
  /LLM|bearer|basic|eyJ|token|secret|passw|api_?key|api-key|private|credential|access_?key|accountkey|_auth|aws_|:\/\/|gh[pousr]_|github_pat_|glpat-|npm_|mgst_|AIza|AKIA|ASIA|xox|_live_|_test_|sk-|[?&](?:key|sig|signature|auth)=/i

function redactPatterns(text: string, matched?: () => void): string {
  if (!MAY_HOLD_SECRET.test(text)) {
    return text
  }
  let result = text
  for (const rule of SECRET_RULES) {
    // A function, so no `$` sequence in the mark is interpreted.
    result = result.replaceAll(rule.pattern, (match: string, lead: string, quote: string) => {
      const replacement = rule.replace(match, lead, quote)
      if (replacement !== match) {
        matched?.()
      }
      return replacement
    })
  }
  return result
}

/**
 * The forms of one exact literal that literal-first redaction replaces (M80,
 * SPEC §4.2): the literal, its percent-encoded form, and what a pattern-only
 * pass leaves of it. Text that an earlier step already redacted by pattern
 * alone (a network error's description) still carries that residue, such as a
 * legacy key's tail after the `%` its pattern stops at.
 */
function literalForms(literal: string): string[] {
  const forms = [literal]
  try {
    forms.push(encodeURIComponent(literal))
  } catch {
    // A lone surrogate has no encoded form; the literal itself still applies.
  }
  const residue = redactPatterns(literal)
  if (residue !== literal && residue !== REDACTED_MARK) {
    forms.push(residue)
  }
  return forms
}

function redactWith(text: string, literals: readonly string[], matched?: () => void): string {
  let result = text
  const ordered = [
    ...new Set(literals.filter((value) => value !== '').flatMap((value) => literalForms(value))),
  ].toSorted((a, b) => b.length - a.length)
  for (const literal of ordered) {
    result = result.replaceAll(literal, () => {
      matched?.()
      return REDACTED_MARK
    })
  }
  return redactPatterns(result, matched)
}

/** Exact run keys precede patterns, including legacy keys containing percent signs. */
export function redactSecrets(text: string, literals: readonly string[] = []): string {
  return redactWith(text, literals)
}

/** Counts only changed, nonoverlapping matches in the same order as redaction. */
export function countSecretMatches(text: string, literals: readonly string[]): number {
  let count = 0
  redactWith(text, literals, () => {
    count += 1
  })
  return count
}

// --- Long text in slices (RV84 #9) ---
//
// A rule's match holds a line break only in the white space after a name, an
// `=` or a `:` (`Bearer\n  token`, `"password":\n  "…"`), or in a PEM key's
// body. So text cut just after a line break redacts piece by piece as it
// does whole, unless the last word before the break could start such a
// match: one holding a rule's literal (`MAY_HOLD_SECRET`), ending in `=` or
// `:`, or `Authorization` (whose rule has no literal of its own before its
// colon); or unless the break is inside a PEM key. Every lookbehind and `\b`
// reads a line break as it reads the start of the text, so a piece's edges
// change no match. redact.test.ts checks this against every rule.

const LINE_BREAK = '\n'
const WHITESPACE = /\s/
const OPEN_WORD_END = /(?:[=:]|authorization)$/i
// A rule's name before the white space runs at most this long (an
// upper-case variable: 1 + 60 + 11 + 60 characters), so a word's end is all
// that is read.
const OPEN_WORD_MAX_CHARS = 256
const PEM_START = '-----BEGIN '
const PEM_AT = new RegExp(PEM_PRIVATE_KEY.source, 'y')

/** Where the white space starting at `at` ends. */
function afterWhitespace(text: string, at: number): number {
  let end = at
  while (end < text.length && WHITESPACE.test(text.charAt(end))) {
    end += 1
  }
  return end
}

/**
 * Whether the last word before `cut`, after `from`, could start a match that
 * goes on past `cut`. Only white space since `from` (a cut already found
 * safe, or the text's start) leaves nothing open.
 */
function isWordOpen(text: string, from: number, cut: number): boolean {
  let end = cut
  while (end > from && WHITESPACE.test(text.charAt(end - 1))) {
    end -= 1
  }
  let start = end
  while (
    start > from &&
    end - start < OPEN_WORD_MAX_CHARS &&
    !WHITESPACE.test(text.charAt(start - 1))
  ) {
    start -= 1
  }
  const word = text.slice(start, end)
  return word !== '' && (MAY_HOLD_SECRET.test(word) || OPEN_WORD_END.test(word))
}

/** Where the PEM key that `cut` falls inside ends, if it falls inside one begun after `from`. */
function pemEndAround(text: string, from: number, cut: number): number | undefined {
  const start = text.lastIndexOf(PEM_START, cut - 1)
  if (start < from) {
    return undefined
  }
  PEM_AT.lastIndex = start
  const key = PEM_AT.exec(text)
  const end = key === null ? start : start + key[0].length
  return end > cut ? end : undefined
}

/**
 * The first cut at or after `target`, just after a line break, that no match
 * goes on past; undefined when there is none before the text's end.
 */
function safeCut(text: string, from: number, target: number): number | undefined {
  let at = target
  for (;;) {
    const lineBreak = text.indexOf(LINE_BREAK, at - 1)
    const cut = lineBreak + 1
    if (lineBreak === -1 || cut >= text.length) {
      return undefined
    }
    if (isWordOpen(text, from, cut)) {
      // The match may run through this white space: the next try is the
      // line after the next word.
      at = afterWhitespace(text, cut) + 1
      continue
    }
    const pemEnd = pemEndAround(text, from, cut)
    if (pemEnd === undefined) {
      return cut
    }
    at = pemEnd + 1
  }
}

/**
 * `text` in pieces of `sliceChars` or a little more, each ending just after
 * a line break that no credential goes on past, so `redactSecrets` of each
 * piece, joined, is `redactSecrets` of the whole: a long text can be redacted
 * a piece at a time, letting the event loop run between. A line longer than
 * `sliceChars` stays in one piece.
 */
export function redactableSlices(text: string, sliceChars: number): string[] {
  const slices: string[] = []
  let from = 0
  while (text.length - from > sliceChars) {
    const cut = safeCut(text, from, from + sliceChars)
    if (cut === undefined) {
      break
    }
    slices.push(text.slice(from, cut))
    from = cut
  }
  slices.push(text.slice(from))
  return slices
}
