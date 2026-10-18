import { describe, expect, it, afterEach } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import {
  PipeRelay,
  WindowsPipeFiles,
  adaptPipeRelayChild,
  inspectWindowsPipeServer,
  inspectWindowsProcess,
  windowsVaultPipeName,
} from '../../../src/runtime/vault/windowsPipeRelay'
import {
  isVaultPipeServerTrusted,
  windowsVaultPipeNameSchema,
  windowsVaultPipeServerResultSchema,
  type WindowsVaultPipeClient,
} from '../../../src/core/vault/broker/windowsPipe'
import { VaultError } from '../../../src/core/vault/crypto'
import type { Duplex } from 'node:stream'

const PEER = path.join(__dirname, '..', 'helpers', 'vault', 'pipeRelayPeer.mjs')
const PIPE = windowsVaultPipeName()
const VAULT_DIR = String.raw`C:\vault\run`
const LOCK_FILE = String.raw`C:\vault\run\broker.lock`
const PEER_EXE = String.raw`C:\Windows\System32\peer.exe`
const OTHER_PIPE = String.raw`\\.\pipe\muse-spark-vault-${'0'.repeat(32)}`
const PEER_PID = 4242
const STARTED_AT = 1_700_000_000_000

const children: ChildProcess[] = []
afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill('SIGKILL')
    try {
      await once(child, 'exit')
    } catch {
      /* The peer is already gone. */
    }
  }
})

interface Peer {
  readonly relay: PipeRelay
  readonly child: ChildProcess
}

function startPeer(behavior: 'serve' | 'fault' | 'garbage'): Peer {
  const child = spawn(process.execPath, [PEER, behavior], { stdio: ['pipe', 'pipe', 'pipe'] })
  children.push(child)
  const relay = new PipeRelay(
    adaptPipeRelayChild(child),
    () => Promise.resolve(),
    'serve',
    behavior === 'serve' ? PIPE : null,
  )
  child.stdout.on('data', (chunk: Buffer) => {
    relay.onStdout(chunk)
  })
  child.stderr.resume()
  child.on('error', () => {
    relay.fail(new Error('peer spawn failed'))
  })
  child.on('close', () => {
    relay.fail(new Error('peer closed'))
  })
  child.stdin.write(
    Buffer.from(
      JSON.stringify(
        behavior === 'serve' ? { v: 1, mode: 'serve', pipe: PIPE } : { v: 1, mode: 'files' },
      ) + '\n',
    ),
  )
  return { relay, child }
}

async function awaitOwner(relay: PipeRelay): Promise<string> {
  const deadline = Date.now() + 5000
  for (;;) {
    try {
      return relay.owner()
    } catch {
      if (Date.now() >= deadline) throw new Error('peer never sent ready')
      await delay(25)
    }
  }
}

describe('Windows pipe relay', () => {
  it('minted pipe names match the contract and never repeat', () => {
    expect(windowsVaultPipeNameSchema.safeParse(windowsVaultPipeName()).success).toBe(true)
    expect(windowsVaultPipeName()).not.toBe(windowsVaultPipeName())
  })

  it('relays a connection, echoes bytes and answers file and identity queries', async () => {
    const { relay } = startPeer('serve')
    expect(await awaitOwner(relay)).toBe('S-1-5-21-1-2-3-1001')
    let connection!: Duplex
    const opened = new Promise<WindowsVaultPipeClient>((resolve) => {
      relay.listen(PIPE, (socket) => {
        connection = socket
        // The channel owns error handling on accepted sockets; the test swallows.
        socket.on('error', () => undefined)
        resolve(relay.inspect(socket))
      })
    })
    const client = await opened
    expect(client.processId).toBe(PEER_PID)
    expect(client.remote).toBe(false)
    expect(client.ownerOnlyDacl).toBe(true)
    const echoed = new Promise<Buffer>((resolve) => {
      const parts: Buffer[] = []
      connection.on('data', (chunk: Buffer) => {
        parts.push(chunk)
        if (Buffer.concat(parts).length >= 5) resolve(Buffer.concat(parts))
      })
    })
    connection.write(Buffer.from('hello'))
    const bytes = await echoed
    expect(bytes.subarray(0, 5).toString('utf8')).toBe('hello')
    const guard = new WindowsPipeFiles(relay, () => new VaultError('io'))
    await guard.protect(VAULT_DIR, 'directory')
    await guard.verify(LOCK_FILE, 'file')
    const server = await inspectWindowsPipeServer(relay, PIPE)
    expect(server.result).toBe('ok')
    expect(server.ownerSid).toBe('S-1-5-21-1-2-3-1001')
    const process = await inspectWindowsProcess(relay, PEER_PID)
    expect(process.result).toBe('ok')
    await relay.stop()
  })

  it('listening on another name is refused', () => {
    const { relay } = startPeer('serve')
    expect(() => relay.listen(OTHER_PIPE, () => undefined)).toThrow()
  })

  it('a helper fault fails every later use with its fixed word', async () => {
    const { relay } = startPeer('fault')
    const deadline = Date.now() + 5000
    for (;;) {
      try {
        await relay.query(0x21, { v: 1, command: 'verify', kind: 'file', path: String.raw`C:\x` })
        throw new Error('query succeeded after fault')
      } catch (error: unknown) {
        if (error instanceof Error && error.message === 'vault-pipe-squatted') return
        if (Date.now() >= deadline) throw error
        await delay(25)
      }
    }
  })

  it('an unknown frame fails the relay closed', async () => {
    const { relay } = startPeer('garbage')
    await expect(
      relay.query(0x21, { v: 1, command: 'verify', kind: 'file', path: String.raw`C:\x` }),
    ).rejects.toThrow()
  })

  it('the server trust predicate matches everything the OS reported', () => {
    const lock = { processId: PEER_PID, startedAt: STARTED_AT }
    const answer = windowsVaultPipeServerResultSchema.parse({
      v: 1,
      id: 1,
      result: 'ok',
      ownerSid: 'S-1-5-21-1-2-3-1001',
      server: {
        v: 1,
        processId: PEER_PID,
        userId: 'S-1-5-21-1-2-3-1001',
        startedAt: STARTED_AT,
        executable: PEER_EXE,
        remote: false,
        ownerOnlyDacl: true,
      },
    })
    expect(isVaultPipeServerTrusted(answer, lock)).toBe(true)
    expect(isVaultPipeServerTrusted({ ...answer, result: 'refused', server: null }, lock)).toBe(
      false,
    )
    expect(
      isVaultPipeServerTrusted({ ...answer, server: { ...answer.server, remote: true } }, lock),
    ).toBe(false)
    expect(
      isVaultPipeServerTrusted({ ...answer, server: { ...answer.server, processId: 9999 } }, lock),
    ).toBe(false)
  })
})
