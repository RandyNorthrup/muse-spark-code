import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { auditRoot, digest } from './helpers/m114AuditCapture.mjs'
import { panelReceipt } from './helpers/m114PanelCapture.mjs'

const normalize = (file) => file.replaceAll('\\', '/')
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
const compareFiles = new Intl.Collator('en').compare
const themes = ['light', 'dark', 'hc-dark', 'hc-light', 'one-dark-pro', 'dracula']

describe('M114 P2 captured evidence', () => {
  it('covers every P2 component at both widths in six themes with current sources and honest axe receipts', () => {
    const audit = readJson(path.join(auditRoot, 'docs/certification/m114-audit.json'))
    const owned = audit.components.filter((row) => row.owner === 'P2')
    const scenes = [...new Set(owned.map((row) => row.scene))]
    const receipt = readJson(panelReceipt)
    expect(receipt).toMatchObject({
      kind: 'after-observation-not-golden',
      base: '28ffc2def',
      imageDirectory: 'temp/m114-p2-after',
      locale: 'en',
      timezone: 'UTC',
      deviceScaleFactor: 1,
      reducedMotion: true,
      network: 'loopback-only',
    })
    expect(receipt.browser).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
    const expected = scenes.flatMap((scene) =>
      themes.flatMap((theme) => [320, 690].map((width) => `${scene}/${theme}/${width}.png`)),
    )
    expect(receipt.captures.map((row) => normalize(row.file)).toSorted(compareFiles)).toEqual(
      expected.toSorted(compareFiles),
    )
    expect(receipt.sources.map((row) => normalize(row.file))).toEqual([
      'src/webview/styles.css',
      'src/webview/whatsNew/whatsNew.css',
      ...owned.map((row) => row.file),
    ])
    for (const row of receipt.sources)
      expect(digest(readFileSync(path.join(auditRoot, ...normalize(row.file).split('/'))))).toBe(
        row.sha256,
      )
    for (const row of receipt.captures) {
      expect(normalize(row.file)).toBe(`${row.scene}/${row.theme}/${row.width}.png`)
      expect(row.height).toBe(760)
      expect(row.sha256).toMatch(/^[\da-f]{64}$/)
      expect(Number.isSafeInteger(row.bytes)).toBe(true)
      expect(row.bytes).toBeGreaterThan(0)
      expect(row.rendered.map((r) => [normalize(r.file), r.selector])).toEqual(
        owned.filter((r) => r.scene === row.scene).map((r) => [r.file, r.captureSelector]),
      )
      for (const render of row.rendered)
        expect(Object.keys(render.computed)).toEqual([
          'color',
          'backgroundColor',
          'borderRadius',
          'boxShadow',
          'fontFamily',
          'animation',
          'transition',
          'filter',
          'backdropFilter',
        ])
      expect(row.violations).toEqual([])
      for (const finding of row.incomplete) {
        expect(finding.id).toBe('color-contrast')
        expect(finding.nodes.length).toBeGreaterThan(0)
        for (const node of finding.nodes) {
          expect(node.target.length).toBeGreaterThan(0)
          expect(node.reasons.length).toBeGreaterThan(0)
          for (const reason of node.reasons)
            expect([
              'elmPartiallyObscured',
              'elmPartiallyObscuring',
              'bgOverlap',
              'nonBmp',
            ]).toContain(reason)
        }
      }
    }
  })

  it('keeps image bytes outside git and checks PNG dimensions, length and SHA-256 when the local archive is supplied', () => {
    const localFiles = readdirSync(path.dirname(panelReceipt), { recursive: true })
    expect(localFiles.filter((file) => normalize(file).endsWith('.png'))).toEqual([])
    const directory = process.env.MUSE_M114_P2_CAPTURES_DIR
    if (directory === undefined) return
    expect(directory.length).toBeGreaterThan(0)
    const captures = readJson(panelReceipt).captures
    const actual = captures.map((capture) => {
      const bytes = readFileSync(path.join(directory, ...normalize(capture.file).split('/')))
      return {
        file: capture.file,
        signature: bytes.subarray(0, 8).toString('hex'),
        width: bytes.readUInt32BE(16),
        height: bytes.readUInt32BE(20),
        bytes: bytes.length,
        sha256: digest(bytes),
      }
    })
    expect(actual).toEqual(
      captures.map(({ file, width, height, bytes, sha256 }) => ({
        file,
        signature: '89504e470d0a1a0a',
        width,
        height,
        bytes,
        sha256,
      })),
    )
  })
})
