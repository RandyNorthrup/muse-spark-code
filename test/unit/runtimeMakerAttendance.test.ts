import { describe, expect, it, vi } from 'vitest'
import { isMakerTerminalAttended, readMakerSshPeer } from '../../src/runtime/maker/attended'
import { createServer, createConnection, type Socket } from 'node:net'
import * as attendance from '../../src/runtime/maker/attended'
import { runRuntimeMaker, type RuntimeMakerEntryDeps } from '../../src/runtime/maker/entry'
import { parseMakerCommand } from '../../src/runtime/maker/commandArgs'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'

function fixture(platform: NodeJS.Platform = 'linux') {
  const run = vi.fn().mockResolvedValue('2 3 bash\n3 1 konsole\n1 0 systemd')
  return {
    stdinTty: true,
    stdoutTty: true,
    parentPid: 2,
    platform,
    env: {},
    run,
    readExecutable: (pid: number) =>
      Promise.resolve(pid === 3 ? '/usr/bin/konsole' : '/usr/bin/bash'),
  }
}

function windowsFixture(
  terminalPath: string | null,
  shell?: { Name: string; ExecutablePath: string },
) {
  const deps = fixture('win32')
  deps.run.mockResolvedValue(
    JSON.stringify([
      {
        ProcessId: 2,
        ParentProcessId: 3,
        ...(shell ?? { Name: 'cmd.exe', ExecutablePath: 'C:/Windows/System32/cmd.exe' }),
      },
      {
        ProcessId: 3,
        ParentProcessId: 4,
        Name: 'WindowsTerminal.exe',
        ExecutablePath: terminalPath,
      },
      { ProcessId: 4, ParentProcessId: 0, Name: 'System', ExecutablePath: null },
    ]),
  )
  return { ...deps, env: { SystemRoot: String.raw`C:\Windows` } }
}

