import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildReference,
  generateReference,
  referenceSources,
} from '../../scripts/lib/reference.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const nls = JSON.parse(readFileSync(path.join(root, 'package.nls.json'), 'utf8'))
const runtime = readFileSync(path.join(root, 'src/runtime/cliArgs.ts'), 'utf8')
const readme = readFileSync(path.join(root, 'README.md'), 'utf8')
const source = await referenceSources(root)
const build = (pkg = manifest, overrides = {}) =>
  buildReference(pkg, nls, { ...source, ...overrides }, runtime, readme)

describe('the code-derived reference gate', () => {
  it('covers both backend palettes, manifest metadata and all CLI routes', () => {
    const model = build()
    expect(model.commands).toHaveLength(manifest.contributes.commands.length)
    expect(model.settings).toHaveLength(
      Object.keys(manifest.contributes.configuration.properties).length,
    )
    expect(model.slash).toContainEqual(
      expect.objectContaining({ name: 'help', backends: ['museCode', 'modelApi'] }),
    )
    expect(model.shortcuts).toEqual(manifest.contributes.keybindings)
    expect(model.cli.map((c) => c.route)).toContain('authClear')
    expect(model.commands.find((c) => c.id === 'museSpark.signOut').canRun).toBe(false)
  })
  it('rejects a newly contributed command without a catalogue entry', () => {
    const pkg = globalThis.structuredClone(manifest)
    pkg.contributes.commands.push({ command: 'museSpark.undocumented', title: 'Undocumented' })
    expect(() => build(pkg)).toThrow('Command lacks catalogue entry: museSpark.undocumented')
  })
  it('rejects a setting without coverage or a description', () => {
    const pkg = globalThis.structuredClone(manifest)
    pkg.contributes.configuration.properties['museSpark.undocumented'] = {
      type: 'boolean',
      default: false,
    }
    expect(() => build(pkg)).toThrow('Missing description: museSpark.undocumented')
    pkg.contributes.configuration.properties['museSpark.undocumented'].description = 'Description'
    expect(() => build(pkg)).toThrow('No feature covers museSpark.undocumented')
  })
  it('rejects unknown feature links and empty descriptions', () => {
    const features = globalThis.structuredClone(source.featureCatalog())
    features[0].settings.push('museSpark.missing')
    expect(() => build(manifest, { featureCatalog: () => features })).toThrow(
      'Unknown feature setting',
    )
    features[0].commands.push('museSpark.missing')
    expect(() => build(manifest, { featureCatalog: () => features })).toThrow(
      'Unknown feature command',
    )
    expect(() =>
      build(manifest, {
        COMMAND_REFERENCE: {
          ...source.COMMAND_REFERENCE,
          openHelp: { description: { ui: 'missing' }, canRun: true },
        },
      }),
    ).toThrow('Missing description: museSpark.openHelp')
  })
  it('rejects a documentation anchor that does not exist', () => {
    const features = globalThis.structuredClone(source.featureCatalog())
    features[0].docs += '-missing'
    expect(() => build(manifest, { featureCatalog: () => features })).toThrow('Invalid docs link')
  })
  it('rejects a slash row without a description', () => {
    const slash = source.slashCommandsOf(
      source.buildPalette({
        models: [],
        effort: 'medium',
        permissionMode: 'manual',
        skills: [],
        backend: 'modelApi',
        paidFeatures: [],
        isKeyStored: true,
      }),
    )
    expect(() =>
      build(manifest, { slashCommandsOf: () => [...slash, { name: 'missing' }] }),
    ).toThrow('Missing description: missing')
  })
  it('rejects an undocumented CLI route', () => {
    expect(() =>
      buildReference(
        manifest,
        nls,
        source,
        runtime.replace(
          'export type RuntimeCommand =',
          "export type RuntimeCommand =\n | { readonly command:\n 'newRoute' }\n",
        ),
        readme,
      ),
    ).toThrow('CLI command lacks entry: newRoute')
  })
  it('checks all generated outputs byte-for-byte', async () => {
    await expect(generateReference(root, true)).resolves.toHaveProperty('features')
  })
})
