// The import's credential check (M83): an entry whose text holds a
// credential cue, in any spelling a shell, a JSON reader or a URL decoder
// would read, is refused whole; ordinary rules text mostly passes, within a
// stated budget; and every scan is linear on adversarial input.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  credentialCue,
  type CredentialCue,
  maskValues,
} from '../../src/core/import/importCredentials'
import { CREDENTIAL_LEAKS, leakSecret, ORDINARY_LINES } from './helpers/credentialLeaks'
import { SYNTHETIC } from './helpers/syntheticTokens'

const MASK = '[masked]'
// A linear scan of 64,000 characters takes milliseconds; the quadratic ones took seconds.
const SCAN_MS_PER_64K = 1000
const SIXTY_FOUR_K = 64_000
// The rules files the import reads are at most 64 KiB; `.claude.json` holds
// MCP arguments up to its 16 MiB, so an argument eight times that is checked too.
const LENGTHS = [SIXTY_FOUR_K, 2 * SIXTY_FOUR_K, 8 * SIXTY_FOUR_K] as const
// The share of ordinary rules documents the check may refuse. On 2026-10-01
// it refused 25 of 200 open-source rule files (12.5%), a third of them for
// a key, a password or a placeholder for one; this repository's own corpus
// below measured 4 of 52.
const FALSE_POSITIVE_BUDGET = 0.15
const BACKSLASH = String.fromCodePoint(0x5c)

const LEAKS = CREDENTIAL_LEAKS.map(
  (leak, index) => [leak.name, leak.text(leakSecret(index))] as const,
)

describe('credentialCue', () => {
  it.each(LEAKS)(
    'refuses %s as text, as separate arguments and inside a shell argument',
    (_name, text) => {
      expect(credentialCue([text])).toBeDefined()
      expect(credentialCue(text.split(' '))).toBeDefined()
      expect(credentialCue(['sh', '-c', text])).toBeDefined()
    },
  )

  it.each<{ readonly name: string; readonly text: string; readonly cue: CredentialCue }>([
    { name: 'an assignment', text: 'GITHUB_TOKEN=abc node x.js', cue: 'name' },
    { name: 'a flag and its value', text: './server --api-key abc', cue: 'name' },
    { name: 'a value on a later line', text: 'password:\n\n  hunter2', cue: 'name' },
    {
      name: 'a bearer value',
      text: `curl -H "X: Bearer ${SYNTHETIC.bearerValue}"`,
      cue: 'name',
    },
    {
      name: 'an encoded Basic value',
      text: 'curl -H "X-Proxy: Basic ZGVtbzpkZW1vZGVtbw=="',
      cue: 'name',
    },
    { name: 'user-info', text: 'git clone https://me:pw@example.test/repo', cue: 'url' },
    { name: 'user-info without a scheme', text: 'see //me:pw@example.test/repo', cue: 'url' },
    {
      name: 'a credential-named query parameter',
      text: 'https://example.test/x?key=abc',
      cue: 'url',
    },
    { name: 'a GitHub token', text: `gh auth ${SYNTHETIC.githubToken}`, cue: 'token' },
    { name: 'an OpenAI-style key', text: `run ${SYNTHETIC.openAiKey}`, cue: 'token' },
    { name: 'a Slack token', text: `post ${SYNTHETIC.slackToken}`, cue: 'token' },
    { name: 'an AWS access key', text: `aws ${SYNTHETIC.awsAccessKey}`, cue: 'token' },
    { name: 'a JSON Web Token start', text: 'jwt eyJdemo.eyJdemo.sig done', cue: 'token' },
    {
      name: 'a private key',
      text: ['-----BEGIN RSA', 'PRIVATE KEY-----'].join(' '),
      cue: 'token',
    },
    {
      name: 'a long mixed-case run with digits',
      text: `npx server ${'aB3'.repeat(14)}`,
      cue: 'opaque',
    },
    { name: 'a long hex run', text: `npx server ${'0a'.repeat(20)}`, cue: 'opaque' },
    // Steps no other spelling covers: a run a shell joins from quoted halves,
    // and a token split by an invisible character.
    {
      name: 'a long run joined from quoted halves',
      text: `npx server '${'aB3'.repeat(6)}''${'aB3'.repeat(6)}'`,
      cue: 'opaque',
    },
    {
      name: 'a zero-width space inside a token',
      text: SYNTHETIC.githubToken.split('_').join(`_${String.fromCodePoint(0x20_0b)}`),
      cue: 'token',
    },
  ])('names $name as a $cue cue', ({ text, cue }) => {
    expect(credentialCue([text])).toBe(cue)
  })

  it('reads every text of an entry as one: a flag in one argument, its value in the next', () => {
    expect(credentialCue(['server', '--token', 'abc'])).toBe('name')
    expect(credentialCue(['server', '--token'])).toBeUndefined()
    expect(credentialCue(['server', '--token', '--port', '9'])).toBeUndefined()
  })

  it('lets ordinary prose, code and URLs through', () => {
    for (const line of ORDINARY_LINES) {
      expect(credentialCue([line]), line).toBeUndefined()
    }
    expect(credentialCue(ORDINARY_LINES)).toBeUndefined()
  })

  it.each([
    ['a credential word with no value', 'Rotate the token when it leaks.'],
    ['a name and a separator with nothing after it', 'TOKEN=\n'],
    ['a comparison', 'if (password == other) return'],
    ['a long identifier', 'AGENT_IMPORT_CLAUDE_STATE_MAX_BYTES_AND_THEN_SOME_MORE'],
    ['a UUID', '123e4567-e89b-12d3-a456-426614174000'],
    ['a long path', 'src/host/checkpoints/checkpointStoreEntry2/Index/AnotherFolder3/x.ts'],
    ['a Windows path', `C:${BACKSLASH}Program Files${BACKSLASH}WindowsPowerShell32${BACKSLASH}x`],
  ])('lets %s through', (_name, text) => {
    expect(credentialCue([text])).toBeUndefined()
  })
})