function entryFixture(env: NodeJS.ProcessEnv = {}) {
  return {
    dataDirectory: '/not-created',
    distDirectory: '/not-read',
    workspace: '/not-read',
    platform: 'linux',
    env,
    print: vi.fn(),
    readSecret: vi.fn(),
    secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() },
    done: new AbortController().signal,
    table: EN,
    locale: 'en',
  } satisfies RuntimeMakerEntryDeps
}
describe('computed maker terminal attendance', () => {
  it('reads the established peer from an owned Linux socket rather than its environment', async () => {
    if (process.platform !== 'linux') {
      await expect(readMakerSshPeer(-1)).rejects.toThrow()
      return
    }
    const server = createServer()
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('address')
    const client = createConnection({ host: '127.0.0.1', port: address.port })
    const accepted = new Promise<Socket>((resolve) => {
      server.once('connection', resolve)
    })
    try {
      const incoming = await accepted
      try {
        expect(await readMakerSshPeer(process.pid)).toBe('127.0.0.1')
      } finally {
        incoming.destroy()
      }
    } finally {
      client.destroy()
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      })
    }
  })
  it.each(['linux', 'darwin'] as const)(
    'accepts a proven terminal parent chain on %s',
    async (platform) => {
      expect(await isMakerTerminalAttended(fixture(platform))).toBe(true)
    },
  )
  it('accepts Windows terminal ancestry through the platform process table', async () => {
    const deps = windowsFixture(
      String.raw`C:\Program Files\WindowsApps\Microsoft.WindowsTerminal_1.23.0.0_x64__8wekyb3d8bbwe\WindowsTerminal.exe`,
      {
        Name: 'powershell.exe',
        ExecutablePath: String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
      },
    )
    expect(await isMakerTerminalAttended(deps)).toBe(true)
    expect(deps.run.mock.calls[0]?.[0]).toContain('powershell.exe')
  })
  it.each([
    '127.0.0.1',
    '127.12.34.56',
    '::1',
    '::ffff:127.0.0.1',
    '192.168.1.10',
    '::ffff:192.168.1.10',
    '2001:db8::10',
  ])('refuses ssh -tt to this machine through client address %s', async (address) => {
    const deps = fixture()
    deps.run.mockResolvedValue('2 3 bash\n3 1 sshd\n1 0 systemd')
    expect(
      await isMakerTerminalAttended({
        ...deps,
        env: {
          SSH_CONNECTION: `${address} 12345 192.168.1.10 22`,
          SSH_CLIENT: `${address} 12345 22`,
        },
        localAddresses: () => ['192.168.1.10', '2001:db8::10'],
        readExecutable: (pid) => Promise.resolve(pid === 3 ? '/usr/sbin/sshd' : '/usr/bin/bash'),
        readSshPeer: () => Promise.resolve(address),
      }),
    ).toBe(false)
  })
  it.each(['linux', 'darwin'] as const)(
    'accepts SSH only from another machine on %s',
    async (platform) => {
      const deps = fixture(platform)
      deps.run.mockResolvedValue('2 3 bash\n3 1 sshd\n1 0 systemd')
      expect(
        await isMakerTerminalAttended({
          ...deps,
          env: {
            SSH_CONNECTION: '192.168.1.20 12345 192.168.1.10 22',
            SSH_CLIENT: '192.168.1.20 12345 22',
          },
          localAddresses: () => ['192.168.1.10'],
          readExecutable: (pid) => Promise.resolve(pid === 3 ? '/usr/sbin/sshd' : '/usr/bin/bash'),
          readSshPeer: () => Promise.resolve('192.168.1.20'),
        }),
      ).toBe(true)
    },
  )
  it.each([undefined, '127.0.0.1', '192.168.1.10', '192.168.1.30'])(
    'refuses forged remote SSH variables with an unknown/local/different kernel peer %s',
    async (peer) => {
      const deps = fixture()
      deps.run.mockResolvedValue('2 3 bash\n3 1 sshd\n1 0 systemd')
      expect(
        await isMakerTerminalAttended({
          ...deps,
          env: { SSH_CLIENT: '192.168.1.20 12345 22' },
          localAddresses: () => ['192.168.1.10'],
          readExecutable: (pid) => Promise.resolve(pid === 3 ? '/usr/sbin/sshd' : '/usr/bin/bash'),
          readSshPeer: () => Promise.resolve(peer),
        }),
      ).toBe(false)
    },
  )
  it('refuses an sshd ancestor without SSH client evidence', async () => {
    const deps = fixture('darwin')
    deps.run.mockResolvedValue('2 3 bash\n3 1 sshd\n1 0 launchd')
    expect(await isMakerTerminalAttended(deps)).toBe(false)
  })
  it.each(['127.0.0.1', '192.168.1.10', '192.168.1.20'])(
    'macOS reads the sshd socket peer instead of trusting a forged environment: %s',
    async (peer) => {
      const deps = fixture('darwin')
      deps.run.mockResolvedValueOnce('2 3 bash\n3 1 sshd\n1 0 launchd')
      deps.run.mockResolvedValueOnce(`p3\nn192.168.1.10:22->${peer}:12345\n`)
      expect(
        await isMakerTerminalAttended({
          ...deps,
          env: { SSH_CLIENT: '192.168.1.20 12345 22' },
          localAddresses: () => ['192.168.1.10'],
        }),
      ).toBe(peer === '192.168.1.20')
      expect(deps.run.mock.calls[1]?.[0]).toBe('/usr/sbin/lsof')
    },
  )
  it.each([
    null,
    String.raw`C:\Users\person\WindowsTerminal.exe`,
    String.raw`C:\Windows\Temp\WindowsTerminal.exe`,
    String.raw`C:\Program Files\WindowsApps\fake\WindowsTerminal.exe`,
  ])(
    'refuses a Windows terminal name without its system executable identity: %s',
    async (executable) => {
      expect(await isMakerTerminalAttended(windowsFixture(executable))).toBe(false)
    },
  )
  it.each(['tmux: server', 'screen'])(
    'marks %s ancestry for independent person authority',
    async (name) => {
      const deps = fixture('darwin')
      deps.run.mockResolvedValue(`2 5 bash\n5 3 ${name}\n3 1 Terminal\n1 0 launchd`)
      const onMultiplexer = vi.fn()
      expect(await isMakerTerminalAttended({ ...deps, onMultiplexer })).toBe(true)
      expect(onMultiplexer).toHaveBeenCalledOnce()
    },
  )
  it.each(['stdinTty', 'stdoutTty'] as const)(
    'refuses a redirected %s before probing',
    async (key) => {
      const deps = fixture()
      expect(await isMakerTerminalAttended({ ...deps, [key]: false })).toBe(false)
      expect(deps.run).not.toHaveBeenCalled()
    },
  )
  it.each(['CI', 'MUSE_SPARK_AGENT_SHELL', 'CODEX_THREAD_ID', 'CLAUDECODE'])(
    'refuses marker %s even with both TTYs',
    async (key) => {
      const deps = fixture()
      expect(await isMakerTerminalAttended({ ...deps, env: { [key]: '1' } })).toBe(false)
      expect(deps.run).not.toHaveBeenCalled()
    },
  )
  it.each(['codex', 'claude', 'muse', 'node', 'python3', 'unknown-launcher'])(
    'refuses an agent/unknown ancestor %s despite a TTY shell',
    async (name) => {
      const deps = fixture()
      deps.run.mockResolvedValue(`2 3 bash\n3 1 ${name}\n1 0 systemd`)
      expect(await isMakerTerminalAttended(deps)).toBe(false)
    },
  )
  it('refuses orphaned shells and interpreters that impersonate a terminal process name', async () => {
    const deps = fixture()
    deps.run.mockResolvedValue('2 1 bash\n1 0 systemd')
    expect(await isMakerTerminalAttended(deps)).toBe(false)
    deps.run.mockResolvedValue('2 3 bash\n3 1 konsole\n1 0 systemd')
    expect(
      await isMakerTerminalAttended({
        ...deps,
        readExecutable: () => Promise.resolve('/usr/bin/python3'),
      }),
    ).toBe(false)
  })
  it.each(['2 9 bash', '2 2 bash', 'malformed'])(
    'treats missing, cyclic and malformed ancestry as unattended: %s',
    async (table) => {
      const deps = fixture()
      deps.run.mockResolvedValue(table)
      expect(await isMakerTerminalAttended(deps)).toBe(false)
    },
  )
  it.each([
    ['hardware', 'enable', '--reason', 'x', '--trust-workspace'],
    ['machines', 'add', '--registration', '{}', '--trust-workspace'],
    ['panel', '--trust-workspace'],
  ])(
    'real CLI entry refuses non-TTY agent-shell privilege %j before storage or credential output',
    async (...args) => {
      const command = parseMakerCommand(args)
      if (command === undefined) throw new Error('command')
      const deps = entryFixture({ MUSE_SPARK_AGENT_SHELL: '1' })
      await expect(runRuntimeMaker(command, deps)).rejects.toThrow(UI_TEXT.makerUnattendedDenied)
      expect(deps.print).not.toHaveBeenCalled()
      expect(deps.readSecret).not.toHaveBeenCalled()
    },
  )
  it.each([
    ['hardware', 'enable', '--reason', 'injected', '--trust-workspace'],
    ['machines', 'add', '--registration', '{}', '--trust-workspace'],
    ['panel', '--trust-workspace'],
  ])(
    'real CLI entry refuses multiplexer privilege %j before storage or key input',
    async (...args) => {
      const command = parseMakerCommand(args)
      if (command === undefined) throw new Error('command')
      const attended = vi
        .spyOn(attendance, 'isMakerTerminalAttended')
        .mockImplementation((deps) => {
          deps.onMultiplexer?.()
          return Promise.resolve(true)
        })
      const deps = entryFixture()
      try {
        await expect(runRuntimeMaker(command, deps)).rejects.toThrow(UI_TEXT.makerMultiplexerDenied)
        expect(deps.print).not.toHaveBeenCalled()
        expect(deps.readSecret).not.toHaveBeenCalled()
      } finally {
        attended.mockRestore()
      }
    },
  )
})
