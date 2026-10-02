// Every credential leak the independent reviews of the import's masking
// reported (M83: RV83, RV83b, RV83c), as text around a synthetic secret, and
// ordinary lines that must come through unchanged. Shared by the masker's
// tests and the production import flow's. No value is a real credential.

export interface CredentialLeak {
  readonly name: string
  readonly text: (secret: string) => string
}

const QUERY_URL = 'https://example.test/mcp?signature='
const MARKS = ["'", '"', '`'] as const
// What a POSIX shell joins onto a closing quote as one word.
const SHELL_JOINS = ['-', '+', '/', '.', '%', '~'] as const
// One past the old 31-character name allowance and 32-character scheme cap.
const PAST_OLD_CAP = 33

export const CREDENTIAL_LEAKS: readonly CredentialLeak[] = [
  // RV83: an opaque query value in an MCP argument and a CLAUDE.md link.
  { name: 'a query value', text: (secret) => `${QUERY_URL}${secret}&tenant=demo` },
  {
    name: 'a query value in a Markdown link',
    text: (secret) => `Read [service](${QUERY_URL}${secret}&tenant=demo).`,
  },
  // RV83b: the value in quote marks or backticks.
  ...MARKS.map((mark) => ({
    name: `a query value in ${mark} marks`,
    text: (secret: string) => `${QUERY_URL}${mark}${secret}${mark}&tenant=demo`,
  })),
  // RV83c: whitespace inside the quoted value.
  ...MARKS.map((mark) => ({
    name: `whitespace inside a value in ${mark} marks`,
    text: (secret: string) => `Read [service](${QUERY_URL}${mark}prefix ${secret}${mark}).`,
  })),
  {
    name: 'whitespace inside a quoted assignment',
    text: (secret) => `MY_SECRET='prefix ${secret}' node x.js`,
  },
  // RV83c: shell word-joining after the closing quote.
  ...SHELL_JOINS.map((join) => ({
    name: `a shell join with ${join}`,
    text: (secret: string) => `curl '${QUERY_URL}'${join}${secret}''`,
  })),
  { name: 'a shell join of adjacent quotes', text: (secret) => `curl '${QUERY_URL}'"${secret}"` },
  // RV83c: names and schemes past the old length caps.
  {
    name: 'a long flag name before the credential word',
    text: (secret) => `deploy --${'x'.repeat(PAST_OLD_CAP)}token ${secret}`,
  },
  {
    name: 'a long flag name after the credential word',
    text: (secret) => `deploy --token${'x'.repeat(PAST_OLD_CAP)} ${secret}`,
  },
  {
    name: 'a long assignment name',
    text: (secret) => `TOKEN${'X'.repeat(PAST_OLD_CAP)}=${secret}`,
  },
  {
    name: 'an everyday long assignment name',
    text: (secret) => `TOKEN_FOR_ORGANIZATION_PRODUCTION_INTEGRATION=${secret}`,
  },
  {
    name: 'a scheme longer than 32 characters',
    text: (secret) => `${'x'.repeat(PAST_OLD_CAP)}://example.test/mcp?signature=${secret}`,
  },
  // RV83c: further probes that every earlier revision leaked.
  { name: 'a JSON object', text: (secret) => `{"token":"${secret}","secret":"${secret}"}` },
  { name: 'an assignment of joined empty quotes', text: (secret) => `TOKEN=''${secret}` },
  { name: 'a flag value after joined empty quotes', text: (secret) => `cmd --token ''${secret}` },
  // The rest of the lead's list: user-info, mixed case, percent-encoding.
  {
    name: 'URL user-info',
    text: (secret) => `git clone https://demo:${secret}@example.test/repo.git`,
  },
  {
    name: 'URL user-info under a long scheme',
    text: (secret) => `${'x'.repeat(PAST_OLD_CAP)}://demo:${secret}@example.test/`,
  },
  {
    name: 'a mixed-case URL',
    text: (secret) => `HtTpS://Example.Test/MCP?SiGnAtUrE=${secret}`,
  },
  { name: 'a mixed-case assignment', text: (secret) => `Api_KeY=${secret}` },
  { name: 'a mixed-case flag', text: (secret) => `./server --ToKeN ${secret}` },
  { name: 'a percent-encoded query value', text: (secret) => `${QUERY_URL}%27${secret}%27` },
  { name: 'a percent-encoded assignment', text: (secret) => `PASSWORD=%22${secret}%22` },
  // An `Authorization` header holding a bare key, and a bearer token in quote marks.
  {
    name: 'a bare key in an Authorization header',
    text: (secret) => `curl -H "Authorization: ${secret}" https://example.test`,
  },
  {
    name: 'a bearer token in quote marks',
    text: (secret) => `curl -H 'Authorization: Bearer "${secret}"'`,
  },
]

/** The synthetic secret of the leak at `index`: distinct, and none holds another. */
export function leakSecret(index: number): string {
  return `opaque-${String(index).padStart(2, '0')}-demo-value`
}

/** Prose, code and URLs without a query or user-info, which masking leaves as they are. */
export const ORDINARY_LINES: readonly string[] = [
  'Run the tests before you commit, and keep each change small.',
  'Prefer early returns; name things for what they hold.',
  'const total = items.reduce((sum, item) => sum + item.price, 0)',
  'npx prettier --write "$FILE"',
  'git commit --author Randy',
  'See https://example.test/docs/guide.html for the details.',
  'Read [the guide](https://example.test/docs/guide) first.',
  "curl 'https://example.test/docs' -H 'Accept: text/plain' -o out.json",
  'Have you read https://example.test/docs? It is short.',
  '{"url":"https://example.test/mcp","mode":"optional"}',
]
