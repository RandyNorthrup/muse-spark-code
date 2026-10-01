// The import and share-file dialogs (M84, PLAN.md D49): the picker's title,
// the size cap before and after the read, strict UTF-8, and the
// confirmation.

import { mkdtempSync, realpathSync } from 'node:fs'
import { open, readFile, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type * as vscode from 'vscode'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Uri, window, workspace } from 'vscode'
import { createSessionTransferFiles } from '../../src/host/conversation/transferDialogs'
import { SESSION_EXPORT_MAX_BYTES, UI_TEXT } from '../../src/shared/constants'
import { inform } from './helpers/vscodeViews'
import { removeFolder } from './helpers/temporaryFolders'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<{ open: typeof open }>()
  return { ...actual, open: vi.fn(actual.open) }
})

const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-session-transfer-')))
afterAll(() => removeFolder(root))

/** A URI the import dialog refuses: only local files are read (the mock's `parse` keeps `file`). */
const REMOTE_URI: vscode.Uri = {
  scheme: 'vscode-remote',
  authority: 'host',
  path: '/share.json',
  query: '',
  fragment: '',
  fsPath: '/share.json',
  with: () => REMOTE_URI,
  toString: () => 'vscode-remote://host/share.json',
  toJSON: () => ({}),
}

async function pick(name: string, bytes: Uint8Array): Promise<string> {
  const target = path.join(root, name)
  await writeFile(target, bytes)
  vi.mocked(window.showOpenDialog).mockResolvedValueOnce([Uri.file(target)])
  return target
}

beforeEach(() => {
  vi.mocked(window.showOpenDialog).mockReset()
  vi.mocked(workspace.fs.stat).mockReset()
  vi.mocked(workspace.fs.readFile).mockReset()
  vi.mocked(window.showInformationMessage).mockReset()
  vi.mocked(open).mockClear()
})

