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
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { brotliDecompressSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'
import * as z from 'zod/mini'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveExecutable } from '../../src/core/executables'
import {
  execEventV2Schema,
  validateResult,
  type ExecResult,
} from '../../src/runtime/exec/execProtocol'

import { TABLE_LOCALES } from '../../src/shared/l10n/locales'
import { removeFolder } from '../unit/helpers/temporaryFolders'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const TEMP = path.join(ROOT, 'temp')
mkdirSync(TEMP, { recursive: true })
const WORK = mkdtempSync(path.join(TEMP, 'm80d-stdio-'))
const BUILD_ROOT = path.join(WORK, 'build')
const INSTALLED = process.env['MUSE_ACP_PACKAGE_DIR']
const PACKAGE = INSTALLED ?? path.join(WORK, 'agent')
const AGENT = path.join(PACKAGE, 'dist', 'acp.js')
const PRELOAD = path.join(WORK, 'preload.cjs')
const PACKAGE_PRELOAD = path.join(WORK, 'package-preload.cjs')
const PACKAGE_IMAGES = path.join(WORK, 'package-images.jsonl')
const KEY = 'LLM|123456|fabricated%legacy.key-for-m80d'
// The real cold archive and native API checks run once in beforeAll.
// Each package guard gets an independent copy; ordinary operations keep 30 seconds.
const COLD_PACKAGE_TIMEOUT_MS = 60_000
const TIMEOUT = 30_000
// The production build and pack before the built rows: about a minute on the
// Windows 11 VM, past Vitest's 10 s hook default and a single row's budget.
const BUILD_TIMEOUT = 300_000
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
  if (bash !== undefined) return bash
  // MinGit can ship GNU Bash under its POSIX entry name only.
  if (git !== undefined && process.platform === 'win32') {
    const sh = path.resolve(path.dirname(git), '..', 'usr', 'bin', 'sh.exe')
    const version = spawnSync(sh, ['--version'], { encoding: 'utf8', windowsHide: true })
    if (version.status === 0 && version.stdout.startsWith('GNU bash,')) return sh
  }
  throw new Error('M80 D guards require installed Bash; no shell was started')
}

const children: ChildProcessWithoutNullStreams[] = []

afterAll(async () => {
  for (const child of children) child.kill()
  // Remove only the test-owned link before recursive cleanup of its tree.
  rmSync(path.join(BUILD_ROOT, 'node_modules'), { force: true })
  await removeFolder(WORK)
})

beforeAll(() => {
  // Packaging runs the real badge validator in a child. Its HTTP boundary
  // needs a fake too: a PR's screenshots do not exist on public main yet.
  // Only this package process tree receives the preload; CI's independent
  // public badge gate and the agent's own transport are unchanged.
  writeFileSync(
    PACKAGE_PRELOAD,
    String.raw`
      const { appendFileSync, readFileSync, readdirSync } = require('node:fs');
      const path = require('node:path');
      const root = ${JSON.stringify(ROOT)};
      const images = ${JSON.stringify(PACKAGE_IMAGES)};
      globalThis.fetch = async input => {
        const url = new URL(String(input));
        appendFileSync(images, JSON.stringify(url.href) + '\n');
        if (url.href === 'https://api.github.com/repos/RandyNorthrup/muse-spark-code/git/trees/main?recursive=1') {
          const tree = readdirSync(path.join(root, 'media'), { recursive: true })
            .filter(file => file.endsWith('.png'))
            .map(file => ({ path: 'media/' + file.replaceAll('\\', '/'), type: 'blob' }));
          return Response.json({ truncated: false, tree });
        }
        if (url.origin === 'https://raw.githubusercontent.com' &&
            url.pathname.startsWith('/RandyNorthrup/muse-spark-code/main/media/')) {
          const file = path.join(root, url.pathname.split('/main/')[1]);
          return new Response(readFileSync(file), { headers: { 'content-type': 'image/png' } });
        }
        if (!['img.shields.io', 'badgen.net', 'github.com'].includes(url.hostname)) {
          throw new Error('Unexpected package image: ' + url.href);
        }
        const text = url.pathname.startsWith('/badge/')
          ? decodeURIComponent(url.pathname.slice('/badge/'.length)).replace(/-[^-]+$/, '')
          : 'test-owned badge';
        return new Response('<svg xmlns="http://www.w3.org/2000/svg"><text>' + text + '</text></svg>', {
          headers: { 'content-type': 'image/svg+xml' },
        });
      };
    `,
  )
})

