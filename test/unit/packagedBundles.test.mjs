import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  assertPackagedBundles,
  requiredPackagedBundles,
} from '../../scripts/check-packaged-bundles.mjs'
const windows = (value) => value.replaceAll('/', '\\')
const fixture = { root: '' }
const siblings = ['vaultStore', 'vaultPosix', 'vaultRuntime', 'vaultBrokerBindings'].map(
  (name) => `dist/${name}.js`,
)
const files = [
  'dist/extension.js',
  'dist/vault.js',
  'dist/vaultBroker.js',
  'dist/resourceGovernor.js',
  ...siblings,
]
beforeAll(() => {
  fixture.root = mkdtempSync(path.join(os.tmpdir(), 'vpkg-'))
  mkdirSync(path.join(fixture.root, 'dist/meta'), { recursive: true })
  const graph = {
    extension: { imports: [{ path: './vault.js', external: true }], inputs: {} },
    vault: {
      imports: [
        { path: './vaultStore.js', external: true },
        { path: './vaultPosix.js', external: true },
        { path: './vaultBroker.js', external: true },
      ],
      inputs: {},
    },
    vaultBroker: { imports: [], inputs: { 'src/runtime/vault/vaultBrokerEntry.ts': {} } },
    vaultRuntime: { imports: [], inputs: { 'src/runtime/vault/vaultRuntimeEntry.ts': {} } },
  }
  for (const [name, { imports, inputs }] of Object.entries(graph))
    writeFileSync(
      path.join(fixture.root, `dist/meta/${name}.json`),
      JSON.stringify({ outputs: { [`dist/${name}.js`]: { imports } }, inputs }),
    )
})
afterAll(() => rmSync(fixture.root, { recursive: true, force: true }))
describe('production sibling packaging graph', () => {
  it('derives static siblings and lazy installed requires and names every omitted bundle', () => {
    const omitted = files.filter((file) => !siblings.includes(file))
    expect(() => assertPackagedBundles(fixture.root, omitted)).toThrow(
      `Required production bundles excluded from VSIX: ${siblings.toSorted((a, b) => a.localeCompare(b)).join(', ')}`,
    )
    expect(requiredPackagedBundles(fixture.root, files)).toEqual(
      files.toSorted((a, b) => a.localeCompare(b)),
    )
    expect(assertPackagedBundles(fixture.root, files)).toEqual(
      files.toSorted((a, b) => a.localeCompare(b)),
    )
  })
  for (const sibling of siblings)
    it(`refuses an omitted ${path.basename(sibling)} independently`, () => {
      expect(() =>
        assertPackagedBundles(
          fixture.root,
          files.filter((file) => file !== sibling),
        ),
      ).toThrow(sibling)
    })
  it('normalizes Windows output, sibling imports and packaged paths', () => {
    const file = path.join(fixture.root, 'dist/meta/vault.json')
    const original = readFileSync(file, 'utf8')
    const graph = JSON.parse(original)
    graph.outputs = Object.fromEntries(
      Object.entries(graph.outputs).map(([name, output]) => [
        windows(name),
        {
          ...output,
          imports: output.imports.map((entry) => ({ ...entry, path: windows(entry.path) })),
        },
      ]),
    )
    try {
      writeFileSync(file, JSON.stringify(graph))
      expect(() =>
        assertPackagedBundles(
          fixture.root,
          files.filter((entry) => entry !== 'dist/vaultStore.js').map((entry) => windows(entry)),
        ),
      ).toThrow('vaultStore.js')
      expect(
        assertPackagedBundles(
          fixture.root,
          files.map((entry) => windows(entry)),
        ),
      ).toEqual(files.toSorted((a, b) => a.localeCompare(b)))
    } finally {
      writeFileSync(file, original)
    }
  })
  it('ships the graph-derived vault siblings and checks before any VSIX copy', () => {
    const ignored = readFileSync('.vscodeignore', 'utf8')
    for (const file of siblings) expect(ignored.split('\n')).toContain(`!${file}`)
    const script = readFileSync('scripts/package-vsix.mjs', 'utf8')
    expect(script.indexOf('assertPackagedBundles(root, files)')).toBeGreaterThan(0)
    expect(script.indexOf('assertPackagedBundles(root, files)')).toBeLessThan(
      script.indexOf('rmSync(stage'),
    )
  })
})
