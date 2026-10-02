// Every credential leak the independent reviews of the import reported (M83:
// RV83, RV83b, RV83c, RV83d and the Muse review mr83), as text around a
// synthetic secret, a few further spellings of the same classes, and
// ordinary lines that must come through. Each leak is now a refusal: the
// whole entry holding it is not imported. Shared by the credential check's
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
// Built when the test runs, so no editor or tool turns them into other characters.
const BACKSLASH = String.fromCodePoint(0x5c)
const NO_BREAK_SPACE = String.fromCodePoint(0xa0)
const E_ACUTE = String.fromCodePoint(0xe9)
const CYRILLIC_O = String.fromCodePoint(0x4_3e)
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x20_0b)
const FULLWIDTH_TOKEN = String.fromCodePoint(0xff_34, 0xff_2f, 0xff_2b, 0xff_25, 0xff_2e)

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
  // The lead's list in round 3: user-info, mixed case, percent-encoding.
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
  {
    name: 'a bare key in an Authorization header',
    text: (secret) => `curl -H "Authorization: ${secret}" https://example.test`,
  },
  {
    name: 'a bearer token in quote marks',
    text: (secret) => `curl -H 'Authorization: Bearer "${secret}"'`,
  },
  // RV83d #1: a value spanning lines, and shell line continuations.
  { name: 'a quoted value on the next line', text: (secret) => `TOKEN='prefix\n${secret}'` },
  {
    name: 'a quoted URL whose query value spans lines',
    text: (secret) => `curl '${QUERY_URL}prefix\n${secret}'`,
  },
  { name: 'a YAML block value', text: (secret) => `password: |\n  ${secret}` },
  {
    name: 'a query continued onto the next line',
    text: (secret) => `curl https://example.test/mcp${BACKSLASH}\n?signature=${secret}`,
  },
  {
    name: 'user-info continued onto the next line',
    text: (secret) => `curl https://demo:${BACKSLASH}\n${secret}@example.test/`,
  },
  // RV83d #2: shell joins inside the credential name or the URL mark.
  {
    name: 'a joined Authorization name',
    text: (secret) => `curl -H 'Authori''zation: ${secret}' https://example.test`,
  },
  { name: 'a joined flag name', text: (secret) => `server --to''ken ${secret}` },
  {
    name: 'a joined URL mark',
    text: (secret) => `curl 'https:'"//example.test/mcp?signature="${secret}`,
  },
  // RV83d #3: an escaped JSON name, and a name with a Unicode suffix.
  {
    name: 'an escaped JSON name',
    text: (secret) => `{"to${BACKSLASH}u006ben":"${secret}"}`,
  },
  { name: 'a name with a Unicode suffix', text: (secret) => `TOKEN${E_ACUTE}=${secret}` },
  // RV83d #4: whitespace after a query's mark, and a URL without a scheme.
  {
    name: 'whitespace after the query mark',
    text: (secret) => `{"url":"https://example.test/mcp? signature=${secret}"}`,
  },
  {
    name: 'a no-break space after the query mark',
    text: (secret) => `{"url":"https://example.test/mcp?${NO_BREAK_SPACE}signature=${secret}"}`,
  },
  {
    name: 'a link without a scheme',
    text: (secret) => `Read [service](//example.test/mcp?signature=${secret}).`,
  },
  // mr83 P2: a secret on the line after its name.
  { name: 'a value on the line after its name', text: (secret) => `password:\n  ${secret}` },
  // Further spellings of the same classes (this round's own probes).
  { name: 'a shell-escaped flag name', text: (secret) => `server --to${BACKSLASH}ken ${secret}` },
  { name: 'a percent-encoded name', text: (secret) => `%74oken=${secret}` },
  { name: 'an HTML-entity name', text: (secret) => `&#116;oken=${secret}` },
  { name: 'a Markdown-split name', text: (secret) => `**to**ken: ${secret}` },
  {
    name: 'a zero-width space inside a name',
    text: (secret) => `to${ZERO_WIDTH_SPACE}ken=${secret}`,
  },
  { name: 'a full-width name', text: (secret) => `${FULLWIDTH_TOKEN}=${secret}` },
  { name: 'a Cyrillic look-alike in a name', text: (secret) => `t${CYRILLIC_O}ken=${secret}` },
  ...['^', '`'].map((continuation) => ({
    name: `user-info continued with ${continuation} onto the next line`,
    text: (secret: string) => `curl https://demo:${continuation}\n${secret}@example.test/`,
  })),
  { name: "curl's user and password", text: (secret) => `curl -u demo:${secret} https://x.test` },
  { name: 'a folded YAML value', text: (secret) => `api_key: >\n  ${secret}` },
]

/** The synthetic secret of the leak at `index`: distinct, and none holds another. */
export function leakSecret(index: number): string {
  return `opaque-${String(index).padStart(2, '0')}-demo-value`
}

/** Prose, code and URLs without credentials, which the check lets through. */
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
  'Keyboard shortcuts for reviewing code.',
  'Count the tokens before you send a long prompt.',
  'Never commit secrets, passwords or API keys.',
  'Use OAuth for sign-in; unauthorized requests get a 401.',
  'The author field names who wrote the change.',
  'Basic usage comes first in each guide.',
  'if (token == undefined) return',
  'Call std::auth::verify before you read the session.',
  'useQuery({ queryKey: ["todos"], queryFn: fetchTodos })',
  'First pass: collect the files. Second pass: rewrite them.',
  `Run C:${BACKSLASH}Windows${BACKSLASH}System32${BACKSLASH}WindowsPowerShell${BACKSLASH}v1.0${BACKSLASH}powershell.exe`,
  'Sources live in src/components/UserProfile/Avatar2/index.tsx.',
]
