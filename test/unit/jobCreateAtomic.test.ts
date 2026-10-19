// RVMEDIAVB 3: the shared Windows job helper (M50's MCP launcher, M27's
// team runs, M105's encoder) creates its child inside the job. A launcher
// ended the instant CreateProcessW returns, the child still suspended,
// closes the job's last handle, and kill-on-close leaves no child behind.

import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { compileJob, type JobBuild } from '../../src/host/backend/jobBuild'
import { expectEnded, isRunning, markedPid } from './helpers/processes'
import { removeFolder } from './helpers/temporaryFolders'

// A test-only entry point over the shipped Win32 half. Its arguments are the
// child, its folder, the owner's PID, the control pipe and nonce, and the
// file the suspended child's PID is written to before the harness waits.
const HARNESS = `using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class JobCreateHarness {
  public static int Main(string[] a) {
    var environment = new List<string>();
    foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables())
      environment.Add(entry.Key + "=" + entry.Value);
    return MuseSparkMcpJob.Run(a[0], new string[] { "-e", "setInterval(() => {}, 1000)" }, a[1],
      uint.Parse(a[2]), environment.ToArray(), false, a[3], a[4], 0, false, null, pid => {
        File.WriteAllText(a[5], pid.ToString());
        Thread.Sleep(Timeout.Infinite);
      });
  }
}
`

const BUILD: JobBuild = {
  stem: 'JobCreateHarness-',
  extension: '.exe',
  outputType: 'exe',
  references: [],
  label: 'job creation harness',
  isPresent: async (file) => {
    try {
      const info = await stat(file)
      return info.isFile()
    } catch {
      return false
    }
  },
}

/** The owner's side of the launch handshake: READY <nonce> earns GO <nonce>. */
async function ownerPipe(name: string, nonce: string): Promise<Server> {
  const server = createServer((socket) => {
    let request = ''
    socket.on('error', () => {
      // The killed harness drops its end.
    })
    socket.on('data', (bytes: Buffer) => {
      request += bytes.toString('utf8')
      if (request.includes('\n') && request.trim() === `READY ${nonce}`) socket.end(`GO ${nonce}\n`)
    })
  })
  server.listen(`\\\\.\\pipe\\${name}`)
  await once(server, 'listening')
  return server
}

describe.runIf(process.platform === 'win32')('the job helper creates its child in the job', () => {
  const state: { folder?: string; harness?: string; orphans: number[] } = { orphans: [] }

  beforeAll(async () => {
    const systemRoot = process.env['SystemRoot']
    if (systemRoot === undefined) throw new Error('SystemRoot is required')
    state.folder = await mkdtemp(path.join(tmpdir(), 'muse-vb-job-create-'))
    const shared = await readFile(path.resolve('native/windows/MuseSparkMcpJob.cs'), 'utf8')
    state.harness = path.join(state.folder, `${BUILD.stem}${randomUUID()}${BUILD.extension}`)
    await compileJob(BUILD, state.harness, `${HARNESS}\n${shared}`, systemRoot)
  }, 120_000)

  afterEach(() => {
    // A drill's surviving suspended child is this test's to end.
    for (const pid of state.orphans.splice(0)) if (isRunning(pid)) process.kill(pid)
  })

  afterAll(async () => {
    if (state.folder !== undefined) await removeFolder(state.folder)
  })

  it('leaves no child when the launcher is killed right after creating it', async () => {
    if (state.folder === undefined || state.harness === undefined)
      throw new Error('the harness was not built')
    const name = `muse-vb-job-create-${randomUUID()}`
    const nonce = randomBytes(16).toString('hex')
    const server = await ownerPipe(name, nonce)
    try {
      const marker = path.join(state.folder, `${name}.pid`)
      const harness = spawn(
        state.harness,
        [process.execPath, state.folder, String(process.pid), name, nonce, marker],
        { stdio: 'pipe', windowsHide: true },
      )
      // Not 'close': a surviving child would hold the harness's pipes open.
      const exited = once(harness, 'exit')
      const child = await markedPid(marker)
      state.orphans.push(child)
      // Created and suspended; the harness now waits inside its hook.
      expect(isRunning(child)).toBe(true)
      harness.kill()
      await exited
      await expectEnded(child)
    } finally {
      server.close()
    }
  }, 60_000)
})
