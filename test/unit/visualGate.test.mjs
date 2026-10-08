import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { deflateSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseVisualArgs } from '../../scripts/check-visual.mjs'
import {
  comparePixels,
  decodePng,
  digest,
  PIXEL_POLICY,
  verifyCapture,
  verifyCaptureBytes,
} from '../../scripts/lib/visualImages.mjs'
import {
  captureGroup,
  captureKey,
  ENVIRONMENT,
  mergeVisualResults,
  selectionDigest,
  selectVisualShard,
  validateManifest,
} from '../../scripts/lib/visualManifest.mjs'

function chunk(kind, bytes) {
  const buffer = Buffer.alloc(bytes.length + 12)
  buffer.writeUInt32BE(bytes.length)
  buffer.write(kind, 4)
  bytes.copy(buffer, 8)
  let crc = -1
  const crcBytes = buffer.subarray(4, -4)
  for (const byte of crcBytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xed_b8_83_20 : 0)
  }
  buffer.writeUInt32BE((crc ^ -1) >>> 0, buffer.length - 4)
  return buffer
}

const expectedRgba = Buffer.from([
  10, 20, 30, 255, 20, 50, 80, 255, 40, 60, 90, 255, 70, 100, 140, 255,
])
// Independent known PNG scanline vectors exercise left/above/Paeth predictors.
const scanlines = [
  [0, 10, 20, 30, 255, 20, 50, 80, 255, 0, 40, 60, 90, 255, 70, 100, 140, 255],
  [1, 10, 20, 30, 255, 10, 30, 50, 0, 1, 40, 60, 90, 255, 30, 40, 50, 0],
  [2, 10, 20, 30, 255, 20, 50, 80, 255, 2, 30, 40, 60, 0, 50, 50, 60, 0],
  [3, 10, 20, 30, 255, 15, 40, 65, 128, 3, 35, 50, 75, 128, 40, 45, 55, 0],
  [4, 10, 20, 30, 255, 10, 30, 50, 0, 4, 30, 40, 60, 0, 30, 40, 50, 0],
]
function png(filter = 0) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(2)
  header.writeUInt32BE(2, 4)
  header[8] = 8
  header[9] = 6
  const raw = Buffer.from(scanlines[filter] ?? scanlines[0])
  raw[0] = filter
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const audit = {
  scenes: ['composer'],
  components: [{ scene: 'composer', file: 'src/webview/components/Composer.tsx' }],
}
const matrix = {
  componentAuditInputs: ['src/webview/components/Composer.tsx'],
  states: ['default', 'hover'],
  themes: ['light', 'dark'],
  widths: [320, 690],
  height: 760,
}
function manifest() {
  const captures = matrix.states.flatMap((state) =>
    matrix.themes.flatMap((theme) =>
      matrix.widths.map((width) => ({
        surface: 'panel',
        scene: 'composer',
        state,
        theme,
        width,
        height: 760,
        file: `panel/composer/${state}/${theme}/${width}.png`,
        bytes: 100,
        sha256: 'a'.repeat(64),
        components: [audit.components[0].file],
        target: 'button.send-button',
        applied: true,
      })),
    ),
  )
  return {
    version: 1,
    revision: 'b'.repeat(40),
    review: 'M114 test review',
    browser: '140.0.0.0',
    rasterization: 'c'.repeat(64),
    platform: 'linux',
    archive: '/external/archive',
    totalBytes: 800,
    environment: ENVIRONMENT,
    policy: { ...PIXEL_POLICY },
    captures,
  }
}

