// Exporting and importing a conversation in the runtime panel (M104 lane B):
// the editor's own dialogs over a real connection, and a real file picked by
// the person. The preview of a portable export is a file the editor opens
// before the person decides, and it is gone once they have.
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createRuntimeTransfer } from '../../src/runtime/features/transfer'
import { stderrLogger } from '../../src/runtime/stderrLog'
import { UI_TEXT } from '../../src/shared/constants'
import { connectedWire } from './helpers/panelWire'
import { fileRoots } from './helpers/tempDirs'

const roots = fileRoots()

async function transferring() {
  const folder = await roots.fresh('muse-transfer-')
  const { connection, editor } = await connectedWire(['lifecycle', 'ui', 'editor'])
  const transfer = createRuntimeTransfer({
    host: connection,
    workspaceRoot: path.join(folder, 'workspace'),
    dataFolder: path.join(folder, 'data'),
    signal: new AbortController().signal,
    log: stderrLogger(() => undefined, 'warn'),
  })
  return { transfer, editor, folder }
}

describe('exporting a conversation', () => {
  it('hands the editor the text to save, and writes nothing when the person closes the dialog', async () => {
    const { transfer, editor } = await transferring()
    const saved: { title: string; suggestedName: string; text: string }[] = []
    let isSaved = false
    editor.serve('ui/saveText', (params) => {
      saved.push(params as (typeof saved)[number])
      return isSaved
    })
    await transfer.exports.saveMarkdown('talk.md', '# talk')
    isSaved = true
    await transfer.exports.saveJson('talk.json', '{"ok":true}')
    expect(saved.map((item) => [item.suggestedName, item.text])).toEqual([
      ['talk.md', '# talk'],
      ['talk.json', '{"ok":true}'],
    ])
  })

  it('opens the redacted file in the editor before asking, and removes it after', async () => {
    const { transfer, editor } = await transferring()
    const seen: { uri: string; text: string }[] = []
    let choice: string | null = 'full'
    const asked: { title: string; message: string; choices: { id: string; title: string }[] }[] = []
    editor.serve('editor/open', (params) => {
      const { uri } = params as { uri: string }
      seen.push({ uri, text: existsSync(fileURLToPath(uri)) ? 'present' : 'missing' })
      return null
    })
    editor.serve('ui/confirm', (params) => {
      asked.push(params as (typeof asked)[number])
      return choice
    })
    const preview = { fileName: 'session.json', content: '{"redacted":true}', detail: '2 messages' }
    expect(await transfer.exports.previewExport(preview)).toBe('full')
    choice = 'redacted'
    expect(await transfer.exports.previewExport(preview)).toBe('redacted')
    choice = null
    expect(await transfer.exports.previewExport(preview)).toBe('dismissed')
    expect(seen.map((item) => item.text)).toEqual(['present', 'present', 'present'])
    expect(asked[0]).toEqual({
      title: UI_TEXT.exportPreviewTitle,
      message: '2 messages',
      choices: [
        { id: 'redacted', title: UI_TEXT.exportPreviewRedacted },
        { id: 'full', title: UI_TEXT.exportPreviewFull },
      ],
    })
    // The file the editor was shown held the redacted text, and is gone now.
    for (const item of seen) expect(existsSync(fileURLToPath(item.uri))).toBe(false)
  })
})

describe('importing a conversation', () => {
  it('reads the file the person picked, whole, and says what is wrong with one it cannot read', async () => {
    const { transfer, editor, folder } = await transferring()
    const good = path.join(folder, 'good.json')
    await writeFile(good, '{"version":1}\n')
    const bad = path.join(folder, 'bad.json')
    await writeFile(bad, Buffer.from([0xff, 0xfe, 0xfd]))
    let picked: string | null = pathToFileURL(good).href
    editor.serve('ui/openFile', () => picked)
    expect(await transfer.transferFiles.pickTransferFile(UI_TEXT.exportPreviewTitle)).toEqual({
      kind: 'read',
      content: await readFile(good, 'utf8'),
    })
    picked = pathToFileURL(bad).href
    await expect(transfer.transferFiles.pickTransferFile('t')).rejects.toThrow(
      UI_TEXT.textFileInvalid,
    )
    picked = 'https://example.invalid/export.json'
    await expect(transfer.transferFiles.pickTransferFile('t')).rejects.toThrow(
      UI_TEXT.transferLocalFileOnly,
    )
    picked = null
    expect(await transfer.transferFiles.pickTransferFile('t')).toEqual({ kind: 'dismissed' })
  })

  it('imports only on an explicit yes', async () => {
    const { transfer, editor } = await transferring()
    let answer: number | null = 1
    editor.serve('ui/confirm', () => answer)
    expect(await transfer.transferFiles.confirmImport('Import?', 'details')).toBe(true)
    answer = null
    expect(await transfer.transferFiles.confirmImport('Import?', 'details')).toBe(false)
  })
})
