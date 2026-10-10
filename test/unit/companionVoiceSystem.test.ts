import { readFile, stat, mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { transcribeCompanionSystem } from '../../src/runtime/companion/voiceSystem'
import { companionWav } from '../../src/shared/companionWav'
import type { HelperInvocation } from '../../src/core/voice/dictation'
import { COMPANION_VOICE_REQUEST_MS } from '../../src/shared/constants'

const roots: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function setup(platform: NodeJS.Platform = 'win32') {
  const root = await mkdtemp(path.join(tmpdir(), 'voice-system-'))
  roots.push(root)
  const stdout = new PassThrough()
  let hasExited = false
  const child = {
    stdout,
    stderr: new PassThrough(),
    kill: vi.fn(),
    send: vi.fn<(line: string) => void>(),
    onExit: vi.fn<(listener: (description: string) => void) => void>(),
  }
  child.kill.mockImplementation(() => {
    if (hasExited) return
    hasExited = true
    child.onExit.mock.calls[0]?.[0]('exit')
  })
  const invocation = { command: 'test-helper', args: [] }
  const spawn = vi.fn((_input: HelperInvocation) => {
    queueMicrotask(() => {
      stdout.write('{"type":"ready","language":"en"}\n')
    })
    return child
  })
  const audio = companionWav(new Int16Array(16_000))
  return { root, child, spawn, audio, deps: { temporaryRoot: root, invocation, platform, spawn } }
}

describe('free companion OS recognition lifecycle', () => {
  it.each(['win32', 'darwin'] as const)(
    'uses %s file mode without a host microphone and removes private audio',
    async (platform) => {
      const s = await setup(platform)
      s.child.send.mockImplementation(() => {
        s.child.stdout.write(
          '{"type":"text","text":"The blue llama"}\n{"type":"text","text":"counts to seven"}\n{"type":"stopped"}\n',
        )
      })
      const result = transcribeCompanionSystem(s.audio, new AbortController().signal, s.deps)
      await expect(result).resolves.toBe('The blue llama counts to seven')
      expect(s.spawn.mock.calls[0]?.[0].args[0]).toBe(
        platform === 'win32' ? '-InputWav' : '--input-wav',
      )
      expect(s.child.send).toHaveBeenCalledWith('start')
      expect(s.child.kill).toHaveBeenCalled()
      expect(await readdir(s.root)).toEqual([])
    },
  )
  it.each(['error', 'invalid frame', 'silent', 'exit', 'cancel', 'output cap'])(
    'cleans up %s recognition without an empty success',
    async (failure) => {
      const s = await setup()
      const stop = new AbortController()
      s.child.send.mockImplementation(() => {
        switch (failure) {
          case 'cancel': {
            stop.abort()
            break
          }
          case 'exit': {
            s.child.onExit.mock.calls[0]?.[0]('exit')
            break
          }
          case 'output cap': {
            s.child.stdout.write('x'.repeat(1_048_577))
            break
          }
          case 'error': {
            s.child.stdout.write('{"type":"error","reason":"private OS body"}\n')
            break
          }
          case 'silent': {
            s.child.stdout.write('{"type":"stopped"}\n')
            break
          }
          default: {
            s.child.stdout.write('invalid\n')
          }
        }
      })
      await expect(transcribeCompanionSystem(s.audio, stop.signal, s.deps)).rejects.toThrow()
      expect(await readdir(s.root)).toEqual([])
      expect(s.child.kill).toHaveBeenCalled()
    },
  )
  it('refuses Linux before writing or spawning', async () => {
    const s = await setup('linux')
    await expect(
      transcribeCompanionSystem(s.audio, new AbortController().signal, s.deps),
    ).rejects.toThrow()
    expect(s.spawn).not.toHaveBeenCalled()
    expect(await readdir(s.root)).toEqual([])
  })
  it('times out a silent helper, stops it and removes audio', async () => {
    const s = await setup()
    s.child.send.mockImplementation(() => undefined)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const running = transcribeCompanionSystem(s.audio, new AbortController().signal, s.deps)
    const refused = expect(running).rejects.toThrow()
    await vi.waitFor(() => {
      expect(s.child.send).toHaveBeenCalledWith('start')
    })
    await vi.advanceTimersByTimeAsync(COMPANION_VOICE_REQUEST_MS)
    await refused
    expect(s.child.kill).toHaveBeenCalled()
    expect(await readdir(s.root)).toEqual([])
  })
  it('writes only into an owner-only private directory and file', async () => {
    const s = await setup()
    s.child.send.mockImplementation(() => undefined)
    const stop = new AbortController()
    const running = transcribeCompanionSystem(s.audio, stop.signal, s.deps)
    await vi.waitFor(() => {
      expect(s.spawn).toHaveBeenCalledTimes(1)
    })
    const file = s.spawn.mock.calls[0]?.[0].args.at(-1)
    if (file === undefined) throw new Error('file missing')
    expect(await readFile(file)).toEqual(Buffer.from(s.audio))
    if (process.platform !== 'win32') {
      const fileStat = await stat(file)
      expect(fileStat.mode & 0o777).toBe(0o600)
      const dirStat = await stat(path.dirname(file))
      expect(dirStat.mode & 0o777).toBe(0o700)
    }
    stop.abort()
    await expect(running).rejects.toThrow()
    expect(await readdir(s.root)).toEqual([])
  })
})
