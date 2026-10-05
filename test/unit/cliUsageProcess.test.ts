import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { build, type Plugin } from 'esbuild'
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
  // Substitute only main.ts's OS opener so this process test cannot launch a
  // browser on any rig. It exercises the actual helper's refusal/redaction.
  writeFileSync(
    path.join(root, 'dist', 'testOpener.cjs'),
    `exports.runProgram = async (_file, args) => {
      if (process.env.M102_FAKE_OPEN_RESULT === 'success') return '';
      throw new Error(args.at(-1));
    };`,
  )
  const opener: Plugin = {
    name: 'test-usage-os-opener',
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /\/processTree$/ }, (args) =>
        args.importer === path.resolve('src/runtime/main.ts')
          ? { path: './testOpener.cjs', external: true }
          : undefined,
      )
    },
  }
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
    plugins: [sharedUiText, opener],
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

function run(args: string[], input?: string, openerResult = 'failure') {
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
        M102_FAKE_OPEN_RESULT: openerResult,
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

  it('closes a companion after an opener failure, hides its token, and leaves a successful page alive', () => {
    const url = `http://127.0.0.1:1234/#${'a'.repeat(64)}`
    const closed = path.join(fixture.root, 'dist', 'closed.txt')
    const companion = path.join(fixture.root, 'dist', 'usageCompanion.js')
    writeFileSync(
      companion,
      `const fs = require('node:fs'); const path = require('node:path');
      exports.openUsageCompanion = async () => ({
        url: '${url}', closed: new Promise(() => {}),
        close: async () => fs.writeFileSync(path.join(__dirname, 'closed.txt'), 'closed')
      });`,
    )
    try {
      const failed = run(['open'])
      expect(failed.status, failed.stderr).toBe(1)
      expect(failed.stdout).toBe('')
      expect(failed.stderr).not.toContain(url)
      expect(existsSync(closed)).toBe(true)
      rmSync(closed)
      const opened = run(['open'], undefined, 'success')
      expect(opened.status, opened.stderr).toBe(0)
      expect(opened.stdout).toBe(`${url}\n`)
      expect(existsSync(closed)).toBe(false)
    } finally {
      rmSync(companion)
    }
  })
})
