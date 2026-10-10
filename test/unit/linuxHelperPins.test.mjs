import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hashHelperFile, writePinsModule } from '../../scripts/build-linux-helper-pins.mjs'
import {
  checkAssets,
  checkBundle,
  checkShape,
  checkValues,
  loadPins,
} from '../../scripts/check-linux-helper-pins.mjs'

// Fakes only: deterministic fixture helpers stand in for the release
// build; the module generation and every guard run against them.
const helperFiles = {
  x64: ['muse-dictate', 'libwhisper.so.1', 'libggml.so', 'libggml-base.so', 'libggml-cpu-x64.so'],
  arm64: [
    'muse-dictate',
    'libwhisper.so.1',
    'libggml.so',
    'libggml-base.so',
    'libggml-cpu-armv8.0_1.so',
  ],
}
const fixture = { root: '', assets: '', module: '' }
function assetName(arch, file) {
  return `linux-${arch}-${file}`
}
const ARCHES = ['x64', 'arm64']
beforeAll(() => {
  fixture.root = mkdtempSync(path.join(tmpdir(), 'm9-pins-'))
  fixture.assets = path.join(fixture.root, 'assets')
  mkdirSync(fixture.assets, { recursive: true })
  for (const arch of ARCHES) {
    const directory = path.join(fixture.root, arch)
    mkdirSync(directory, { recursive: true })
    const wanted = helperFiles[arch]
    for (const file of wanted) {
      const content = `fake ${arch} ${file}`
      writeFileSync(path.join(directory, file), content)
      writeFileSync(path.join(fixture.assets, assetName(arch, file)), content)
    }
  }
  fixture.module = readFileSync(path.join('src', 'shared', 'linuxHelperPins.ts'), 'utf8')
})
afterAll(() => rmSync(fixture.root, { recursive: true, force: true }))

function measured() {
  const result = {}
  for (const arch of ARCHES) {
    result[arch] = {}
    const wanted = helperFiles[arch]
    for (const file of wanted) {
      result[arch][file] = hashHelperFile(path.join(fixture.root, arch, file))
    }
  }
  return result
}

describe('Linux helper release pins', () => {
  it('regenerates only bytes and digests, keeping assets, order and flags', async () => {
    const rewritten = writePinsModule(fixture.module, measured())
    expect(rewritten).not.toBe(fixture.module)
    expect(rewritten).toContain(`linux-x64-muse-dictate', 'muse-dictate', `)
    // Idempotent: regenerating from the same bytes changes nothing further.
    expect(writePinsModule(rewritten, measured())).toBe(rewritten)
    const compiled = await build({
      stdin: { contents: rewritten, resolveDir: process.cwd(), loader: 'ts' },
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
    })
    const pins = await import(
      `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
    )
    expect(pins.hasLinuxHelperPins(pins.LINUX_HELPER_PINS.x64)).toBe(true)
    expect(pins.hasLinuxHelperPins(pins.LINUX_HELPER_PINS.arm64)).toBe(true)
    expect(pins.linuxHelperBytes(pins.LINUX_HELPER_PINS.x64)).toBeGreaterThan(0)
  })
  it('refuses an empty helper file and a module missing an architecture', () => {
    const empty = path.join(fixture.root, 'x64', 'muse-dictate')
    const original = readFileSync(empty)
    try {
      writeFileSync(empty, '')
      expect(() => hashHelperFile(empty)).toThrow('missing or empty')
      expect(() => writePinsModule(fixture.module, measured())).toThrow()
    } finally {
      writeFileSync(empty, original)
    }
    expect(() => writePinsModule(fixture.module, { x64: measured().x64 })).toThrow(
      'No measured helper for committed pin linux-arm64-muse-dictate',
    )
  })
  it('accepts the committed shape but rejects unset values and missing assets', async () => {
    const pins = await loadPins()
    expect(checkShape(pins)).toEqual([])
    // Committed pins are unset: values and assets both refuse.
    expect(checkValues(pins).length).toBeGreaterThan(0)
    expect(checkAssets(pins, fixture.assets).length).toBeGreaterThan(0)
  })
  it('accepts regenerated pins against the fixture assets and refuses tampering', async () => {
    const rewritten = writePinsModule(fixture.module, measured())
    const assets = path.join(fixture.root, 'assets')
    // Parse the regenerated digests without executing the module: every
    // filePin line carries asset, file, bytes, sha256 and the flag.
    const entries = rewritten
      .matchAll(/filePin\('([^']+)', '([^']+)', (\d+), '([0-9a-f]*)', (true|false)\)/g)
      .map((match) => ({
        asset: match[1],
        file: match[2],
        bytes: Number(match[3]),
        sha256: match[4],
        isExecutable: match[5] === 'true',
      }))
      .toArray()
    expect(entries).toHaveLength(10)
    const pins = {
      LINUX_HELPER_PINS: {
        x64: entries.filter((entry) => entry.asset.includes('-x64-')),
        arm64: entries.filter((entry) => entry.asset.includes('-arm64-')),
      },
      linuxHelperUrl: (pin) =>
        `https://github.com/RandyNorthrup/muse-spark-code/releases/latest/download/${pin.asset}`,
    }
    expect(checkShape(pins)).toEqual([])
    expect(checkValues(pins)).toEqual([])
    expect(checkAssets(pins, assets)).toEqual([])
    const bundle = entries.map((entry) => entry.sha256).join('\n')
    expect(checkBundle(pins, bundle)).toEqual([])
    // A swapped asset fails; a bundle without the digests fails too.
    const swapped = entries[0].asset
    const original = readFileSync(path.join(assets, swapped))
    try {
      writeFileSync(path.join(assets, swapped), createHash('sha256').update('x').digest())
      expect(checkAssets(pins, assets).length).toBeGreaterThan(0)
    } finally {
      writeFileSync(path.join(assets, swapped), original)
    }
    expect(checkBundle(pins, 'no digests here').length).toBeGreaterThan(0)
    expect(checkAssets(pins, path.join(fixture.root, 'missing'))).toContainEqual(
      expect.stringContaining('missing'),
    )
  })
})