describe('M114 bounded pixelmatch visual gate', () => {
  it('detects visible differences and limits each image to 0.01 percent or 12 pixels', () => {
    expect(PIXEL_POLICY).toEqual({
      threshold: 0.1,
      includeAA: false,
      maxChangedPixelRatio: 0.0001,
      maxChangedPixels: 12,
    })
    for (const [width, height, allowed] of [
      [2, 1, 0],
      [100, 100, 1],
      [320, 760, 12],
    ]) {
      const before = Buffer.alloc(width * height * 4, 255)
      const after = Buffer.from(before)
      expect(comparePixels(before, after, width, height)).toBe(0)
      after[0] -= 1
      expect(comparePixels(before, after, width, height)).toBe(0)
      for (let pixel = 0; pixel < allowed; pixel += 1) after[pixel * 4] = 0
      expect(comparePixels(before, after, width, height)).toBe(allowed)
      after[allowed * 4] = 0
      expect(() => comparePixels(before, after, width, height)).toThrow(
        `${allowed + 1} changed pixel`,
      )
    }
  })

  it('filters an antialiased edge while retaining a visible colour regression', () => {
    const before = Buffer.from(
      Array.from({ length: 5 }, () => [0, 0, 128, 255, 255])
        .flat()
        .flatMap((v) => [v, v, v, 255]),
    )
    const after = Buffer.from(before)
    for (let channel = 0; channel < 3; channel += 1) after[48 + channel] = 200
    expect(comparePixels(before, after, 5, 5)).toBe(0)
    after[0] = 255
    expect(() => comparePixels(before, after, 5, 5)).toThrow('changed pixel')
  })

  it('decodes Chromium PNG filters and refuses dimensions, unsupported encoding, truncation and corrupt data', () => {
    for (const filter of [0, 1, 2, 3, 4]) expect(decodePng(png(filter), 2, 2)).toEqual(expectedRgba)
    expect(() => decodePng(png(), 1, 1)).toThrow('dimensions')
    expect(() => decodePng(png(5), 2, 2)).toThrow('filter')
    expect(() => decodePng(png().subarray(0, 40), 2, 2)).toThrow('Incomplete')
    const unsupported = png()
    unsupported[25] = 0
    expect(() => decodePng(unsupported, 2, 2)).toThrow('encoding')
    expect(() => decodePng(Buffer.alloc(30), 1, 1)).toThrow('header')
  })

  it('verifies exact baseline bytes before decoding, failing valid-looking hash and size tampering', () => {
    const bytes = png()
    const capture = {
      file: 'one.png',
      width: 2,
      height: 2,
      bytes: bytes.length,
      sha256: digest(bytes),
    }
    expect(() => verifyCaptureBytes(bytes, capture)).not.toThrow()
    expect(() => verifyCaptureBytes(bytes, { ...capture, sha256: 'a'.repeat(64) })).toThrow(
      'integrity',
    )
    expect(() => verifyCaptureBytes(bytes, { ...capture, bytes: bytes.length + 1 })).toThrow(
      'integrity',
    )
    expect(verifyCapture(bytes, capture)).toEqual(expectedRgba)
    expect(() => verifyCapture(bytes, { ...capture, sha256: 'a'.repeat(64) })).toThrow('integrity')
    expect(() => verifyCapture(bytes, { ...capture, bytes: bytes.length + 1 })).toThrow('integrity')
  })

  it('requires named reviewed updates and rejects unknown or check-time update flags', () => {
    expect(parseVisualArgs([]).update).toBe(false)
    expect(parseVisualArgs(['--update', '--review=M114 integrated review']).update).toBe(true)
    expect(() => parseVisualArgs(['--update'])).toThrow('review')
    expect(() => parseVisualArgs(['--update', '--review= '])).toThrow('review')
    expect(() => parseVisualArgs(['--review=unapproved'])).toThrow('requires --update')
    expect(() => parseVisualArgs(['--bless'])).toThrow('Unknown')
  })

  it('requires complete unique scene/state/theme/width and actual component coverage, accepting Windows separators', () => {
    const value = manifest()
    value.captures[0].file = value.captures[0].file.replaceAll('/', '\\')
    expect(validateManifest(value, audit, matrix).captures).toHaveLength(8)
    const missing = manifest()
    missing.captures.pop()
    expect(() => validateManifest(missing, audit, matrix)).toThrow('Missing visual')
    const duplicate = manifest()
    duplicate.captures[1] = duplicate.captures[0]
    expect(() => validateManifest(duplicate, audit, matrix)).toThrow('Duplicate')
    const component = manifest()
    component.captures[0].components = []
    expect(() => validateManifest(component, audit, matrix)).toThrow('component coverage')
    const state = manifest()
    state.captures[4].applied = false
    expect(() => validateManifest(state, audit, matrix)).toThrow('Unapplied')
  })

  it('rejects an inventory that can certify a manifest while omitting a current renderer', () => {
    const current = {
      ...matrix,
      componentAuditInputs: [
        ...matrix.componentAuditInputs,
        'src/webview/components/OpenQuestionsChip.tsx',
      ],
    }
    expect(() => validateManifest(manifest(), audit, current)).toThrow(
      'Renderer inventory coverage',
    )
  })

  it('partitions the reviewed matrix exactly once without splitting scene states', () => {
    const value = manifest()
    const partitions = [1, 2, 3].map((index) => selectVisualShard(value, { index, count: 3 }))
    expect(
      partitions
        .flat()
        .map((capture) => captureKey(capture))
        .toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(
      value.captures.map((capture) => captureKey(capture)).toSorted((a, b) => a.localeCompare(b)),
    )
    for (const partition of partitions) {
      const groups = new Set(partition.map((capture) => captureGroup(capture)))
      for (const group of groups)
        expect(partition.filter((capture) => captureGroup(capture) === group)).toHaveLength(2)
    }
    expect(() => selectVisualShard(value, { index: 4, count: 3 })).toThrow('range')
    expect(() => selectVisualShard(value, { index: 1, count: 5 })).toThrow('range')
    expect(parseVisualArgs(['--shard=2/3']).shard).toEqual({ index: 2, count: 3 })
    for (const arg of ['--shard=0/3', '--shard=4/3', '--shard=1/0', '--shard=1.5/3'])
      expect(() => parseVisualArgs([arg])).toThrow()
    expect(() => parseVisualArgs(['--update', '--review=named', '--shard=1/3'])).toThrow(
      'full matrix',
    )
    expect(() => parseVisualArgs(['--merge-shards=temp', '--shard=1/3'])).toThrow(
      'receipt directory',
    )
    const reviewed = JSON.parse(readFileSync('test/harness/goldens/manifest.json', 'utf8'))
    const complete = [1, 2, 3, 4, 5, 6].flatMap((index) => {
      const partition = selectVisualShard(reviewed, { index, count: 6 })
      expect(partition).toHaveLength(804)
      return partition.map((capture) => captureKey(capture))
    })
    expect(new Set(complete).size).toBe(4824)
    expect(complete.toSorted((a, b) => a.localeCompare(b))).toEqual(
      reviewed.captures
        .map((capture) => captureKey(capture))
        .toSorted((a, b) => a.localeCompare(b)),
    )
  })

  it('requires every shard, exact coverage and environment, and the combined archive budget', () => {
    const value = manifest()
    const manifestHash = 'd'.repeat(64)
    const receipts = [1, 2, 3].map((index) => {
      const selected = selectVisualShard(value, { index, count: 3 })
      return {
        revision: value.revision,
        manifestSha256: manifestHash,
        candidateSha256: manifestHash,
        shard: { index, count: 3 },
        selectionSha256: selectionDigest(selected),
        checked: selected.length,
        changedPixels: 0,
        maxImageChangedPixels: 0,
        baselineBytes: 100,
        candidateBytes: 100,
        regenerated: true,
        browser: value.browser,
        rasterization: value.rasterization,
        platform: value.platform,
        policy: value.policy,
      }
    })
    expect(mergeVisualResults(receipts, value, manifestHash, manifestHash)).toMatchObject({
      checked: 8,
      shards: 3,
    })
    expect(() =>
      mergeVisualResults(receipts.slice(0, 2), value, manifestHash, manifestHash),
    ).toThrow('Missing')
    expect(() =>
      mergeVisualResults(
        [receipts[0], receipts[0], receipts[2]],
        value,
        manifestHash,
        manifestHash,
      ),
    ).toThrow('Duplicate')
    for (const mutate of [
      (receipt) => {
        receipt.checked -= 1
      },
      (receipt) => {
        receipt.selectionSha256 = 'e'.repeat(64)
      },
      (receipt) => {
        receipt.manifestSha256 = 'e'.repeat(64)
      },
      (receipt) => {
        receipt.candidateSha256 = 'e'.repeat(64)
      },
      (receipt) => {
        receipt.browser = 'different'
      },
      (receipt) => {
        receipt.policy.maxChangedPixels += 1
      },
      (receipt) => {
        receipt.baselineBytes = 512 * 1024 * 1024
      },
      (receipt) => {
        receipt.candidateBytes = 512 * 1024 * 1024
      },
    ]) {
      const changed = globalThis.structuredClone(receipts)
      mutate(changed[0])
      expect(() => mergeVisualResults(changed, value, manifestHash, manifestHash)).toThrow()
    }
  })

  it('rejects traversal, wrong dimensions, malformed metadata, relaxed pixel policy and oversized archives', () => {
    for (const mutate of [
      (value) => {
        value.captures[0].file = '../outside.png'
      },
      (value) => {
        value.captures[0].height = 1
      },
      (value) => {
        value.captures[0].sha256 = 'bad'
      },
      (value) => {
        value.captures[0].bytes = 0.5
      },
      (value) => {
        value.policy.threshold = 0.2
      },
      (value) => {
        value.policy.maxChangedPixels = 13
      },
      (value) => {
        value.policy.includeAA = true
      },
      (value) => {
        value.policy.maxChangedPixelRatio = 0.0002
      },
      (value) => {
        value.captures[0].bytes = 512 * 1024 * 1024
        value.totalBytes = value.captures.reduce((sum, row) => sum + row.bytes, 0)
      },
      (value) => {
        value.totalBytes += 1
      },
    ]) {
      const value = manifest()
      mutate(value)
      expect(() => validateManifest(value, audit, matrix)).toThrow()
    }
  })

  it('keeps the pinned ISC comparator unmodified and wires the gate into quality', () => {
    expect(digest(readFileSync('vendor/pixelmatch/index.js'))).toBe(
      '972e5a5387dde3b6d85ab77337d59ebafca988bf220145caa4b27dc742134dc5',
    )
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts
    expect(scripts['check:visual']).toBe('node scripts/check-visual.mjs')
    expect(scripts['quality:gates'].split(' ')).toContain('check:visual')
  })
  it('requires visual source replay and tokens in both CI tiers and the required aggregate', () => {
    const workflow = readFileSync('.github/workflows/build.yml', 'utf8')
    const visual = workflow.slice(workflow.indexOf('  visual-shards:'), workflow.indexOf('  unit:'))
    expect(visual).toContain('fetch-depth: 0')
    expect(visual).toContain('persist-credentials: false')
    expect(visual).toContain('validateManifest(')
    expect(visual).toContain('git fetch --no-tags origin "$revision"')
    expect(visual).toContain('git cat-file -e "$revision^{commit}"')
    expect(visual).toContain('run: npm run check:visual')
    expect(visual).toContain('shard: [1, 2, 3, 4, 5, 6]')
    expect(visual).toContain('--shard=${{ matrix.shard }}/6')
    expect(visual).toContain('needs: visual-shards')
    expect(visual).toContain('test "$SHARDS" = success')
    expect(visual).toContain('--merge-shards=temp/visual-shards')
    expect(visual).not.toContain('inputs.fast')
    // Pixel replay has required shards; the 15-minute static job cannot replay it.
    const checks = workflow.slice(
      workflow.indexOf('  checks:'),
      workflow.indexOf('  visual-shards:'),
    )
    expect(checks).toContain('check:badges check:tokens check:l10n')
    expect(checks).not.toContain('check:visual')
    const required = workflow.slice(
      workflow.indexOf('  required:'),
      workflow.indexOf('  native-build:'),
    )
    expect(required).toMatch(/checks,\s+visual,\s+unit/)
    expect(required).toContain('VISUAL: ${{ needs.visual.result }}')
    expect(required).toContain('test "$VISUAL" = success')
    const shell = required.match(/ {8}run: \|\n((?: {10}[^\n]*\n)+)/)?.[1]
    expect(shell).toBeDefined()
    const results = Object.fromEntries(
      [
        'CHECKS',
        'UNIT',
        'COVERAGE',
        'ACCESSIBILITY',
        'INTEGRATION',
        'HELPER',
        'LINUX_HELPER',
        'PACKAGES',
        'SECRETS',
        'SAST',
      ].map((job) => [job, 'success']),
    )
    const bash =
      process.platform === 'win32'
        ? path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git', 'bin', 'bash.exe')
        : 'bash'
    for (const fast of ['true', 'false'])
      for (const visual of ['success', 'failure', 'cancelled', 'skipped']) {
        const child = spawnSync(bash, ['--noprofile', '--norc', '-e', '-c', shell], {
          env: { ...results, FAST: fast, VISUAL: visual },
          encoding: 'utf8',
        })
        expect(child.error).toBeUndefined()
        expect(child.status, `${fast}/${visual}: ${child.stderr}`).toBe(
          visual === 'success' ? 0 : 1,
        )
      }
  })
})
