// M80 D: production packaging guards, then the built-process rows E1-E7 against
// the real built engine (all lanes integrated, so they always run; Windows
// skips only the POSIX signal rows). Fake fetch/keyring injection lives only in
// a test-owned Node preload, never in a production loader flag. No request can
// reach the network in this suite.
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveExecutable } from '../../src/core/executables'
import { execEventSchema, validateResult } from '../../src/runtime/exec/execProtocol'
import type { ExecResult } from '../../src/runtime/exec/execProtocol'
import { removeFolder } from '../unit/helpers/temporaryFolders'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const TEMP = path.join(ROOT, 'temp')
mkdirSync(TEMP, { recursive: true })
const WORK = mkdtempSync(path.join(TEMP, 'm80d-stdio-'))
const INSTALLED = process.env['MUSE_ACP_PACKAGE_DIR']
const PACKAGE = INSTALLED ?? path.join(WORK, 'agent')
const AGENT = path.join(PACKAGE, 'dist', 'acp.js')
const PRELOAD = path.join(WORK, 'preload.cjs')
const KEY = 'LLM|123456|fabricated%legacy.key-for-m80d'
const TIMEOUT = 30_000
const BASH = bashForTests()
// Node passes drive-letter absolute paths; GNU tar treats their colon as a
// remote host. Native Windows bsdtar accepts them without a shell.
const TAR =
  process.platform === 'win32'
    ? path.join(process.env['SystemRoot'] ?? String.raw`C:\Windows`, 'System32', 'tar.exe')
    : 'tar'
const SHELL_ENV = {
  ...process.env,
  PATH: `${path.dirname(BASH)}${path.delimiter}${process.env['PATH'] ?? ''}`,
}

function bashForTests(): string {
  const probe = {
    platform: process.platform,
    pathVariable: process.env['PATH'],
    fileExists: existsSync,
  }
  const git = resolveExecutable('git', probe)
  const besideGit =
    git === undefined ? undefined : path.resolve(path.dirname(git), '..', 'usr', 'bin', 'bash.exe')
  const portable = path.join(ROOT, 'node_modules', '.bin', 'msys', 'usr', 'bin', 'bash.exe')
  const fromPath = resolveExecutable('bash', probe)
  const candidates = process.platform === 'win32' ? [portable, besideGit, fromPath] : [fromPath]
  const bash = candidates.find((candidate) => candidate !== undefined && existsSync(candidate))
  if (bash === undefined)
    throw new Error('M80 D guards require installed Bash; no shell was started')
  return bash
}

const children: ChildProcessWithoutNullStreams[] = []

afterAll(async () => {
  for (const child of children) child.kill()
  await removeFolder(WORK)
})

function command(
  file: string,
  cwd: string,
  args: readonly string[] = [],
  env: NodeJS.ProcessEnv = {},
) {
  return spawnSync(process.execPath, [file, ...args], {
    cwd,
    env: { ...process.env, LANG: 'C', LC_ALL: 'C', ...env },
    encoding: 'utf8',
    timeout: TIMEOUT,
  })
}

function packagingFixture() {
  const dir = mkdtempSync(path.join(WORK, 'package space-'))
  for (const folder of [
    'scripts',
    'dist',
    'native/windows',
    'l10n',
    'docs/schemas',
    'test/action',
  ]) {
    mkdirSync(path.join(dir, folder), { recursive: true })
  }
  for (const script of ['package-acp.mjs', 'package-acp-test.mjs']) {
    cpSync(path.join(ROOT, 'scripts', script), path.join(dir, 'scripts', script))
  }
  writeFileSync(
    path.join(dir, 'scripts', 'third-party-notices.mjs'),
    'import {writeFileSync} from "node:fs"; writeFileSync(process.argv.at(-1), "test fixture notices");',
  )
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'test-fixture',
      version: '0.0.0',
      license: 'MIT',
      engines: { node: '>=22' },
      repository: { url: 'https://github.com/RandyNorthrup/muse-spark-code.git' },
      devDependencies: { '@napi-rs/keyring': '2.1.0' },
    }),
  )
  for (const bundle of ['acp', 'modelApi', 'uiText', 'searchWorker', 'pageWorker']) {
    writeFileSync(path.join(dir, 'dist', `${bundle}.js`), '// test-owned inert bundle\n')
  }
  for (const file of ['MuseSparkJob.cs', 'MuseSparkMcpJob.cs']) {
    writeFileSync(path.join(dir, 'native', 'windows', file), '// test-owned native fixture\n')
  }
  writeFileSync(path.join(dir, 'l10n', 'ui.de.json'), '{}\n')
  writeFileSync(path.join(dir, 'LICENSE'), 'test-owned licence\n')
  writeFileSync(path.join(dir, 'docs', 'acp.md'), '# Test-owned guide\n')
  cpSync(path.join(ROOT, 'docs', 'schemas'), path.join(dir, 'docs', 'schemas'), { recursive: true })
  writeFileSync(
    path.join(dir, 'test', 'action', 'exec-test-launcher.ts'),
    'console.log("TEST ONLY")\n',
  )
  return dir
}

