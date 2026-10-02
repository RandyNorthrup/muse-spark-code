// Credential refusal for the import from other agents (M83, PLAN.md D49).
// Every imported item (a rules file, a command, an agent, a hook, an MCP
// server) is checked whole before it is offered. When a credential cue
// appears anywhere in it, the item is not imported at all: nothing of it is
// published or copied, and the preview names it with the kind of cue it
// holds, never the value, for the user to copy by hand. Masking a value
// inside the text needs to know where that value ends, and four review
// rounds each found a spelling that hid it (quote marks a shell joins, JSON
// escapes, a value on the next line, a joined credential name); a refusal
// needs only to see the cue.
//
// Each item's text is read in three spellings; a cue in any one refuses it:
//   1. as written, after Unicode NFKC, with invisible format characters
//      removed and Cyrillic and Greek look-alikes read as Latin letters;
//   2. as a shell, a JSON reader or a URL decoder would read it: escapes
//      (`\u0074`, `\x74`, `\164`, `\n`, `%74`, `&#116;`) decoded (an
//      unknown one, as in a Windows path, kept as written), a line
//      continuation (`\`, `^` or a backtick before a line break) and every
//      quote mark removed;
//   3. spelling 2 with every character but letters, digits, whitespace, `-`,
//      `=` and `:` removed, so a name split by other punctuation
//      (`**to**ken:`, `--to\ken`) reads whole; `-` stays for flags.
// Names are matched without regard to case; token shapes keep theirs. The
// lines are read as one: a name, its separator and its value may each be on
// a line of their own (`password:`, then the value below it), as whitespace
// between them may hold any line break.
//
// The cues, by the kind the preview names:
//   - name: a word holding a credential word (`token` but not `tokenizer`,
//     `secret`, `passw`, `api_key`, `auth` but not `author`, `authenticate`
//     or `authorized`, `bearer`, `credential`, `private_key`, `access_key`,
//     `signature`, `cookie`, `session_id`, `jwt`, a `_KEY` or `.key`
//     ending), or exactly `pw` or `otp`, followed by `=` or `:` (not `==` or
//     `::`) and a value, on its line or a later one; such a flag (`--token`)
//     followed by a value that is not another flag; any word ending in
//     `key`, or exactly `sig`, `code` or `pass`, followed by `=` and a value;
//     `Bearer` and a value, or `Basic` and an encoded one; `-u` or `--user`
//     followed by `name:password`;
//   - url: user-info (`//user:pw@`, with or without a scheme), or a name cue
//     right after a query's `?` or `&`;
//   - token: a known token shape (GitHub, GitLab, OpenAI and Anthropic,
//     Slack, AWS, Google, Stripe, npm, Hugging Face, Meta's Model API key,
//     a JSON Web Token's start, a PEM private key, Slack and Discord webhook
//     URLs);
//   - opaque: `AGENT_IMPORT_OPAQUE_RUN_MIN_CHARS` or more base64 or hex
//     characters in a row (`/` apart, which joins a path's folders) that mix
//     digits with letters (hex) or with both letter cases. Only spellings 1
//     and 2: spelling 3 joins ordinary words.
// A credential word needs a separator and a value after it, so prose such
// as "count the tokens" passes; `max_tokens: 4096`, `**Secrets**: never
// commit them` and a placeholder `API_KEY=your-key` are refused, which errs
// safe (25 of 200 open-source rule files, a third of them for a key, a
// password or a placeholder for one; `docs/certification/m83b.md`). Each
// scan reads a character a bounded number of times, so a long line costs
// milliseconds. Pure; no `vscode` import.

import { AGENT_IMPORT_OPAQUE_RUN_MIN_CHARS } from '../../shared/constants'

/** The kind of cue an item was refused for; shown and logged in its place, never the value. */
export type CredentialCue = 'name' | 'url' | 'token' | 'opaque'

