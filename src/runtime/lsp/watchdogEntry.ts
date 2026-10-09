// EOF guardian and Node launch gate; process identity/enrollment/actions belong only to M107.
import { readSync, closeSync } from 'node:fs'
import path from 'node:path'
import type { ResourceTicket, ResourceProcessIdentity } from '../../shared/resources'
import type { StopBinding } from './stopReceipt'
import { LSP_LIMITS, RUNTIME_STOP } from '../../shared/constants'

async function watch(): Promise<void> {
  const packageRoot = process.argv[3] ?? path.resolve(__dirname, '..')
  const storageDir = process.argv[4] ?? path.join(packageRoot, 'temp')
  const { processAuthority } = await import('./processAuthority')
  const authority = await processAuthority(packageRoot, storageDir)
  const { guardianMessageSchema, isSameProcess } = await import('./stopReceipt')
  const receiptFile = process.argv[5]
  const observed = new Map<string, ResourceProcessIdentity>()
  let binding: StopBinding | undefined
  const observe = (member: ResourceProcessIdentity) => {
    observed.set(`${String(member.pid)}:${member.startTime}`, member)
  }
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
        const members = await authority.registry.members(registered)
        for (const member of members) observe(member)
        if (receiptFile !== undefined && binding !== undefined)
          await authority.writeReceipt(
            receiptFile,
            binding,
            Array.from(observed, ([, member]) => member),
            false,
          )
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
        if (ticket !== undefined) {
          const stopped = await authority.stop(ticket)
          for (const member of stopped) observe(member)
          if (!isFailed && receiptFile !== undefined && binding !== undefined)
            await authority.writeReceipt(
              receiptFile,
              binding,
              Array.from(observed, ([, member]) => member),
              true,
            )
        }
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
        const parsed = guardianMessageSchema.parse(JSON.parse(message))
        const ownIdentity = await authority.identity(process.pid)
        if (
          ownIdentity === null ||
          !isSameProcess(ownIdentity, parsed.binding.guardian) ||
          !isSameProcess(parsed.ticket.root, parsed.binding.root) ||
          parsed.ticket.id !== parsed.binding.ticketId
        )
          throw new Error('EWATCH_BINDING')
        binding = parsed.binding
        ticket = await authority.registry.register(parsed.ticket)
        observe(ticket.root)
        if (receiptFile !== undefined)
          await authority.writeReceipt(
            receiptFile,
            binding,
            Array.from(observed, ([, member]) => member),
            false,
          )
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
} else if (
  process.execArgv.some(
    (argument, index) =>
      argument === '--require' &&
      path.resolve(process.execArgv[index + 1] ?? '') === path.resolve(__filename),
  )
) {
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