describe('M80 D package guards', { timeout: TIMEOUT }, () => {
  it('ships exact committed schemas, keeps production bin, and never packs the test launcher', () => {
    const dir = packagingFixture()
    const run = command(path.join(dir, 'scripts', 'package-acp.mjs'), dir)
    expect(run.status, run.stderr).toBe(0)
    const stage = path.join(dir, 'dist', 'acp-package')
    const packed = path.join(dir, 'dist', 'muse-spark-code-acp-0.0.0.tgz')
    for (const schema of ['exec-result-v1.schema.json', 'exec-event-v1.schema.json']) {
      expect(readFileSync(path.join(stage, 'schemas', schema))).toEqual(
        readFileSync(path.join(ROOT, 'docs', 'schemas', schema)),
      )
      const extracted = spawnSync(TAR, ['-xOzf', packed, `package/schemas/${schema}`], {
        encoding: 'utf8',
        timeout: TIMEOUT,
      })
      expect(extracted.status, extracted.stderr).toBe(0)
      expect(extracted.stdout).toBe(
        readFileSync(path.join(ROOT, 'docs', 'schemas', schema), 'utf8'),
      )
    }
    const manifest: unknown = JSON.parse(readFileSync(path.join(stage, 'package.json'), 'utf8'))
    expect(manifest).toMatchObject({ bin: { 'muse-spark-code-acp': 'dist/acp.js' } })
    expect(existsSync(path.join(stage, 'dist', 'exec-test-launcher.js'))).toBe(false)
  })

  it.each(['missing', 'directory', 'invalid-json'])(
    'refuses %s schema before replacing stage',
    (fault) => {
      const dir = packagingFixture()
      const schema = path.join(dir, 'docs', 'schemas', 'exec-result-v1.schema.json')
      rmSync(schema)
      if (fault === 'directory') mkdirSync(schema)
      else if (fault === 'invalid-json') writeFileSync(schema, '{')
      const stage = path.join(dir, 'dist', 'acp-package')
      mkdirSync(stage)
      writeFileSync(path.join(stage, 'sentinel'), 'preserve')
      const run = command(path.join(dir, 'scripts', 'package-acp.mjs'), dir)
      expect(run.status).not.toBe(0)
      if (fault === 'directory') expect(run.stderr).toContain('not a regular file')
      expect(readFileSync(path.join(stage, 'sentinel'), 'utf8')).toBe('preserve')
    },
  )

  it('packs distinct private fake-only tarball without changing production stage or digest', () => {
    const dir = packagingFixture()
    expect(command(path.join(dir, 'scripts', 'package-acp.mjs'), dir).status).toBe(0)
    const product = path.join(dir, 'dist', 'muse-spark-code-acp-0.0.0.tgz')
    const digest = () => createHash('sha256').update(readFileSync(product)).digest('hex')
    const before = digest()
    const run = command(path.join(dir, 'scripts', 'package-acp-test.mjs'), dir)
    expect(run.status, run.stderr).toBe(0)
    expect(existsSync(product)).toBe(true)
    expect(digest()).toBe(before)
    expect(existsSync(path.join(dir, 'dist', 'muse-spark-code-acp-test-0.0.0.tgz'))).toBe(true)
    const testStage = path.join(dir, 'dist', 'acp-test-package')
    expect(JSON.parse(readFileSync(path.join(testStage, 'package.json'), 'utf8'))).toMatchObject({
      private: true,
      bin: { 'muse-spark-code-acp': 'dist/exec-test-launcher.js' },
    })
    expect(
      readFileSync(path.join(dir, 'dist', 'acp-package', 'package.json'), 'utf8'),
    ).not.toContain('exec-test-launcher')
    expect(readFileSync(path.join(testStage, 'schemas', 'exec-event-v1.schema.json'))).toEqual(
      readFileSync(path.join(ROOT, 'docs', 'schemas', 'exec-event-v1.schema.json')),
    )
  })

  it('refuses missing test launcher rather than emitting a product-like test success', () => {
    const dir = packagingFixture()
    expect(command(path.join(dir, 'scripts', 'package-acp.mjs'), dir).status).toBe(0)
    rmSync(path.join(dir, 'test', 'action', 'exec-test-launcher.ts'))
    expect(command(path.join(dir, 'scripts', 'package-acp-test.mjs'), dir).status).not.toBe(0)
    expect(existsSync(path.join(dir, 'dist', 'acp-test-package'))).toBe(false)
    expect(existsSync(path.join(dir, 'dist', 'muse-spark-code-acp-test-0.0.0.tgz'))).toBe(false)
  })

  it.each(['exec-result-v1.schema.json', 'exec-event-v1.schema.json'])(
    'build tarball guard rejects missing %s',
    (missing) => {
      const dir = packagingFixture()
      expect(command(path.join(dir, 'scripts', 'package-acp.mjs'), dir).status).toBe(0)
      const workflow = readFileSync(path.join(ROOT, '.github/workflows/build.yml'), 'utf8')
      const step = workflow.split(
        "- name: the agent's package carries its bundles, tables, notices and manifest",
        2,
      )[1]
      const block = step?.split('run: |\n', 2)[1]?.split('\n      #', 1)[0]
      if (block === undefined) throw new Error('missing build tarball verification step')
      const script = block
        .split('\n')
        .map((line) => line.replace(/^ {10}/, ''))
        .join('\n')
      const check = () =>
        spawnSync(BASH, ['-c', script], {
          cwd: dir,
          env: SHELL_ENV,
          encoding: 'utf8',
          timeout: TIMEOUT,
        })
      const valid = check()
      expect(valid.error, valid.stderr).toBeUndefined()
      expect(valid.status, valid.stderr).toBe(0)
      const staging = path.join(dir, 'repack')
      mkdirSync(staging)
      cpSync(path.join(dir, 'dist', 'acp-package'), path.join(staging, 'package'), {
        recursive: true,
      })
      rmSync(path.join(staging, 'package', 'schemas', missing))
      const packed = path.join(dir, 'dist', 'muse-spark-code-acp-0.0.0.tgz')
      expect(
        spawnSync(TAR, ['-czf', packed, '-C', staging, 'package'], { timeout: TIMEOUT }).status,
      ).toBe(0)
      const refused = check()
      expect(refused.error, refused.stderr).toBeUndefined()
      expect(refused.status).toBe(1)
      expect(refused.stderr).toContain(`package/schemas/${missing} is missing`)
    },
  )

  it.each(['name', 'bin', 'version'])(
    'refuses wrong production %s before test staging',
    (fault) => {
      const dir = packagingFixture()
      expect(command(path.join(dir, 'scripts', 'package-acp.mjs'), dir).status).toBe(0)
      const source = path.join(dir, 'dist', 'acp-package', 'package.json')
      const manifest: Record<string, unknown> = JSON.parse(readFileSync(source, 'utf8'))
      if (fault === 'name') manifest['name'] = 'wrong-package'
      else if (fault === 'bin') manifest['bin'] = { 'muse-spark-code-acp': 'wrong.js' }
      else manifest['version'] = '../escape'
      writeFileSync(source, JSON.stringify(manifest))
      expect(command(path.join(dir, 'scripts', 'package-acp-test.mjs'), dir).status).not.toBe(0)
      expect(existsSync(path.join(dir, 'dist', 'acp-test-package'))).toBe(false)
    },
  )

  it('refuses a directory in place of a required test-package schema', () => {
    const dir = packagingFixture()
    expect(command(path.join(dir, 'scripts', 'package-acp.mjs'), dir).status).toBe(0)
    const schema = path.join(dir, 'dist', 'acp-package', 'schemas', 'exec-result-v1.schema.json')
    rmSync(schema)
    mkdirSync(schema)
    expect(command(path.join(dir, 'scripts', 'package-acp-test.mjs'), dir).status).not.toBe(0)
    expect(existsSync(path.join(dir, 'dist', 'acp-test-package'))).toBe(false)
  })

  it.each(['empty', 'path'])(
    'refuses %s npm pack output instead of renaming a directory',
    (fault) => {
      const dir = packagingFixture()
      expect(command(path.join(dir, 'scripts', 'package-acp.mjs'), dir).status).toBe(0)
      const bin = path.join(dir, 'bin')
      mkdirSync(bin)
      const shim = path.join(bin, process.platform === 'win32' ? 'npm.cmd' : 'npm')
      const line = fault === 'empty' ? '' : '../escape.tgz'
      writeFileSync(
        shim,
        process.platform === 'win32'
          ? `@echo off\r\n${line === '' ? '' : `echo ${line}\r\n`}exit /b 0\r\n`
          : `#!/bin/sh\nprintf '%s\\n' '${line}'\n`,
      )
      chmodSync(shim, 0o755)
      const run = command(path.join(dir, 'scripts', 'package-acp-test.mjs'), dir, [], {
        PATH: `${bin}${path.delimiter}${process.env['PATH'] ?? ''}`,
      })
      expect(run.status).not.toBe(0)
      expect(run.stderr).toContain('npm pack did not return a tarball name')
      expect(existsSync(path.join(dir, 'dist', 'muse-spark-code-acp-test-0.0.0.tgz'))).toBe(false)
    },
  )

  it.each([
    'stored',
    'unavailable',
    'exec-fails',
    'trust-accepted',
    'help-missing',
    'schema-drift',
    'help-no-exec',
    'help-no-scan',
    'schema-required',
    'schema-empty',
  ])('host store guard/cleanup: %s', (state) => {
    const dir = packagingFixture()
    expect(command(path.join(dir, 'scripts', 'package-acp.mjs'), dir).status).toBe(0)
    const stage = path.join(dir, 'dist', 'acp-package')
    const calls = path.join(dir, 'auth-calls')
    writeFileSync(path.join(stage, 'dist', 'uiText.js'), 'exports.EN={acpKeyAbsent:"absent"};')
    writeFileSync(
      path.join(stage, 'dist', 'acp.js'),
      String.raw`
      const fs = require('node:fs');
      const args = process.argv.slice(2);
      const calls = ${JSON.stringify(calls)};
      const state = ${JSON.stringify(state)};
      const marker = calls + '.stored';
      if (args[0] === '--help') { fs.writeFileSync(calls + '.started', 'help'); console.log({'help-missing':'agent help','help-no-exec':'scan-secrets','help-no-scan':'exec'}[state] ?? 'exec scan-secrets'); }
      else if (args[0] === 'auth') {
        const op = args[1];
        fs.appendFileSync(calls, op + '\n');
        if (op === 'status') {
          if (state === 'stored' || fs.existsSync(marker)) console.log('present');
          else { if (state !== 'unavailable') console.log('absent'); process.exitCode = 1; }
        } else if (op === 'set') fs.writeFileSync(marker, 'fabricated');
        else if (op === 'clear') fs.rmSync(marker, {force:true});
      } else process.exitCode = args.includes('--trust-workspace') ? (state === 'trust-accepted' ? 0 : 2) : 4;
    `,
    )
    switch (state) {
      case 'schema-drift':
      case 'schema-required': {
        const schema = path.join(stage, 'schemas', 'exec-result-v1.schema.json')
        const original = readFileSync(schema, 'utf8')
        writeFileSync(
          schema,
          state === 'schema-drift'
            ? original.replace('"const": 1', '"const": 2')
            : original.replace('    "status",\n', ''),
        )
        break
      }
      case 'schema-empty': {
        writeFileSync(path.join(stage, 'schemas', 'exec-event-v1.schema.json'), '{"anyOf":[]}')
        break
      }
    }
    const run = spawnSync(BASH, [path.join(ROOT, 'test/hosts/exec.sh'), stage, '--store'], {
      cwd: ROOT,
      env: { ...SHELL_ENV, LANG: 'C', LC_ALL: 'C' },
      encoding: 'utf8',
      timeout: TIMEOUT,
    })
    expect(run.error, run.stderr).toBeUndefined()
    expect(run.status, run.stderr).toBe(state === 'exec-fails' ? 4 : 1)
    expect(existsSync(`${calls}.started`), run.stderr).toBe(true)
    const observed = existsSync(calls) ? readFileSync(calls, 'utf8') : ''
    if (state === 'exec-fails') {
      expect(observed).toContain('set\nstatus\nclear\n')
      expect(existsSync(`${calls}.stored`)).toBe(false)
    } else if (
      [
        'trust-accepted',
        'help-missing',
        'schema-drift',
        'help-no-exec',
        'help-no-scan',
        'schema-required',
        'schema-empty',
      ].includes(state)
    ) {
      expect(observed).toBe('')
    } else {
      expect(observed).toBe('status\n')
    }
  })
})

