// The desktop terminal sessions (desktop/app/terminals.ts): the person's
// real shell on a real PTY. Every test spawns real shells through the
// compiled node-pty binding and, for rendering, feeds captured bytes to a
// real headless xterm.js emulator.
import { mkdtemp, realpath, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Terminal } from '@xterm/headless'
import { confineTerminalCwd } from '../../../desktop/app/files'
import { processTreeProbeArgs, processTreeWindowsScript } from '../../../desktop/app/processTree'
import { TerminalSessions } from '../../../desktop/app/terminals'
import { removeFolder } from '../helpers/temporaryFolders'

const scratchRoots: string[] = []
const liveSessions: TerminalSessions[] = []

async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'muse-desktop-bp-'))
  scratchRoots.push(dir)
  return dir
}

interface SessionEvents {
  chunks: string[]
  exits: (number | null)[]
}

function sessions(): { events: SessionEvents; all: TerminalSessions } {
  const events: SessionEvents = { chunks: [], exits: [] }
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

/** Runs the body with a scratch HOME, restored afterwards. */
async function withIsolatedHome(
  body: (context: { events: SessionEvents; all: TerminalSessions; root: string }) => Promise<void>,
): Promise<void> {
  const previousHome = process.env['HOME']
  process.env['HOME'] = await scratch()
  try {
    const { events, all } = sessions()
    const root = await scratch()
    await body({ events, all, root })
  } finally {
    if (previousHome === undefined) delete process.env['HOME']
    else process.env['HOME'] = previousHome
  }
}

afterEach(async () => {
  for (const all of liveSessions.splice(0)) all.closeAll()
  // A killed Windows shell holds its working folder for a moment after the kill.
  await Promise.all(
    scratchRoots.splice(0).map(async (dir) => {
      await removeFolder(dir)
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
    all.write(created.id, 'stty size\rexit\r')
    await waitFor(() => events.chunks.join('').includes('40 100'))
    await waitFor(() => events.exits.length === 1)
    expect(events.exits).toEqual([0])
  })

  it('an agent session runs its command and carries its label', async () => {
    const { events, all } = sessions()
    const root = await scratch()
    const created = all.create({
      cwd: root,
      cols: 80,
      rows: 24,
      agent: { label: 'web-eng', runId: 'run-9', command: 'echo bp-agent-ran' },
    })
    expect(created.title).toBe('web-eng')
    await waitFor(() => events.chunks.join('').includes('bp-agent-ran'))
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
      agent: { label: 'web-eng', runId: 'run-1', command: 'exit 3' },
    })
    const person = all.create({ cwd: root, cols: 80, rows: 24 })
    all.write(agent.id, 'echo agent-marker-never-typed\r')
    all.write(person.id, 'echo person-marker-typed\r')
    await waitFor(() => events.chunks.join('').includes('person-marker-typed'))
    const output = events.chunks.join('')
    expect(output).not.toContain('agent-marker-never-typed')
    // Its command ends by itself. A session closed first would report no exit at all,
    // and on Windows the exit arrives after the person's echo, so it is waited for.
    await waitFor(() => events.exits.includes(3))
    all.close(agent.id)
    expect(all.list().map((session) => session.id)).toEqual([person.id])
    // Its own exit drops the person's session too, so it waits for the list above.
    all.write(person.id, 'exit\r')
    await waitFor(() => events.exits.length === 2)
    expect(events.exits).toHaveLength(2)
    expect(events.exits).toContain(0)
    expect(events.exits).toContain(3)
    expect(all.list()).toEqual([])
  })

  it('the child probe sees running commands, not idle prompts', async () => {
    await withIsolatedHome(async ({ events, all, root }) => {
      const created = all.create({ cwd: root, cols: 80, rows: 24 })
      // Echo is a builtin: when its marker returns the shell is truly
      // idle at its prompt, not merely still starting.
      all.write(created.id, 'echo bp-prompt-ready\r')
      await waitFor(() => events.chunks.join('').includes('bp-prompt-ready'))
      expect(all.hasChildren(created.id)).toBe(false)
      all.write(
        created.id,
        process.platform === 'win32' ? 'ping -n 30 127.0.0.1 > NUL\r' : 'sleep 27\r',
      )
      await waitFor(() => all.hasChildren(created.id))
      all.close(created.id)
      expect(all.list()).toEqual([])
      expect(all.hasChildren(created.id)).toBe(false)
    })
  })

  it.runIf(process.platform !== 'win32')('closing ends the running command', async () => {
    const { spawnSync } = await import('node:child_process')
    await withIsolatedHome(async ({ events, all, root }) => {
      const created = all.create({ cwd: root, cols: 80, rows: 24 })
      all.write(created.id, 'sleep 28 & echo bp-sleep-pid-$!\r')
      await waitFor(() => /bp-sleep-pid-\d+/.test(events.chunks.join('')))
      const pid = Number(/bp-sleep-pid-(\d+)/.exec(events.chunks.join(''))?.[1])
      expect(pid).toBeGreaterThan(0)
      expect(all.hasChildren(created.id)).toBe(true)
      all.close(created.id)
      await waitFor(() => spawnSync('ps', ['-p', String(pid)], { encoding: 'utf8' }).status !== 0)
    })
  })

  it('terminal environments carry no credential variables end to end', async () => {
    process.env['MUSE_BP_PROBE_API_KEY'] = 'bp-probe-not-a-key'
    try {
      const { events, all } = sessions()
      const root = await scratch()
      const created = all.create({ cwd: root, cols: 80, rows: 24 })
      const probe =
        process.platform === 'win32'
          ? 'echo MARKER_START & set | findstr BP_PROBE_MARKER & echo MARKER_END & exit\r'
          : 'echo MARKER_START; env | grep BP_PROBE_MARKER; echo MARKER_END; exit\r'
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
    const realRoot = await realpath(root)
    await expect(confineTerminalCwd(root, root)).resolves.toBe(realRoot)
    await expect(confineTerminalCwd(root, 'sub/dir')).resolves.toBe(path.join(realRoot, 'sub/dir'))
    await expect(confineTerminalCwd(root, path.join(tmpdir(), '..', 'outside-bp'))).rejects.toThrow(
      /outside the workspace/,
    )
    await expect(confineTerminalCwd(root, '../outside-bp')).rejects.toThrow(/outside the workspace/)
    // A link inside the workspace that leaves it is refused like `..`.
    const outside = await scratch()
    await symlink(
      outside,
      path.join(root, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(confineTerminalCwd(root, 'linked')).rejects.toThrow(/outside the workspace/)
  })
})
