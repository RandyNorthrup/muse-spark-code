import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFdWriter } from '../../src/runtime/exec/fdWriter'
import { EXEC_WRITE_RETRY_MS } from '../../src/shared/constants'

const state = vi.hoisted(() => {
  const callbacks: ((error: Error | null, written: number) => void)[] = []
  return { callbacks }
})
vi.mock('node:fs', () => ({
  writeSync: vi.fn(),
  write: (...args: unknown[]) => {
    const callback = args.at(-1)
    if (typeof callback === 'function')
      state.callbacks.push((error, written) => {
        Reflect.apply(callback, undefined, [error, written])
      })
  },
}))
afterEach(() => {
  state.callbacks.length = 0
  vi.useRealTimers()
})

describe('M80 async fd writer (A14/A22)', () => {
  it('serializes partial UTF-8 writes, counts queued bytes and resolves flush after draining', async () => {
    const onClosed = vi.fn()
    const writer = createFdWriter(1, onClosed)
    writer.write('é')
    writer.write('next')
    expect(writer.queuedBytes).toBe(6)
    expect(state.callbacks).toHaveLength(1)
    const pending = writer.flush(1000)
    state.callbacks.shift()!(null, 1)
    expect(writer.queuedBytes).toBe(5)
    state.callbacks.shift()!(null, 1)
    state.callbacks.shift()!(null, 4)
    expect(await pending).toBe(true)
    expect(writer.queuedBytes).toBe(0)
    expect(await writer.flush(0)).toBe(true)
    expect(onClosed).not.toHaveBeenCalled()
  })
  it.each(['EPIPE', 'EBADF', 'zero'])(
    'closes once on %s and settles pending flush',
    async (code) => {
      const onClosed = vi.fn()
      const writer = createFdWriter(1, onClosed)
      writer.write('data')
      const pending = writer.flush(1000)
      state.callbacks.shift()!(code === 'zero' ? null : new Error(code), code === 'zero' ? 0 : 1)
      writer.write('again')
      expect(await pending).toBe(false)
      expect(await writer.flush(0)).toBe(false)
      expect(writer.isClosed).toBe(true)
      expect(onClosed).toHaveBeenCalledOnce()
    },
  )
  it.each(['EAGAIN', 'EWOULDBLOCK'])(
    'retries a full non-blocking pipe (%s) instead of closing it (M80 E5)',
    async (code) => {
      vi.useFakeTimers()
      const onClosed = vi.fn()
      const writer = createFdWriter(1, onClosed)
      writer.write('data')
      const pending = writer.flush(1000)
      state.callbacks.shift()!(Object.assign(new Error(code), { code }), 0)
      expect(writer.isClosed).toBe(false)
      expect(state.callbacks).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(EXEC_WRITE_RETRY_MS)
      expect(state.callbacks).toHaveLength(1)
      state.callbacks.shift()!(null, 4)
      expect(await pending).toBe(true)
      expect(onClosed).not.toHaveBeenCalled()
    },
  )
  it('rejects queue overflow once, discards pending buffers and tolerates late callbacks', () => {
    const onClosed = vi.fn()
    const writer = createFdWriter(1, onClosed)
    writer.write('x'.repeat(16_777_216))
    expect(writer.queuedBytes).toBe(16_777_216)
    writer.write('x')
    state.callbacks.shift()!(null, 1)
    writer.write('again')
    expect(writer.isClosed).toBe(true)
    expect(writer.queuedBytes).toBe(0)
    expect(onClosed).toHaveBeenCalledOnce()
  })
  it('flush times out without blocking timers or closing an otherwise healthy writer', async () => {
    vi.useFakeTimers()
    const writer = createFdWriter(1, vi.fn())
    writer.write('data')
    const pending = writer.flush(300)
    await vi.advanceTimersByTimeAsync(300)
    expect(await pending).toBe(false)
    expect(writer.isClosed).toBe(false)
    state.callbacks.shift()!(null, 4)
    expect(await writer.flush(0)).toBe(true)
  })
  it('A22 real unread pipe keeps timers alive at 4 MiB; EPIPE closes once', async () => {
    const { outputFiles } = await build({
      stdin: {
        contents: String.raw`import { createFdWriter } from './src/runtime/exec/fdWriter'; const w = createFdWriter(1, () => { process.stderr.write('closed\n'); setTimeout(() => process.exit(0), 10) }); w.write('x'.repeat(4*1024*1024)); setTimeout(() => process.stderr.write('timer\n'), 10); w.flush(300).then(ok => process.stderr.write('flush='+ok+'\n'));`,
        resolveDir: process.cwd(),
        loader: 'ts',
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      write: false,
    })
    const tempRoot = path.join(process.cwd(), 'temp')
    await mkdir(tempRoot, { recursive: true })
    const folder = await mkdtemp(path.join(tempRoot, 'm80a-fd-'))
    const entry = path.join(folder, 'writer.cjs')
    try {
      await writeFile(entry, outputFiles[0]!.text)
      const child = spawn(process.execPath, [entry], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      let stderr = ''
      try {
        const flushed = new Promise<void>((resolve, reject) => {
          const deadline = setTimeout(() => {
            reject(new Error('unread pipe blocked its timers'))
          }, 2000)
          child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString()
            if (!stderr.includes('flush=false')) return
            clearTimeout(deadline)
            resolve()
          })
          child.once('error', (error) => {
            clearTimeout(deadline)
            reject(error)
          })
        })
        await flushed
        expect(stderr).toContain('timer')
        // A full pipe is not a closed one (M80 E5): Node's child stdio is
        // non-blocking, so the writer met EAGAIN here and kept its queue.
        expect(stderr).not.toContain('closed')
        child.stdout.destroy()
        await once(child, 'close')
        expect(stderr.match(/closed/g)).toHaveLength(1)
        expect(child.exitCode).toBe(0)
      } finally {
        child.kill()
        child.stdout.destroy()
        child.stderr.destroy()
      }
    } finally {
      await rm(entry, { force: true })
      await rmdir(folder)
    }
  })
})
