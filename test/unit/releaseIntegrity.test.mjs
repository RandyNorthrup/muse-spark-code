import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureGithubRelease } from '../../scripts/github-release.mjs'
import { checkVsixSize } from '../../scripts/check-vsix-size.mjs'
import { bundledPackages, nativePackages, shippedBom } from '../../scripts/release-sbom.mjs'

const fixture = { directory: '', artifact: '' }
beforeEach(() => {
  mkdirSync('dist', { recursive: true })
  fixture.directory = mkdtempSync(path.join('dist', 'integrity-test-'))
  fixture.artifact = path.join(fixture.directory, 'artifact.vsix')
  writeFileSync(fixture.artifact, 'release bytes')
})
afterEach(() => rmSync(fixture.directory, { recursive: true, force: true }))

describe('GitHub Release reruns', () => {
  it('creates only after a definite not-found, with the original files', () => {
    const run = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('release not found')
      })
      .mockReturnValue('created')
    ensureGithubRelease('v0.10.1', 'notes.md', [fixture.artifact], run)
    expect(run).toHaveBeenLastCalledWith([
      'release',
      'create',
      'v0.10.1',
      fixture.artifact,
      '--title',
      'v0.10.1',
      '--notes-file',
      'notes.md',
      '--verify-tag',
    ])
  })
  it.each(['HTTP 403', 'HTTP 503', 'bad metadata'])('never creates after %s', (message) => {
    const run = vi.fn(() => {
      throw new Error(message)
    })
    expect(() => ensureGithubRelease('v0.10.1', 'notes.md', [fixture.artifact], run)).toThrow(
      message,
    )
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('accepts identical existing assets and adds only missing ones, without clobber', () => {
    const extra = path.join(fixture.directory, 'SHA256SUMS')
    writeFileSync(extra, 'sums')
    const run = vi.fn((args) => {
      if (args[1] === 'view') return JSON.stringify({ assets: [{ name: 'artifact.vsix' }] })
      if (args[1] === 'download')
        copyFileSync(fixture.artifact, path.join(args.at(-1), 'artifact.vsix'))
      return ''
    })
    ensureGithubRelease('v0.10.1', 'notes.md', [fixture.artifact, extra], run)
    expect(run).toHaveBeenLastCalledWith(['release', 'upload', 'v0.10.1', extra])
    expect(run.mock.calls.flat(Infinity)).not.toContain('--clobber')
  })
  it('refuses differing bytes before uploading anything', () => {
    const run = vi.fn((args) => {
      if (args[1] === 'view') return JSON.stringify({ assets: [{ name: 'artifact.vsix' }] })
      writeFileSync(path.join(args.at(-1), 'artifact.vsix'), 'wrong bytes')
      return ''
    })
    expect(() =>
      ensureGithubRelease('v0.10.1', 'notes.md', [fixture.artifact, 'missing.json'], run),
    ).toThrow('differs')
    expect(run.mock.calls.some(([args]) => args[1] === 'upload')).toBe(false)
  })
  it('fails closed on malformed release metadata and empty asset lists', () => {
    expect(() =>
      ensureGithubRelease('v0.10.1', 'notes.md', [fixture.artifact], () => '{}'),
    ).toThrow()
    expect(() => ensureGithubRelease('v0.10.1', 'notes.md', [], vi.fn())).toThrow(
      'No release assets',
    )
  })
})

describe('compressed universal VSIX budget', () => {
  it('accepts exactly the measured budget', () => {
    writeFileSync(fixture.artifact, new Uint8Array(1850 * 1024))
    expect(checkVsixSize(fixture.artifact)).toBe(1850 * 1024)
  })
  it('refuses one byte over budget', () => {
    writeFileSync(fixture.artifact, new Uint8Array(1850 * 1024 + 1))
    expect(() => checkVsixSize(fixture.artifact)).toThrow('budget')
  })
  it('refuses a missing package', () => {
    expect(() => checkVsixSize(path.join(fixture.directory, 'absent.vsix'))).toThrow()
  })
})

