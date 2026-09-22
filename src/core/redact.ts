// Secret redaction for anything that reaches a log. Pure; no `vscode` import.
//
// Patterns cover the credential shapes this extension can encounter:
//   - Meta Model API keys: `LLM|<numeric id>|<secret>`
//   - HTTP bearer tokens: `Bearer <token>`
//   - Environment assignments of the known key variables: `META_API_KEY=...`,
//     `MODEL_API_KEY=...`
//
// Replacement strings are literals on purpose: unicorn/no-unsafe-string-
// replacement rejects computed replacements because `$` sequences in them are
// interpreted by replaceAll.

const META_MODEL_API_KEY = /LLM\|\d+\|[\w+./=-]+/g
const BEARER_TOKEN = /(\bBearer\s+)[\w+./=~-]+/gi
const KEY_ENV_ASSIGNMENT = /((?:META|MODEL)_API_KEY\s*=\s*)\S+/g

export function redactSecrets(text: string): string {
  return text
    .replaceAll(META_MODEL_API_KEY, '[redacted]')
    .replaceAll(BEARER_TOKEN, '$1[redacted]')
    .replaceAll(KEY_ENV_ASSIGNMENT, '$1[redacted]')
}
