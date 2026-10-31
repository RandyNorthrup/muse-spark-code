import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { brotliDecompressSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import ts from 'typescript'
import { buildProfile, requireArduinoBuild } from '../../scripts/lib/arduinoBuild.mjs'
import { stageArduinoVsix } from '../../scripts/package-arduino.mjs'
import { stageVsix } from '../../scripts/package-vsix.mjs'
import { parseSolidTextArchive } from '../../scripts/lib/solidTextArchive.mjs'
import { arduinoCompilerOptions } from '../../scripts/typecheck-arduino.mjs'
import { UI_TEXT_REGIONS } from '../../scripts/lib/uiTextRegions.mjs'

const fixture = {
  root: '',
  arduinoRoot: '',
  sourceManifest: '',
  normalFiles: [],
  staged: undefined,
}
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
// Two full VSIX stagings, each packing the runtime and legal archives.
beforeAll(async () => {
  mkdirSync('temp', { recursive: true })
  fixture.root = mkdtempSync(path.resolve('temp/m103a-package-'))
  for (const file of [
    'package.json',
    '.vscodeignore',
    'README.md',
    'CHANGELOG.md',
    'docs/marketplace-readme.md',
    'LICENSE',
    'THIRD_PARTY_NOTICES.txt',
  ]) {
    mkdirSync(path.dirname(path.join(fixture.root, file)), { recursive: true })
    cpSync(file, path.join(fixture.root, file))
  }
  cpSync('l10n', path.join(fixture.root, 'l10n'), { recursive: true })
  cpSync('vendor', path.join(fixture.root, 'vendor'), { recursive: true })
  cpSync('first-party-skills', path.join(fixture.root, 'first-party-skills'), { recursive: true })
  cpSync('native/dictation-linux', path.join(fixture.root, 'native/dictation-linux'), {
    recursive: true,
  })
  for (const file of [
    'dist/extension.js',
    'dist/uiText.js',
    'dist/validation.js',
    'dist/verifyEditor.js',
    'dist/hardwareGuard.js',
    'dist/hardwareShell.js',
    'dist/makerContracts.js',
    'native/linux/x64/muse-created',
    'native/linux/arm64/muse-created',
    'dist/webview/main.js',
    'dist/webview/chunks/maker-test.js',
  ]) {
    mkdirSync(path.dirname(path.join(fixture.root, file)), { recursive: true })
    writeFileSync(path.join(fixture.root, file), 'same product bytes')
  }
  mkdirSync(path.join(fixture.root, 'dist/legal-data'), { recursive: true })
  writeFileSync(path.join(fixture.root, 'dist/legal-data/NOTICE.md'), 'fixture notice')
  writeFileSync(path.join(fixture.root, 'dist/legal-data/member.txt'), 'fixture member')
  mkdirSync(path.join(fixture.root, 'dist/meta'), { recursive: true })
  writeFileSync(
    path.join(fixture.root, 'dist/meta/webview.json'),
    JSON.stringify({
      outputs: { 'dist/webview/main.js': {}, 'dist/webview/chunks/maker-test.js': {} },
    }),
  )
  writeFileSync(
    path.join(fixture.root, 'dist/build-profile.json'),
    JSON.stringify({ ...buildProfile(true), production: true }),
  )
  for (const page of ['modelsWebview', 'whatsNewPage', 'usageWebview', 'referencePage'])
    cpSync(
      path.join(fixture.root, 'dist/meta/webview.json'),
      path.join(fixture.root, `dist/meta/${page}.json`),
    )
  // This manifest/artifact fixture uses minimal valid regional fallback modules.
  for (const region of UI_TEXT_REGIONS)
    writeFileSync(path.join(fixture.root, region.output), 'exports.EN={};')
  fixture.sourceManifest = readFileSync(path.join(fixture.root, 'package.json'))
  fixture.normalFiles = await stageVsix(fixture.root, path.join(fixture.root, 'dist/vsix-package'))
  // A second staging of the same root lists through the first stage's
  // output; stage the Arduino variant from a clean copy instead.
  const arduinoRoot = `${fixture.root}-arduino`
  cpSync(fixture.root, arduinoRoot, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}vsix-package`),
  })
  fixture.staged = await stageArduinoVsix(arduinoRoot)
  fixture.arduinoRoot = arduinoRoot
}, 120_000)
afterAll(() => {
  rmSync(fixture.root, { recursive: true, force: true })
  rmSync(fixture.arduinoRoot, { recursive: true, force: true })
})

describe('Arduino product build', () => {
  it('uses Arduino runtime floors and preserves the normal build floors', () => {
    expect(buildProfile(true)).toEqual({
      host: 'node20.14',
      browser: 'chrome124',
      vscode: '^1.96.0',
      node: '>=20.14.0',
    })
    expect(buildProfile(false)).toEqual({ host: 'node20.18', browser: 'chrome128' })
  })
  it.each([
    { ...buildProfile(false), production: true },
    { ...buildProfile(true), production: false },
    { ...buildProfile(true), host: 'node22', production: true },
    { ...buildProfile(true), browser: 'chrome128', production: true },
  ])('refuses incompatible or development output: %j', (record) => {
    expect(() => requireArduinoBuild(record)).toThrow('Arduino production build')
  })
  it('stages every regular product file with Arduino floors and the matching type pin', () => {
    const normalFiles = fixture.normalFiles
    const { stage, files, manifest } = fixture.staged
    const source = JSON.parse(fixture.sourceManifest)
    expect(manifest).toEqual({
      ...source,
      engines: { ...source.engines, vscode: '^1.96.0', node: '>=20.14.0' },
      devDependencies: { ...source.devDependencies, '@types/vscode': '1.96.0' },
    })
    expect(files.toSorted((a, b) => a.localeCompare(b, 'en'))).toEqual(
      normalFiles.toSorted((a, b) => a.localeCompare(b, 'en')),
    )
    expect(files).not.toContain('dist/build-profile.json')
    expect(digest(readFileSync(path.join(fixture.root, 'package.json')))).toBe(
      digest(fixture.sourceManifest),
    )
    // Packed bundles ship as stubs over the code archive; the archived
    // member is the fixture's exact source.
    const codeArchive = JSON.parse(
      brotliDecompressSync(readFileSync(path.join(stage, 'dist/runtime.bundles.json.br')), {
        maxOutputLength: 64 * 1024 * 1024,
      }).toString('utf8'),
    )
    expect(codeArchive.bundles['extension.js']).toBe(
      readFileSync(path.join(fixture.root, 'dist/extension.js'), 'utf8'),
    )
    expect(readFileSync(path.join(stage, 'dist/extension.js'), 'utf8')).toContain(
      'readPackedRuntime',
    )
    // The webview tree ships as one solid archive; its members are the
    // fixture's exact bytes.
    const members = parseSolidTextArchive(
      readFileSync(path.join(stage, 'dist/webview.json.br')),
      4_000_000,
      1,
    )
    for (const member of ['main.js', 'chunks/maker-test.js']) {
      expect(members[member]?.text).toBe(
        readFileSync(path.join(fixture.root, 'dist/webview', member), 'utf8'),
      )
    }
  })
  it('checks imports against 1.96 without merging the root 1.99 ambient declaration', () => {
    const declarations = path.join(fixture.root, 'vscode-floor.d.ts')
    writeFileSync(
      declarations,
      "declare module 'vscode' { export namespace languages { export function getLanguages(): Promise<string[]> } }",
    )
    const probe = path.join(fixture.root, 'floor-probe.ts')
    writeFileSync(
      probe,
      "import * as vscode from 'vscode';\nvscode.languages.registerDocumentPasteEditProvider;\n",
    )
    const options = arduinoCompilerOptions(
      {
        noEmit: true,
        skipLibCheck: true,
        types: ['node', 'vscode'],
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
      },
      declarations,
    )
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([probe], options))
    expect(
      diagnostics.some(
        (item) =>
          item.code === 2339 &&
          ts
            .flattenDiagnosticMessageText(item.messageText, '\n')
            .includes('registerDocumentPasteEditProvider'),
      ),
    ).toBe(true)
  })
})
