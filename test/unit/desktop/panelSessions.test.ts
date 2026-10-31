// The desktop terminal sessions (desktop/app/terminals.ts): the person's
// real shell on a real PTY. Every test spawns real shells through the
// compiled node-pty binding and, for rendering, feeds captured bytes to a
// real headless xterm.js emulator.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Terminal } from '@xterm/headless'
import { confineTerminalCwd } from '../../../desktop/app/files'
import { processTreeProbeArgs, processTreeWindowsScript } from '../../../desktop/app/processTree'
import { TerminalSessions } from '../../../desktop/app/terminals'

const scratchRoots: string[] = []
const liveSessions: TerminalSessions[] = []

async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'muse-desktop-bp-'))
  scratchRoots.push(dir)
  return dir
}

function sessions(): {
  events: { chunks: string[]; exits: (number | null)[] }
  all: TerminalSessions
} {
  const events = { chunks: [] as string[], exits: [] as (number | null)[] }
  const all = new TerminalSessions({
    onData: (_id, data) => {
      events.chunks.push(data)
    },
    onExit: (_id, code) => {
      events.exits.push(code)
    },
  })
  liveSessions.push(all)
  return { events, all }
}

afterEach(async () => {
  for (const all of liveSessions.splice(0)) all.closeAll()
  await Promise.all(
    scratchRoots.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    }),
  )
})

