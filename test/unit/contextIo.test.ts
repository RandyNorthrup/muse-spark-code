// The context loaders on the real file system (D27): a UTF-16 rules file
// written as Windows PowerShell 5.1 writes one, and skill directories that
// are junctions (Windows, no privilege needed) or symbolic links (elsewhere),
// one leading inside the workspace, one out of it, one from the personal root.

import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WorkspaceContext } from '../../src/core/context/workspaceContext'
import { fileContextIo } from '../../src/host/backend/contextIo'
import { encoded } from './helpers/fakeContextIo'

const paths = { workspace: '', outside: '', skills: '', personal: '' }
const links: string[] = []

const skillFile = (name: string) =>
  `---\nname: ${name}\ndescription: The ${name} skill\n---\n\nBody\n`

async function writeSkill(directory: string, name: string): Promise<void> {
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'SKILL.md'), skillFile(name))
}

async function link(target: string, at: string): Promise<void> {
  await symlink(target, at, 'junction')
  links.push(at)
}

beforeAll(async () => {
  paths.workspace = realpathSync.native(await mkdtemp(path.join(tmpdir(), 'muse-context-')))
  paths.outside = realpathSync.native(await mkdtemp(path.join(tmpdir(), 'muse-context-out-')))
  paths.skills = path.join(paths.workspace, '.agents', 'skills')
  paths.personal = path.join(paths.outside, 'home', 'skills')
  await writeFile(
    path.join(paths.workspace, 'AGENTS.md'),
    encoded.utf16le('Réponds en français.\r\n'),
  )
  await writeSkill(path.join(paths.skills, 'plain'), 'plain')
  await writeFile(path.join(paths.skills, 'README.md'), 'not a skill')
  await writeSkill(path.join(paths.workspace, 'vendor', 'kept'), 'kept')
  await writeSkill(path.join(paths.outside, 'escape'), 'escape')
  await writeSkill(path.join(paths.outside, 'dotfiles', 'dot'), 'dot')
  await mkdir(paths.personal, { recursive: true })
  await link(path.join(paths.workspace, 'vendor', 'kept'), path.join(paths.skills, 'kept'))
  await link(path.join(paths.outside, 'escape'), path.join(paths.skills, 'escape'))
  await link(path.join(paths.outside, 'dotfiles', 'dot'), path.join(paths.personal, 'dot'))
})

afterAll(async () => {
  for (const at of links) {
    await rm(at, { force: true })
  }
  await rm(paths.workspace, { recursive: true, force: true })
  await rm(paths.outside, { recursive: true, force: true })
})

describe('fileContextIo', () => {
  it('lists directories and links, not files, and nothing for a missing directory', async () => {
    const names = await fileContextIo.listDirectory(paths.skills)
    expect(names.toSorted((a, b) => a.localeCompare(b))).toEqual(['escape', 'kept', 'plain'])
    await expect(fileContextIo.listDirectory(path.join(paths.workspace, 'none'))).resolves.toEqual(
      [],
    )
  })

  it('returns the bytes as written, and undefined for a missing file or one under a file', async () => {
    const bytes = await fileContextIo.readFile(path.join(paths.workspace, 'AGENTS.md'))
    expect(bytes?.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfe]))
    await expect(
      fileContextIo.readFile(path.join(paths.workspace, 'none.md')),
    ).resolves.toBeUndefined()
    await expect(
      fileContextIo.readFile(path.join(paths.workspace, 'AGENTS.md', 'x')),
    ).resolves.toBeUndefined()
  })

  it('rejects what it cannot read rather than calling it missing', async () => {
    await expect(fileContextIo.readFile(paths.skills)).rejects.toThrow(/EISDIR/)
    await expect(fileContextIo.listDirectory(`${paths.skills}\0`)).rejects.toThrow(/null bytes/)
  })

  it('gives the workspace context the UTF-16 rules and the linked skills, confined (D24)', async () => {
    const warnings: string[] = []
    const context = new WorkspaceContext({
      io: fileContextIo,
      workspaceRoot: paths.workspace,
      platform: process.platform,
      personalSkillsRoot: paths.personal,
      isWorkspaceTrusted: () => true,
      warn: (message) => {
        warnings.push(message)
      },
    })
    await context.load()
    const sections = context.sections()
    expect(sections.rules).toContain('## Rules from AGENTS.md\n\nRéponds en français.')
    expect(sections.skills.map((skill) => `${skill.source}:${skill.id}`)).toEqual([
      'project:kept',
      'project:plain',
      'user:dot',
    ])
    expect(warnings).toEqual([
      expect.stringMatching(
        /^project skill escape skipped: SKILL\.md is refused: path .+ leads outside the workspace through a link$/,
      ),
    ])
  })
})
