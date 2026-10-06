import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Socket } from 'node:net'
import * as z from 'zod/mini'
import {
  RUNTIME_MAKER_HOST,
  RUNTIME_MAKER_MAX_BYTES,
  RUNTIME_MAKER_TIMEOUT_MS,
  RUNTIME_MAKER_TOKEN_BYTES,
  RUNTIME_MAKER_FRAME_NEWLINE,
  RUNTIME_MAKER_MAX_ITEMS,
} from '../../shared/constants'

const helloSchema = z.strictObject({
  v: z.literal(2),
  type: z.literal('hello'),
  provider: z.literal('thonny'),
  token: z.string(),
})
const controlSchema = z.strictObject({
  v: z.literal(2),
  type: z.literal('port_request'),
  id: z.string().check(z.minLength(1), z.maxLength(RUNTIME_MAKER_MAX_ITEMS)),
  op: z.enum(['acquire', 'release']),
  port: z.string().check(z.minLength(1), z.maxLength(RUNTIME_MAKER_MAX_ITEMS)),
})
const replySchema = z.strictObject({
  v: z.literal(2),
  type: z.literal('device_response'),
  id: z.string(),
  ok: z.boolean(),
  result: z.optional(z.unknown()),
  error: z.optional(z.strictObject({ code: z.string(), message: z.string() })),
})
export interface ThonnyPortOwner {
  /** Must resolve only after lane P has the lease and approved serial open. */
  acquire(port: string, signal: AbortSignal): Promise<() => Promise<void>>
}
/** The plugin is a context provider and a user handover surface, never a byte executor. */
export async function startThonnyServer(owner: ThonnyPortOwner) {
  const token = randomBytes(RUNTIME_MAKER_TOKEN_BYTES).toString('hex')
  const sockets = new Set<Socket>()
  let provider: Socket | undefined
  let cleanup: Promise<void> = Promise.resolve()
  let isCleanupFailed = false
  let currentContext: { readonly id: string; readonly resolve: (raw: unknown) => void } | undefined
  const canWelcome = () => !isCleanupFailed && provider === undefined
  const server = createServer((socket) => {
    sockets.add(socket)
    let isReady = false
    let input = Buffer.alloc(0)
    let queue: Promise<void> = Promise.resolve()
    let queued = 0
    const lifetime = new AbortController()
    let held: { port: string; release: () => Promise<void> } | undefined
    let opening: Promise<() => Promise<void>> | undefined
    socket.setTimeout(RUNTIME_MAKER_TIMEOUT_MS, () => {
      if (!isReady) socket.destroy()
    })
    const send = (message: unknown) => {
      if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`)
    }
    async function release(): Promise<void> {
      if (opening !== undefined) {
        try {
          held = { port: held?.port ?? '', release: await opening }
        } catch {
          /* Cancelled acquire closed its own resources. */
        }
        opening = undefined
      }
      await held?.release()
      held = undefined
    }
    async function handle(raw: unknown): Promise<void> {
      if (!isReady) {
        const hello = helloSchema.parse(raw)
        if (
          !canWelcome() ||
          Buffer.byteLength(hello.token) !== Buffer.byteLength(token) ||
          !timingSafeEqual(Buffer.from(hello.token), Buffer.from(token))
        )
          throw new Error('thonny-provider-refused')
        await cleanup
        if (!canWelcome()) throw new Error('thonny-provider-refused')
        lifetime.signal.throwIfAborted()
        provider = socket
        isReady = true
        socket.setTimeout(0)
        send({ v: 2, type: 'welcome', ok: true })
        return
      }
      const reply = replySchema.safeParse(raw)
      if (reply.success) {
        if (currentContext?.id === reply.data.id) {
          currentContext.resolve(reply.data)
          currentContext = undefined
        }
        return
      }
      const request = controlSchema.parse(raw)
      try {
        if (request.op === 'acquire') {
          if (held !== undefined || opening !== undefined) throw new Error('thonny-port-busy')
          opening = owner.acquire(request.port, lifetime.signal)
          const close = await opening
          held = { port: request.port, release: close }
          opening = undefined
          lifetime.signal.throwIfAborted()
          send({ ...request, type: 'port_response', ok: true, owner: 'runtime' })
        } else {
          if (held !== undefined && held.port !== request.port)
            throw new Error('thonny-port-changed')
          await release()
          send({ ...request, type: 'port_response', ok: true, owner: 'released' })
        }
      } catch {
        send({ ...request, type: 'port_response', ok: false })
        socket.destroy()
      }
    }
    socket.on('data', (chunk: Buffer) => {
      input = Buffer.concat([input, chunk])
      if (input.length > RUNTIME_MAKER_MAX_BYTES) {
        socket.destroy()
        return
      }
      for (;;) {
        const end = input.indexOf(RUNTIME_MAKER_FRAME_NEWLINE)
        if (end === -1) break
        const line = input.subarray(0, end).toString('utf8')
        input = input.subarray(end + 1)
        queued += 1
        if (queued > RUNTIME_MAKER_MAX_ITEMS) {
          socket.destroy()
          return
        }
        const previous = queue
        queue = (async () => {
          try {
            await previous
            lifetime.signal.throwIfAborted()
            const raw: unknown = JSON.parse(line)
            await handle(raw)
          } catch {
            socket.destroy()
          } finally {
            queued -= 1
          }
        })()
      }
    })
    socket.on('error', () => {
      socket.destroy()
    })
    socket.once('close', () => {
      lifetime.abort()
      sockets.delete(socket)
      if (provider === socket) {
        provider = undefined
        currentContext?.resolve(undefined)
        currentContext = undefined
      }
      const previous = cleanup
      cleanup = (async () => {
        try {
          await previous
          await queue
          await release()
        } catch {
          isCleanupFailed = true
        }
      })()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, RUNTIME_MAKER_HOST, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('thonny-listen-address')
  return {
    host: RUNTIME_MAKER_HOST,
    port: address.port,
    token,
    async context(signal: AbortSignal): Promise<{ text: string; connected: boolean }> {
      if (provider === undefined) return { text: '', connected: false }
      if (currentContext !== undefined) throw new Error('thonny-context-busy')
      const id = randomBytes(RUNTIME_MAKER_TOKEN_BYTES).toString('hex')
      let timer: ReturnType<typeof setTimeout> | undefined
      const cancel = () => {
        currentContext?.resolve(undefined)
        currentContext = undefined
      }
      try {
        signal.throwIfAborted()
        const response = new Promise<unknown>((resolve) => {
          currentContext = { id, resolve }
          timer = setTimeout(cancel, RUNTIME_MAKER_TIMEOUT_MS)
          signal.addEventListener('abort', cancel, { once: true })
        })
        provider.write(`${JSON.stringify({ v: 2, type: 'device_request', id, op: 'context' })}\n`)
        const reply = replySchema.parse(await response)
        if (!reply.ok) throw new Error('thonny-context-refused')
        const context = z
          .strictObject({ text: z.string(), source: z.literal('thonny_shell') })
          .parse(reply.result)
        return { text: context.text, connected: true }
      } finally {
        clearTimeout(timer)
        signal.removeEventListener('abort', cancel)
        currentContext = undefined
      }
    },
    async close(): Promise<void> {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
      })
      await cleanup
      if (isCleanupFailed) throw new Error('thonny-release-failed')
    },
  }
}
