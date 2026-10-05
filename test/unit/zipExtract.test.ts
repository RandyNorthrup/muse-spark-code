// The runtime bundle's bounded ZIP reader (M81 A1, design spec v4 §4.3): the
// pinned archives' own shape extracts, private and with only the pin's
// executable entries executable; every other shape, name, size or
// disagreement is refused before anything is written, and output past an
// entry's bound stops while it is being inflated.
import { Buffer } from 'node:buffer'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type ExtractPlan,
  extractZipEntries,
  readZipEntries,
  ZipRefused,
} from '../../src/host/browser/runtime/zipExtract'
import { buildZip, type ZipFileSpec } from './helpers/zipBuilder'

const folders: string[] = []

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true })
  }
})

function folder(): string {
  const made = mkdtempSync(path.join(tmpdir(), 'm81-zip-'))
  folders.push(made)
  return made
}

const SHELL = Buffer.from('#!/bin/sh\necho headless\n')
const LIB = Buffer.alloc(4096, 7)

function good(): ZipFileSpec[] {
  return [
    { name: 'shell/chrome-headless-shell', data: SHELL, mode: 0o10_0755 },
    { name: 'shell/libEGL.so', data: LIB, mode: 0o10_0755 },
    { name: 'shell/locales/en-US.pak', data: Buffer.from('pak'), mode: 0o10_0644, method: 0 },
    { name: 'shell/deb.deps', data: Buffer.from('deps'), mode: 0o10_0600 },
  ]
}

function planFor(
  files: readonly ZipFileSpec[],
  executable = ['shell/chrome-headless-shell'],
): ExtractPlan {
  return {
    entryCount: files.length,
    extractedBytes: files.reduce((sum, file) => sum + (file.size ?? file.data.length), 0),
    executableEntries: new Set(executable),
  }
}

async function readEntries(archive: Buffer, plan: ExtractPlan) {
  const dir = folder()
  const file = path.join(dir, 'archive.part')
  writeFileSync(file, archive)
  const handle = await open(file, 'r')
  try {
    return { file, entries: await readZipEntries(handle, archive.length, plan) }
  } finally {
    await handle.close()
  }
}

async function extract(archive: Buffer, plan: ExtractPlan, signal = new AbortController().signal) {
  const { file, entries } = await readEntries(archive, plan)
  const destination = path.join(folder(), 'unpack')
  mkdirSync(destination)
  await extractZipEntries(file, entries, destination, plan, signal)
  return destination
}