function command(
  file: string,
  cwd: string,
  args: readonly string[] = [],
  env: NodeJS.ProcessEnv = {},
  timeout = TIMEOUT,
) {
  return spawnSync(process.execPath, [file, ...args], {
    cwd,
    env: {
      ...process.env,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      BADGE_CHECK_SKIP_NETWORK: undefined,
      ...(path.basename(file) === 'package-acp.mjs' && {
        NODE_OPTIONS: `--require ${JSON.stringify(PACKAGE_PRELOAD)}`,
      }),
      ...env,
    },
    encoding: 'utf8',
    timeout,
  })
}

function packedText(archive: string, member: string): string {
  const extracted = spawnSync(TAR, ['-xOzf', archive, `package/${member}`], {
    encoding: 'utf8',
    timeout: TIMEOUT,
  })
  expect(extracted.status, extracted.stderr).toBe(0)
  return extracted.stdout
}

function packagingFixture() {
  const dir = mkdtempSync(path.join(WORK, 'package space-'))
  for (const folder of [
    'scripts/lib',
    'dist',
    'dist/webview',
    'dist/meta',
    'native/windows',
    'l10n',
    'docs/schemas',
    'test/action',
    'test/packaging',
  ]) {
    mkdirSync(path.join(dir, folder), { recursive: true })
  }
  for (const script of ['package-acp.mjs', 'package-acp-test.mjs']) {
    cpSync(path.join(ROOT, 'scripts', script), path.join(dir, 'scripts', script))
  }
  const packer = path.join(dir, 'scripts/package-acp.mjs')
  const exportCheck = path.join(dir, 'scripts/native-exports.cjs')
  writeFileSync(
    exportCheck,
    `const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const checker = ${JSON.stringify(path.join(ROOT, 'test/packaging/moduleExports.test.mjs'))};
const hash = createHash('sha256').update(readFileSync(process.argv[3]))
  .update(readFileSync(checker)).update(process.version).update(process.argv[2]).digest('hex');
const cache = path.join(${JSON.stringify(WORK)}, 'native-export-cache');
const marker = path.join(cache, hash);
if (!existsSync(marker)) {
  execFileSync(process.execPath, [checker, ...process.argv.slice(2)], { stdio: 'inherit' });
  mkdirSync(cache, { recursive: true });
  writeFileSync(marker, hash);
}
`,
  )
  writeFileSync(
    packer,
    readFileSync(packer, 'utf8')
      .replace("'scripts/check-l10n.mjs'", () =>
        JSON.stringify(path.join(ROOT, 'scripts/check-l10n.mjs')),
      )
      .replace("'./check-badges.mjs'", () =>
        JSON.stringify(pathToFileURL(path.join(ROOT, 'scripts/check-badges.mjs')).href),
      )
      .replace("'scripts/check-badges.mjs'", () =>
        JSON.stringify(path.join(ROOT, 'scripts/check-badges.mjs')),
      )
      .replace("'test/packaging/moduleExports.test.mjs'", () => JSON.stringify(exportCheck)),
  )
  mkdirSync(path.join(dir, 'scripts/lib'), { recursive: true })
  writeFileSync(
    path.join(dir, 'scripts/lib/packageArchive.mjs'),
    `import { packRuntimeArchive as pack } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'scripts/lib/packageArchive.mjs')).href)};
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
export async function packRuntimeArchive(root, stage, files, tables) {
  const hash = createHash('sha256').update(JSON.stringify(tables));
  for (const file of files) hash.update(file).update(readFileSync(path.join(root, file)));
  const cache = path.join(${JSON.stringify(WORK)}, 'archive-cache', hash.digest('hex'));
  const members = [...files.filter(file => file !== 'dist/providerCatalog.json'), 'l10n/ui.tables.json.br', 'l10n/usage.tables.json.br', 'dist/runtime.bundles.json.br'];
  if (!existsSync(path.join(cache, 'complete'))) {
    await pack(root, stage, files, tables);
    for (const file of members) {
      mkdirSync(path.dirname(path.join(cache, file)), { recursive: true });
      cpSync(path.join(stage, file), path.join(cache, file));
    }
    writeFileSync(path.join(cache, 'complete'), 'complete');
  } else {
    for (const file of members) {
      mkdirSync(path.dirname(path.join(stage, file)), { recursive: true });
      cpSync(path.join(cache, file), path.join(stage, file));
    }
  }
}
`,
  )
  cpSync(
    path.join(ROOT, 'scripts/lib/packedL10n.mjs'),
    path.join(dir, 'scripts/lib/packedL10n.mjs'),
  )
  writeFileSync(
    path.join(dir, 'scripts', 'third-party-notices.mjs'),
    'import {writeFileSync} from "node:fs"; writeFileSync(process.argv.at(-1), "test fixture notices");',
  )
  // The badge check has its own suite (checkBadges.test.mjs) and the fixture's
  // landing page carries no badges: a test-owned renderer and a no-op check.
  writeFileSync(
    path.join(dir, 'scripts', 'check-badges.mjs'),
    'export const renderPackageReadme = (markdown) => markdown\n',
  )
  writeFileSync(path.join(dir, 'scripts/check-l10n.mjs'), '// test-owned source gate\n')
  // These inert bundles exercise package admission; the dedicated native API
  // suite owns callable exports. Require this probe to receive the actual tar.
  writeFileSync(
    path.join(dir, 'test/packaging/moduleExports.test.mjs'),
    String.raw`import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
assert.equal(process.argv[2], 'acp');
const files = new Set(execFileSync(${JSON.stringify(TAR)}, ['-tzf', process.argv[3]], { encoding: 'utf8' }).split('\n'));
for (const file of ['acp.js', 'modelApi.js', 'modelApiBoundaries.js', 'team.js', 'teamScheduler.js', 'teamRunners.js', 'runtime.bundles.json.br'])
  assert.ok(files.has('package/dist/' + file), file);
`,
  )
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      ...JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')),
      name: 'test-fixture',
      version: '0.0.0',
      license: 'MIT',
      engines: { node: '>=22' },
      repository: { url: 'https://github.com/RandyNorthrup/muse-spark-code.git' },
      devDependencies: { '@napi-rs/keyring': '2.1.0' },
    }),
  )
  for (const bundle of [
    'acp',
    'headless',
    'sharingRuntime',
    // M112: the lazy ACP forms, the private registry and the deferral note.
    'acpQuestions',
    'runtimeQuestions',
    'questionNotes',
    'exec',
    'modelApi',
    'mcpPool',
    'modelApiCodeIntel',
    'structuredSchema',
    'modelApiHooks',
    'modelApiMcp',
    'runtimeAccounting',
    'runtimeEngine',
    'providerPolicy',
    'modelApiBoundaries',
    'providers',
    'subscriptions',
    'configuredProviders',
    'reviewer',
    'legalScan',
    'team',
    'teamScheduler',
    'teamRunners',
    // M91: the adapters, the hook and MCP-form runtime, the window's hook runner.
    'foreignHooks',
    'hookRuntime',
    'extensionHooks',
    'recorder',
    'reference',
    'uiText',
    'uiTextRuntime',
    'uiTextHooks',
    'uiTextSurfaces',
    'wire',
    'validation',
    'searchWorker',
    'imageResizeWorker',
    'pageWorker',
    'resourceGovernor',
    'resourceAdmission',
    'usageService',
    'usageCompanion',
  ]) {
    cpSync(path.join(ROOT, 'dist', `${bundle}.js`), path.join(dir, 'dist', `${bundle}.js`))
  }
  cpSync(path.join(ROOT, 'dist/providerCatalog.json'), path.join(dir, 'dist/providerCatalog.json'))
  cpSync(path.join(ROOT, 'dist/providerCatalog.js'), path.join(dir, 'dist/providerCatalog.js'))
  for (const file of ['MuseSparkJob.cs', 'MuseSparkMcpJob.cs']) {
    writeFileSync(path.join(dir, 'native', 'windows', file), '// test-owned native fixture\n')
  }
  mkdirSync(path.join(dir, 'native', 'darwin'), { recursive: true })
  writeFileSync(path.join(dir, 'native', 'darwin', 'muse-dictate'), 'test-owned inert helper')
  for (const arch of ['x64', 'arm64']) {
    const native = path.join(dir, 'native', 'linux', arch)
    mkdirSync(native, { recursive: true })
    // This fixture checks packaging only; it never executes these native bytes.
    writeFileSync(path.join(native, 'muse-created'), 'test-owned inert Linux helper\n')
  }
  cpSync(path.join(ROOT, 'media'), path.join(dir, 'media'), { recursive: true })
  cpSync(path.join(ROOT, 'src/shared'), path.join(dir, 'src/shared'), { recursive: true })
  mkdirSync(path.join(dir, 'src/core/judge'), { recursive: true })
  cpSync(path.join(ROOT, 'src/core/judge/engine.ts'), path.join(dir, 'src/core/judge/engine.ts'))
  mkdirSync(path.join(dir, 'src/runtime'), { recursive: true })
  cpSync(path.join(ROOT, 'src/runtime/cliOptions.ts'), path.join(dir, 'src/runtime/cliOptions.ts'))
  cpSync(path.join(ROOT, 'src/core/whatsNew'), path.join(dir, 'src/core/whatsNew'), {
    recursive: true,
  })
  for (const name of readdirSync(ROOT)) {
    if (/^package\.nls.*\.json$/.test(name)) cpSync(path.join(ROOT, name), path.join(dir, name))
  }
  const languageFiles = readdirSync(path.join(ROOT, 'l10n'))
  for (const table of languageFiles) {
    if (/^(?:ui|usage)\..+\.json$/.test(table))
      cpSync(path.join(ROOT, 'l10n', table), path.join(dir, 'l10n', table))
  }
  cpSync(path.join(ROOT, 'l10n/untranslated.json'), path.join(dir, 'l10n/untranslated.json'))
  cpSync(path.join(ROOT, 'dist/webview'), path.join(dir, 'dist/webview'), { recursive: true })
  cpSync(
    path.join(ROOT, 'dist/meta/usageWebview.json'),
    path.join(dir, 'dist/meta/usageWebview.json'),
  )
  cpSync(path.join(ROOT, 'native/runner'), path.join(dir, 'native/runner'), { recursive: true })
  writeFileSync(path.join(dir, 'LICENSE'), 'test-owned licence\n')
  writeFileSync(path.join(dir, 'docs', 'acp.md'), '# Test-owned guide\n')
  for (const file of ['README.md', 'docs/npm-readme.md', 'docs/marketplace-readme.md'])
    cpSync(path.join(ROOT, file), path.join(dir, file))
  cpSync(path.join(ROOT, 'docs', 'schemas'), path.join(dir, 'docs', 'schemas'), { recursive: true })
  cpSync(path.join(ROOT, 'src', 'core', 'legal', 'data'), path.join(dir, 'dist/legal-data'), {
    recursive: true,
  })
  writeFileSync(
    path.join(dir, 'test', 'action', 'exec-test-launcher.ts'),
    'console.log("TEST ONLY")\n',
  )
  return dir
}

