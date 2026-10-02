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
//   - Since M71, which signs in to GitHub and sends text there: GitHub's
//     token shapes (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` and
//     `github_pat_`, docs.github.com "About authentication to GitHub"),
//     PEM private key blocks, AWS access key ids and Slack tokens, the
//     shapes a generated commit message or pull request text could carry
//
// Replacement strings are literals on purpose: unicorn/no-unsafe-string-
// replacement rejects computed replacements because `$` sequences in them are
// interpreted by replaceAll.

const GITHUB_TOKEN = /\bgh[pousr]_[A-Za-z\d]{36,255}\b|\bgithub_pat_\w{22,255}\b/g
const PRIVATE_KEY_BLOCK =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g
const AWS_ACCESS_KEY_ID = /\b(?:AKIA|ASIA)[A-Z\d]{16}\b/g
const SLACK_TOKEN = /\bxox[abeoprs]-[A-Za-z\d-]{10,}/g
const META_MODEL_API_KEY = /LLM_[\w-]{16,}|LLM\|\d+\|[\w+./=-]+/g
const BEARER_TOKEN = /(\bBearer\s+)[\w+./=~-]+/gi
const BASIC_CREDENTIALS = /(\bBasic\s+)[\w+/=]{8,}/gi
const JSON_WEB_TOKEN = /\beyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g
const KEY_ENV_ASSIGNMENT = /((?:META|MODEL)_API_KEY\s*=\s*)\S+/g
const QUOTED_SECRET_FIELD =
  /((?:access_token|refresh_token|id_token|client_secret|api_?key|password)["']?\s*[:=]\s*)(["'])(?:\\.|[^\r\n\\])*?\2/gi
const SECRET_FIELD =
  /((?:access_token|refresh_token|id_token|client_secret|api_?key|password)["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi
// The scheme is at most 32 characters: unbounded, a long line of dotted or
// dashed words with no `://` made the scan quadratic (3.5 s for 40,000
// characters), and every log line passes through here.
const URL_USER_INFO = /(\b[a-z][\w+.-]{0,31}:\/\/)[^\s/@:]+:[^\s/@]+@/gi

export function redactSecrets(text: string): string {
  return text
    .replaceAll(PRIVATE_KEY_BLOCK, '[redacted]')
    .replaceAll(GITHUB_TOKEN, '[redacted]')
    .replaceAll(AWS_ACCESS_KEY_ID, '[redacted]')
    .replaceAll(SLACK_TOKEN, '[redacted]')
    .replaceAll(META_MODEL_API_KEY, '[redacted]')
    .replaceAll(BEARER_TOKEN, '$1[redacted]')
    .replaceAll(BASIC_CREDENTIALS, '$1[redacted]')
    .replaceAll(JSON_WEB_TOKEN, '[redacted]')
    .replaceAll(KEY_ENV_ASSIGNMENT, '$1[redacted]')
    .replaceAll(QUOTED_SECRET_FIELD, '$1$2[redacted]$2')
    .replaceAll(SECRET_FIELD, '$1[redacted]')
    .replaceAll(URL_USER_INFO, '$1[redacted]@')
}