describe('the runtime’s ZIP reader (M81 A1)', () => {
  it('extracts the pinned archives’ shape, every file private and only the pin’s executables executable', async () => {
    const files = good()
    const destination = await extract(buildZip(files), planFor(files))
    expect(readFileSync(path.join(destination, 'shell/chrome-headless-shell'))).toEqual(SHELL)
    expect(readFileSync(path.join(destination, 'shell/libEGL.so'))).toEqual(LIB)
    if (process.platform === 'win32') {
      return
    }
    const mode = (name: string): number => statSync(path.join(destination, name)).mode & 0o777
    expect(mode('shell/chrome-headless-shell')).toBe(0o700)
    // Executable in the archive but not in the pin: private data.
    expect(mode('shell/libEGL.so')).toBe(0o600)
    expect(mode('shell/deb.deps')).toBe(0o600)
    expect(statSync(path.join(destination, 'shell/locales')).mode & 0o777).toBe(0o700)
  })

  it('refuses archives whose shape the pin does not use', async () => {
    const files = good()
    const plan = planFor(files)
    const cases: [string, Buffer, ExtractPlan?][] = [
      ['a comment', buildZip(files, { comment: 'x' })],
      ['a ZIP64 locator', buildZip(files, { zip64Locator: true })],
      ['another disk', buildZip(files, { disk: 1 })],
      ['a different entry count', buildZip(files, { count: files.length + 1 })],
      ['bytes between entries and directory', buildZip(files, { gapBeforeDirectory: 4 })],
      ['too short', Buffer.alloc(10)],
      ['no end record', Buffer.alloc(100)],
      ['an entry count the pin does not have', buildZip(files), { ...plan, entryCount: 3 }],
      [
        'an extracted total the pin does not have',
        buildZip(files),
        { ...plan, extractedBytes: plan.extractedBytes + 1 },
      ],
    ]
    for (const [label, archive, otherPlan] of cases) {
      await expect(readEntries(archive, otherPlan ?? plan), label).rejects.toBeInstanceOf(
        ZipRefused,
      )
    }
  })

  it('refuses entries that are encrypted, deferred, ZIP64, unknown methods, links, folders or not what they say', async () => {
    const shell = { name: 'shell/chrome-headless-shell', data: SHELL, mode: 0o10_0755 }
    const cases: [string, ZipFileSpec][] = [
      ['encrypted', { ...shell, flags: 0x1 }],
      ['a data descriptor', { ...shell, flags: 0x8 }],
      ['strong encryption', { ...shell, flags: 0x40 }],
      ['an unknown method', { ...shell, method: 12 }],
      ['a stored entry whose sizes differ', { ...shell, method: 0, size: SHELL.length + 1 }],
      ['a ZIP64 extra field', { ...shell, extra: Buffer.from([0x01, 0x00, 0x00, 0x00]) }],
      ['a malformed extra field', { ...shell, extra: Buffer.from([0x55, 0x54, 0x09]) }],
      ['a symbolic link', { ...shell, mode: 0o12_0777 }],
      [
        'a folder entry',
        { ...shell, name: 'shell/', data: Buffer.alloc(0), method: 0, mode: 0o04_0755 },
      ],
      ['a DOS folder', { ...shell, mode: 0, dosAttributes: 0x10 }],
      ['a local name that differs', { ...shell, local: { name: 'shell/other-name-xxxxxx' } }],
      ['local flags that differ', { ...shell, local: { flags: 0x8_00 } }],
      ['a local CRC that differs', { ...shell, local: { crc: 1 } }],
    ]
    for (const [label, file] of cases) {
      await expect(readEntries(buildZip([file]), planFor([file])), label).rejects.toBeInstanceOf(
        ZipRefused,
      )
    }
  })

  it('refuses every unsafe or ambiguous name before anything is written', async () => {
    for (const name of [
      '/etc/passwd',
      '../outside',
      'shell/../../outside',
      'shell/./x',
      'shell//x',
      'C:/Windows/x',
      String.raw`shell\x`,
      String.raw`\\server\share\x`,
      'shell/x:stream',
      'shell/CON',
      'shell/nul.txt',
      'shell/com1',
      'shell/LPT9.log',
      'shell/trailing.',
      'shell/trailing ',
      'shell/x\u{0}y',
      'shell/caf\u{E9}',
      'shell/x*',
    ]) {
      const file = { name, data: SHELL, mode: 0o10_0644 }
      await expect(readEntries(buildZip([file]), planFor([file], [])), name).rejects.toBeInstanceOf(
        ZipRefused,
      )
    }
  })

  it('refuses names that collide when case is folded, and a file where a folder is needed', async () => {
    for (const files of [
      [
        { name: 'shell/Lib.so', data: LIB },
        { name: 'shell/lib.so', data: LIB },
      ],
      [
        { name: 'shell/x', data: LIB },
        { name: 'shell/x/y', data: LIB },
      ],
      [
        { name: 'SHELL/x', data: LIB },
        { name: 'shell/X/y', data: LIB },
      ],
    ]) {
      await expect(readEntries(buildZip(files), planFor(files, []))).rejects.toBeInstanceOf(
        ZipRefused,
      )
    }
  })

  it('refuses an entry past the 400 MiB total before allocating, and a declared size past it', async () => {
    const huge = { name: 'shell/big', data: Buffer.from('x'), size: 401 * 1024 * 1024, crc: 0 }
    await expect(readEntries(buildZip([huge]), planFor([huge], []))).rejects.toThrow('too large')
  })

  it('stops a bomb while inflating it: output past the declared size is refused, not buffered', async () => {
    const bomb = Buffer.alloc(8 * 1024 * 1024)
    const file: ZipFileSpec = {
      name: 'shell/bomb',
      data: Buffer.alloc(16),
      compressed: deflateRawSync(bomb),
      size: 16,
    }
    const plan = planFor([file], [])
    await expect(extract(buildZip([file]), plan)).rejects.toThrow('output beyond its bound')
  })

  it('refuses an entry whose length or CRC does not come out as declared', async () => {
    const short: ZipFileSpec = { name: 'shell/a', data: SHELL, size: SHELL.length + 5 }
    await expect(extract(buildZip([short]), planFor([short], []))).rejects.toThrow('length or CRC')
    const wrong: ZipFileSpec = { name: 'shell/a', data: SHELL, crc: 12_345, local: { crc: 12_345 } }
    await expect(extract(buildZip([wrong]), planFor([wrong], []))).rejects.toThrow('length or CRC')
  })

  it('never writes over a file that exists in its destination', async () => {
    const files = good()
    const archive = buildZip(files)
    const { file, entries } = await readEntries(archive, planFor(files))
    const destination = path.join(folder(), 'unpack')
    mkdirSync(path.join(destination, 'shell'), { recursive: true })
    writeFileSync(path.join(destination, 'shell/chrome-headless-shell'), 'planted')
    await expect(
      extractZipEntries(file, entries, destination, planFor(files), new AbortController().signal),
    ).rejects.toThrow()
    expect(readFileSync(path.join(destination, 'shell/chrome-headless-shell'), 'utf8')).toBe(
      'planted',
    )
  })

  it('keeps every write inside its destination even for an entry the name checks did not see', async () => {
    // The backstop under the name rules: an entry handed to extraction directly.
    const files = good()
    const { file, entries } = await readEntries(buildZip(files), planFor(files))
    const parent = folder()
    const destination = path.join(parent, 'unpack')
    mkdirSync(destination)
    for (const name of ['../escape', 'shell/../../escape']) {
      const escaping = entries.map((entry, index) => (index === 0 ? { ...entry, name } : entry))
      await expect(
        extractZipEntries(
          file,
          escaping,
          destination,
          planFor(files),
          new AbortController().signal,
        ),
        name,
      ).rejects.toBeInstanceOf(ZipRefused)
      expect(existsSync(path.join(parent, 'escape')), name).toBe(false)
    }
  })

  it('stops at once when its signal ends', async () => {
    const files = good()
    const stop = new AbortController()
    stop.abort()
    await expect(extract(buildZip(files), planFor(files), stop.signal)).rejects.toThrow()
  })

  it('extracts an empty stored file', async () => {
    const files: ZipFileSpec[] = [{ name: 'shell/empty', data: Buffer.alloc(0), method: 0 }]
    const destination = await extract(buildZip(files), planFor(files, []))
    expect(existsSync(path.join(destination, 'shell/empty'))).toBe(true)
  })
})
