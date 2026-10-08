import * as childProcess from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as admission from '../../src/core/resources/admission'
import { spawnResourceProcess } from '../../src/core/resources/process'
import { handoffResourceFile } from '../../src/core/resources/commands'
import { RESOURCE_HANDOFF_TIMEOUT_MS } from '../../src/shared/constants'
import { fakeResourceLease } from './helpers/resources/fakes'
import { removeFolder } from './helpers/temporaryFolders'

vi.mock('../../src/core/resources/admission', { spy: true })
vi.mock('node:child_process', { spy: true })
afterEach(() => vi.restoreAllMocks())

// Linux names the session; macOS ps has no portable session column.
const columns = process.platform === 'linux' ? ['sid', 'pgid', 'tty'] : ['pgid', 'tty']
const psArgs = columns.flatMap((column) => ['-o', `${column}=`])

function parentIdentity(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    childProcess.execFile('/bin/ps', [...psArgs, '-p', String(process.pid)], (error, stdout) => {
      if (error === null) resolve(stdout.trim().split(/\s+/u))
      else reject(new Error('ps failed', { cause: error }))
    })
  })
}

describe('explicit portable launch profiles', () => {
  it('keeps interactive login in the terminal session and observes its exit', async () => {
    const lease = fakeResourceLease()
    vi.mocked(admission.admitResource).mockResolvedValue(lease)
    const spawn = vi.spyOn(childProcess, 'spawn')
    const { child } = await spawnResourceProcess(
      'interactive',
      process.execPath,
      ['-e', 'process.exit(0)'],
      { env: process.env },
    )
    try {
      expect(spawn).toHaveBeenCalledWith(
        process.execPath,
        expect.any(Array),
        expect.objectContaining({ stdio: 'inherit', detached: false, shell: false }),
      )
      expect(child.stdin).toBeNull()
      expect(lease.register).toHaveBeenCalledWith(
        expect.objectContaining({ profile: 'interactive', stop: expect.any(Function) }),
      )
      await once(child, 'exit')
      expect(lease.complete).toHaveBeenCalledWith(true)
    } finally {
      child.kill('SIGKILL')
    }
  })

  it.runIf(process.platform !== 'win32')(
    'gives interactive login the terminal’s session, group and TTY; contained work gets its own',
    async () => {
      const folder = await mkdtemp(path.join(tmpdir(), 'l-SPAWN017C-'))
      try {
        const read = async (file: string) => {
          const text = await readFile(file, 'utf8')
          return text.trim().split(/\s+/u)
        }
        // The shell reports its own session, process group and controlling terminal.
        const probe = (file: string) => `/bin/ps ${psArgs.join(' ')} -p $$ > '${file}'`
        const parent = await parentIdentity()
        vi.mocked(admission.admitResource).mockResolvedValue(fakeResourceLease())
        const interactiveFile = path.join(folder, 'interactive')
        const interactive = await spawnResourceProcess(
          'interactive',
          '/bin/sh',
          ['-c', probe(interactiveFile)],
          { env: { PATH: '/usr/bin:/bin' } },
        )
        await once(interactive.child, 'exit')
        expect(await read(interactiveFile)).toEqual(parent)

        vi.mocked(admission.admitResource).mockResolvedValue(fakeResourceLease())
        const containedFile = path.join(folder, 'contained')
        const contained = await spawnResourceProcess(
          'contained',
          '/bin/sh',
          ['-c', probe(containedFile)],
          { env: { PATH: '/usr/bin:/bin' } },
        )
        contained.child.stdin.end()
        await once(contained.child, 'exit')
        const own = await read(containedFile)
        expect(own[columns.indexOf('pgid')]).toBe(String(contained.child.pid))
        expect(own[columns.indexOf('pgid')]).not.toBe(parent[columns.indexOf('pgid')])
        if (process.platform === 'linux') expect(own[0]).toBe(String(contained.child.pid))
      } finally {
        await removeFolder(folder)
      }
    },
  )

  it('waits for a bounded handoff without allocating or killing a contained tree', async () => {
    const lease = fakeResourceLease()
    vi.mocked(admission.admitResource).mockResolvedValue(lease)
    const stop = vi.spyOn(admission, 'stopResourceTree')
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const spawn = vi.spyOn(childProcess, 'spawn')
    const { child } = await spawnResourceProcess(
      'handoff',
      process.execPath,
      ['-e', 'process.exit(0)'],
      { env: process.env },
    )
    child.stdin.end()
    await once(child, 'exit')
    expect(timeout).toHaveBeenCalledWith(RESOURCE_HANDOFF_TIMEOUT_MS)
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      expect.any(Array),
      expect.objectContaining({ detached: false, stdio: ['pipe', 'ignore', 'ignore'] }),
    )
    expect(stop).not.toHaveBeenCalled()
    expect(lease.complete).toHaveBeenCalledWith(true)
    expect(admission.admitResource).toHaveBeenCalledWith(
      'other',
      expect.any(AbortSignal),
      'background',
    )
  })

  it('kills only a hanging handoff root when its named deadline aborts', async () => {
    const lease = fakeResourceLease()
    vi.mocked(admission.admitResource).mockResolvedValue(lease)
    const deadline = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    const stop = vi.spyOn(admission, 'stopResourceTree')
    const { child } = await spawnResourceProcess(
      'handoff',
      process.execPath,
      ['-e', 'setInterval(()=>{},1000)'],
      { env: process.env },
    )
    try {
      const exited = once(child, 'exit')
      deadline.abort()
      await exited
      expect(child.signalCode).toBe('SIGKILL')
      expect(stop).not.toHaveBeenCalled()
    } finally {
      child.kill('SIGKILL')
    }
  })

  it('returns at the adapter’s exit while the program it opened keeps running', async () => {
    vi.mocked(admission.admitResource).mockResolvedValue(fakeResourceLease())
    const folder = await mkdtemp(path.join(tmpdir(), 'l-SPAWN017C-'))
    const marker = path.join(folder, 'browser.pid')
    let browserPid: number | undefined
    try {
      // The adapter starts a long-lived "browser" with its inherited stdio, then exits.
      const adapter = `const c=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'inherit',detached:true});require('node:fs').writeFileSync(${JSON.stringify(marker)},String(c.pid));c.unref();process.stdin.resume();process.stdin.on('end',()=>process.exit(0))`
      await expect(
        handoffResourceFile(process.execPath, ['-e', adapter], { env: process.env, input: 'x' }),
      ).resolves.toBeUndefined()
      browserPid = Number(await readFile(marker, 'utf8'))
      // Alive: signal 0 throws for a process that is gone.
      expect(() => process.kill(browserPid ?? 0, 0)).not.toThrow()
    } finally {
      if (browserPid !== undefined) process.kill(browserPid, 'SIGKILL')
      await removeFolder(folder)
    }
  })

  it('refuses a handoff the OS adapter failed', async () => {
    vi.mocked(admission.admitResource).mockResolvedValue(fakeResourceLease())
    await expect(
      handoffResourceFile(process.execPath, ['-e', 'process.exit(3)'], { env: process.env }),
    ).rejects.toThrow('Governed handoff failed')
  })
})
