import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
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
import { DESKTOP_LAYOUT_FILE } from '../../../src/shared/constants'
import {
  DEFAULT_WORKBENCH_LAYOUT,
  DEFAULT_WORKBENCH_LAYOUT_V2,
} from '../../../src/shared/desktop/bridge'
import { removeScratchDirs, trackScratch } from '../helpers/scratchDir'

const scratchRoots: string[] = []

function scratch(): Promise<string> {
  return trackScratch(scratchRoots, 'muse-desktop-wb-')
}

afterEach(async () => {
  await removeScratchDirs(scratchRoots)
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

  it('refuses a symlink or junction that leaves the workspace, and follows one that stays', async () => {
    const parent = await scratch()
    const root = path.join(parent, 'ws')
    const outside = path.join(parent, 'outside')
    await mkdir(path.join(root, 'src'), { recursive: true })
    await mkdir(outside, { recursive: true })
    await writeFile(path.join(root, 'src', 'a.ts'), 'export {}')
    await writeFile(path.join(outside, 'secret.txt'), 'top-secret')
    const linkKind = process.platform === 'win32' ? 'junction' : 'dir'
    await symlink(outside, path.join(root, 'linked'), linkKind)
    await symlink(path.join(root, 'src'), path.join(root, 'alias'), linkKind)

    await expect(readWorkspaceFile(root, 'linked/secret.txt')).rejects.toBeInstanceOf(
      DesktopFileError,
    )
    await expect(writeWorkspaceFile(root, 'linked/planted.txt', 'nope')).rejects.toBeInstanceOf(
      DesktopFileError,
    )
    await expect(readFile(path.join(outside, 'planted.txt'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    const listed = await listWorkspaceFiles(root)
    expect(listed.map((entry) => entry.path)).toEqual(['src/a.ts'])

    expect(await readWorkspaceFile(root, 'alias/a.ts')).toEqual({
      path: 'alias/a.ts',
      text: 'export {}',
    })
    await writeWorkspaceFile(root, 'alias/a.ts', 'changed-via-alias')
    expect(await readFile(path.join(root, 'src', 'a.ts'), 'utf8')).toBe('changed-via-alias')
  })

  it('persists layouts per workspace and per compositor workspace', async () => {
    const dir = await scratch()
    const store = new LayoutStore(dir)
    expect(await store.get({ workspaceRoot: '/work/app' })).toBeNull()
    const layout = { ...DEFAULT_WORKBENCH_LAYOUT_V2, chatWidthPx: 400 }
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

  it('migrates a version 1 record to version 2 on load', async () => {
    const dir = await scratch()
    await writeFile(
      path.join(dir, DESKTOP_LAYOUT_FILE),
      JSON.stringify({ '/work/app': { ...DEFAULT_WORKBENCH_LAYOUT, activeFooterTab: 'output' } }),
    )
    const store = new LayoutStore(dir)
    const loaded = await store.get({ workspaceRoot: '/work/app' })
    expect(loaded?.version).toBe(2)
    expect(loaded?.panelView).toBe('output')
    expect(loaded?.panelPinned).toBe(true)
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
      GITHUB_TOKEN: 'stays-for-the-persons-shell',
      HOME: '/home/dev',
    })
    expect(cleaned['PATH']).toBe('/bin')
    expect(cleaned['HOME']).toBe('/home/dev')
    expect('META_API_KEY' in cleaned).toBe(false)
    expect('OPENAI_API_KEY' in cleaned).toBe(false)
    expect(cleaned['GITHUB_TOKEN']).toBe('stays-for-the-persons-shell')
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
    const created = sessions.create({ cwd: root, cols: 80, rows: 24 })
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
