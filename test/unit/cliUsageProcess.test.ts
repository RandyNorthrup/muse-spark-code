import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sharedUiText } from './helpers/modelApiBundle'
import { removeFolder } from './helpers/temporaryFolders'
import { usageState } from './helpers/usageAdapters'

const fixture = { root: '' }
beforeAll(async () => {
  mkdirSync('temp', { recursive: true })
  const root = mkdtempSync(path.resolve('temp', 'usage-cli-'))
  fixture.root = root
  mkdirSync(path.join(root, 'dist'), { recursive: true })
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.0.0-test' }))
  const options = {
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'silent',
  } as const
  await build({
    ...options,
    entryPoints: ['src/shared/l10n/en.ts'],
    outfile: path.join(root, 'dist', 'uiText.js'),
  })
  await build({
    ...options,
    entryPoints: ['src/runtime/main.ts'],
    outfile: path.join(root, 'dist', 'acp.js'),
    plugins: [sharedUiText],
    external: ['@napi-rs/keyring'],
  })
  // All fake implementations stay in this test-only bundle. The CLI dispatcher
  // and its stdio/export implementation are the actual product sources.
  await build({
    ...options,
    stdin: {
      resolveDir: process.cwd(),
      contents: String.raw`
      export { runUsageCommand } from './src/runtime/usage/usageCli';
      const state = ${JSON.stringify(usageState())};
      export function createUsageAccess() {
        if (Object.keys(process.env).some(name => name.toUpperCase().endsWith('_API_KEY')))
          throw new Error('credential variables were not removed');
        return {
          read: async () => state,
          usageText: () => 'Unpriced: unknown; reported: $0.42',
          export: async (_query, format) => format === 'json' ? JSON.stringify(state) : 'cost,certainty\n0.42,reported',
          connect: ports => ({ receive: async message => {
            if (message.type === 'usage/ready') ports.post({ type: 'usage/state', state });
          }, dispose() {} })
        };
      }
    `,
    },
    outfile: path.join(root, 'dist', 'usageService.js'),
    plugins: [sharedUiText],
  })
})
afterAll(() => removeFolder(fixture.root))

function run(args: string[], input?: string) {
  return spawnSync(
    process.execPath,
    [path.join(fixture.root, 'dist', 'acp.js'), 'usage', ...args],
    {
      input,
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        LANG: 'en_US.UTF-8',
        LANGUAGE: 'en',
        LC_ALL: 'en_US.UTF-8',
        M102_FAKE_API_KEY: 'test-only-value',
        XDG_DATA_HOME: path.join(fixture.root, 'data'),
      },
    },
  )
}

describe('built CLI usage routes', () => {
  it('prints text/JSON/CSV without loading credentials or starting a model backend', () => {
    const plain = run([])
    expect(plain.status, plain.stderr).toBe(0)
    expect(plain.stdout).toBe('Unpriced: unknown; reported: $0.42\n')
    const json = run(['--json'])
    expect(json.status, json.stderr).toBe(0)
    expect(JSON.parse(json.stdout)).toEqual(usageState())
    const csv = run(['--csv'])
    expect(csv.status, csv.stderr).toBe(0)
    expect(csv.stdout).toBe('cost,certainty\n0.42,reported\n')
  })

  it('answers validated native stdio frames and exits cleanly at EOF', () => {
    const result = run(['serve', '--stdio'], '{invalid\n{"type":"usage/ready"}\n')
    expect(result.status, result.stderr).toBe(0)
    const messages: unknown[] = result.stdout
      .trim()
      .split('\n')
      .map((line) => {
        const message: unknown = JSON.parse(line)
        return message
      })
    expect(messages).toEqual([
      { type: 'usage/error', code: 'invalidMessage' },
      { type: 'usage/state', state: usageState() },
    ])
  })

  it('refuses malformed commands with exit 2 and an explicit missing companion with exit 1', () => {
    expect(run(['--json', '--csv']).status).toBe(2)
    const absent = run(['open'])
    expect(absent.status).toBe(1)
    expect(absent.stdout).toBe('')
  })
})