// Typical rules text in the styles open-source projects use, written for
// this test (no project's file is copied), beside this repository's own.
const ORDINARY_RULES: readonly string[] = [
  'You are an expert in TypeScript, React and Next.js.\n\n- Use functional components and hooks.\n- Prefer interfaces over types for object shapes.\n- Name files in kebab-case and components in PascalCase.\n- Validate input with zod at every boundary.\n',
  '## Python style\n\n- Target Python 3.12. Format with ruff; type-check with mypy --strict.\n- Prefer dataclasses for plain records.\n- Never catch a bare `Exception`; log it and re-raise.\n- Tests live in `tests/` and run with `pytest -q`.\n',
  '## Security\n\nNever commit credentials. Read keys from the environment at run time and keep them out of logs. Rotate a key that leaks, and tell the team.\n',
  '## Commits\n\n- Use Conventional Commits (`feat:`, `fix:`, `docs:`).\n- One logical change per commit; rebase before you open a pull request.\n- Run `npm test` and `npm run lint` before you push.\n',
  '- Take `context.Context` as the first parameter.\n- Return errors; wrap them with `fmt.Errorf("read config: %w", err)`.\n- Run `go vet ./...` and `golangci-lint run` before committing.\n',
  '---\ndescription: API route conventions\nglobs: src/app/api/**/*.ts\n---\n\n- Validate the request body with zod.\n- Return `NextResponse.json` with an explicit status.\n- Authentication runs in middleware; routes assume a signed-in user.\n',
  '- Prefer `?` over `unwrap()` outside tests.\n- Derive `Debug` on public types.\n- Keep `unsafe` blocks small and documented.\n- Run `cargo clippy -- -D warnings`.\n',
  '## Local setup\n\n1. Copy `.env.example` to `.env` and fill in the values you were given.\n2. Start the services with `docker compose up -d`.\n3. Open http://localhost:3000.\n',
  '- Write a failing test first.\n- Mock the network, never the module under test.\n- Use snapshot tests only for stable output.\n',
  '## Prompts\n\nKeep prompts in `prompts/`. Count the tokens before a long call, and trim the history when it grows past the window.\n',
  '- Every interactive element is reachable by keyboard.\n- Give images `alt` text; decorative ones get `alt=""`.\n',
  '- The client reads its base URL from `API_BASE_URL`.\n- Retry idempotent requests up to three times with backoff.\n- Session handling lives in `src/session.ts`.\n',
]