describe('createSessionTransferFiles', () => {
  it('picks one JSON file under the title it is given, and reads it as UTF-8 without its BOM', async () => {
    const original = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"a":1}')])
    const target = await pick('bom.json', original)
    const picked = await createSessionTransferFiles().pickTransferFile('Import session')
    expect(picked).toEqual({ kind: 'read', content: '{"a":1}' })
    expect(await readFile(target)).toEqual(Buffer.from(original))
    expect(workspace.fs.readFile).not.toHaveBeenCalled()
    expect(vi.mocked(window.showOpenDialog).mock.calls[0]?.[0]).toEqual({
      title: 'Import session',
      filters: { JSON: ['json'] },
      canSelectMany: false,
    })
  })

  it('reads nothing when dismissed and refuses an oversized real file', async () => {
    const files = createSessionTransferFiles()
    vi.mocked(window.showOpenDialog).mockResolvedValueOnce(undefined)
    expect(await files.pickTransferFile('t')).toEqual({ kind: 'dismissed' })
    vi.mocked(window.showOpenDialog).mockResolvedValueOnce([])
    expect(await files.pickTransferFile('t')).toEqual({ kind: 'dismissed' })
    const target = await pick('oversized.json', Buffer.alloc(SESSION_EXPORT_MAX_BYTES + 1, 0x61))
    const overCap = await files.pickTransferFile('t')
    expect(overCap.kind).toBe('tooLarge')
    expect(workspace.fs.readFile).not.toHaveBeenCalled()
    const kept = await readFile(target)
    expect(kept.byteLength).toBe(SESSION_EXPORT_MAX_BYTES + 1)
  })

  it('bounds growth after the open handle reports its old size', async () => {
    const target = await pick('growing.json', Buffer.from('{}'))
    const handle = await open(target, 'r')
    const original = await handle.stat()
    const held = Promise.withResolvers<undefined>()
    const sampled = Promise.withResolvers<undefined>()
    vi.spyOn(handle, 'stat')
      .mockResolvedValueOnce(original)
      .mockImplementationOnce(async () => {
        sampled.resolve(undefined)
        await held.promise
        return original
      })
    vi.mocked(open).mockResolvedValueOnce(handle)
    const reading = createSessionTransferFiles().pickTransferFile('t')
    try {
      await sampled.promise
      await writeFile(target, Buffer.alloc(SESSION_EXPORT_MAX_BYTES + 1, 0x62))
      held.resolve(undefined)
      const outcome = await reading
      expect(outcome.kind).toBe('tooLarge')
      expect(workspace.fs.readFile).not.toHaveBeenCalled()
      const grown = await readFile(target)
      expect(grown.byteLength).toBe(SESSION_EXPORT_MAX_BYTES + 1)
    } finally {
      held.resolve(undefined)
      await reading
      await handle.close()
    }
  })

  it('refuses replacement of a picked path after opening and preserves both files', async () => {
    const original = Buffer.from('{"original":true}')
    const replacement = Buffer.from('{"replacement":true}')
    const target = await pick('replaced.json', original)
    const saved = `${target}.saved`
    const handle = await open(target, 'r')
    const identity = await handle.stat()
    const held = Promise.withResolvers<undefined>()
    const sampled = Promise.withResolvers<undefined>()
    vi.spyOn(handle, 'stat').mockImplementationOnce(async () => {
      sampled.resolve(undefined)
      await held.promise
      return identity
    })
    vi.mocked(open).mockResolvedValueOnce(handle)
    const reading = createSessionTransferFiles().pickTransferFile('t')
    try {
      await sampled.promise
      await rename(target, saved)
      await writeFile(target, replacement)
      held.resolve(undefined)
      await expect(reading).rejects.toThrow()
      const kept = await readFile(saved)
      expect(kept).toEqual(original)
      const current = await readFile(target)
      expect(current).toEqual(replacement)
      expect(workspace.fs.readFile).not.toHaveBeenCalled()
    } finally {
      held.resolve(undefined)
      try {
        await reading
      } catch {
        // The replacement is refused; the reads above prove both files survived.
      }
      await handle.close()
    }
  })

  it('says a picked file that is gone before it is read is missing, not too large', async () => {
    // Moved or deleted (a sync client) between the dialog and the read.
    vi.mocked(window.showOpenDialog).mockResolvedValueOnce([Uri.file(path.join(root, 'gone.json'))])
    await expect(createSessionTransferFiles().pickTransferFile('t')).rejects.toThrow(
      new Error(UI_TEXT.transferFileMissing),
    )
    expect(workspace.fs.readFile).not.toHaveBeenCalled()
  })

  it('keeps the JSON cap for a picked file with a PDF header', async () => {
    await pick(
      'pdf-shaped.json',
      Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(SESSION_EXPORT_MAX_BYTES + 1, 0x20)]),
    )
    const picked = await createSessionTransferFiles().pickTransferFile('t')
    expect(picked.kind).toBe('tooLarge')
    expect(workspace.fs.readFile).not.toHaveBeenCalled()
  })

  it('explicitly refuses a provider without a bounded local descriptor', async () => {
    vi.mocked(window.showOpenDialog).mockResolvedValueOnce([REMOTE_URI])
    await expect(createSessionTransferFiles().pickTransferFile('t')).rejects.toThrow(
      UI_TEXT.transferLocalFileOnly,
    )
    expect(open).not.toHaveBeenCalled()
    expect(workspace.fs.readFile).not.toHaveBeenCalled()
  })

  it('refuses bytes that are not UTF-8 with the translated text, not the decoder’s', async () => {
    await pick('invalid-utf8.json', new Uint8Array([0xc3, 0x28]))
    await expect(createSessionTransferFiles().pickTransferFile('t')).rejects.toThrow(
      new Error(UI_TEXT.textFileInvalid),
    )
  })

  it('confirms an import only on its own button', async () => {
    const files = createSessionTransferFiles()
    vi.mocked(inform).mockResolvedValueOnce(UI_TEXT.importConfirmAction)
    expect(await files.confirmImport('Import session', 'detail')).toBe(true)
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      'Import session',
      { modal: true, detail: 'detail' },
      UI_TEXT.importConfirmAction,
    )
    vi.mocked(inform).mockResolvedValueOnce(undefined)
    expect(await files.confirmImport('Import session', 'detail')).toBe(false)
  })
})