describe('M80 D package guards', { timeout: TIMEOUT }, () => {
  let preparedPackage: { dir: string; run: ReturnType<typeof command> } | undefined

  function productionFixture(): string {
    if (preparedPackage === undefined) throw new Error('Missing prepared production package')
    if (preparedPackage.run.status !== 0)
      throw new Error(preparedPackage.run.stdout + preparedPackage.run.stderr)
    const dir = mkdtempSync(path.join(WORK, 'package space-'))
    cpSync(preparedPackage.dir, dir, { recursive: true })
    return dir
  }

  beforeAll(() => {
    const dir = packagingFixture()
    preparedPackage = {
      dir,
      run: command(
        path.join(dir, 'scripts', 'package-acp.mjs'),
        dir,
        [],
        {},
        COLD_PACKAGE_TIMEOUT_MS,
      ),
    }
  }, COLD_PACKAGE_TIMEOUT_MS)
  it(
    'ships exact committed schemas, keeps production bin, and never packs the test launcher',
    { timeout: COLD_PACKAGE_TIMEOUT_MS },
    () => {
      if (preparedPackage === undefined) throw new Error('Missing prepared production package')
      const { dir, run } = preparedPackage
      expect(run.status, run.stdout + run.stderr).toBe(0)
      const stage = path.join(dir, 'dist', 'acp-package')
      const packed = path.join(dir, 'dist', 'muse-spark-code-acp-0.0.0.tgz')
      for (const schema of [
        'exec-result-v1.schema.json',
        'exec-event-v1.schema.json',
        'share-v1.schema.json',
      ]) {
        expect(readFileSync(path.join(stage, 'schemas', schema))).toEqual(
          readFileSync(path.join(ROOT, 'docs', 'schemas', schema)),
        )
        expect(packedText(packed, `schemas/${schema}`)).toBe(
          readFileSync(path.join(ROOT, 'docs', 'schemas', schema), 'utf8'),
        )
      }
      const tables = z
        .object({
          keys: z.array(z.string()),
          locales: z.array(z.string()),
          values: z.array(z.array(z.unknown())),
        })
        .parse(
          JSON.parse(
            brotliDecompressSync(readFileSync(path.join(stage, 'l10n/ui.tables.json.br'))).toString(
              'utf8',
            ),
          ),
        )
      // The package ships every table, independently of the process locale.
      // Inspect German explicitly; the old assertion belonged to a tiny fixture
      // that TRAIN15E replaced with the production tables.
      expect(tables.locales).toEqual(TABLE_LOCALES.toSorted((a, b) => a.localeCompare(b, 'en')))
      const expected = z
        .record(z.string(), z.unknown())
        .parse(JSON.parse(readFileSync(path.join(dir, 'l10n/ui.de.json'), 'utf8')))
      expect(tables.values[tables.locales.indexOf('de')]).toEqual(
        tables.keys.map((key) => expected[key]),
      )
      const manifest: unknown = JSON.parse(readFileSync(path.join(stage, 'package.json'), 'utf8'))
      expect(manifest).toMatchObject({ bin: { 'muse-spark-code-acp': 'dist/acp.js' } })
      expect(existsSync(path.join(stage, 'dist', 'validation.js'))).toBe(true)
      expect(existsSync(path.join(stage, 'dist', 'sharingRuntime.js'))).toBe(true)
      expect(existsSync(path.join(stage, 'dist', 'providerCatalog.json'))).toBe(false)
      expect(existsSync(path.join(stage, 'dist', 'providerCatalog.js'))).toBe(true)
      expect(existsSync(path.join(stage, 'dist', 'exec-test-launcher.js'))).toBe(false)
      for (const member of [
        'dist/legalScan.js',
        'dist/legal-data/NOTICE.md',
        'dist/legal-data/provenance.json',
      ]) {
        const source = member.startsWith('dist/legal-data/')
          ? path.join(ROOT, 'src/core/legal/data', path.basename(member))
          : path.join(dir, member)
        if (member === 'dist/legalScan.js') {
          const runtime = z
            .object({ bundles: z.record(z.string(), z.string()) })
            .parse(
              JSON.parse(
                brotliDecompressSync(
                  readFileSync(path.join(stage, 'dist/runtime.bundles.json.br')),
                ).toString('utf8'),
              ),
            )
          expect(runtime.bundles['legalScan.js']).toBe(readFileSync(source, 'utf8'))
        } else expect(packedText(packed, member)).toBe(readFileSync(source, 'utf8'))
      }
    },
  )

  it.each(['missing', 'directory', 'invalid-json'])(
    'refuses %s schema before replacing stage',
    (fault) => {
      const dir = packagingFixture()
      const schema = path.join(dir, 'docs', 'schemas', 'exec-result-v2.schema.json')
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
    const dir = productionFixture()
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
    expect(readFileSync(path.join(testStage, 'schemas', 'exec-event-v2.schema.json'))).toEqual(
      readFileSync(path.join(ROOT, 'docs', 'schemas', 'exec-event-v2.schema.json')),
    )
  })

  it('refuses missing test launcher rather than emitting a product-like test success', () => {
    const dir = productionFixture()
    rmSync(path.join(dir, 'test', 'action', 'exec-test-launcher.ts'))
    expect(command(path.join(dir, 'scripts', 'package-acp-test.mjs'), dir).status).not.toBe(0)
    expect(existsSync(path.join(dir, 'dist', 'acp-test-package'))).toBe(false)
    expect(existsSync(path.join(dir, 'dist', 'muse-spark-code-acp-test-0.0.0.tgz'))).toBe(false)
  })

  it.each([
    'schemas/exec-result-v1.schema.json',
    'schemas/exec-event-v1.schema.json',
    'l10n/ui.tables.json.br',
    'dist/runtime.bundles.json.br',
    'dist/providers.js',
    'dist/subscriptions.js',
    'dist/configuredProviders.js',
    'dist/providerCatalog.js',
    'schemas/share-v1.schema.json',
    'dist/sharingRuntime.js',
  ])('build tarball guard rejects missing %s', (missing) => {
    const dir = productionFixture()
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
    rmSync(path.join(staging, 'package', missing))
    const packed = path.join(dir, 'dist', 'muse-spark-code-acp-0.0.0.tgz')
    expect(
      spawnSync(TAR, ['-czf', packed, '-C', staging, 'package'], { timeout: TIMEOUT }).status,
    ).toBe(0)
    const refused = check()
    expect(refused.error, refused.stderr).toBeUndefined()
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain(
      missing === 'l10n/ui.tables.json.br'
        ? 'runtime table archive is missing'
        : `package/${missing} is missing`,
    )
  })

  it.each(['name', 'bin', 'version'])(
    'refuses wrong production %s before test staging',
    (fault) => {
      const dir = productionFixture()
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
    const dir = productionFixture()
    const schema = path.join(dir, 'dist', 'acp-package', 'schemas', 'exec-result-v1.schema.json')
    rmSync(schema)
    mkdirSync(schema)
    expect(command(path.join(dir, 'scripts', 'package-acp-test.mjs'), dir).status).not.toBe(0)
    expect(existsSync(path.join(dir, 'dist', 'acp-test-package'))).toBe(false)
  })

  it.each(['empty', 'path'])(
    'refuses %s npm pack output instead of renaming a directory',
    (fault) => {
      const dir = productionFixture()
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
    const dir = productionFixture()
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
        const schema = path.join(stage, 'schemas', 'exec-result-v2.schema.json')
        const original = readFileSync(schema, 'utf8')
        writeFileSync(
          schema,
          state === 'schema-drift'
            ? original.replace('"const": 2', '"const": 3')
            : original.replace('    "status",\n', ''),
        )
        break
      }
      case 'schema-empty': {
        writeFileSync(path.join(stage, 'schemas', 'exec-event-v2.schema.json'), '{"anyOf":[]}')
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
    .map((line) => execEventV2Schema.parse(JSON.parse(line)))
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
      // The bundle-split suite mutates its metafiles. Rebuilding its dist/
      // here can delete chunks or truncate those files during a guard check.
      mkdirSync(BUILD_ROOT, { recursive: true })
      for (const folder of [
        'src',
        'scripts',
        'vendor',
        'media',
        'native',
        'l10n',
        'docs',
        'test/integration',
        'test/packaging',
      ]) {
        cpSync(path.join(ROOT, folder), path.join(BUILD_ROOT, folder), { recursive: true })
      }
      for (const file of [
        'package.json',
        'tsconfig.json',
        'LICENSE',
        'CHANGELOG.md',
        'README.md',
      ]) {
        cpSync(path.join(ROOT, file), path.join(BUILD_ROOT, file))
      }
      for (const file of readdirSync(ROOT)) {
        if (/^package\.nls.*\.json$/.test(file))
          cpSync(path.join(ROOT, file), path.join(BUILD_ROOT, file))
      }
      symlinkSync(
        path.join(ROOT, 'node_modules'),
        path.join(BUILD_ROOT, 'node_modules'),
        'junction',
      )
      // The built-process fixture needs the real native helper on its own host.
      if (process.platform === 'darwin') {
        const native = spawnSync(BASH, ['native/darwin/build.sh'], {
          cwd: BUILD_ROOT,
          encoding: 'utf8',
          timeout: BUILD_TIMEOUT,
        })
        expect(native.status, native.stderr).toBe(0)
      } else {
        writeFileSync(
          path.join(BUILD_ROOT, 'native', 'darwin', 'muse-dictate'),
          'test-owned inert helper',
        )
      }
      for (const arch of ['x64', 'arm64']) {
        const folder = path.join(BUILD_ROOT, 'native', 'linux', arch)
        mkdirSync(folder, { recursive: true })
        // Execute only the host's Linux helper; other architectures are archive fixtures.
        if (process.platform === 'linux' && arch === process.arch) {
          const native = spawnSync(
            '/usr/bin/cc',
            [
              '-Wall',
              '-Wextra',
              '-Werror',
              '-DMUSE_CREATED_STANDALONE',
              'native/darwin/MuseSparkCreated.c',
              '-lcrypto',
              '-o',
              path.join(folder, 'muse-created'),
            ],
            { cwd: BUILD_ROOT, encoding: 'utf8', timeout: BUILD_TIMEOUT },
          )
          expect(native.status, native.stderr).toBe(0)
        } else writeFileSync(path.join(folder, 'muse-created'), 'test-owned inert helper')
      }
      const built = command(
        path.join(BUILD_ROOT, 'scripts', 'build.mjs'),
        BUILD_ROOT,
        ['--production'],
        {},
        BUILD_TIMEOUT,
      )
      expect(built.status, built.stderr).toBe(0)
      const packed = command(
        path.join(BUILD_ROOT, 'scripts', 'package-acp.mjs'),
        BUILD_ROOT,
        [],
        {
          NODE_OPTIONS: `--require ${JSON.stringify(PACKAGE_PRELOAD)}`,
          BADGE_CHECK_SKIP_NETWORK: undefined,
        },
        BUILD_TIMEOUT,
      )
      expect(packed.status, packed.stderr).toBe(0)
      const images: unknown[] = readFileSync(PACKAGE_IMAGES, 'utf8')
        .trim()
        .split('\n')
        .map((line) => {
          const image: unknown = JSON.parse(line)
          return image
        })
      expect(images).toContain(
        'https://raw.githubusercontent.com/RandyNorthrup/muse-spark-code/main/media/readme/banner.png',
      )
      expect(images).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^https:\/\/img\.shields\.io\/badge\/npm-v/),
        ]),
      )
      cpSync(path.join(BUILD_ROOT, 'dist', 'acp-package'), PACKAGE, { recursive: true })
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
  }, BUILD_TIMEOUT)

  it('E1/H4 built help names exec/scanner and package schemas are valid', async () => {
    const run = await start(['--help'], 'store').closed
    expect(run.code).toBe(0)
    expect(run.stdout).toContain('exec')
    expect(run.stdout).toContain('scan-secrets')
    for (const schema of ['exec-result-v2', 'exec-event-v2']) {
      const parsed: unknown = JSON.parse(
        readFileSync(path.join(PACKAGE, 'schemas', `${schema}.schema.json`), 'utf8'),
      )
      if (schema === 'exec-result-v2') expect(parsed).toHaveProperty('properties.v.const', 2)
      else
        expect(parsed).toMatchObject({
          anyOf: expect.arrayContaining([
            expect.objectContaining({
              properties: expect.objectContaining({ v: expect.objectContaining({ const: 2 }) }),
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
