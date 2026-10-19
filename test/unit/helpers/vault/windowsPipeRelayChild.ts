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
import { VaultError } from '../../../../src/core/vault/crypto'

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
  await serve.listen(context.pipe, (socket) => {
    socket.on('error', () => undefined)
    socket.on('data', (bytes: Buffer) => {
      socket.write(bytes)
    })
  })
  const client = connect(context.pipe)
  const echo = 'hello-relay'
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
  const guard = new WindowsPipeFiles(serve.relay, () => new VaultError('io'))
  const target = path.join(context.workDir, 'anchor-probe.json')
  await writeFile(target, '{}')
  await guard.protect(target, 'file')
  await guard.verify(target, 'file')
  await guard.protect(context.workDir, 'directory')
  const server = await inspectWindowsPipeServer(serve.relay, context.pipe)
  const examined = await inspectWindowsProcess(serve.relay, process.pid)
  process.send({
    results: {
      echo: echoed.subarray(0, echo.length).toString('utf8'),
      serverResult: server.result,
      serverOwnerSid: server.ownerSid,
      processResult: examined.result,
      processId: examined.process?.processId ?? null,
      processUserId: examined.process?.userId ?? null,
    },
  })
  // Windows has no graceful SIGTERM for node: the parent says stop, the
  // child stops its serve helper and drains (the broker fixtures exit the
  // same way, never through process.exit).
  await once(process, 'message')
  await serve.stop()
  process.disconnect()
})().catch((error: unknown) => {
  process.stderr.write(`relay fixture refused: ${String(error)}\n`)
  process.exitCode = 1
})
