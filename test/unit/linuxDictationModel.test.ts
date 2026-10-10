import { createHash } from 'node:crypto'
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LinuxDictationModel } from '../../src/core/voice/linuxModel'
import { LINUX_DICTATION, UI_TEXT } from '../../src/shared/constants'

const content = Buffer.from('offline model bytes')
const pin = {
  bytes: content.length,
  sha256: createHash('sha256').update(content).digest('hex'),
  url: 'https://models.example/model.bin',
}
const state = {
  directory: '',
  consent: vi.fn(() => Promise.resolve(true)),
  fetcher: vi.fn<typeof fetch>(() => Promise.resolve(new Response(content))),
}
const make = () =>
  new LinuxDictationModel({
    directory: state.directory,
    pin,
    consent: state.consent,
    fetch: state.fetcher,
  })
const signal = () => new AbortController().signal
const partial = () => path.join(state.directory, LINUX_DICTATION.partialFile)
function remainingBytes(): Response {
  return new Response(content.subarray(5), {
    status: 206,
    headers: { 'Content-Range': `bytes 5-${String(content.length - 1)}/${String(content.length)}` },
  })
}

beforeEach(async () => {
  state.directory = await mkdtemp(path.join(tmpdir(), 'm9-model-'))
  state.consent = vi.fn(() => Promise.resolve(true))
  state.fetcher = vi.fn<typeof fetch>(() => Promise.resolve(new Response(content)))
})
afterEach(async () => {
  await rm(state.directory, { recursive: true, force: true })
})

