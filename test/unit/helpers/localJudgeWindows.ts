import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'

const execute = promisify(execFile)

export async function compilePeer(shouldPauseBeforeLiveness = false): Promise<string> {
  let source = path.resolve('native/windows/MuseSparkLocalJudgePeer.cs')
  let contents = await readFile(source, 'utf8')
  if (shouldPauseBeforeLiveness) {
    // Test-only wrapper pauses at the real native wait, after the second TCP
    // lookup. The production condition and held handle are otherwise unchanged.
    const pattern =
      /\[DllImport\("kernel32.dll"\)\]\r?\n {2}static extern uint WaitForSingleObject\(IntPtr handle, uint milliseconds\);/
    if (!pattern.test(contents)) throw new Error('missing native lifetime declaration')
    contents = contents.replace(
      pattern,
      `[DllImport("kernel32.dll", EntryPoint = "WaitForSingleObject")]
  static extern uint NativeWaitForSingleObject(IntPtr handle, uint milliseconds);
  static uint WaitForSingleObject(IntPtr handle, uint milliseconds) {
    Console.Error.WriteLine("lease-held");
    Console.ReadLine();
    return NativeWaitForSingleObject(handle, milliseconds);
  }`,
    )
  }
  const digest = createHash('sha256').update(contents).digest('hex')
  const folder = path.resolve('temp/m98-2j')
  await mkdir(folder, { recursive: true })
  const helper = path.join(folder, `peer-${digest}.exe`)
  if (shouldPauseBeforeLiveness) {
    source = path.join(folder, `peer-${digest}.cs`)
    await writeFile(source, contents)
  }
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
