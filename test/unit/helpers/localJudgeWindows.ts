import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'

const execute = promisify(execFile)

export async function compilePeer(): Promise<string> {
  const source = path.resolve('native/windows/MuseSparkLocalJudgePeer.cs')
  const digest = createHash('sha256')
    .update(await readFile(source))
    .digest('hex')
  const folder = path.resolve('temp/m98-2j')
  await mkdir(folder, { recursive: true })
  const helper = path.join(folder, `peer-${digest}.exe`)
  await execute(
    path.join(process.env['SystemRoot'] ?? '', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    ['/nologo', '/target:exe', '/r:System.Runtime.Serialization.dll', `/out:${helper}`, source],
    { windowsHide: true, env: { SystemRoot: process.env['SystemRoot'] } },
  )
  return helper
}

/** Real separate processes exercise distinct IPv4/IPv6 owners and a relay. */
export async function nodeListener(
  address: string,
  port = 0,
  relayPort = 0,
): Promise<{ child: ChildProcess; port: number }> {
  const child = spawn(
    process.execPath,
    [
      path.resolve('test/unit/helpers/localJudgeRelay.mjs'),
      address,
      String(port),
      String(relayPort),
    ],
    {
      windowsHide: true,
      env: {},
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const [chunk] = await once(child.stdout, 'data')
  const decoded: unknown = JSON.parse(String(chunk))
  return { child, port: z.object({ port: z.number().int().positive() }).parse(decoded).port }
}

export async function endListener(child: ChildProcess): Promise<void> {
  const closed = once(child, 'close')
  child.kill()
  await closed
}
