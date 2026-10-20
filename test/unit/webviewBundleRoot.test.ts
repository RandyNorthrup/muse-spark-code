// VSIXWEB A: the webview bundle's solid archive and its one shared root
// resolver. The real producer packs real build output into a real archive;
// the real resolver extracts it into a real temp storage folder and every
// member round-trips byte-for-byte; a second activation reuses and
// re-verifies, a stale digest is removed, a tampered stored copy is
// restored from the archive, and a damaged member, a damaged archive and a
// missing tree each refuse with the panel's sentence instead of files.
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
  copyRig,
  damageSolidArchiveBytes,
  damageSolidArchiveMember,
  readSolidArchiveMembers,
  sha256Text,
  writeSolidArchiveMembers,
} from './helpers/solidArchive'
import { webviewBundleErrorHtml } from '../../src/host/views/webviewBundle'
import { resolveWebviewBundleDir, WebviewBundleError } from '../../src/host/views/webviewBundleRoot'
import { WEBVIEW_ARCHIVE_FILE, WEBVIEW_ARCHIVE_VERSION } from '../../src/shared/constants'
import { packSolidTextArchive } from '../../scripts/lib/solidTextArchive.mjs'

// Real build output, small enough to pack per run: the document the panels
// serve beside a chunk and the style they load with it. The chunk name is
// content-hashed, so the test reads whatever the build emitted.
const VICTIM = 'main.js'
const FIRST_CHUNK =
  readdirSync(path.join('dist', 'webview', 'chunks')).toSorted((left, right) =>
    left.localeCompare(right, 'en'),
  )[0] ?? 'missing.js'
const REAL_MEMBERS = [VICTIM, 'main.css', `chunks/${FIRST_CHUNK}`]

const root = mkdtempSync(path.join(tmpdir(), 'muse-webview-bundle-'))
const extensionDir = path.join(root, 'ext')
const looseSource = path.join(root, 'loose')
const storageDir = path.join(root, 'storage')

/** A private copy of the rig whose archive and empty storage the test then uses. */
function damagedRig(): { extensionDir: string; storageDir: string; cleanup: () => void } {
  const rig = copyRig(extensionDir)
  const storage = mkdtempSync(path.join(tmpdir(), 'muse-webview-storage-'))
  return {
    extensionDir: rig.dir,
    storageDir: storage,
    cleanup: () => {
      rig.cleanup()
      rmSync(storage, { recursive: true, force: true })
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
  mkdirSync(storageDir, { recursive: true })
  packSolidTextArchive(
    path.join(looseSource, 'dist', 'webview'),
    path.join(extensionDir, 'dist', WEBVIEW_ARCHIVE_FILE),
  )
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
      const stale = path.join(rig.storageDir, `webview-${'f'.repeat(64)}`)
      mkdirSync(stale, { recursive: true })
      writeFileSync(path.join(stale, 'junk.txt'), 'stale')
      // A new archive digest extracts again and drops every older folder.
      const rigArchive = path.join(rig.extensionDir, 'dist', WEBVIEW_ARCHIVE_FILE)
      const files = {
        ...readSolidArchiveMembers(rigArchive),
        'extra.txt': { sha256: sha256Text('extra'), text: 'extra' },
      }
      writeSolidArchiveMembers(rigArchive, files, WEBVIEW_ARCHIVE_VERSION)
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
      damageSolidArchiveMember(rigArchive, VICTIM, WEBVIEW_ARCHIVE_VERSION)
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
      damageSolidArchiveBytes(rigArchive)
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
