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
//     three base64url parts, the first two starting `eyJ`
//   - Environment assignments of the known key variables: `META_API_KEY=...`,
//     `MODEL_API_KEY=...`
//   - Token and secret fields in JSON, query strings or `key=value` text:
//     `access_token`, `refresh_token`, `id_token`, `client_secret`,
//     `api_key` / `apikey`, `password`
//   - Credentials in a URL's user-info part: `https://user:secret@host`
//   - Common services' keys and tokens, wherever they appear (a tool's
//     output, `cat .env`, a config file): a PEM private key; GitHub, GitLab,
//     npm and Google API tokens; AWS access key ids; Slack tokens; `sk-` and
//     `sk_live_` style API keys
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

import { REDACTED_MARK } from '../shared/constants'

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

/** One credential shape, applied in list order. */
export interface SecretRule {
  readonly pattern: RegExp
  /**
   * Lower case; every match of `pattern` holds at least one of these, case
   * ignored. `MAY_HOLD_SECRET` must find each, or the pattern never runs:
   * redact.test.ts checks both against real-shaped matches.
   */
  readonly literals: readonly string[]
  readonly replace: (match: string, lead: string, quote: string) => string
}

// The fields `QUOTED_SECRET_FIELD` and `SECRET_FIELD` name.
const SECRET_FIELD_LITERALS = ['token', 'secret', 'apikey', 'api_key', 'password']

export const SECRET_RULES: readonly SecretRule[] = [
  // Meta Model API keys.
  { pattern: /LLM_[\w-]{16,}|LLM\|\d+\|[\w+./=-]+/g, literals: ['llm'], replace: mark },
  { pattern: /(\bBearer\s+)[\w+./=~-]+/gi, literals: ['bearer'], replace: markAfter },
  { pattern: /(\bBasic\s+)[\w+/=]{8,}/gi, literals: ['basic'], replace: markAfter },
  // A JSON Web Token. Starts only where no token character precedes: with
  // `\b`, a long `eyJ-eyJ-…` run began a scan at every hyphen and took
  // quadratic time.
  { pattern: /(?<![\w-])eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g, literals: ['eyj'], replace: mark },
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
  // Whole tokens, recognised by their shape and replaced entirely. A PEM
  // private key, its body to the END line:
  {
    pattern:
      /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----[A-Za-z0-9+/=\s]*(?:-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----)?/g,
    literals: ['private key'],
    replace: mark,
  },
  // GitHub tokens, GitLab personal access tokens, npm tokens.
  {
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_\w{20,255})/g,
    literals: ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_'],
    replace: mark,
  },
  { pattern: /\bglpat-[\w-]{20,255}/g, literals: ['glpat-'], replace: mark },
  { pattern: /\bnpm_[A-Za-z0-9]{36,255}/g, literals: ['npm_'], replace: mark },
  // Google API keys: `AIza` and 35 more.
  { pattern: /\bAIza[\w-]{35}/g, literals: ['aiza'], replace: mark },
  // AWS access key ids, Slack tokens, and `sk-` / `sk_live_` style API keys.
  { pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, literals: ['akia', 'asia'], replace: mark },
  { pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,255}/g, literals: ['xox'], replace: mark },
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
  /LLM|bearer|basic|eyJ|token|secret|passw|api_?key|api-key|private|credential|access_?key|accountkey|_auth|aws_|:\/\/|gh[pousr]_|github_pat_|glpat-|npm_|AIza|AKIA|ASIA|xox|_live_|_test_|sk-|[?&](?:key|sig|signature|auth)=/i

export function redactSecrets(text: string): string {
  if (!MAY_HOLD_SECRET.test(text)) {
    return text
  }
  let result = text
  for (const rule of SECRET_RULES) {
    // A function, so no `$` sequence in the mark is interpreted.
    result = result.replaceAll(rule.pattern, (match: string, lead: string, quote: string) =>
      rule.replace(match, lead, quote),
    )
  }
  return result
}
