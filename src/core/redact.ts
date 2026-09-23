// Secret redaction for anything that reaches a log. Pure; no `vscode` import.
//
// Patterns cover the credential shapes this extension can encounter:
//   - Meta Model API keys: `LLM|<numeric id>|<secret>`
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
// Replacement strings are literals on purpose: unicorn/no-unsafe-string-
// replacement rejects computed replacements because `$` sequences in them are
// interpreted by replaceAll.

const META_MODEL_API_KEY = /LLM\|\d+\|[\w+./=-]+/g
const BEARER_TOKEN = /(\bBearer\s+)[\w+./=~-]+/gi
const BASIC_CREDENTIALS = /(\bBasic\s+)[\w+/=]{8,}/gi
const JSON_WEB_TOKEN = /\beyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g
const KEY_ENV_ASSIGNMENT = /((?:META|MODEL)_API_KEY\s*=\s*)\S+/g
const SECRET_FIELD =
  /((?:access_token|refresh_token|id_token|client_secret|api_?key|password)["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi
const URL_USER_INFO = /(\b[a-z][\w+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi

export function redactSecrets(text: string): string {
  return text
    .replaceAll(META_MODEL_API_KEY, '[redacted]')
    .replaceAll(BEARER_TOKEN, '$1[redacted]')
    .replaceAll(BASIC_CREDENTIALS, '$1[redacted]')
    .replaceAll(JSON_WEB_TOKEN, '[redacted]')
    .replaceAll(KEY_ENV_ASSIGNMENT, '$1[redacted]')
    .replaceAll(SECRET_FIELD, '$1[redacted]')
    .replaceAll(URL_USER_INFO, '$1[redacted]@')
}