describe('Linux offline model acquisition', () => {
  it('asks before any request, publishes only pinned bytes and reuses them without network', async () => {
    const order: string[] = []
    state.consent.mockImplementation(() => {
      order.push('consent')
      return Promise.resolve(true)
    })
    state.fetcher.mockImplementation(() => {
      order.push('network')
      return Promise.resolve(new Response(content))
    })
    const model = make()
    expect(await model.ensure(signal())).toBe(model.modelPath)
    expect(order).toEqual(['consent', 'network'])
    expect(state.fetcher.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'omit',
      redirect: 'manual',
      headers: { 'Accept-Encoding': 'identity' },
    })
    expect(await readFile(model.modelPath)).toEqual(content)
    expect(await model.ensure(signal())).toBe(model.modelPath)
    expect(order).toEqual(['consent', 'network'])
    const info = await lstat(model.modelPath)
    if (process.platform !== 'win32') expect(info.mode & 0o777).toBe(0o600)
  })
  it('refusal and an already aborted call cannot make a network request', async () => {
    state.consent.mockResolvedValue(false)
    expect(await make().ensure(signal())).toBeUndefined()
    const stop = new AbortController()
    stop.abort()
    await expect(make().ensure(stop.signal)).rejects.toThrow()
    expect(state.fetcher).not.toHaveBeenCalled()
  })
  it('refuses a same-size hash mismatch and deletes corrupt partial bytes', async () => {
    state.fetcher.mockResolvedValue(new Response(Buffer.alloc(content.length)))
    await expect(make().ensure(signal())).rejects.toThrow(UI_TEXT.linuxDictationIntegrity)
    expect(await readdir(state.directory)).toEqual([])
  })
  it('never reuses a corrupted published model', async () => {
    await writeFile(make().modelPath, Buffer.alloc(content.length))
    state.consent.mockResolvedValue(false)
    expect(await make().ensure(signal())).toBeUndefined()
    await expect(readFile(make().modelPath)).rejects.toThrow()
    expect(state.fetcher).not.toHaveBeenCalled()
  })
  it('resumes an interrupted transfer with a verified Content-Range', async () => {
    await writeFile(partial(), content.subarray(0, 5))
    state.fetcher.mockResolvedValue(remainingBytes())
    expect(await make().ensure(signal())).toBe(make().modelPath)
    expect(state.fetcher.mock.calls[0]?.[1]?.headers).toEqual({
      'Accept-Encoding': 'identity',
      Range: 'bytes=5-',
    })
    expect(await readFile(make().modelPath)).toEqual(content)
  })
  it('restarts safely when a server ignores Range instead of appending duplicate bytes', async () => {
    await writeFile(partial(), content.subarray(0, 5))
    expect(await make().ensure(signal())).toBe(make().modelPath)
    expect(await readFile(make().modelPath)).toEqual(content)
  })
  it('refuses a malformed range, oversized body and truncated response', async () => {
    await writeFile(partial(), content.subarray(0, 5))
    state.fetcher.mockResolvedValue(
      new Response(content.subarray(5), {
        status: 206,
        headers: { 'Content-Range': 'bytes 0-1/2' },
      }),
    )
    await expect(make().ensure(signal())).rejects.toThrow(UI_TEXT.linuxDictationDownloadFailed)
    state.fetcher.mockResolvedValue(
      new Response(content, { headers: { 'Content-Length': String(content.length + 1) } }),
    )
    await expect(make().ensure(signal())).rejects.toThrow(UI_TEXT.linuxDictationIntegrity)
    state.fetcher.mockResolvedValue(new Response(Buffer.concat([content, Buffer.from('extra')])))
    await expect(make().ensure(signal())).rejects.toThrow(UI_TEXT.linuxDictationIntegrity)
    state.fetcher.mockResolvedValue(new Response(content.subarray(0, 5)))
    await expect(make().ensure(signal())).rejects.toThrow(UI_TEXT.linuxDictationDownloadFailed)
    await expect(readFile(make().modelPath)).rejects.toThrow()
  })
  it('keeps interrupted bytes for retry and releases ownership', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(content.subarray(0, 5))
        controller.close()
      },
    })
    state.fetcher.mockResolvedValue(new Response(body))
    await expect(make().ensure(signal())).rejects.toThrow(UI_TEXT.linuxDictationDownloadFailed)
    expect(await readFile(partial())).toEqual(content.subarray(0, 5))
    state.fetcher.mockResolvedValue(remainingBytes())
    expect(await make().ensure(signal())).toBe(make().modelPath)
  })
  it('refuses a live owner without stealing its lock or making a request', async () => {
    const lock = path.join(state.directory, LINUX_DICTATION.lockDirectory)
    await mkdir(lock)
    await writeFile(path.join(lock, String(process.pid)), '')
    await expect(make().ensure(signal())).rejects.toThrow(UI_TEXT.linuxDictationBusy)
    expect(await readdir(lock)).toEqual([String(process.pid)])
    expect(state.fetcher).not.toHaveBeenCalled()
  })
  it('recovers a dead owner and removes both installed and partial weights', async () => {
    const probe = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('missing'), { code: 'ESRCH' })
    })
    try {
      const lock = path.join(state.directory, LINUX_DICTATION.lockDirectory)
      await mkdir(lock)
      await writeFile(path.join(lock, '99999999'), '')
      await make().ensure(signal())
    } finally {
      probe.mockRestore()
    }
    await writeFile(partial(), 'partial')
    await make().remove()
    expect(await readdir(state.directory)).toEqual([])
  })
  it.skipIf(process.platform === 'win32')(
    'refuses symlinked storage and partial files without modifying the target',
    async () => {
      const target = path.join(state.directory, 'target')
      await writeFile(target, 'private')
      await symlink(target, partial())
      await expect(make().ensure(signal())).rejects.toThrow()
      expect(await readFile(target, 'utf8')).toBe('private')
      const linkedRoot = path.join(state.directory, 'linked')
      await symlink(state.directory, linkedRoot)
      await expect(
        new LinuxDictationModel({
          directory: linkedRoot,
          pin,
          fetch: state.fetcher,
          consent: state.consent,
        }).ensure(signal()),
      ).rejects.toThrow(UI_TEXT.linuxDictationIntegrity)
    },
  )
  it('refuses insecure redirects and bounds redirect chains', async () => {
    state.fetcher.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: ['http:', '', 'models.example', 'model.bin'].join('/') },
      }),
    )
    await expect(make().ensure(signal())).rejects.toThrow(UI_TEXT.linuxDictationDownloadFailed)
    expect(state.fetcher).toHaveBeenCalledTimes(1)
    state.fetcher
      .mockClear()
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: '/again' } }))
    await expect(make().ensure(signal())).rejects.toThrow(UI_TEXT.linuxDictationDownloadFailed)
    expect(state.fetcher).toHaveBeenCalledTimes(LINUX_DICTATION.redirectLimit + 1)
  })
})
