// Secret redaction for anything that reaches a log. Pure; no `vscode` import.
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
// Three or more words joined by dots, matched whole. The lookbehind lets a
// match start only where a word starts, so a long word is not read again
// from each of its characters; the tokens are then found inside the match
// (`redactTokens`), so one glued after a dash or a letter is still found.
// Matched from each `eyJ` instead (`\beyJ[\w-]+\.eyJ[\w-]+\.[\w-]+`), the
// rest of the word was read again from every `eyJ` in it: quadratic,
// seconds for a 64,000-character line of `eyJa-eyJa-…`.
const DOTTED_WORDS = /(?<![\w-])[\w-]+(?:\.[\w-]+){2,}/g
// A token's first two parts are base64url JSON, which starts `{"`.
const TOKEN_HEAD = 'eyJ'
const KEY_ENV_ASSIGNMENT = /((?:META|MODEL)_API_KEY\s*=\s*)\S+/g
const QUOTED_SECRET_FIELD =
  /((?:access_token|refresh_token|id_token|client_secret|api_?key|password)["']?\s*[:=]\s*)(["'])(?:\\.|[^\r\n\\])*?\2/gi
const SECRET_FIELD =
  /((?:access_token|refresh_token|id_token|client_secret|api_?key|password)["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi
// The scheme is at most 32 characters: unbounded, a long line of dotted or
// dashed words with no `://` made the scan quadratic (3.5 s for 40,000
// characters), and every log line passes through here.
const URL_USER_INFO = /(\b[a-z][\w+.-]{0,31}:\/\/)[^\s/@:]+:[^\s/@]+@/gi

function isTokenPayload(part: string | undefined): boolean {
  return part !== undefined && part.startsWith(TOKEN_HEAD) && part.length > TOKEN_HEAD.length
}

/**
 * `words` (three or more dotted words) with every token in it redacted: a
 * word holding `eyJ` and more, then a word starting `eyJ` and more, then any
 * word. A token is redacted from its first `eyJ` through its third word;
 * tokens that share a word are one redaction.
 */
function redactTokens(words: string): string {
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
      kept.push(isTokenStart ? `${part.slice(0, head)}[redacted]` : part)
    }
    if (isTokenStart) {
      redactedThrough = index + 2
    }
  }
  return kept.join('.')
}

/** `text` with every token redacted; text without `eyJ` is not split up. */
function redactJsonWebTokens(text: string): string {
  return text.includes(TOKEN_HEAD)
    ? text.replaceAll(DOTTED_WORDS, (words) => redactTokens(words))
    : text
}

export function redactSecrets(text: string): string {
  const withoutKeys = text
    .replaceAll(PRIVATE_KEY_BLOCK, '[redacted]')
    .replaceAll(GITHUB_TOKEN, '[redacted]')
    .replaceAll(AWS_ACCESS_KEY_ID, '[redacted]')
    .replaceAll(SLACK_TOKEN, '[redacted]')
    .replaceAll(META_MODEL_API_KEY, '[redacted]')
    .replaceAll(BEARER_TOKEN, '$1[redacted]')
    .replaceAll(BASIC_CREDENTIALS, '$1[redacted]')
  return redactJsonWebTokens(withoutKeys)
    .replaceAll(KEY_ENV_ASSIGNMENT, '$1[redacted]')
    .replaceAll(QUOTED_SECRET_FIELD, '$1$2[redacted]$2')
    .replaceAll(SECRET_FIELD, '$1[redacted]')
    .replaceAll(URL_USER_INFO, '$1[redacted]@')
}
