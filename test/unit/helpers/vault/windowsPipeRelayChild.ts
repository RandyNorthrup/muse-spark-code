import { connect } from 'node:net'
import { once } from 'node:events'
import { writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import * as z from 'zod/mini'
import {
  WindowsPipeFiles,
  inspectWindowsPipeServer,
  inspectWindowsProcess,
  startWindowsPipeServe,
} from '../../../../src/runtime/vault/windowsPipeRelay'
import { windowsPipeExecutable } from '../../../../src/host/vault/slots/windowsVaultBuild'
import { configureResources } from '../../../../src/core/resources/admission'
import { runtimeWindowsJob } from '../../../../src/runtime/resources/jobs'
import { VaultError } from '../../../../src/core/vault/crypto'

/** Dial-and-leave waves against the served pipe, and the dials in each. */
const DIAL_WAVES = 20
const DIALS_PER_WAVE = 10

// The real MuseSparkVaultPipe helper, built and served here: the parent
// proves the relay against this binary on Windows CI. Nothing is invented:
// every reported value comes from the helper or the OS.
void (async () => {
  if (process.platform !== 'win32') throw new Error('the pipe helper runs on Windows only')
  if (!process.send) throw new Error('the relay fixture needs an IPC channel')
  const context = z
    .strictObject({
      storageDir: z.string(),
      systemRoot: z.string(),
      slotSource: z.string(),
      pipeSource: z.string(),
      workDir: z.string(),
      pipe: z.string(),
    })
    .parse(JSON.parse(process.argv[2] ?? 'null'))
  // The helper build and its launch go through the real resource governor,
  // configured here as the vault broker configures it
  // (src/runtime/vault/vaultBrokerEntry.ts): Windows records each governed
  // child through the job helpers. The parent spawns this child from the
  // repository root, the root its helper sources are read from.
  configureResources({
    inspect: () => ({}),
    onError: () => undefined,
    windowsJob: runtimeWindowsJob(
      path.join(path.dirname(context.storageDir), 'jobs'),
      process.cwd(),
    ),
  })
  const helper = await windowsPipeExecutable({
    storageDir: context.storageDir,
    systemRoot: context.systemRoot,
    readSlotSource: () => readFile(context.slotSource, 'utf8'),
    readPipeSource: () => readFile(context.pipeSource, 'utf8'),
  })
  const serve = await startWindowsPipeServe(helper, context.pipe)
  process.send({ built: true, ownerSid: serve.relay.owner() })
  // The build is slow (a cold C# compile); the run below stays fast.
  await once(process, 'message')
  const serverClosed = Promise.withResolvers<undefined>()
  await serve.listen(context.pipe, (socket) => {
    socket.once('close', () => {
      serverClosed.resolve(undefined)
    })
    socket.on('error', () => undefined)
    socket.on('data', (bytes: Buffer) => {
      socket.write(bytes)
    })
    // A broker's answer or watch event can cross its client's close: bytes
    // written once the client has gone (here, on its end) reach the helper
    // after it dropped the connection, and must not fault the helper.
    socket.once('end', () => {
      socket.write(Buffer.from('late', 'utf8'))
    })
  })
  const echoOnce = async (echo: string): Promise<string> => {
    const client = connect(context.pipe)
    const echoed = await new Promise<Buffer>((resolve, reject) => {
      const parts: Buffer[] = []
      client.once('error', reject)
      client.on('data', (chunk: Buffer) => {
        parts.push(chunk)
        if (Buffer.concat(parts).length >= echo.length) resolve(Buffer.concat(parts))
      })
      client.write(Buffer.from(echo, 'utf8'))
    })
    client.destroy()
    return echoed.subarray(0, echo.length).toString('utf8')
  }
  const echoed = await echoOnce('hello-relay')
  // The client's going away closes the relayed server socket, as a net
  // socket closes when its peer ends: a socket that never closed kept the
  // broker from its idle shutdown.
  await serverClosed.promise
  // The queries below reach the helper after the late bytes, in order: a
  // helper that faulted on them answers none of them.
  const guard = new WindowsPipeFiles(serve.relay, () => new VaultError('io'))
  const target = path.join(context.workDir, 'anchor-probe.json')
  await writeFile(target, '{}')
  await guard.protect(target, 'file')
  await guard.verify(target, 'file')
  await guard.protect(context.workDir, 'directory')
  const server = await inspectWindowsPipeServer(serve.relay, context.pipe)
  const examined = await inspectWindowsProcess(serve.relay, process.pid)
  // The pipe still serves a new client after the late bytes.
  const echoedAgain = await echoOnce('hello-again')
  // Clients that connect and leave at once (the dial's own server
  // inspection does) must never leave the pipe without an instance: a dial
  // then fails with ENOENT, and a server inspection answers `missing` (the
  // client's "No access" before it speaks). Waves of them, each awaited,
  // count every dial and every inspection that found no pipe.
  const didDialConnect = async (): Promise<boolean> => {
    const socket = connect(context.pipe)
    try {
      await once(socket, 'connect')
      return true
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
      throw error
    } finally {
      socket.destroy()
    }
  }
  let missedDials = 0
  let missedInspections = 0
  for (let wave = 0; wave < DIAL_WAVES; wave++) {
    const [dials, inspection] = await Promise.all([
      Promise.all(Array.from({ length: DIALS_PER_WAVE }, () => didDialConnect())),
      inspectWindowsPipeServer(serve.relay, context.pipe),
    ])
    missedDials += dials.filter((isConnected) => !isConnected).length
    if (inspection.result !== 'ok') missedInspections += 1
  }
  // The server answer goes over whole: the parent asserts the trust
  // predicate against what the helper really reported, so a helper that
  // answers `ownerOnlyDacl: false` fails the suite instead of passing it.
  process.send({
    results: {
      echo: echoed,
      echoAgain: echoedAgain,
      missedDials,
      missedInspections,
      serverResult: server.result,
      serverOwnerSid: server.ownerSid,
      server,
      processResult: examined.result,
      processId: examined.process?.processId ?? null,
      processUserId: examined.process?.userId ?? null,
      serverClosed: true,
    },
  })
  // Windows has no graceful SIGTERM for node: the parent says stop, the
  // child stops its serve helper and drains (the broker fixtures exit the
  // same way, never through process.exit).
  await once(process, 'message')
  await serve.stop()
  process.disconnect()
})().catch((error: unknown) => {
  // The cause chain names the real failure (a refused helper build reports
  // only its fixed sentence otherwise).
  const causes: string[] = []
  let cause: unknown = error instanceof Error ? error.cause : undefined
  while (cause instanceof Error && causes.length < 3) {
    causes.push(String(cause))
    cause = cause.cause
  }
  const trail = causes.length > 0 ? ` <- ${causes.join(' <- ')}` : ''
  process.stderr.write(`relay fixture refused: ${String(error)}${trail}\n`)
  process.exitCode = 1
})
