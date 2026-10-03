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
import { AGENT_FILE_MAX_BYTES } from '../../src/shared/constants'
import { fileContextIo } from '../../src/host/backend/contextIo'
import { encoded } from './helpers/fakeContextIo'
import { removeFolder } from './helpers/temporaryFolders'

const paths = {
  workspace: '',
  outside: '',
  skills: '',
  personal: '',
  agents: '',
  personalAgents: '',
}
const links: string[] = []

const skillFile = (name: string) =>
  `---\nname: ${name}\ndescription: The ${name} skill\n---\n\nBody\n`

const agentFile = (name: string) =>
  `---\nname: ${name}\ndescription: The ${name} agent\n---\n\nRole of ${name}\n`

async function writeAgent(directory: string, name: string): Promise<void> {
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'AGENT.md'), agentFile(name))
}

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
  paths.agents = path.join(paths.workspace, '.agents', 'agents')
  paths.personalAgents = path.join(paths.outside, 'home', 'agents')
  await writeAgent(path.join(paths.agents, 'plain'), 'plain')
  await writeAgent(path.join(paths.workspace, 'vendor', 'kept-agent'), 'kept')
  await writeAgent(path.join(paths.outside, 'escape-agent'), 'escape')
  await writeAgent(path.join(paths.outside, 'dotfiles', 'dot-agent'), 'dot')
  await mkdir(path.join(paths.agents, 'dirfile', 'AGENT.md'), { recursive: true })
  await mkdir(path.join(paths.agents, 'huge'), { recursive: true })
  await writeFile(path.join(paths.agents, 'huge', 'AGENT.md'), Buffer.alloc(1_000_000, 0x61))
  await mkdir(paths.personalAgents, { recursive: true })
  await link(path.join(paths.workspace, 'vendor', 'kept-agent'), path.join(paths.agents, 'kept'))
  await link(path.join(paths.outside, 'escape-agent'), path.join(paths.agents, 'escape'))
  await link(
    path.join(paths.outside, 'dotfiles', 'dot-agent'),
    path.join(paths.personalAgents, 'dot'),
  )
})

afterAll(async () => {
  for (const at of links) {
    await rm(at, { force: true })
  }
  await removeFolder(paths.workspace)
  await removeFolder(paths.outside)
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
      personalAgentsRoot: paths.personalAgents,
      hasAgents: true,
      isWorkspaceTrusted: () => true,
      loadMemory: undefined,
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
    // The agents: a link that leaves the workspace, a folder where the file
    // should be and a file over its cap are each refused by name; the personal
    // root is the user's own and follows its link (M76).
    expect(sections.agents.map((agent) => `${agent.source}:${agent.id}`)).toEqual([
      'builtin:explore',
      'builtin:second-opinion',
      'project:kept',
      'project:plain',
      'user:dot',
    ])
    expect(warnings).toEqual([
      expect.stringMatching(
        /^project skill escape skipped: SKILL\.md is refused: path .+ leads outside the workspace through a link$/,
      ),
      expect.stringMatching(
        /^project agent dirfile skipped: AGENT\.md could not be read: .+ is not a regular file$/,
      ),
      expect.stringMatching(
        /^project agent escape skipped: AGENT\.md is refused: path .+ leads outside the workspace through a link$/,
      ),
      `project agent huge skipped: AGENT.md is over the ${String(AGENT_FILE_MAX_BYTES)} byte limit`,
    ])
  })

  it('reads a capped file to one byte past its cap, and only a regular file (M76)', async () => {
    const big = path.join(paths.workspace, 'capped.bin')
    await writeFile(big, Buffer.alloc(1000, 0x61))
    await expect(fileContextIo.readFile(big, 10)).resolves.toHaveLength(11)
    await expect(fileContextIo.readFile(big, 1000)).resolves.toHaveLength(1000)
    await expect(fileContextIo.readFile(big, 5000)).resolves.toHaveLength(1000)
    await expect(fileContextIo.readFile(big)).resolves.toHaveLength(1000)
    await expect(fileContextIo.readFile(paths.skills, 10)).rejects.toThrow(/not a regular file/)
    await expect(
      fileContextIo.readFile(path.join(paths.workspace, 'none.md'), 10),
    ).resolves.toBeUndefined()
  })
})
