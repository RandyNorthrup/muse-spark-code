// VSIXWEB A: the webview bundle's solid archive and its one shared root
// resolver. The real producer packs real build output into a real archive;
// the real resolver extracts it into a real temp storage folder and every
// member round-trips byte-for-byte; a second activation reuses and
// re-verifies, a stale digest is removed, a tampered stored copy is
// restored from the archive, and a damaged member, a damaged archive and a
// missing tree each refuse with the panel's sentence instead of files.
import { createHash } from 'node:crypto'
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from 'node:zlib'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  resolveWebviewBundleDir,
  webviewBundleErrorHtml,
  WebviewBundleError,
} from '../../src/host/views/webviewBundleRoot'
import { WEBVIEW_ARCHIVE_FILE, WEBVIEW_ARCHIVE_VERSION } from '../../src/shared/constants'
import { packSolidTextArchive } from '../../scripts/lib/solidTextArchive.mjs'

// Real build output, small enough to pack per run: the document the panels
// serve beside a chunk and the style they load with it.
const VICTIM = 'main.js'
const REAL_MEMBERS = [VICTIM, 'main.css', 'chunks/22BDA6UX.js']

const root = mkdtempSync(path.join(tmpdir(), 'muse-webview-bundle-'))
const extensionDir = path.join(root, 'ext')
const looseSource = path.join(root, 'loose')
const storageDir = path.join(root, 'storage')

function isRecord(value: unknown): value is Record<string, { sha256: string; text: string }> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every(
      (member: unknown) =>
        typeof member === 'object' &&
        member !== null &&
        typeof Reflect.get(member, 'sha256') === 'string' &&
        typeof Reflect.get(member, 'text') === 'string',
    )
  )
}

/** A private copy of the whole rig whose archive the test then damages. */
function damagedRig(): { extensionDir: string; storageDir: string; cleanup: () => void } {
  const copy = mkdtempSync(path.join(root, 'damaged-'))
  rmSync(copy, { recursive: true, force: true })
  cpSync(extensionDir, path.join(copy, 'ext'), { recursive: true })
  return {
    extensionDir: path.join(copy, 'ext'),
    storageDir: path.join(copy, 'storage'),
    cleanup: () => {
      rmSync(copy, { recursive: true, force: true })
    },
  }
}

