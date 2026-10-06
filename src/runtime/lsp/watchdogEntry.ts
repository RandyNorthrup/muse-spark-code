// EOF guardian and Node launch gate; process identity/enrollment/actions belong only to M107.
import { readSync, closeSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import { resourceTicketSchema, type ResourceTicket } from '../../shared/resources'
import { LSP_LIMITS, RUNTIME_STOP } from '../../shared/constants'

async function watch(): Promise<void> {
  const packageRoot = process.argv[3] ?? path.resolve(__dirname, '..')
  const storageDir = process.argv[4] ?? path.join(packageRoot, 'temp')
  const { processAuthority } = await import('./processAuthority')
  const authority = await processAuthority(packageRoot, storageDir)
  let ticket: ResourceTicket | undefined
  let input = ''
  let pending = Promise.resolve()
  let ending: Promise<void> | undefined
  let scanning: Promise<void> | undefined
  let isFailed = false
  const timer = setInterval(() => {
    if (ticket === undefined || ending !== undefined || scanning !== undefined) return
    const registered = ticket
    scanning = (async () => {
      try {
        await pending
        // Empty/unknown accounting is not an exit receipt; Stop asks the action API.
        await authority.registry.members(registered)
      } catch {
        isFailed = true
        void stop()
      } finally {
        scanning = undefined
      }
    })()
  }, LSP_LIMITS.watchdogPollMs)
  const stop = () => {
    ending ??= (async () => {
      clearInterval(timer)
      await pending
      await scanning
      try {
        if (ticket !== undefined) await authority.stop(ticket)
      } catch {
        isFailed = true
      }
      process.exitCode = isFailed ? 1 : 0
      process.stdin.destroy()
    })()
    return ending
  }
  process.stdin.on('data', (bytes: Buffer) => {
    input += bytes.toString('utf8')
    if (input.length > LSP_LIMITS.recordBytes) {
      isFailed = true
      void stop()
      return
    }
    if (!input.endsWith('\n')) return
    const message = input
    input = ''
    const previous = pending
    pending = (async () => {
      try {
        await previous
        if (ticket !== undefined) throw new Error('EWATCH_ROOT')
        const parsed = z.strictObject({ ticket: resourceTicketSchema }).parse(JSON.parse(message))
        ticket = await authority.registry.register(parsed.ticket)
        process.stdout.write('OWNED\n')
      } catch {
        isFailed = true
        void stop()
      }
    })()
  })
  process.stdin.once('end', () => {
    void stop()
  })
  process.stdin.once('error', () => {
    isFailed = true
    void stop()
  })
  process.once('SIGTERM', () => {
    void stop()
  })
  process.stdout.write('READY\n')
}
if (require.main === module) {
  void watch().catch(() => {
    process.exitCode = 1
    process.stdin.destroy()
  })
} else {
  // Extra private pipe; no command, token or credential is read by the preload.
  const bytes = Buffer.alloc(1)
  const wait = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
  let count: number
  for (;;) {
    try {
      count = readSync(RUNTIME_STOP.launchFd, bytes, 0, 1, null)
      break
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EAGAIN')) throw error
      Atomics.wait(wait, 0, 0, RUNTIME_STOP.pollMs)
    }
  }
  if (count !== 1 || bytes.toString('ascii') !== 'G') throw new Error('ESTOP_LAUNCH')
  closeSync(RUNTIME_STOP.launchFd)
  // Node may use this same installed file as both preload and guardian main.
  Reflect.deleteProperty(require.cache, __filename)
}
