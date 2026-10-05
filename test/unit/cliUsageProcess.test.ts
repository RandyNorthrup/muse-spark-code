import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
    `const native = require('node:child_process');
    exports.runProgram = async (_file, args) => {
      if (process.env.M102_FAKE_OPEN_RESULT === 'success') return '';
      throw new Error(args.at(-1));
    };
    exports.spawn = (_file, args, options) => {
      if (process.env.M102_FAKE_OPEN_RESULT === 'success')
        return native.spawn(process.execPath, ['-e', ''], options);
      return native.spawn(args.at(-1), [], options);
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
      pluginBuild.onResolve({ filter: /^node:child_process$/ }, (args) =>
        args.importer === path.resolve('src/runtime/main.ts')
          ? { path: './testOpener.cjs', external: true }
          : undefined,
      )
    },
  }
  // The Linux regression uses real child processes and the product runProgram.
  // Replace only the OS executable with this harmless foreground Node handler.
  writeFileSync(
    path.join(root, 'dist', 'foregroundHandler.cjs'),
    `const fs = require('node:fs'); const path = require('node:path');
    fs.writeFileSync(path.join(__dirname, 'handler.pid'), String(process.pid));
    if (process.env.M102_FAKE_OPEN_RESULT === 'exit') setTimeout(() => {
      fs.writeFileSync(path.join(__dirname, 'handler-exited.txt'), 'exited');
      process.exit(7);
    }, 50);
    else setInterval(() => {}, 1000);`,
  )
  writeFileSync(
    path.join(root, 'dist', 'testLinuxOpener.cjs'),
    `const native = require('node:child_process');
    const fs = require('node:fs'); const path = require('node:path');
    const handler = path.join(__dirname, 'foregroundHandler.cjs');
    exports.execFile = (_file, _args, options, callback) =>
      native.execFile(process.execPath, [handler], options, callback);
    exports.spawn = (file, args, options) => {
      fs.writeFileSync(path.join(__dirname, 'open-call.json'), JSON.stringify({
        file, args, detached: options.detached, stdio: options.stdio,
        hasCredentials: Object.keys(options.env).some(name => name.toUpperCase().endsWith('_API_KEY'))
      }));
      return native.spawn(process.execPath, [handler], options);
    };`,
  )
  const linuxOpener: Plugin = {
    name: 'test-linux-foreground-handler',
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^node:child_process$/ }, (args) =>
        [path.resolve('src/runtime/main.ts'), path.resolve('src/host/processTree.ts')].includes(
          args.importer,
        )
          ? { path: './testLinuxOpener.cjs', external: true }
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
  await build({
    ...options,
    entryPoints: ['src/runtime/main.ts'],
    outfile: path.join(root, 'dist', 'acp-linux.js'),
    plugins: [sharedUiText, linuxOpener],
    define: { 'process.platform': '"linux"' },
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

function run(args: string[], input?: string, openerResult = 'failure', isLinux = false) {
  return spawnSync(
    process.execPath,
    [path.join(fixture.root, 'dist', isLinux ? 'acp-linux.js' : 'acp.js'), 'usage', ...args],
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

  it('detaches a foreground Linux handler and lets the companion end at its own idle timeout or explicit stop', () => {
    const url = `http://127.0.0.1:1234/#${'a'.repeat(64)}`
    const companion = path.join(fixture.root, 'dist', 'usageCompanion.js')
    const closed = path.join(fixture.root, 'dist', 'linux-closed.txt')
    const ownStop = path.join(fixture.root, 'dist', 'companion-own-stop.txt')
    const pidFile = path.join(fixture.root, 'dist', 'handler.pid')
    const exited = path.join(fixture.root, 'dist', 'handler-exited.txt')
    for (const end of ['idle', 'explicit']) {
      writeFileSync(
        companion,
        `const fs = require('node:fs'); const path = require('node:path');
        exports.openUsageCompanion = async () => {
          let finish;
          const closed = new Promise(resolve => { finish = resolve; });
          const stop = reason => {
            clearTimeout(timer);
            fs.writeFileSync(path.join(__dirname, 'linux-closed.txt'), reason);
            finish();
          };
          const page = { url: '${url}', closed, close: async () => stop('explicit') };
          const timer = setTimeout(() => {
            fs.writeFileSync(path.join(__dirname, 'companion-own-stop.txt'), '${end}');
            ${end === 'idle' ? "stop('idle')" : 'page.close()'};
          }, 500);
          return page;
        };`,
      )
      try {
        const opened = run(['open'], undefined, end === 'idle' ? 'success' : 'exit', true)
        expect(opened.status, opened.stderr).toBe(0)
        expect(opened.stdout).toBe(`${url}\n`)
        expect(opened.stderr).toBe('')
        expect(
          JSON.parse(readFileSync(path.join(fixture.root, 'dist', 'open-call.json'), 'utf8')),
        ).toEqual({
          file: 'xdg-open',
          args: [url],
          detached: true,
          stdio: 'ignore',
          hasCredentials: false,
        })
        expect(readFileSync(closed, 'utf8')).toBe(end)
        expect(readFileSync(ownStop, 'utf8')).toBe(end)
        // Neither a foreground handler nor its earlier exit owns the companion.
        if (end === 'idle')
          expect(() => process.kill(Number(readFileSync(pidFile, 'utf8')), 0)).not.toThrow()
        else expect(existsSync(exited)).toBe(true)
      } finally {
        if (existsSync(pidFile)) {
          if (!existsSync(exited)) process.kill(Number(readFileSync(pidFile, 'utf8')))
          rmSync(pidFile)
        }
        if (existsSync(closed)) rmSync(closed)
        if (existsSync(ownStop)) rmSync(ownStop)
        if (existsSync(exited)) rmSync(exited)
        rmSync(companion)
      }
    }
  })
})