// Cyrillic and Greek letters drawn like Latin ones, each read as the Latin
// letter at its place in the second string: Cyrillic small a e o p c y x i
// j s d l k, capital A B E K M H O P C T X Y I J S; Greek small alpha
// omicron kappa nu iota rho upsilon tau, capital A B E Z H I K M N O P T Y X.
const LOOK_ALIKES_FROM =
  '\u{430}\u{435}\u{43E}\u{440}\u{441}\u{443}\u{445}\u{456}\u{458}\u{455}\u{501}\u{4CF}\u{43A}\u{410}\u{412}\u{415}\u{41A}\u{41C}\u{41D}\u{41E}\u{420}\u{421}\u{422}\u{425}\u{423}\u{406}\u{408}\u{405}\u{3B1}\u{3BF}\u{3BA}\u{3BD}\u{3B9}\u{3C1}\u{3C5}\u{3C4}\u{391}\u{392}\u{395}\u{396}\u{397}\u{399}\u{39A}\u{39C}\u{39D}\u{39F}\u{3A1}\u{3A4}\u{3A5}\u{3A7}'
const LOOK_ALIKES_TO = 'aeopcyxijsdlkABEKMHOPCTXYIJSaokviputABEZHIKMNOPTYX'
const LOOK_ALIKES: ReadonlyMap<string, string> = new Map(
  Array.from(LOOK_ALIKES_FROM, (letter, index) => [letter, LOOK_ALIKES_TO.charAt(index)]),
)
const LOOK_ALIKE = new RegExp(`[${LOOK_ALIKES_FROM}]`, 'gu')
const FORMAT_CHARACTER = /\p{Cf}/gu

// Spelling 2's steps, each one linear replace.
const CONTINUATION = /[\\^`]\r?\n/g
const ESCAPE = /\\(?:u\{[\dA-Fa-f]{1,6}\}|u[\dA-Fa-f]{4}|x[\dA-Fa-f]{2}|[0-7]{1,3}|[\s\S])/g
const PERCENT_ESCAPES = /(?:%[\dA-Fa-f]{2})+/g
const PERCENT_ESCAPE = /%([\dA-Fa-f]{2})/g
const ENTITY = /&#(?:[xX][\dA-Fa-f]{1,6}|\d{1,7});/g
const QUOTE_MARK = /["'`\u{AB}\u{BB}\u{2018}-\u{201F}\u{2039}\u{203A}]/gu
// JSON's and JavaScript's one-character escapes; quote marks go anyway.
const NAMED_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['n', '\n'],
  ['r', '\r'],
  ['t', '\t'],
  ['b', '\b'],
  ['f', '\f'],
  ['v', '\v'],
  ['/', '/'],
  ['\\', '\\'],
  ['"', ''],
  ["'", ''],
  ['`', ''],
])
const HEX = 16
const OCTAL = 8
const DECIMAL = 10
const MAX_CODE_POINT = 0x10_ff_ff
const OCTAL_DIGITS = /^[0-7]+$/
const ENTITY_PREFIX = '&#'
const ENTITY_HEX_MARK = /^[xX]/
// Spelling 3: punctuation dropped, the separators a name cue needs and a
// flag's dash kept.
const PUNCTUATION = /[^\p{L}\p{M}\p{N}\s=:-]+/gu

// A name: letters, digits and the joiners names use, tried once per run.
const NAME = /[\p{L}\p{M}\p{N}_.-]+/gu
// `auth` and `token`, but not the English words built on them that name no
// credential (`author`, `authenticate`, `authorized`, `tokenizer`), though
// `Authorization`, the header, stays one.
const CREDENTIAL_WORD =
  /token(?!iz)|secret|passw|passphrase|pwd|api[_.-]?key|auth(?!or(?!i)|enticat|oriz(?!ation))|bearer|credential|private[_.-]?key|access[_.-]?key|signature|cookie|session[_.-]?id|sessid|jwt/iu
