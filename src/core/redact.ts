// Secret redaction for anything that reaches a log. Pure; no `vscode` import.
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
//
// Every pattern scans in linear time: the session export (M84) runs them over
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

/** The mark alone, in place of the whole match. */
function mark(): string {
  return REDACTED_MARK
}

/** The mark after the match's first group (the field name or scheme it follows). */
function markAfter(_match: string, lead: string): string {
  return `${lead}${REDACTED_MARK}`
}

export function redactSecrets(text: string): string {
  return text
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
}