async function waitFor(isDone: () => boolean): Promise<void> {
  const deadline = Date.now() + 4000
  while (!isDone() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  expect(isDone()).toBe(true)
}

describe('M111 lane BP terminal sessions', () => {
  it.runIf(process.platform !== 'win32')('resize applies to the live PTY', async () => {
    const { events, all } = sessions()
    const root = await scratch()
    const created = all.create({ cwd: root, cols: 80, rows: 24 })
    all.resize(created.id, 100, 40)
    all.write(created.id, 'stty size\nexit\n')
    await waitFor(() => events.chunks.join('').includes('40 100'))
    await waitFor(() => events.exits.length === 1)
    expect(events.exits).toEqual([0])
  })

  it('read-only agent sessions refuse writes while person sessions echo', async () => {
    const { events, all } = sessions()
    const root = await scratch()
    const agent = all.create({
      cwd: root,
      cols: 80,
      rows: 24,
      agent: { label: 'web-eng', runId: 'run-1', command: 'vitest' },
    })
    const person = all.create({ cwd: root, cols: 80, rows: 24 })
    all.write(agent.id, 'echo agent-marker-never-typed\n')
    all.write(person.id, 'echo person-marker-typed\nexit\n')
    await waitFor(() => events.chunks.join('').includes('person-marker-typed'))
    const output = events.chunks.join('')
    expect(output).not.toContain('agent-marker-never-typed')
    // Closing drops the session at once; only the person's own exit emits.
    all.close(agent.id)
    expect(all.list().map((session) => session.id)).toEqual([person.id])
    await waitFor(() => events.exits.length === 1)
    expect(all.list()).toEqual([])
  })

  it('the child probe sees running commands, not idle prompts', async () => {
    const previousHome = process.env['HOME']
    process.env['HOME'] = await scratch()
    try {
      const { events, all } = sessions()
      const root = await scratch()
      const created = all.create({ cwd: root, cols: 80, rows: 24 })
      // Echo is a builtin: when its marker returns the shell is truly
      // idle at its prompt, not merely still starting.
      all.write(created.id, 'echo bp-prompt-ready\n')
      await waitFor(() => events.chunks.join('').includes('bp-prompt-ready'))
      expect(all.hasChildren(created.id)).toBe(false)
      if (process.platform === 'win32') {
        all.write(created.id, 'ping -n 30 127.0.0.1 > NUL\n')
      } else {
        all.write(created.id, 'sleep 27\n')
      }
      await waitFor(() => all.hasChildren(created.id))
      all.close(created.id)
      expect(all.list()).toEqual([])
      expect(all.hasChildren(created.id)).toBe(false)
    } finally {
      if (previousHome === undefined) delete process.env['HOME']
      else process.env['HOME'] = previousHome
    }
  })

  it.runIf(process.platform !== 'win32')('closing ends the running command', async () => {
    const { spawnSync } = await import('node:child_process')
    const previousHome = process.env['HOME']
    process.env['HOME'] = await scratch()
    try {
      const { events, all } = sessions()
      const root = await scratch()
      const created = all.create({ cwd: root, cols: 80, rows: 24 })
      all.write(created.id, 'sleep 28 & echo bp-sleep-pid-$!\n')
      await waitFor(() => /bp-sleep-pid-\d+/.test(events.chunks.join('')))
      const pid = Number(/bp-sleep-pid-(\d+)/.exec(events.chunks.join(''))?.[1])
      expect(pid).toBeGreaterThan(0)
      expect(all.hasChildren(created.id)).toBe(true)
      all.close(created.id)
      await waitFor(() => spawnSync('ps', ['-p', String(pid)], { encoding: 'utf8' }).status !== 0)
    } finally {
      if (previousHome === undefined) delete process.env['HOME']
      else process.env['HOME'] = previousHome
    }
  })

  it('terminal environments carry no credential variables end to end', async () => {
    process.env['MUSE_BP_PROBE_API_KEY'] = 'bp-probe-not-a-key'
    try {
      const { events, all } = sessions()
      const root = await scratch()
      const created = all.create({ cwd: root, cols: 80, rows: 24 })
      const probe =
        process.platform === 'win32'
          ? 'echo MARKER_START & set | findstr BP_PROBE_MARKER & echo MARKER_END & exit\n'
          : 'echo MARKER_START; env | grep BP_PROBE_MARKER; echo MARKER_END; exit\n'
      all.write(created.id, probe)
      await waitFor(
        () =>
          events.chunks.join('').includes('MARKER_START') &&
          events.chunks.join('').includes('MARKER_END'),
      )
      await waitFor(() => events.exits.length === 1)
      expect(events.chunks.join('')).not.toContain('bp-probe-not-a-key')
    } finally {
      delete process.env['MUSE_BP_PROBE_API_KEY']
    }
  })

  it.runIf(process.platform !== 'win32')('a real emulator renders captured PTY bytes', async () => {
    const { events, all } = sessions()
    const root = await scratch()
    const created = all.create({ cwd: root, cols: 80, rows: 24 })
    all.write(created.id, "printf '\\e[31mred\\e[0m \\u2713\\n'; exit\n")
    await waitFor(() => events.exits.length === 1)
    const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true })
    try {
      await new Promise<void>((resolve) => {
        terminal.write(events.chunks.join(''), () => {
          resolve()
        })
      })
      const lines: string[] = []
      const buffer = terminal.buffer.active
      for (let row = 0; row < buffer.length; row += 1) {
        lines.push(buffer.getLine(row)?.translateToString(true) ?? '')
      }
      expect(lines.some((line) => line.includes('red') && line.includes('✓'))).toBe(true)
    } finally {
      terminal.dispose()
    }
  })

  it('unknown sessions are ignored, list and cwd stay honest', async () => {
    const { all } = sessions()
    all.write('missing', 'x')
    all.resize('missing', 80, 24)
    all.close('missing')
    expect(all.hasChildren('missing')).toBe(false)
    expect(all.list()).toEqual([])

    const root = await scratch()
    expect(processTreeProbeArgs(4242)).toEqual(['-P', '4242'])
    expect(processTreeWindowsScript(4242)).toContain('ParentProcessId=4242')
    expect(confineTerminalCwd(root, root)).toBe(path.resolve(root))
    expect(confineTerminalCwd(root, 'sub/dir')).toBe(path.resolve(root, 'sub/dir'))
    expect(() => confineTerminalCwd(root, path.join(tmpdir(), '..', 'outside-bp'))).toThrow(
      /outside the workspace/,
    )
    expect(() => confineTerminalCwd(root, '../outside-bp')).toThrow(/outside the workspace/)
  })
})