function start(args: readonly string[], mode = 'stdin', shouldReadOutput = true) {
  const marker = path.join(WORK, 'dispatched')
  const blockedMarker = path.join(WORK, 'large-write')
  rmSync(marker, { force: true })
  rmSync(blockedMarker, { force: true })
  const child = spawn(process.execPath, ['--require', PRELOAD, AGENT, ...args], {
    cwd: WORK,
    env: {
      PATH: process.env['PATH'],
      SystemRoot: process.env['SystemRoot'],
      HOME: WORK,
      USERPROFILE: WORK,
      XDG_DATA_HOME: WORK,
      LOCALAPPDATA: WORK,
      LANG: 'C',
      LC_ALL: 'C',
      NODE_PATH: path.join(ROOT, 'node_modules'),
      M80D_CASE: mode,
      M80D_REPORT: path.join(WORK, 'report.json'),
      M80D_REQUEST_MARKER: marker,
      M80D_BLOCK_MARKER: blockedMarker,
    },
    stdio: 'pipe',
  })
  children.push(child)
  let stdout = '',
    stderr = ''
  if (shouldReadOutput)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  const closed = new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code) => {
        resolve({ code, stdout, stderr })
      })
    },
  )
  return { child, closed, marker, blockedMarker }
}

function execArgs() {
  return [
    'exec',
    '--backend',
    'modelApi',
    '--model',
    'muse-spark-1.3-contributor',
    '--allow-contributor-models',
    '--max-budget-usd',
    '1.00',
    '--ephemeral',
    '--output',
    'jsonl',
    'Reply ok.',
  ]
}

