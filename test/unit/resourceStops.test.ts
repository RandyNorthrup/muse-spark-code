import { ChildProcess, spawn } from 'node:child_process'
import type * as childProcess from 'node:child_process'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { admitResource, resourceWindowsJob } from '../../src/core/resources/admission'
import type * as resources from '../../src/core/resources/admission'
import { jobProcessTree, posixProcessTree } from '../../src/core/backends/modelapi/pluginHost'
import { createGitProcess } from '../../src/host/git'
import { hostBrowserRunDeps } from '../../src/host/browser/browserProcess'
import { spawnHelper } from '../../src/host/voice/voiceProcesses'
import { fakeResourceLease } from './helpers/resources/fakes'

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof childProcess>()),
  spawn: vi.fn(),
}))
vi.mock('../../src/core/resources/admission', async (importOriginal) => ({
  ...(await importOriginal<typeof resources>()),
  admitResource: vi.fn(),
  resourceWindowsJob: vi.fn(),
}))

function fixture() {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const child = Object.assign(new ChildProcess(), {
    pid: 701,
    stdin,
    stdout,
    stderr,
    stdio: [stdin, stdout, stderr, new PassThrough(), new PassThrough()],
  })
  const rawKill = vi.spyOn(child, 'kill').mockReturnValue(true)
  vi.mocked(spawn).mockReturnValue(child)
  const resource = fakeResourceLease()
  vi.mocked(admitResource).mockResolvedValue(resource)
  return { child, rawKill, resource }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resourceWindowsJob).mockResolvedValue(undefined)
})
afterEach(() => vi.restoreAllMocks())

it.each([false, true])(
  'uses registered browser stop with no raw fallback (admitted=%s)',
  async (isAdmitted) => {
    const h = fixture()
    h.resource.kill.mockResolvedValue(isAdmitted)
    const browser = hostBrowserRunDeps({
      platform: 'win32',
      env: {},
      resource: h.resource,
      warn: vi.fn(),
    }).spawn('browser.exe', [], {})
    if (isAdmitted) await browser.kill()
    else
      await expect(browser.kill()).rejects.toThrow('Registered resource tree could not be stopped')
    expect(h.resource.kill).toHaveBeenCalledTimes(1)
    expect(h.rawKill).not.toHaveBeenCalled()
    expect(h.resource.complete).not.toHaveBeenCalledWith(true)
  },
)

it('rejects a refused Git stop without waiting for root exit or invoking a bare child kill', async () => {
  const h = fixture()
  h.rawKill.mockImplementation(() => {
    h.child.emit('close', -1)
    return true
  })
  const stop = new AbortController()
  const git = createGitProcess({
    platform: 'win32',
    env: { PATH: String.raw`C:\tools` },
    fileExists: () => true,
    spawn,
  })
  const pending = git(['status'], {
    cwd: String.raw`C:\workspace`,
    env: {},
    timeoutMs: 1000,
    signal: stop.signal,
  })
  const rejected = expect(pending).rejects.toThrow('Registered resource tree could not be stopped')
  await vi.waitFor(() => {
    expect(h.resource.register).toHaveBeenCalled()
  })
  stop.abort()
  const exit = setTimeout(() => {
    h.child.emit('close', -1)
  }, 0)
  try {
    await rejected
  } finally {
    clearTimeout(exit)
  }
  expect(h.resource.kill).toHaveBeenCalledTimes(1)
  expect(h.rawKill).not.toHaveBeenCalled()
  expect(h.resource.complete).toHaveBeenCalledWith(false)
})

it('reports refused voice stop through the driver while retaining its registered tree', async () => {
  const h = fixture()
  const helper = spawnHelper({ command: 'voice.exe', args: [] })
  const exited = vi.fn()
  helper.onExit(exited)
  await vi.waitFor(() => {
    expect(h.resource.register).toHaveBeenCalled()
  })
  helper.kill()
  await vi.waitFor(() => {
    expect(exited).toHaveBeenCalledWith(
      'could not start: Registered resource tree could not be stopped',
    )
  })
  expect(h.resource.kill).toHaveBeenCalledTimes(1)
  expect(h.rawKill).not.toHaveBeenCalled()
  expect(h.resource.complete).not.toHaveBeenCalledWith(true)
})

it.each(['job', 'posix'])(
  'routes a contained plugin stop through its lease and preserves refusal (%s)',
  async (platform) => {
    const h = fixture()
    const rawSignal = vi.spyOn(process, 'kill').mockReturnValue(true)
    const tree = platform === 'job' ? jobProcessTree(() => h.child) : posixProcessTree
    const child = await tree.spawn('plugin.exe', [], {
      env: {},
      cwd: String.raw`C:\workspace`,
      resource: h.resource,
    })
    await expect(tree.killTree(child)).rejects.toThrow(
      'Registered resource tree could not be stopped',
    )
    expect(h.resource.kill).toHaveBeenCalledTimes(1)
    expect(h.rawKill).not.toHaveBeenCalled()
    expect(rawSignal).not.toHaveBeenCalled()
  },
)
