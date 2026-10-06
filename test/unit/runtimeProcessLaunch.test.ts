import { ChildProcess, type SpawnOptions } from 'node:child_process'
import type * as childProcessModule from 'node:child_process'
import { Socket } from 'node:net'
import type * as netModule from 'node:net'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import { spawnMcpJob } from '../../src/host/backend/mcpJobLaunch'
import { MCP_JOB_CONFIG_VARIABLE } from '../../src/shared/constants'
import { readFile } from 'node:fs/promises'

const fixture = vi.hoisted(() => ({
  spawn: vi.fn<(file: string, args: readonly string[], options: SpawnOptions) => ChildProcess>(),
  accept: (socket: Socket) => {
    socket.destroy()
  },
}))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof childProcessModule>()),
  spawn: fixture.spawn,
}))
vi.mock('node:net', async (importOriginal) => {
  const actual = await importOriginal<typeof netModule>()
  return {
    ...actual,
    createServer: (accept: (socket: Socket) => void) => {
      fixture.accept = accept
      const server = new actual.Server()
      vi.spyOn(server, 'listen').mockReturnValue(server)
      return server
    },
  }
})
afterEach(() => {
  vi.restoreAllMocks()
  fixture.spawn.mockReset()
  fixture.accept = (socket) => {
    socket.destroy()
  }
})
function launch(registered: (pid: number) => Promise<void>) {
  const child = Object.assign(new ChildProcess(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  })
  Object.defineProperty(child, 'pid', { value: 710 })
  fixture.spawn.mockReturnValue(child)
  spawnMcpJob({
    executablePath: String.raw`C:\private\launcher.exe`,
    file: 'node.exe',
    args: [],
    cwd: String.raw`C:\workspace`,
    env: {},
    log: vi.fn(),
    jobName: String.raw`Local\Lsp-test`,
    independent: true,
    isVerbatim: false,
    registered,
  })
  const payload = fixture.spawn.mock.calls[0]?.[2].env?.[MCP_JOB_CONFIG_VARIABLE]
  if (payload === undefined) throw new Error('no native launch payload')
  const config = z
    .object({ controlNonce: z.string(), jobName: z.string(), independent: z.boolean() })
    .parse(JSON.parse(Buffer.from(payload, 'base64').toString('utf8')))
  const socket = new Socket()
  const replying = vi.spyOn(socket, 'end').mockReturnValue(socket)
  const destroying = vi.spyOn(socket, 'destroy').mockReturnValue(socket)
  fixture.accept(socket)
  socket.emit('data', Buffer.from(`READY ${config.controlNonce}\n`))
  return { child, config, replying, destroying }
}
async function settle() {
  for (let attempt = 0; attempt < 10; attempt += 1) await Promise.resolve()
}
describe('LSP Windows launch registration seam', () => {
  it('holds native GO until exact job registration completes', async () => {
    const admitted = Promise.withResolvers<undefined>()
    const registered = vi.fn(() => admitted.promise)
    const run = launch(registered)
    expect(run.config).toMatchObject({ jobName: String.raw`Local\Lsp-test`, independent: true })
    expect(registered).toHaveBeenCalledWith(710)
    await settle()
    expect(run.replying).not.toHaveBeenCalled()
    admitted.resolve(undefined)
    await settle()
    expect(run.replying).toHaveBeenCalledWith(`GO ${run.config.controlNonce}\n`)
  })
  it('closes admission after registration refusal without any bare child signal', async () => {
    const run = launch(() => Promise.reject(new Error('changed birth')))
    const killing = vi.spyOn(run.child, 'kill')
    await settle()
    expect(run.replying).not.toHaveBeenCalled()
    expect(run.destroying).toHaveBeenCalledOnce()
    expect(killing).not.toHaveBeenCalled()
  })
  it('registers the native launcher in the named job before GO and keeps the independent owner alive after frontend exit', async () => {
    const source = await readFile('native/windows/MuseSparkMcpJob.cs', 'utf8')
    const start = source.indexOf('if (registeredJobName != null) {')
    const assignment = source.indexOf(
      'AssignProcessToJobObject(job, System.Diagnostics.Process.GetCurrentProcess().Handle)',
      start,
    )
    const admission = source.indexOf('ConfirmOwner(controlPipe, controlNonce, parent)', start)
    const create = source.indexOf('if (!CreateProcessW(', start)
    expect(start).toBeGreaterThan(0)
    expect(assignment).toBeGreaterThan(start)
    expect(admission).toBeGreaterThan(assignment)
    expect(create).toBeGreaterThan(admission)
    expect(source).toContain('independent ? WaitForSingleObject(process.hProcess, 0xffffffff)')
    expect(source).toContain(
      'if (job != IntPtr.Zero && registeredJobName == null) CloseHandle(job)',
    )
  })
})
