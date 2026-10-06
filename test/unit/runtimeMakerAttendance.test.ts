import { describe, expect, it, vi } from 'vitest'
import { isMakerTerminalAttended } from '../../src/runtime/maker/attended'
import { runRuntimeMaker } from '../../src/runtime/maker/entry'
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
describe('computed maker terminal attendance', () => {
  it.each(['linux', 'darwin'] as const)(
    'accepts a proven terminal parent chain on %s',
    async (platform) => {
      expect(await isMakerTerminalAttended(fixture(platform))).toBe(true)
    },
  )
  it('accepts Windows terminal ancestry through the platform process table', async () => {
    const deps = fixture('win32')
    deps.run.mockResolvedValue(
      JSON.stringify([
        { ProcessId: 2, ParentProcessId: 3, Name: 'powershell.exe' },
        { ProcessId: 3, ParentProcessId: 1, Name: 'WindowsTerminal.exe' },
        { ProcessId: 1, ParentProcessId: 0, Name: 'System' },
      ]),
    )
    expect(
      await isMakerTerminalAttended({ ...deps, env: { SystemRoot: String.raw`C:\Windows` } }),
    ).toBe(true)
    expect(deps.run.mock.calls[0]?.[0]).toContain('powershell.exe')
  })
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
      const print = vi.fn(),
        readSecret = vi.fn()
      await expect(
        runRuntimeMaker(command, {
          dataDirectory: '/not-created',
          distDirectory: '/not-read',
          workspace: '/not-read',
          platform: 'linux',
          env: { MUSE_SPARK_AGENT_SHELL: '1' },
          print,
          readSecret,
          secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() },
          done: new AbortController().signal,
          table: EN,
          locale: 'en',
        }),
      ).rejects.toThrow(UI_TEXT.makerUnattendedDenied)
      expect(print).not.toHaveBeenCalled()
      expect(readSecret).not.toHaveBeenCalled()
    },
  )
})