beforeAll(() => {
  // Real build output the tests never alter; the packaged rig is a copy the
  // real producer packs (its loose files leave with the archive).
  const looseDir = path.join(looseSource, 'dist', 'webview')
  mkdirSync(looseDir, { recursive: true })
  for (const member of REAL_MEMBERS) {
    const target = path.join(looseDir, ...member.split('/'))
    mkdirSync(path.dirname(target), { recursive: true })
    cpSync(path.join('dist', 'webview', ...member.split('/')), target)
  }
  cpSync(path.join(looseSource, 'dist'), path.join(extensionDir, 'dist'), { recursive: true })
  mkdirSync(storageDir, { recursive: true })
  packSolidTextArchive(extensionDir, 'dist/webview', `dist/${WEBVIEW_ARCHIVE_FILE}`)
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('webview bundle resolver', () => {
  it('serves the loose tree when no archive is packed (source tree, dev build)', () => {
    const rig = damagedRig()
    try {
      rmSync(path.join(rig.extensionDir, 'dist', WEBVIEW_ARCHIVE_FILE))
      cpSync(
        path.join(looseSource, 'dist', 'webview'),
        path.join(rig.extensionDir, 'dist', 'webview'),
        {
          recursive: true,
        },
      )
      expect(
        resolveWebviewBundleDir({
          extensionPath: rig.extensionDir,
          globalStoragePath: rig.storageDir,
        }),
      ).toBe(path.join(rig.extensionDir, 'dist', 'webview'))
    } finally {
      rig.cleanup()
    }
  })

  it('extracts once per archive digest and every member round-trips byte-for-byte', () => {
    const resolved = resolveWebviewBundleDir({
      extensionPath: extensionDir,
      globalStoragePath: storageDir,
    })
    expect(path.dirname(resolved)).toBe(storageDir)
    expect(path.basename(resolved).length).toBeGreaterThan('webview-'.length)
    for (const member of REAL_MEMBERS) {
      expect(readFileSync(path.join(resolved, ...member.split('/')))).toEqual(
        readFileSync(path.join('dist', 'webview', ...member.split('/'))),
      )
    }
  })

  it('a second activation reuses the verified copy and a new digest removes the old ones', () => {
    const rig = damagedRig()
    try {
      const locations = { extensionPath: rig.extensionDir, globalStoragePath: rig.storageDir }
      const first = resolveWebviewBundleDir(locations)
      expect(resolveWebviewBundleDir(locations)).toBe(first)
      const stale = path.join(rig.storageDir, `webview-${'0'.repeat(56)}`)
      mkdirSync(stale, { recursive: true })
      writeFileSync(path.join(stale, 'junk.txt'), 'stale')
      // A new archive digest extracts again and drops every older folder.
      const rigArchive = path.join(rig.extensionDir, 'dist', WEBVIEW_ARCHIVE_FILE)
      const parsed: unknown = JSON.parse(
        brotliDecompressSync(readFileSync(rigArchive)).toString('utf8'),
      )
      const files: unknown =
        typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'files') : undefined
      if (!isRecord(files)) throw new Error('Test archive is malformed')
      files['extra.txt'] = {
        sha256: createHash('sha256').update('extra').digest('hex'),
        text: 'extra',
      }
      writeFileSync(
        rigArchive,
        brotliCompressSync(JSON.stringify({ version: WEBVIEW_ARCHIVE_VERSION, files }), {
          params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 1 },
        }),
      )
      const second = resolveWebviewBundleDir(locations)
      expect(second).not.toBe(first)
      expect(existsSync(stale)).toBe(false)
      expect(existsSync(first)).toBe(false)
      expect(readdirSync(rig.storageDir)).toEqual([path.basename(second)])
      expect(readFileSync(path.join(second, 'extra.txt'), 'utf8')).toBe('extra')
    } finally {
      rig.cleanup()
    }
  })

  it('a tampered stored copy is restored from the archive instead of served', () => {
    const resolved = resolveWebviewBundleDir({
      extensionPath: extensionDir,
      globalStoragePath: storageDir,
    })
    const stored = path.join(resolved, ...VICTIM.split('/'))
    writeFileSync(stored, 'tampered')
    const again = resolveWebviewBundleDir({
      extensionPath: extensionDir,
      globalStoragePath: storageDir,
    })
    expect(again).toBe(resolved)
    expect(readFileSync(stored)).toEqual(readFileSync(path.join('dist', 'webview', VICTIM)))
  })

  it('a damaged member refuses with the panel sentence', () => {
    const rig = damagedRig()
    try {
      const rigArchive = path.join(rig.extensionDir, 'dist', WEBVIEW_ARCHIVE_FILE)
      const parsed: unknown = JSON.parse(
        brotliDecompressSync(readFileSync(rigArchive)).toString('utf8'),
      )
      const files: unknown =
        typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'files') : undefined
      if (!isRecord(files)) throw new Error('Test archive is malformed')
      const original = files[VICTIM]?.text ?? ''
      files[VICTIM] = { sha256: files[VICTIM]?.sha256 ?? '', text: `X${original.slice(1)}` }
      writeFileSync(
        rigArchive,
        brotliCompressSync(JSON.stringify({ version: WEBVIEW_ARCHIVE_VERSION, files }), {
          params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 1 },
        }),
      )
      expect(() =>
        resolveWebviewBundleDir({
          extensionPath: rig.extensionDir,
          globalStoragePath: rig.storageDir,
        }),
      ).toThrow(WebviewBundleError)
      const html = webviewBundleErrorHtml('The panel could not be loaded.', 'en')
      expect(html).toContain('The panel could not be loaded.')
      expect(html).not.toContain('<script')
    } finally {
      rig.cleanup()
    }
  })

  it('a damaged archive refuses', () => {
    const rig = damagedRig()
    try {
      const rigArchive = path.join(rig.extensionDir, 'dist', WEBVIEW_ARCHIVE_FILE)
      const packed = readFileSync(rigArchive)
      const last = packed.at(-1)
      expect(last).toBeDefined()
      packed.writeUInt8((last ?? 0) ^ 0xff, packed.length - 1)
      writeFileSync(rigArchive, packed)
      expect(() =>
        resolveWebviewBundleDir({
          extensionPath: rig.extensionDir,
          globalStoragePath: rig.storageDir,
        }),
      ).toThrow(WebviewBundleError)
    } finally {
      rig.cleanup()
    }
  })

  it('a missing tree refuses instead of serving nothing', () => {
    const rig = damagedRig()
    try {
      rmSync(path.join(rig.extensionDir, 'dist', WEBVIEW_ARCHIVE_FILE))
      rmSync(path.join(rig.extensionDir, 'dist', 'webview'), { recursive: true, force: true })
      expect(() =>
        resolveWebviewBundleDir({
          extensionPath: rig.extensionDir,
          globalStoragePath: rig.storageDir,
        }),
      ).toThrow(WebviewBundleError)
    } finally {
      rig.cleanup()
    }
  })
})