function readRepositoryFile(file: string): string {
  return readFileSync(path.join(process.cwd(), file), 'utf8')
}

/** This repository's rules-like documents whole, and its README section by section. */
function repositoryRules(): readonly string[] {
  const whole = [
    'AGENTS.md',
    'CLAUDE.md',
    'CONTRIBUTING.md',
    'CODE_OF_CONDUCT.md',
    '.github/copilot-instructions.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    'docs/acp.md',
    'resources/walkthrough/chat.md',
    'resources/walkthrough/open.md',
    'resources/walkthrough/sign-in.md',
    'resources/walkthrough/welcome.md',
    'test/fixtures/workspace/README.md',
  ].map((file) => readRepositoryFile(file))
  return [...whole, ...readRepositoryFile('README.md').split(/\n(?=## )/u)]
}

describe('credentialCue on ordinary rules', () => {
  it('refuses no more ordinary rules documents than the stated budget', () => {
    const corpus = [...repositoryRules(), ...ORDINARY_RULES]
    const refused = corpus.filter((text) => credentialCue([text]) !== undefined)
    const titles = refused.map((text) => text.split('\n', 1)[0])
    expect(refused.length / corpus.length, titles.join('\n')).toBeLessThanOrEqual(
      FALSE_POSITIVE_BUDGET,
    )
    expect(ORDINARY_RULES.filter((text) => credentialCue([text]) !== undefined)).toEqual([])
  })
})

// Inputs that would make a scan restart on every character of a long run.
const ADVERSARIAL: readonly (readonly [string, (length: number) => string])[] = [
  ['backslash escapes with no digits', (n) => `${BACKSLASH}u`.repeat(n / 2)],
  ['percent marks with one digit', (n) => '%4'.repeat(n / 2)],
  ['entity starts', (n) => '&#x'.repeat(n / 3)],
  ['continuations', (n) => `${BACKSLASH}\n`.repeat(n / 2)],
  ['one name of many credential words', (n) => 'token'.repeat(n / 5)],
  ['credential words with no value', (n) => 'token '.repeat(n / 6)],
  ['flags with no value', (n) => '--token'.repeat(n / 7)],
  ['quote marks after a credential word', (n) => `token${'"'.repeat(n)}`],
  ['spaces after a credential word', (n) => `token${' '.repeat(n)}`],
  ['query marks before credential words', (n) => '?token '.repeat(n / 7)],
  ['URL marks with no user-info', (n) => '//a'.repeat(n / 3)],
  ['JSON Web Token near-misses', (n) => 'eyJa-'.repeat(n / 5)],
  ['a URL path of dots', (n) => `https://example.test/${'.'.repeat(n)}x`],
  ['a key header with no end', (n) => `-----BEGIN ${'A'.repeat(n)}`],
  ['Basic with short words', (n) => 'basic '.repeat(n / 6)],
  ['user flags with no password', (n) => '-u '.repeat(n / 3)],
  ['colons with short names', (n) => 'a: '.repeat(n / 3)],
  ['key words with no assignment', (n) => 'key '.repeat(n / 4)],
  ['long runs without digits', (n) => 'aB'.repeat(n / 2)],
]

describe('credentialCue on long input', () => {
  for (const length of LENGTHS) {
    it.each(ADVERSARIAL)(
      `reads %s in linear time (${String(length)} characters)`,
      (_name, make) => {
        const text = make(length)
        const started = performance.now()
        credentialCue([text])
        // The time is the assertion: a quadratic scan fails here, whatever it returned.
        expect(performance.now() - started).toBeLessThan((SCAN_MS_PER_64K * length) / SIXTY_FOUR_K)
      },
    )
  }
})

describe('maskValues', () => {
  it('keeps the names and masks every value', () => {
    expect(maskValues({ NODE_ENV: 'production', LOG_LEVEL: 'debug' }, MASK)).toEqual({
      NODE_ENV: MASK,
      LOG_LEVEL: MASK,
    })
  })
})
