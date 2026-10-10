import { createHash } from 'node:crypto'
import { lstat, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LinuxDictationHelper } from '../../src/core/voice/linuxHelper'
import { LINUX_DICTATION, UI_TEXT } from '../../src/shared/constants'
import type { LinuxHelperFilePin } from '../../src/shared/linuxHelperPins'

// Fakes only: a local fixture server stands in for the release assets; no
// live calls. Every file carries distinct bytes so a swapped file is caught.
const files = {
  'muse-dictate': Buffer.from('fake helper binary'),
  'libwhisper.so.1': Buffer.from('fake whisper library'),
  'libggml.so': Buffer.from('fake ggml library'),
  'libggml-base.so': Buffer.from('fake ggml base library'),
  'libggml-cpu-x64.so': Buffer.from('fake x64 cpu backend'),
}
const pins: LinuxHelperFilePin[] = Object.entries(files).map(([file, content]) => ({
  asset: `linux-x64-${file}`,
  file,
  bytes: content.length,
  sha256: createHash('sha256').update(content).digest('hex'),
  isExecutable: file === 'muse-dictate',
}))
const state = {
  directory: '',
  consent: vi.fn(() => Promise.resolve(true)),
  fetcher: vi.fn<typeof fetch>(() => Promise.reject(new Error('no network'))),
}
function requestPath(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}
function serve(input: string | URL | Request): Response {
  const name = requestPath(input).split('/').pop()
  const entry = pins.find((pin) => pin.asset === name)
  const content = entry === undefined ? undefined : files[entry.file as keyof typeof files]
  return content === undefined ? new Response(null, { status: 404 }) : new Response(content)
}
const make = () =>
  new LinuxDictationHelper({
    directory: state.directory,
    fetch: state.fetcher,
    consent: state.consent,
    arch: 'x64',
    pins,
  })
const signal = () => new AbortController().signal

beforeEach(async () => {
  state.directory = await mkdtemp(path.join(tmpdir(), 'm9-helper-'))
  state.consent = vi.fn(() => Promise.resolve(true))
  state.fetcher = vi.fn<typeof fetch>((input) => Promise.resolve(serve(input)))
})
afterEach(async () => {
  await rm(state.directory, { recursive: true, force: true })
})

describe('Linux helper acquisition', () => {
  it('asks once, installs every file with owner-only modes and reuses them without network', async () => {
    const helper = make()
    expect(await helper.ensure(signal())).toBe(helper.helperPath)
    expect(helper.helperPath).toBe(path.join(state.directory, LINUX_DICTATION.helperBinary))
    expect(state.consent).toHaveBeenCalledTimes(1)
    expect(state.fetcher).toHaveBeenCalledTimes(pins.length)
    for (const pin of pins) {
      expect(await readFile(path.join(state.directory, pin.file))).toEqual(
        files[pin.file as keyof typeof files],
      )
    }
    if (process.platform !== 'win32') {
      const binary = await lstat(helper.helperPath)
      expect(binary.mode & 0o777).toBe(LINUX_DICTATION.helperMode)
      const library = await lstat(path.join(state.directory, 'libggml.so'))
      expect(library.mode & 0o777).toBe(LINUX_DICTATION.fileMode)
    }
    state.fetcher.mockClear()
    expect(await helper.ensure(signal())).toBe(helper.helperPath)
    expect(state.fetcher).not.toHaveBeenCalled()
    expect(state.consent).toHaveBeenCalledTimes(1)
  })
  it('refusal downloads nothing and corrupt served bytes refuse loudly', async () => {
    state.consent.mockResolvedValue(false)
    expect(await make().ensure(signal())).toBeUndefined()
    expect(await readdir(state.directory)).toEqual([])
    state.consent.mockResolvedValue(true)
    // Same size, wrong digest: the classic swapped-asset failure.
    state.fetcher.mockImplementation((input) =>
      Promise.resolve(
        requestPath(input).endsWith('linux-x64-libggml.so')
          ? new Response(Buffer.alloc(files['libggml.so'].length))
          : serve(input),
      ),
    )
    await expect(make().ensure(signal())).rejects.toThrow(UI_TEXT.linuxDictationIntegrity)
    expect(await readFile(path.join(state.directory, 'muse-dictate'))).toEqual(
      files['muse-dictate'],
    )
    await expect(readFile(path.join(state.directory, 'libggml.so'))).rejects.toThrow()
    await expect(readFile(path.join(state.directory, 'libggml.so.partial'))).rejects.toThrow()
  })
  it('refuses before any consent when the build carries no release pins', async () => {
    const helper = new LinuxDictationHelper({
      directory: state.directory,
      fetch: state.fetcher,
      consent: state.consent,
      arch: 'x64',
      pins: [],
    })
    await expect(helper.ensure(signal())).rejects.toThrow(UI_TEXT.linuxDictationDownloadFailed)
    expect(state.consent).not.toHaveBeenCalled()
    expect(state.fetcher).not.toHaveBeenCalled()
  })
  it('removes installed and partial helper files', async () => {
    const helper = make()
    await helper.ensure(signal())
    await writeFile(path.join(state.directory, 'muse-dictate.partial'), 'stale')
    await helper.remove()
    expect(await readdir(state.directory)).toEqual([])
  })
})
