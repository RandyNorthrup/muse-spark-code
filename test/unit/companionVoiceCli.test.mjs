import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, describe, expect, it } from 'vitest'
import { sharedUiText } from './helpers/modelApiBundle.ts'

// Compile once before timed assertions. The only substitutions are the held
// release switch, browser factory and journal writer; the real CLI runs.
const root = await mkdtemp(path.resolve('temp', 'voice-cli-'))
const dist = path.join(root, 'dist')
await mkdir(dist)
await writeFile(path.join(root, 'package.json'), '{"version":"0.0.0-test"}')
const options = { bundle: true, minify: true, platform: 'node', format: 'cjs', logLevel: 'silent' }
const release = {
  name: 'test-held-voice-cli',
  setup(plugin) {
    plugin.onLoad({ filter: /[\\/]shared[\\/]constants\.ts$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8')
      return {
        loader: 'ts',
        contents: source.replace(
          'COMPANION_VOICE_RELEASE = { isReady: false }',
          'COMPANION_VOICE_RELEASE = { isReady: true }',
        ),
      }
    })
  },
}
await build({
  ...options,
  entryPoints: ['src/shared/l10n/en.ts'],
  outfile: path.join(dist, 'uiText.js'),
})
await build({
  ...options,
  entryPoints: ['src/runtime/main.ts'],
  outfile: path.join(dist, 'acp.js'),
  plugins: [release, sharedUiText],
  external: ['@napi-rs/keyring'],
})
await build({
  ...options,
  stdin: {
    sourcefile: 'voice-cli-fixture.ts',
    resolveDir: process.cwd(),
    contents: `import { PaidUsage } from './src/core/paid/paidFeatures';
      import { writeFileSync } from 'node:fs';
      import path from 'node:path';
      export async function openVoiceCompanion(deps, context) {
        let end;
        const closed = new Promise(resolve => { end = resolve; });
        const panel = { closed, launchUrl: () => 'http://127.0.0.1:31415/#fake-launch',
          close: async () => { writeFileSync(path.join(__dirname, 'closed.json'), 'true'); end(); } };
        setImmediate(async () => {
          if (process.env.CMIC_VOICE_CASE === 'close') { end(); return; }
          const stop = new AbortController();
          if (process.env.CMIC_VOICE_CASE === 'abort') stop.abort();
          try {
            await context.send('Reviewed CLI transcript.', stop.signal);
            new PaidUsage(deps.log, deps.recording).addVoiceBatch(1);
          } catch { end(); }
        });
        return panel;
      }`,
  },
  outfile: path.join(dist, 'voiceCompanion.js'),
  plugins: [sharedUiText],
})
await writeFile(
  path.join(dist, 'usageService.js'),
  `
  const fs = require('node:fs'); const path = require('node:path');
  exports.createUsageWriter = async () => {
    const rows = [];
    return { noteUsage(_usage, context) { rows.push(context); }, append() {},
      read: async () => ({records: []}), flush: async () => {
        fs.writeFileSync(path.join(__dirname, 'usage.json'), JSON.stringify(rows));
      } };
  };`,
)
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('held companion CLI with fake browser and billing', () => {
  it.each(['send', 'abort', 'close'])('%s keeps stdout and final tally honest', async (action) => {
    await rm(path.join(dist, 'usage.json'), { force: true })
    await rm(path.join(dist, 'closed.json'), { force: true })
    const result = spawnSync(
      process.execPath,
      [path.join(dist, 'acp.js'), 'dictate', '--muse-voice'],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 4000,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          HOME: root,
          USERPROFILE: root,
          XDG_DATA_HOME: root,
          XDG_CONFIG_HOME: root,
          LOCALAPPDATA: root,
          APPDATA: root,
          TMPDIR: root,
          LANG: 'en_US.UTF-8',
          CMIC_VOICE_CASE: action,
        },
      },
    )
    expect(result.error).toBeUndefined()
    expect(result.stderr).toContain('http://127.0.0.1:31415/#fake-launch')
    expect(JSON.parse(await readFile(path.join(dist, 'closed.json'), 'utf8'))).toBe(true)
    expect(result.status).toBe(action === 'send' ? 0 : 1)
    expect(result.stdout).toBe(action === 'send' ? 'Reviewed CLI transcript.\n' : '')
    if (action !== 'send') return
    const rows = JSON.parse(await readFile(path.join(dist, 'usage.json'), 'utf8'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      client: 'CLI',
      kind: 'voice',
      model: 'muse-voice-transcribe-1.0',
      units: { audioSeconds: 1 },
    })
  })
})