function result(stdout: string): ExecResult {
  const events = stdout
    .trim()
    .split('\n')
    .map((line) => execEventSchema.parse(JSON.parse(line)))
  expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1))
  const finals = events.filter((event) => event.type === 'result')
  expect(finals).toHaveLength(1)
  const final = finals[0]
  if (final?.type !== 'result') throw new Error('missing final result')
  return validateResult(final.result)
}

// E1-E7 and H2 use the actual production package and engine.
describe('M80 E1-E7 built exec', { timeout: TIMEOUT }, () => {
  beforeAll(async () => {
    if (INSTALLED === undefined) {
      expect(command(path.join(ROOT, 'scripts', 'build.mjs'), ROOT, ['--production']).status).toBe(
        0,
      )
      expect(command(path.join(ROOT, 'scripts', 'package-acp.mjs'), ROOT).status).toBe(0)
      cpSync(path.join(ROOT, 'dist', 'acp-package'), PACKAGE, { recursive: true })
    }
    await build({
      stdin: {
        contents: `
          import Module from 'node:module';
          import { createHash } from 'node:crypto';
          import { writeFileSync } from 'node:fs';
          import fs from 'node:fs';
          import { fakeModelApi, FAKE_MODEL_API_KEY } from ${JSON.stringify(path.join(ROOT, 'test/unit/helpers/fakeModelApi.ts'))};
          const key = ${JSON.stringify(KEY)};
          const mode = process.env.M80D_CASE;
          const write = fs.write;
          fs.write = function(fd, ...args) {
            // Far beyond any pipe buffer, so the unread stdout really blocks.
            if (fd === 1 && Buffer.isBuffer(args[0]) && args[0].length >= 256 * 1024) {
              writeFileSync(process.env.M80D_BLOCK_MARKER, 'large async write queued');
            }
            return write.call(this, fd, ...args);
          };
          // The agent loads the keyring with a native import(), which
          // Module._load never sees; a resolve/load hook answers import() and
          // require() alike, so no real OS store is ever opened here.
          const FAKE_KEYRING = 'file:///m80-test-owned-keyring.mjs';
          Module.registerHooks({
            resolve(specifier, context, nextResolve) {
              if (specifier === '@napi-rs/keyring') return { url: FAKE_KEYRING, shortCircuit: true };
              return nextResolve(specifier, context);
            },
            load(url, context, nextLoad) {
              if (url !== FAKE_KEYRING) return nextLoad(url, context);
              if (mode !== 'store') throw new Error('keyring must not load on stdin path');
              return {
                format: 'module',
                shortCircuit: true,
                source: 'export class AsyncEntry { getPassword() { return Promise.resolve(' + JSON.stringify(key) + ') } setPassword() { return Promise.resolve() } deletePassword() { return Promise.resolve(true) } }',
              };
            },
          });
          const api = fakeModelApi();
          api.models = ['muse-spark-1.3-contributor'];
          // The blocked reply stays inside exec's 32 MiB response cap: the fake
          // streams text in five-character deltas, so 4 MiB of text would be cut
          // short and withheld, and nothing large would reach stdout.
          api.script({text:mode === 'blocked' ? 'x'.repeat(512 * 1024) : 'ok', usage:{input:10, output:5}, ...(mode === 'hold' ? {hold:new Promise(()=>{})} : {})});
          globalThis.fetch = (url, init) => {
            if (mode === 'crash') throw new Error('startup ' + key);
            if (String(url).endsWith('/responses')) writeFileSync(process.env.M80D_REQUEST_MARKER, 'dispatched');
            // The run's own key must arrive; the shared fake then sees its fixed key.
            const headers = new Headers(init?.headers);
            if (headers.get('authorization') !== 'Bearer ' + key) {
              return Promise.resolve(Response.json({ error: { message: 'bad key', type: 'authentication_error' } }, { status: 401 }));
            }
            headers.set('authorization', 'Bearer ' + FAKE_MODEL_API_KEY);
            return api.fetch(url, { ...init, headers: Object.fromEntries(headers) });
          };
          const hash = value => createHash('sha256').update(value).digest('hex');
          process.on('exit', () => writeFileSync(process.env.M80D_REPORT, JSON.stringify({
            env: Object.fromEntries(Object.entries(process.env).map(([k,v]) => [k,hash(v ?? '')])),
            argv: process.argv.map(hash), requests: api.requests.map(r => ({path:r.path, method:r.method}))
          })));
        `,
        resolveDir: ROOT,
        loader: 'ts',
      },
      outfile: PRELOAD,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      logLevel: 'silent',
    })
  })

  it('E1/H4 built help names exec/scanner and package schemas are valid', async () => {
    const run = await start(['--help'], 'store').closed
    expect(run.code).toBe(0)
    expect(run.stdout).toContain('exec')
    expect(run.stdout).toContain('scan-secrets')
    for (const schema of ['exec-result-v1', 'exec-event-v1']) {
      const parsed: unknown = JSON.parse(
        readFileSync(path.join(PACKAGE, 'schemas', `${schema}.schema.json`), 'utf8'),
      )
      if (schema === 'exec-result-v1') expect(parsed).toHaveProperty('properties.v.const', 1)
      else
        expect(parsed).toMatchObject({
          anyOf: expect.arrayContaining([
            expect.objectContaining({
              properties: expect.objectContaining({ v: expect.objectContaining({ const: 1 }) }),
            }),
          ]),
        })
    }
  })

  it.each(['--trust-workspace', '--web-search'])('E2/H1 refuses %s with usage/2', async (flag) => {
    const output = await start([...execArgs(), flag], 'store').closed
    expect(output.code).toBe(2)
  })

  it.each(['stdin', 'store'])(
    'E3/E4/H2 completes using test-owned %s auth and real built engine',
    async (mode) => {
      const run = start([...execArgs(), ...(mode === 'stdin' ? ['--key-stdin'] : [])], mode)
      if (mode === 'stdin') run.child.stdin.end(`${KEY}\n`)
      const output = await run.closed
      expect(output.code, output.stderr).toBe(0)
      expect(result(output.stdout)).toMatchObject({
        status: 'completed',
        finalMessage: 'ok',
        usage: { requests: 1 },
      })
      expect(output.stdout + output.stderr).not.toContain(KEY)
      // Injected child-env/argv hashes are evidence of these supplied values only,
      // not a claim of full OS environment-block inspection on Windows.
      const report = readFileSync(path.join(WORK, 'report.json'), 'utf8')
      expect(report).not.toContain(KEY)
      expect(report).not.toContain(createHash('sha256').update(KEY).digest('hex'))
    },
  )

  it.skipIf(process.platform === 'win32').each(['SIGINT', 'SIGTERM'] as const)(
    'E5 %s while streaming is bounded',
    async (signal) => {
      const run = start([...execArgs(), '--key-stdin'], 'hold')
      run.child.stdin.end(`${KEY}\n`)
      await expect.poll(() => existsSync(run.marker), { timeout: TIMEOUT }).toBe(true)
      const stopped = performance.now()
      run.child.kill(signal)
      const output = await run.closed
      expect(output.code).toBe(signal === 'SIGINT' ? 130 : 143)
      expect(performance.now() - stopped).toBeLessThan(5400)
      if (output.stdout.includes('"result"')) expect(result(output.stdout).status).toBe('cancelled')
    },
  )

  it.skipIf(process.platform === 'win32')(
    'E5 unread output cannot block bounded signal exit',
    async () => {
      const run = start([...execArgs(), '--key-stdin'], 'blocked', false)
      run.child.stdin.end(`${KEY}\n`)
      await expect.poll(() => existsSync(run.blockedMarker), { timeout: TIMEOUT }).toBe(true)
      const stopped = performance.now()
      run.child.kill('SIGTERM')
      const output = await run.closed
      expect(output.code, output.stderr).toBe(143)
      expect(performance.now() - stopped).toBeLessThan(5400)
    },
  )

  it('E6 redacts exact percent-legacy key from startup failure stderr', async () => {
    const run = start([...execArgs(), '--key-stdin'], 'crash')
    run.child.stdin.end(`${KEY}\n`)
    const output = await run.closed
    expect(output.code).not.toBe(0)
    expect(output.stderr).not.toContain(KEY)
    expect(output.stderr).not.toContain('legacy.key-for-m80d')
  })

  it.each(['clean', 'secret', 'missing'])(
    'E7 installed scanner %s is counts-only with no keyring',
    async (kind) => {
      const file = path.join(WORK, `scan-${kind}.txt`)
      if (kind !== 'missing')
        writeFileSync(file, kind === 'secret' ? `removed line ${KEY}` : 'ordinary text')
      const run = start(['scan-secrets', file, '--key-stdin'])
      // Keep pipe open after LF: scanner must not wait for EOF.
      run.child.stdin.write(`${KEY}\n`)
      const output = await run.closed
      expect(output.code).toBe(
        new Map([
          ['clean', 0],
          ['secret', 10],
          ['missing', 2],
        ]).get(kind),
      )
      expect(output.stdout + output.stderr).not.toContain(KEY)
      expect(output.stdout).not.toContain('removed line')
    },
  )
})