describe('bundled extension and ACP CycloneDX inventories', () => {
  const components = [
    { name: 'zod', version: '4.6.5', 'bom-ref': 'zod' },
    { group: '@napi-rs', name: 'keyring', version: '2.1.0', 'bom-ref': 'keyring' },
    { name: 'eslint', version: '10.11.0', 'bom-ref': 'lint' },
  ]
  const bom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    metadata: { component: { name: 'muse-spark-code', version: '0.10.1', 'bom-ref': 'root' } },
    components,
    dependencies: [
      { ref: 'root', dependsOn: ['zod', 'lint'] },
      { ref: 'zod', dependsOn: ['lint'] },
      { ref: 'lint', dependsOn: [] },
    ],
  }
  it('keeps shipped devDeps, excludes tools, prunes omitted references and gives ACP its identity', () => {
    const acp = shippedBom(
      bom,
      new Set(['zod@4.6.5', '@napi-rs/keyring@2.1.0']),
      'muse-spark-code-acp',
    )
    expect(acp.components).toEqual(components.slice(0, 2))
    expect(acp.dependencies).toEqual([
      { ref: 'pkg:npm/muse-spark-code-acp@0.10.1', dependsOn: ['keyring', 'zod'] },
      { ref: 'zod', dependsOn: [] },
    ])
    expect(acp.metadata.component.purl).toBe('pkg:npm/muse-spark-code-acp@0.10.1')
    expect(() => shippedBom(bom, new Set(['missing@1.0.0']), 'extension')).toThrow('omitted')
  })
  it('uses output contributions, including scoped/nested packages, never zero-byte inputs', () => {
    const read = vi.fn((file) =>
      file === 'meta.json'
        ? JSON.stringify({
            outputs: {
              bundle: {
                inputs: {
                  'node_modules/zod/index.js': { bytesInOutput: 10 },
                  'node_modules/x/node_modules/@scope/pkg/a.js': { bytesInOutput: 1 },
                  'node_modules/eslint/a.js': { bytesInOutput: 0 },
                  'src/a.ts': { bytesInOutput: 10 },
                },
              },
            },
          })
        : JSON.stringify(
            file.includes('@scope')
              ? { name: '@scope/pkg', version: '1.0.0' }
              : { name: 'zod', version: '4.6.5' },
          ),
    )
    expect([...bundledPackages(['meta.json'], read)]).toEqual(['zod@4.6.5', '@scope/pkg@1.0.0'])
    expect(read.mock.calls.some(([file]) => file.includes('eslint'))).toBe(false)
  })
  it('includes every optional native platform and nested runtime dependency from the lock', () => {
    const packages = {
      'node_modules/@napi-rs/keyring': {
        version: '2.1.0',
        optionalDependencies: {
          '@napi-rs/keyring-win32-x64-msvc': '2.1.0',
          '@napi-rs/keyring-linux-x64-gnu': '2.1.0',
        },
      },
      'node_modules/@napi-rs/keyring-win32-x64-msvc': { version: '2.1.0' },
      'node_modules/@napi-rs/keyring-linux-x64-gnu': {
        version: '2.1.0',
        dependencies: { leaf: '1.0.0' },
      },
      'node_modules/@napi-rs/keyring-linux-x64-gnu/node_modules/leaf': { version: '1.0.0' },
    }
    expect([...nativePackages({ packages })].toSorted((a, b) => a.localeCompare(b, 'en'))).toEqual(
      [
        '@napi-rs/keyring@2.1.0',
        '@napi-rs/keyring-linux-x64-gnu@2.1.0',
        '@napi-rs/keyring-win32-x64-msvc@2.1.0',
        'leaf@1.0.0',
      ].toSorted((a, b) => a.localeCompare(b, 'en')),
    )
    expect(() => nativePackages({ packages: {} })).toThrow('Missing locked')
  })
})