const CREDENTIAL_EXACT = /^-*(?:pw|otp)$/iu
// A key named as such in an environment or configuration name: `SIGNING_KEY`,
// `signing.key`, `SIGNINGKEY`; case kept.
const KEY_ENDING = /(?:[_.-][Kk][Ee][Yy]|[\dA-Z]KEY)[Ss]?$/u
// Words that name a credential only when assigned or in a query (`key=`,
// `cacheKey = …`): code's `queryKey: […]` and prose's `first pass:` do not.
const ASSIGNMENT_ONLY = /keys?$|^-*(?:sig|code|pass)$/iu
const FLAG_MARK = '-'
const BEARER = /^bearer$/iu
const BASIC = /^basic$/iu
const USER_FLAG = /^(?:-u|--user)$/u
// What follows a name: closing quote marks, then a separator, then a value.
// A comparison's `==` and a path's `::` separate nothing.
const ASSIGNED = /["'`]*\s*(?:=(?!=)|:(?!:))\s*\S/uy
const ASSIGNED_EQUALS = /["'`]*\s*=(?!=)\s*\S/uy
// A flag's value: not another flag (`--repo-token, --service-name`).
const FOLLOWED = /["'`]*\s+[^\s-]/uy
const USER_AND_PASSWORD = /\s+[^\s:]+:\S/uy
// An encoded value after `Basic`: an encoded character, a digit or an inner
// capital, so `basic usage` and `Basic Examples` stay prose.
const BASIC_VALUE = /\s+([\d+/A-Za-z]{8,}=*)/uy
const ENCODED_SIGN = /[\d+/=]|.[A-Z]/u
const QUERY_MARKS: ReadonlySet<string> = new Set(['?', '&', ';'])
const WHITESPACE = /\s/u

const USER_INFO = /\/\/[^\s#/?@]+@/u
const TOKEN_SHAPE = new RegExp(
  [
    String.raw`\bgh[oprsu]_[\dA-Za-z]{20,}`,
    String.raw`\bgithub_pat_\w{20,}`,
    String.raw`\bglpat-[\w-]{20,}`,
    String.raw`\bsk-[\w-]{16,}`,
    String.raw`\bxox[abeprs]-[\w-]{10,}`,
    String.raw`\b(?:AKIA|ASIA)[\dA-Z]{16}\b`,
    String.raw`\bAIza[\w-]{30,}`,
    String.raw`\b[prs]k_(?:live|test)_\w{16,}`,
    String.raw`\bnpm_[\dA-Za-z]{36}`,
    String.raw`\bhf_[\dA-Za-z]{30,}`,
    String.raw`LLM_[\w-]{16,}`,
    String.raw`LLM\|\d+\|[\w+./=-]+`,
    String.raw`\beyJ[\w-]`,
    '-----BEGIN[ A-Z]{0,40}PRIVATE KEY',
    String.raw`hooks\.slack\.com/services/`,
    String.raw`discord(?:app)?\.com/api/webhooks/`,
  ].join('|'),
  'u',
)
// Base64 and hex characters, but not `/`, which joins a path's folders into
// one long run.
const OPAQUE_RUN = /[\w+=-]+/g
const HEX_RUN = /^[\dA-Fa-f]+$/
const DIGIT = /\d/
const HEX_LETTER = /[A-Fa-f]/
const LOWER = /[a-z]/
const UPPER = /[A-Z]/

/**
 * The first credential cue in an item, read across all its texts (each
 * field of a server, a hook's command and matcher, a file and its name) in
 * every spelling; undefined when there is none.
 */
export function credentialCue(texts: readonly string[]): CredentialCue | undefined {
  const written = asWritten(texts.join('\n'))
  const joined = asJoined(written)
  const bare = joined.replaceAll(PUNCTUATION, '')
  const spellings = [written, joined, bare]
  if (spellings.some((text) => TOKEN_SHAPE.test(text))) {
    return 'token'
  }
  if (spellings.some((text) => USER_INFO.test(text))) {
    return 'url'
  }
  for (const text of spellings) {
    const cue = namedCue(text)
    if (cue !== undefined) {
      return cue
    }
  }
  return [written, joined].some((text) => hasOpaqueRun(text)) ? 'opaque' : undefined
}

/** Every value of a name-to-value table masked; the names stay, so the user knows what to fill in. */
export function maskValues(
  table: Readonly<Record<string, string>>,
  mask: string,
): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.keys(table).map((name) => [name, mask]))
}

// Spelling 1.
function asWritten(text: string): string {
  return text
    .normalize('NFKC')
    .replaceAll(FORMAT_CHARACTER, '')
    .replaceAll(LOOK_ALIKE, (letter) => LOOK_ALIKES.get(letter) ?? letter)
}

// Spelling 2; what the decoding produced is normalized again.
function asJoined(written: string): string {
  return asWritten(
    written
      .replaceAll(CONTINUATION, '')
      .replaceAll(ESCAPE, (escape) => decodeEscape(escape))
      .replaceAll(PERCENT_ESCAPES, (run) => decodePercent(run))
      .replaceAll(ENTITY, (entity) => decodeEntity(entity))
      .replaceAll(QUOTE_MARK, ''),
  )
}

function fromCodePoint(digits: string, radix: number): string {
  const point = Number.parseInt(digits, radix)
  return point <= MAX_CODE_POINT ? String.fromCodePoint(point) : ''
}

// One backslash escape as JSON, JavaScript or a shell's `$'…'` reads it.
// An unknown one stays as written, so a Windows path's folders do not join
// into one long word; spelling 3 drops its backslash, as a shell would.
function decodeEscape(escape: string): string {
  const body = escape.slice(1)
  if (body.startsWith('u{')) {
    return fromCodePoint(body.slice(2, -1), HEX)
  }
  if (body.length > 1 && (body.startsWith('u') || body.startsWith('x'))) {
    return fromCodePoint(body.slice(1), HEX)
  }
  return OCTAL_DIGITS.test(body) ? fromCodePoint(body, OCTAL) : (NAMED_ESCAPES.get(body) ?? escape)
}

// A run of percent escapes as UTF-8, or byte by byte when it is not.
function decodePercent(run: string): string {
  try {
    return decodeURIComponent(run)
  } catch {
    return run.replaceAll(PERCENT_ESCAPE, (_escape, byte: string) => fromCodePoint(byte, HEX))
  }
}

function decodeEntity(entity: string): string {
  const digits = entity.slice(ENTITY_PREFIX.length, -1)
  return ENTITY_HEX_MARK.test(digits)
    ? fromCodePoint(digits.slice(1), HEX)
    : fromCodePoint(digits, DECIMAL)
}

// The first name followed by a value it names, as `name` or, right after a
// query's mark, `url`.
function namedCue(text: string): CredentialCue | undefined {
  for (const match of text.matchAll(NAME)) {
    const name = match[0]
    const end = match.index + name.length
    if (isNamedValue(text, name, end)) {
      return isInQuery(text, match.index) ? 'url' : 'name'
    }
  }
  return undefined
}

function isFollowedBy(pattern: RegExp, text: string, at: number): boolean {
  pattern.lastIndex = at
  return pattern.test(text)
}

function isNamedValue(text: string, name: string, end: number): boolean {
  if (CREDENTIAL_WORD.test(name) || CREDENTIAL_EXACT.test(name) || KEY_ENDING.test(name)) {
    return (
      isFollowedBy(ASSIGNED, text, end) ||
      ((name.startsWith(FLAG_MARK) || BEARER.test(name)) && isFollowedBy(FOLLOWED, text, end))
    )
  }
  if (ASSIGNMENT_ONLY.test(name)) {
    return isFollowedBy(ASSIGNED_EQUALS, text, end)
  }
  if (BASIC.test(name)) {
    BASIC_VALUE.lastIndex = end
    const value = BASIC_VALUE.exec(text)?.[1]
    return value !== undefined && ENCODED_SIGN.test(value)
  }
  return USER_FLAG.test(name) && isFollowedBy(USER_AND_PASSWORD, text, end)
}

// Whether a query's `?` or `&` comes right before the name, whitespace apart.
function isInQuery(text: string, start: number): boolean {
  let at = start - 1
  while (at >= 0 && WHITESPACE.test(text.charAt(at))) {
    at -= 1
  }
  return QUERY_MARKS.has(text.charAt(at))
}

function hasOpaqueRun(text: string): boolean {
  for (const [run] of text.matchAll(OPAQUE_RUN)) {
    if (run.length >= AGENT_IMPORT_OPAQUE_RUN_MIN_CHARS && isOpaque(run)) {
      return true
    }
  }
  return false
}

// Hex with digits and letters, or anything else with digits and both cases.
function isOpaque(run: string): boolean {
  if (!DIGIT.test(run)) {
    return false
  }
  return HEX_RUN.test(run) ? HEX_LETTER.test(run) : LOWER.test(run) && UPPER.test(run)
}
