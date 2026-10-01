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

const META_MODEL_API_KEY = /LLM_[\w-]{16,}|LLM\|\d+\|[\w+./=-]+/g
const BEARER_TOKEN = /(\bBearer\s+)[\w+./=~-]+/gi
const BASIC_CREDENTIALS = /(\bBasic\s+)[\w+/=]{8,}/gi
// Starts only where no token character precedes: with `\b`, a long
// `eyJ-eyJ-…` run began a scan at every hyphen and took quadratic time.
const JSON_WEB_TOKEN = /(?<![\w-])eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g
const KEY_ENV_ASSIGNMENT = /((?:META|MODEL)_API_KEY\s*=\s*)\S+/g
const QUOTED_SECRET_FIELD =
  /((?:access_token|refresh_token|id_token|client_secret|api_?key|password)["']?\s*[:=]\s*)(["'])(?:\\.|[^\r\n\\])*?\2/gi
const SECRET_FIELD =
  /((?:access_token|refresh_token|id_token|client_secret|api_?key|password)["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi
// The scheme is bounded (real ones are a few letters): unbounded, a long run
// such as `a.b.c.…` took quadratic time.
const URL_USER_INFO = /(\b[a-z][\w+.-]{0,31}:\/\/)[^\s/@:]+:[^\s/@]+@/gi
// Whole tokens, recognised by their shape and replaced entirely.
const TOKEN_SHAPES: readonly RegExp[] = [
  // A PEM private key, its body to the END line.
  /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----[A-Za-z0-9+/=\s]*(?:-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----)?/g,
  // GitHub tokens, GitLab personal access tokens, npm tokens.
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_\w{20,255})/g,
  /\bglpat-[\w-]{20,255}/g,
  /\bnpm_[A-Za-z0-9]{36,255}/g,
  // Google API keys: `AIza` and 35 more.
  /\bAIza[\w-]{35}/g,
  // AWS access key ids, Slack tokens, and `sk-` / `sk_live_` style API keys.
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,255}/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,255}|\bsk-[\w-]{20,255}/g,
]
// A secret named by its key: the value after the name is replaced, the name
// stays. The first is upper case only, so ordinary words (`inputTokens: 12`)
// keep their values; the AWS file's lower-case names have their own pattern.
const NAMED_SECRETS: readonly RegExp[] = [
  /(\b[A-Z][A-Z0-9_]{0,60}(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIALS?)[A-Z0-9_]{0,60}\s{0,5}[=:]\s{0,5}["']?)[^\s"'&,;}]{1,4096}/g,
  /(\baws_(?:secret_access_key|session_token)\s{0,5}[=:]\s{0,5}["']?)[^\s"'&,;}]{1,4096}/gi,
  /(\b(?:Account|SharedAccess)Key\s{0,5}=\s{0,5})[^\s"';]{1,4096}/gi,
  // Not after a dot or a word character, so code's `self._auth = …` stays.
  /(?<![\w.])(_auth(?:Token)?\s{0,5}=\s{0,5}["']?)[^\s"'&,;}]{1,4096}/gi,
  /(\b(?:x-)?api-key\s{0,5}[:=]\s{0,5}["']?)[^\s"'&,;}]{1,4096}/gi,
  /(\bAuthorization\s{0,5}:\s{0,5}token\s{1,5})[^\s"'&,;}]{1,4096}/gi,
  /(["'][\w-]{0,40}(?:token|secret|passw(?:or)?d|api[_-]?key|private[_-]?key)["']\s{0,5}:\s{0,5}["'])[^"'\r\n]{1,4096}/gi,
  /([?&](?:token|key|secret|sig|signature|auth)=)[^&#\s"']{1,4096}/gi,
]

/** The mark alone, in place of the whole match. */
function mark(): string {
  return REDACTED_MARK
}

/** The mark after the match's first group (the field name or scheme it follows). */
function markAfter(_match: string, lead: string): string {
  return `${lead}${REDACTED_MARK}`
}

export function redactSecrets(text: string): string {
  let result = text
    .replaceAll(META_MODEL_API_KEY, () => mark())
    .replaceAll(BEARER_TOKEN, (match: string, lead: string) => markAfter(match, lead))
    .replaceAll(BASIC_CREDENTIALS, (match: string, lead: string) => markAfter(match, lead))
    .replaceAll(JSON_WEB_TOKEN, () => mark())
    .replaceAll(KEY_ENV_ASSIGNMENT, (match: string, lead: string) => markAfter(match, lead))
    .replaceAll(
      QUOTED_SECRET_FIELD,
      (_match: string, lead: string, quote: string) => `${lead}${quote}${REDACTED_MARK}${quote}`,
    )
    .replaceAll(SECRET_FIELD, (match: string, lead: string) => markAfter(match, lead))
    .replaceAll(URL_USER_INFO, (_match: string, lead: string) => `${lead}${REDACTED_MARK}@`)
  for (const shape of TOKEN_SHAPES) {
    result = result.replaceAll(shape, () => mark())
  }
  for (const named of NAMED_SECRETS) {
    result = result.replaceAll(named, (match: string, lead: string) => markAfter(match, lead))
  }
  return result
}
