import { mkdtempSync } from 'node:fs'
import { lstat, open, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, expect, it, vi } from 'vitest'
import { createToolIo, readPickedFile } from '../../src/host/backend/toolIo'
import { loadToolImage } from '../../src/core/toolImages'
import {
  MAX_IMAGE_BYTES,
  MAX_TEXT_ATTACHMENT_BYTES,
  MODEL_TEXT,
  TOOL_FILE_MAX_BYTES,
} from '../../src/shared/constants'
import { canonicalPath } from '../../src/host/canonicalPath'
import { removeFolder } from './helpers/temporaryFolders'
import { pdfFixture } from './helpers/pdfFixture'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<{ open: typeof open; stat: typeof stat }>()
  return { ...actual, open: vi.fn(actual.open), stat: vi.fn(actual.stat) }
})

const root = mkdtempSync(path.join(tmpdir(), 'muse-bounded-file-'))
afterAll(() => removeFolder(root))
afterEach(() => {
  vi.mocked(open).mockClear()
  vi.mocked(stat).mockReset()
})

const io = createToolIo({
  platform: process.platform,
  listFiles: () => Promise.resolve([]),
  systemRoot: process.env['SystemRoot'],
  env: () => process.env,
  searchWorkerPath: 'unused-here',
  log: () => undefined,
  unsavedFiles: () => [],
})

async function textLength(target: string): Promise<number | undefined> {
  const text = await io.readFile(target)
  return text?.length
}

async function growAfterOpenMetadata(target: string, grown: Buffer): Promise<void> {
  await writeFile(target, Buffer.alloc(4, 0x61))
  const handle = await open(target, 'r')
  const stale = await handle.stat()
  vi.spyOn(handle, 'stat').mockImplementationOnce(async () => {
    await writeFile(target, grown)
    return stale
  })
  vi.mocked(open).mockResolvedValueOnce(handle)
}

it('refuses visual bytes when path metadata understates the opened file', async () => {
  const target = path.join(root, 'grown.pdf')
  const bytes = Buffer.from('123456789')
  await writeFile(target, bytes)
  const stale = await lstat(target)
  stale.size = 4
  vi.mocked(stat).mockResolvedValueOnce(stale)
  await expect(io.readBytes(target, 4)).rejects.toThrow('grown.pdf is 9 bytes, over the 4 allowed')
  await expect(io.readBytes(target, 9)).resolves.toEqual(bytes)
})

it('refuses text bytes when path metadata understates the opened file', async () => {
  const textTarget = path.join(root, 'grown.txt')
  await writeFile(textTarget, Buffer.alloc(TOOL_FILE_MAX_BYTES + 1, 0x61))
  const stale = await lstat(textTarget)
  stale.size = 4
  vi.mocked(stat).mockResolvedValueOnce(stale)
  await expect(textLength(textTarget)).rejects.toThrow(MODEL_TEXT.toolFileTooLarge)
})

it('bounds picked bytes when a selected file grows after handle metadata', async () => {
  const target = path.join(root, 'picked.pdf')
  await growAfterOpenMetadata(target, Buffer.alloc(9, 0x62))

  await expect(readPickedFile(target, 4)).resolves.toEqual({ bytes: undefined, isPdf: false })
  await expect(readPickedFile(target, 9)).resolves.toEqual({
    bytes: Buffer.alloc(9, 0x62),
    isPdf: false,
  })
})

it('keeps missing picked files as an undefined result', async () => {
  await expect(readPickedFile(path.join(root, 'missing.pdf'), 4)).resolves.toEqual({
    bytes: undefined,
    isPdf: false,
  })
})

it('sniffs a renamed PDF on one handle and returns its full bounded bytes from offset zero', async () => {
  const target = path.join(root, 'renamed.png')
  const small = Buffer.from(pdfFixture(1))
  const largePdf = Buffer.concat([small, Buffer.alloc(MAX_IMAGE_BYTES * 2 - small.length, 0x20)])
  await writeFile(target, largePdf)
  const read = await readPickedFile(target, MAX_IMAGE_BYTES)
  expect(read.isPdf).toBe(true)
  expect(read.bytes?.byteLength).toBe(largePdf.length)
  expect(Buffer.from(read.bytes ?? []).subarray(0, small.length)).toEqual(small)
})

it('keeps non-PDF image and text caps at the host read boundary', async () => {
  const image = path.join(root, 'large.png')
  const text = path.join(root, 'large.txt')
  await writeFile(image, Buffer.alloc(MAX_IMAGE_BYTES + 1, 0x61))
  await writeFile(text, Buffer.alloc(MAX_TEXT_ATTACHMENT_BYTES + 1, 0x62))
  await expect(readPickedFile(image, MAX_IMAGE_BYTES)).resolves.toEqual({
    bytes: undefined,
    isPdf: false,
  })
  await expect(readPickedFile(text, MAX_TEXT_ATTACHMENT_BYTES)).resolves.toEqual({
    bytes: undefined,
    isPdf: false,
  })
  await expect(readPickedFile(text, 0)).resolves.toEqual({ bytes: undefined, isPdf: false })
})

it('bounds a tool-row image that grows after its open handle reports the old size', async () => {
  const target = path.join(root, 'tool-image.png')
  await growAfterOpenMetadata(target, Buffer.alloc(MAX_IMAGE_BYTES + 1, 0x62))

  await expect(
    loadToolImage('tool-image.png', root, process.platform, {
      realPath: canonicalPath,
      fileSize: () => Promise.resolve(4),
      readBytes: io.readBytes,
    }),
  ).rejects.toThrow(`tool-image.png is ${String(MAX_IMAGE_BYTES + 1)} bytes`)
})
