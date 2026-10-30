import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DesktopFileError,
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
} from '../../../desktop/app/files'
import { LayoutStore, writeStatusSnapshot } from '../../../desktop/app/layoutStore'
import { TerminalSessions, cleanTerminalEnvironment } from '../../../desktop/app/terminals'
import { DEFAULT_WORKBENCH_LAYOUT } from '../../../src/shared/desktop/bridge'

const scratchRoots: string[] = []

async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'muse-desktop-wb-'))
  scratchRoots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    scratchRoots.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true })
    }),
  )
})

describe('M111 lane WB desktop shell services', () => {
  it('lists, reads and writes real workspace files, confined to the root', async () => {
    const root = await scratch()
    await mkdir(path.join(root, 'src'), { recursive: true })
    await mkdir(path.join(root, 'node_modules', 'dep'), { recursive: true })
    await writeFile(path.join(root, 'src', 'a.ts'), 'export {}')
    await writeFile(path.join(root, 'node_modules', 'dep', 'b.js'), 'x')
    await writeFile(path.join(root, 'README.md'), '# hi')

    const listed = await listWorkspaceFiles(root)
    expect(listed.map((entry) => entry.path)).toEqual(['README.md', 'src/a.ts'])

    expect(await readWorkspaceFile(root, 'src/a.ts')).toEqual({
      path: 'src/a.ts',
      text: 'export {}',
    })
    await writeWorkspaceFile(root, 'src/a.ts', 'changed')
    expect(await readFile(path.join(root, 'src', 'a.ts'), 'utf8')).toBe('changed')

    await expect(readWorkspaceFile(root, '../outside.txt')).rejects.toBeInstanceOf(DesktopFileError)
    await writeFile(path.join(root, 'bin.dat'), Buffer.from([1, 0, 2]))
    await expect(readWorkspaceFile(root, 'bin.dat')).rejects.toMatchObject({ kind: 'not-text' })
  })

  it('persists layouts per workspace and per compositor workspace', async () => {
    const dir = await scratch()
    const store = new LayoutStore(dir)
    expect(await store.get({ workspaceRoot: '/work/app' })).toBeNull()
    const layout = { ...DEFAULT_WORKBENCH_LAYOUT, chatWidthPx: 400 }
    await store.set({ workspaceRoot: '/work/app' }, layout)
    await store.set(
      { workspaceRoot: '/work/app', compositorWorkspace: '2' },
      { ...layout, chatWidthPx: 500 },
    )
    const reopened = new LayoutStore(dir)
    const plain = await reopened.get({ workspaceRoot: '/work/app' })
    const scoped = await reopened.get({ workspaceRoot: '/work/app', compositorWorkspace: '2' })
    expect(plain?.chatWidthPx).toBe(400)
    expect(scoped?.chatWidthPx).toBe(500)
  })

  it('writes the ordered status snapshot SH1 reads', async () => {
    const dir = await scratch()
    const filePath = await writeStatusSnapshot(dir, '/work/app', [
      { id: 'b', side: 'right', text: 'B', priority: 10 },
      { id: 'a', side: 'left', text: 'A', priority: 5 },
    ])
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as {
      workspaceRoot: string
      items: { id: string }[]
    }
    expect(parsed.workspaceRoot).toBe('/work/app')
    expect(parsed.items.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('strips credential variables from terminal environments', () => {
    const cleaned = cleanTerminalEnvironment({
      PATH: '/bin',
      META_API_KEY: 'never-in-a-child',
      OPENAI_API_KEY: 'never-in-a-child',
      HOME: '/home/dev',
    })
    expect(cleaned['PATH']).toBe('/bin')
    expect(cleaned['HOME']).toBe('/home/dev')
    expect('META_API_KEY' in cleaned).toBe(false)
    expect('OPENAI_API_KEY' in cleaned).toBe(false)
    expect(cleaned['TERM']).toBe('xterm-256color')
  })

  it('runs a real shell and streams its output and exit', async () => {
    const chunks: string[] = []
    let exited: number | null | undefined
    const sessions = new TerminalSessions({
      onData: (_id, data) => {
        chunks.push(data)
      },
      onExit: (_id, code) => {
        exited = code
      },
    })
    const root = await scratch()
    const created = sessions.create(root)
    sessions.write(created.id, 'echo muse-wb-smoke\nexit\n')
    const deadline = Date.now() + 4000
    while (exited === undefined && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    sessions.closeAll()
    expect(chunks.join('')).toContain('muse-wb-smoke')
    expect(exited).toBe(0)
  })
})
