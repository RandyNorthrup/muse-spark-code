// The import's file access on the real file system (M83): a file over the
// limit is not read, a folder is not a file, a junction (Windows, no
// privilege needed) or symbolic link to a folder lists as one, a file that
// exists is never replaced, and a broken link still counts as something
// being there.

import { realpathSync } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type * as NodeFsPromises from 'node:fs/promises'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  applyImportWrites,
  type ImportApplyResult,
  type ImportCandidate,
  type ImportProjectRoot,
  type ImportWrite,
  planImportApply,
} from '../../src/core/import/agentImport'
import {
  assertImportTarget,
  fileImportIo,
  fileImportWriter,
  isPathPresent,
} from '../../src/host/importIo'
import { AGENT_IMPORT_ROOT_CHANGED_CODE, RULES_FILE_MAX_BYTES } from '../../src/shared/constants'
import { removeFolder } from './helpers/temporaryFolders'
import { SYNTHETIC } from './helpers/syntheticTokens'
import { readContextText } from '../../src/core/context/contextFiles'
import { fileContextIo } from '../../src/host/backend/contextIo'
import { processGitRunner } from '../../src/host/git'
import { scanImportFixture } from './helpers/memoryImportIo'

const folders = { root: '' }

/** A workspace folder as the plan sees it: its path and its identity now. */
async function rootOf(workspace: string): Promise<ImportProjectRoot> {
  return { path: workspace, identity: await fileImportWriter.identifyRoot(workspace) }
}
const gates = vi.hoisted(() => {
  const controls: {
    beforeOpen: ((file: string) => Promise<void>) | undefined
  } = { beforeOpen: undefined }
  return controls
})

// Only timing is controlled; every open, inode check and link uses the real filesystem.
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof NodeFsPromises>()
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      await gates.beforeOpen?.(String(args[0]))
      return await fs.open(...args)
    },
  }
})

afterEach(() => {
  gates.beforeOpen = undefined
})

/** Runs `action` once, just before the next file `isTarget` accepts is opened: only timing is controlled. */
function beforeOpening(isTarget: (file: string) => boolean, action: () => Promise<void>): void {
  gates.beforeOpen = async (file) => {
    if (!isTarget(file)) {
      return
    }
    gates.beforeOpen = undefined
    await action()
  }
}

/** The temporary file an import stages beside `target`. */
function stagedBeside(target: string): (file: string) => boolean {
  return (file) => file.startsWith(`${target}.`) && file.endsWith('.tmp')
}

/** Shared real-filesystem rules plan, with target state known to be empty. */
async function planRulesFixture(
  candidates: readonly ImportCandidate[],
  workspace: string,
  home: string,
) {
  return await planImportApply(
    candidates,
    {
      platform: process.platform,
      homeDir: home,
      workspaceRoot: workspace,
      workspaceIdentity: await fileImportWriter.identifyRoot(workspace),
      personalRoot: home,
      museSettingsFile: path.join(home, 'settings.json'),
    },
    {
      io: fileImportIo,
      isPresent: isPathPresent,
      rulesFile: { status: 'missing' },
      museSettings: { status: 'missing' },
      hooksFile: 'missing',
    },
  )
}

beforeAll(async () => {
  folders.root = realpathSync.native(await mkdtemp(path.join(tmpdir(), 'muse-import-io-')))
  await mkdir(path.join(folders.root, 'commands', 'nested'), { recursive: true })
  await writeFile(path.join(folders.root, 'commands', 'small.md'), 'small')
  await writeFile(path.join(folders.root, 'big.md'), 'x'.repeat(100))
  await mkdir(path.join(folders.root, 'target'), { recursive: true })
  await symlink(
    path.join(folders.root, 'target'),
    path.join(folders.root, 'commands', 'linked'),
    'junction',
  )
})

afterAll(async () => {
  await removeFolder(folders.root)
})

describe('fileImportIo', () => {
  it('uses a nested target repository index rather than the parent workspace ignore rules', async () => {
    const workspace = path.join(folders.root, 'nested-repository')
    const home = path.join(folders.root, 'nested-home')
    const nested = path.join(workspace, 'inner')
    await mkdir(nested, { recursive: true })
    await mkdir(home, { recursive: true })
    const git = processGitRunner()
    await git(['init', '--quiet'], workspace)
    await git(['init', '--quiet'], nested)
    await writeFile(path.join(workspace, '.gitignore'), 'CLAUDE.md\ninner/\n')
    await writeFile(path.join(workspace, 'CLAUDE.md'), 'Private source.')
    const target = path.join(nested, 'AGENTS.md')
    await writeFile(target, 'Keep this tracked file.')
    await git(['add', '--', 'AGENTS.md'], nested)
    const scan = await scanImportFixture(fileImportIo, {
      platform: process.platform,
      homeDir: home,
      workspaceRoot: workspace,
    })
    const candidate = scan.candidates[0]
    if (candidate?.target.kind !== 'rules') throw new Error('Fixture must yield project rules')
    const plan = await planRulesFixture(
      [{ ...candidate, target: { ...candidate.target, file: target } }],
      workspace,
      home,
    )
    expect(plan.writes).toEqual([])
    expect(plan.skipped.map((skip) => skip.reason)).toEqual(['ignoredToTracked'])
    expect(await readFile(target, 'utf8')).toBe('Keep this tracked file.')
  })

  it('classifies real git ignores and refuses an ignored source copied to a tracked target', async () => {
    const workspace = path.join(folders.root, 'git-ignore')
    const home = path.join(folders.root, 'ignore-home')
    await mkdir(workspace, { recursive: true })
    await mkdir(home, { recursive: true })
    const git = processGitRunner()
    await git(['init', '--quiet'], workspace)
    await writeFile(path.join(workspace, '.gitignore'), 'CLAUDE.md\n')
    await writeFile(path.join(workspace, 'CLAUDE.md'), 'Private source bytes.\n')
    const makePlan = async () => {
      const scan = await scanImportFixture(fileImportIo, {
        platform: process.platform,
        homeDir: home,
        workspaceRoot: workspace,
      })
      expect(scan.candidates[0]?.sourceExposure).toBe('project-local')
      return await planRulesFixture(scan.candidates, workspace, home)
    }
    const refused = await makePlan()
    expect(refused.writes).toEqual([])
    expect(refused.skipped.map((skip) => skip.reason)).toEqual(['ignoredToTracked'])
    await writeFile(path.join(workspace, '.gitignore'), 'CLAUDE.md\nAGENTS.md\n')
    const allowed = await makePlan()
    const written = await applyImportWrites(allowed.writes, fileImportWriter, process.platform)
    expect(written.skipped).toEqual([])
    expect(written.written).toHaveLength(1)
    expect(await readFile(path.join(workspace, 'AGENTS.md'), 'utf8')).toContain(
      'Private source bytes.',
    )
    // A tracked file stays tracked even when a later ignore pattern matches it.
    await git(['add', '-f', '--', 'AGENTS.md'], workspace)
    expect(await fileImportIo.isIgnored(path.join(workspace, 'AGENTS.md'), workspace)).toBe(false)
    expect(await fileImportIo.isIgnored(path.join(home, 'none'), home)).toBe(false)
  })

  it('reads a file under the limit, and neither one over it nor a folder', async () => {
    const small = await fileImportIo.readFile(path.join(folders.root, 'commands', 'small.md'), 10)
    expect(small.status === 'read' && Buffer.from(small.bytes).toString('utf8')).toBe('small')
    expect(await fileImportIo.readFile(path.join(folders.root, 'big.md'), 10)).toEqual({
      status: 'tooLarge',
    })
    expect(await fileImportIo.readFile(path.join(folders.root, 'commands'), 10)).toEqual({
      status: 'notFile',
    })
    expect(await fileImportIo.readFile(path.join(folders.root, 'missing.md'), 10)).toEqual({
      status: 'missing',
    })
  })

  it('lists a linked folder as a folder, and a missing folder as nothing', async () => {
    const entries = await fileImportIo.listDirectory(path.join(folders.root, 'commands'))
    expect(entries?.toSorted((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'linked', isDirectory: true },
      { name: 'nested', isDirectory: true },
      { name: 'small.md', isDirectory: false },
    ])
    expect(await fileImportIo.listDirectory(path.join(folders.root, 'missing'))).toBeUndefined()
  })
})

describe('fileImportWriter', () => {
  it('publishes rules unchanged on the real filesystem and loads the published bytes as context', async () => {
    const workspace = path.join(folders.root, 'refused-context')
    const home = path.join(workspace, 'home')
    const ordinary = path.join(workspace, 'CLAUDE.md')
    const source = path.join(workspace, '.claude', 'CLAUDE.md')
    const target = path.join(workspace, 'AGENTS.md')
    const secret = SYNTHETIC.githubToken
    await mkdir(path.dirname(source), { recursive: true })
    await writeFile(ordinary, 'Keep each change small.\n')
    await writeFile(source, `Project credential: ${secret}.\n`)
    const scan = await scanImportFixture(fileImportIo, {
      platform: process.platform,
      homeDir: home,
      workspaceRoot: workspace,
    })
    expect(scan.candidates.map((candidate) => candidate.target.kind)).toEqual(['rules', 'rules'])
    const plan = await planRulesFixture(scan.candidates, workspace, home)
    expect(plan.writes).toHaveLength(1)
    const result = await applyImportWrites(plan.writes, fileImportWriter, process.platform)
    expect(result.failures).toEqual([])
    const published = await readFile(target, 'utf8')
    expect(published).toBe(plan.writes[0]?.content)
    expect(published).toContain(secret)
    expect(plan.skipped).toEqual([])
    expect(await readFile(source, 'utf8')).toContain(secret)
    const context = await readContextText(
      { platform: process.platform, io: fileContextIo },
      target,
      workspace,
    )
    expect(context).toEqual({ ok: true, text: published })
    expect(JSON.stringify(context)).toContain(secret)
  })

  it.each(['create', 'append'])(
    'rechecks live permission after a held real %s stage before publication',
    async (mode) => {
      const workspace = path.join(folders.root, `live-permission-${mode}`)
      const target = path.join(workspace, mode === 'append' ? 'AGENTS.md' : 'SKILL.md')
      await mkdir(workspace)
      if (mode === 'append') await writeFile(target, 'Prior rules.\n')
      const held = Promise.withResolvers<undefined>()
      const started = Promise.withResolvers<undefined>()
      let isAllowed = true
      beforeOpening(stagedBeside(target), async () => {
        started.resolve(undefined)
        await held.promise
      })
      const applying = applyImportWrites(
        [await projectWrite(workspace, target)],
        fileImportWriter,
        process.platform,
        {
          beforeWrite: () => {
            if (!isAllowed) throw Object.assign(new Error('Permission changed'), { code: 'EPERM' })
          },
        },
      )
      try {
        await started.promise
        isAllowed = false
        held.resolve(undefined)
        const result = await applying
        expect(result.written).toEqual([])
        expect(result.failures).toEqual([{ absolutePath: target, code: 'EPERM' }])
        expect(await readdir(workspace)).toEqual(mode === 'append' ? ['AGENTS.md'] : [])
        if (mode === 'append') expect(await readFile(target, 'utf8')).toBe('Prior rules.\n')
        else expect(await isPathPresent(target)).toBe(false)
      } finally {
        held.resolve(undefined)
        await applying
      }
    },
  )

  it('publishes two racing creates whole, keeps the winner, and removes staging files', async () => {
    const folder = path.join(folders.root, 'racing-create')
    const target = path.join(folder, 'AGENT.md')
    const first = 'first'.repeat(100)
    const second = 'second'.repeat(100)
    const results = await Promise.all([
      fileImportWriter.createFile(target, first),
      fileImportWriter.createFile(target, second),
    ])
    expect(results.toSorted((a, b) => a.localeCompare(b, 'en'))).toEqual(['created', 'exists'])
    expect([first, second]).toContain(await readFile(target, 'utf8'))
    expect(await readdir(folder)).toEqual(['AGENT.md'])
  })

  it('refuses a stale append and a result past the rules cap, preserving prior bytes', async () => {
    const target = path.join(folders.root, 'capped-rules', 'AGENTS.md')
    await mkdir(path.dirname(target))
    await writeFile(target, 'User rules.\n')
    await expect(
      fileImportWriter.appendText(target, 'new', {
        expectedText: 'Old rules.\n',
      }),
    ).rejects.toMatchObject({ code: 'ESTALE' })
    expect(await readFile(target, 'utf8')).toBe('User rules.\n')
    const full = 'x'.repeat(RULES_FILE_MAX_BYTES)
    await writeFile(target, full)
    await expect(fileImportWriter.appendText(target, 'new')).rejects.toMatchObject({
      code: 'EFBIG',
    })
    expect(await readFile(target, 'utf8')).toBe(full)
  })

  it('keeps a user edit made while the atomic append stages its text', async () => {
    const folder = path.join(folders.root, 'changed-append')
    const target = path.join(folder, 'AGENTS.md')
    await mkdir(folder)
    await writeFile(target, 'Original.\n')
    beforeOpening(stagedBeside(target), () => writeFile(target, 'User changed it.\n'))
    await expect(
      fileImportWriter.appendText(target, 'Imported.\n', {
        project: await rootOf(folder),
        expectedText: 'Original.\n',
      }),
    ).rejects.toMatchObject({ code: 'ESTALE' })
    expect(await readFile(target, 'utf8')).toBe('User changed it.\n')
    expect(await readdir(folder)).toEqual(['AGENTS.md'])
  })

  it('creates a file and its folders, and never replaces one', async () => {
    const target = path.join(folders.root, 'out', 'skill', 'SKILL.md')
    expect(await fileImportWriter.createFile(target, 'first')).toBe('created')
    expect(await fileImportWriter.createFile(target, 'second')).toBe('exists')
    expect(await readFile(target, 'utf8')).toBe('first')
  })

  it('appends to a file, creating it when it is missing', async () => {
    const target = path.join(folders.root, 'AGENTS.md')
    await fileImportWriter.appendText(target, 'one\n')
    await fileImportWriter.appendText(target, 'two\n')
    expect(await fileImportWriter.readText(target)).toBe('one\ntwo\n')
    expect(await fileImportWriter.readText(path.join(folders.root, 'none.md'))).toBeUndefined()
  })
})

/** Windows makes a file symbolic link only with a privilege; a junction needs none. */
function isPrivilegeDenied(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EPERM' &&
    process.platform === 'win32'
  )
}

describe('real import path boundaries', () => {
  it.for(['existing', 'dangling'])(
    'refuses an %s file symlink for preview reads and append, including inside the workspace',
    async (kind, context) => {
      const workspace = path.join(folders.root, `file-link-${kind}`)
      const target = path.join(workspace, 'original.md')
      const rules = path.join(workspace, 'AGENTS.md')
      await mkdir(workspace)
      if (kind === 'existing') {
        await writeFile(target, 'Prior rules.\n')
      }
      try {
        await symlink(target, rules, 'file')
      } catch (error: unknown) {
        if (isPrivilegeDenied(error)) {
          context.skip('Windows denied file-symlink creation; junction cases still run')
          return
        }
        throw error
      }
      const project = await rootOf(workspace)
      await expect(assertImportTarget(rules, project)).rejects.toMatchObject({ code: 'ELOOP' })
      await expect(fileImportIo.readFile(rules, 100, workspace)).rejects.toMatchObject({
        code: 'ELOOP',
      })
      await expect(fileImportWriter.readText(rules, project)).rejects.toMatchObject({
        code: 'ELOOP',
      })
      await expect(
        fileImportWriter.appendText(rules, 'Imported.\n', { project }),
      ).rejects.toMatchObject({ code: 'ELOOP' })
      expect(await isPathPresent(target)).toBe(kind === 'existing')
      if (kind === 'existing') {
        expect(await readFile(target, 'utf8')).toBe('Prior rules.\n')
      }
    },
  )

  it('refuses existing and dangling directory junctions before destination read or open', async () => {
    const workspace = path.join(folders.root, 'target-junction')
    const outside = path.join(folders.root, 'target-outside')
    await mkdir(workspace)
    await mkdir(outside)
    await writeFile(path.join(outside, 'hooks.json'), 'Private file.\n')
    await symlink(outside, path.join(workspace, '.muse'), 'junction')
    const hooks = path.join(workspace, '.muse', 'hooks.json')
    const project = await rootOf(workspace)
    await expect(assertImportTarget(hooks, project)).rejects.toMatchObject({ code: 'ELOOP' })
    await expect(fileImportIo.readFile(hooks, 100, workspace)).rejects.toMatchObject({
      code: 'ELOOP',
    })
    await symlink(
      path.join(folders.root, 'missing-junction-target'),
      path.join(workspace, '.agents'),
      'junction',
    )
    await expect(
      assertImportTarget(path.join(workspace, '.agents', 'new.md'), project),
    ).rejects.toMatchObject({ code: 'ELOOP' })
    expect(await readFile(path.join(outside, 'hooks.json'), 'utf8')).toBe('Private file.\n')
  })

  it('refuses a parent swapped for a real junction after stat but before opening a read', async () => {
    const workspace = path.join(folders.root, 'read-swap')
    const nested = path.join(workspace, 'nested')
    const outside = path.join(folders.root, 'read-outside')
    await mkdir(nested, { recursive: true })
    await mkdir(outside)
    await writeFile(path.join(nested, 'AGENTS.md'), 'Inside.\n')
    await writeFile(path.join(outside, 'AGENTS.md'), 'Outside private.\n')
    const target = path.join(nested, 'AGENTS.md')
    beforeOpening(
      (file) => file === target,
      async () => {
        await rename(nested, `${nested}-original`)
        await symlink(outside, nested, 'junction')
      },
    )
    await expect(fileImportIo.readFile(target, 100, workspace)).rejects.toMatchObject({
      code: 'ESTALE',
    })
    expect(await readFile(path.join(outside, 'AGENTS.md'), 'utf8')).toBe('Outside private.\n')
    expect(await readFile(path.join(`${nested}-original`, 'AGENTS.md'), 'utf8')).toBe('Inside.\n')
  })

  it('refuses a parent swapped while creating its staging file and removes the owned empty file', async () => {
    const workspace = path.join(folders.root, 'create-swap')
    const nested = path.join(workspace, 'nested')
    const outside = path.join(folders.root, 'create-outside')
    await mkdir(nested, { recursive: true })
    await mkdir(outside)
    await writeFile(path.join(outside, 'keep.txt'), 'Unchanged.\n')
    beforeOpening(
      (file) => file.startsWith(`${path.join(nested, 'AGENT.md')}.`),
      async () => {
        await rename(nested, `${nested}-original`)
        await symlink(outside, nested, 'junction')
      },
    )
    await expect(
      fileImportWriter.createFile(
        path.join(nested, 'AGENT.md'),
        'Imported.\n',
        await rootOf(workspace),
      ),
    ).rejects.toMatchObject({ code: 'ELOOP' })
    expect(await readdir(outside)).toEqual(['keep.txt'])
    expect(await readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('Unchanged.\n')
  })

  it('bounds a source that grows after its size check', async () => {
    const target = path.join(folders.root, 'growing-source.md')
    await writeFile(target, 'small')
    beforeOpening(
      (file) => file === target,
      () => writeFile(target, 'x'.repeat(100)),
    )
    expect(await fileImportIo.readFile(target, 10)).toEqual({ status: 'tooLarge' })
  })

  it('appends one section when two imports race for one file, the loser keeping its hands off', async () => {
    const workspace = path.join(folders.root, 'queued-rules')
    await mkdir(workspace)
    const target = path.join(workspace, 'AGENTS.md')
    await writeFile(target, 'Existing rules.\n')
    const firstAppend = Promise.withResolvers<undefined>()
    const resume = Promise.withResolvers<undefined>()
    let appends = 0
    const writer = {
      ...fileImportWriter,
      appendText: async (...args: Parameters<typeof fileImportWriter.appendText>) => {
        appends += 1
        if (appends === 1) {
          firstAppend.resolve(undefined)
          await resume.promise
        }
        await fileImportWriter.appendText(...args)
      },
    }
    // The window's own gate allows one import at a time; another window has none.
    const write = await projectWrite(workspace, target)
    const first = applyImportWrites([write], writer, process.platform)
    try {
      await firstAppend.promise
      expect(await readFile(target, 'utf8')).toBe('Existing rules.\n')
      // The other window finishes while the first waits at its append, having read the file.
      const second = await applyImportWrites([write], writer, process.platform)
      expect(second.written).toHaveLength(1)
      resume.resolve(undefined)
      const one = await first
      expect(one.written).toEqual([])
      expect(one.failures).toEqual([{ absolutePath: target, code: 'ESTALE' }])
      expect(one.skipped).toEqual([{ candidateId: 'a', reason: 'failed' }])
      const text = await readFile(target, 'utf8')
      expect(text).toContain('Existing rules.\n')
      expect(text.split('## A')).toHaveLength(2)
    } finally {
      resume.resolve(undefined)
      await first
    }
  })
})

// The approval wait is long: the folder the preview was made for can be
// retargeted or replaced before the accepted writes start, or while one runs.
/** Applies one planned write and expects it refused because its folder changed. */
async function expectRefusedAsChanged(write: ImportWrite): Promise<ImportApplyResult> {
  const result = await applyImportWrites([write], fileImportWriter, process.platform)
  expect(result.written).toEqual([])
  expect(result.skipped).toEqual([{ candidateId: 'a', reason: 'changed' }])
  return result
}

describe('a workspace folder that changes after the plan (M83)', () => {
  it('refuses a link retargeted to another folder, and creates nothing in either', async () => {
    const first = path.join(folders.root, 'retarget-first')
    const second = path.join(folders.root, 'retarget-second')
    const link = path.join(folders.root, 'retarget-link')
    await mkdir(first)
    await mkdir(second)
    await symlink(first, link, 'junction')
    const write = await projectWrite(link, path.join(link, '.agents', 'skills', 'a', 'SKILL.md'))
    await unlink(link)
    await symlink(second, link, 'junction')
    const result = await expectRefusedAsChanged(write)
    expect(result.failures).toEqual([
      { absolutePath: write.absolutePath, code: AGENT_IMPORT_ROOT_CHANGED_CODE },
    ])
    expect(await readdir(first)).toEqual([])
    expect(await readdir(second)).toEqual([])
  })

  it('refuses a folder replaced by another at the same path', async () => {
    const workspace = path.join(folders.root, 'replaced-root')
    await mkdir(workspace)
    const write = await projectWrite(
      workspace,
      path.join(workspace, '.agents', 'skills', 'a', 'SKILL.md'),
    )
    // The original stays, so its file number is not reused by the replacement.
    await rename(workspace, `${workspace}-original`)
    await mkdir(workspace)
    await expectRefusedAsChanged(write)
    expect(await readdir(workspace)).toEqual([])
    expect(await readdir(`${workspace}-original`)).toEqual([])
  })

  it('refuses a root retargeted as the staging file is created, and removes that staging file', async () => {
    const first = path.join(folders.root, 'mid-first')
    const second = path.join(folders.root, 'mid-second')
    const link = path.join(folders.root, 'mid-link')
    await mkdir(first)
    // The other folder has the same tree, so the staging file would be created there.
    await mkdir(path.join(second, '.agents', 'skills', 'a'), { recursive: true })
    await symlink(first, link, 'junction')
    const write = await projectWrite(link, path.join(link, '.agents', 'skills', 'a', 'SKILL.md'))
    beforeOpening(stagedBeside(write.absolutePath), async () => {
      await unlink(link)
      await symlink(second, link, 'junction')
    })
    await expectRefusedAsChanged(write)
    expect(await readdir(path.join(second, '.agents', 'skills', 'a'))).toEqual([])
    expect(await isPathPresent(path.join(first, '.agents', 'skills', 'a', 'SKILL.md'))).toBe(false)
  })

  it('refuses a rules append when the folder is replaced while its text is staged', async () => {
    const workspace = path.join(folders.root, 'append-replaced')
    await mkdir(workspace)
    const rules = path.join(workspace, 'AGENTS.md')
    await writeFile(rules, 'Prior.\n')
    const write = await projectWrite(workspace, rules)
    beforeOpening(stagedBeside(rules), async () => {
      await rename(workspace, `${workspace}-original`)
      await mkdir(workspace)
      await writeFile(rules, 'Replacement folder rules.\n')
    })
    await expectRefusedAsChanged(write)
    expect(await readFile(rules, 'utf8')).toBe('Replacement folder rules.\n')
    expect(await readdir(workspace)).toEqual(['AGENTS.md'])
    expect(await readFile(path.join(`${workspace}-original`, 'AGENTS.md'), 'utf8')).toBe('Prior.\n')
  })

  it('refuses a rules append when its root link is retargeted while canonical text is staged', async () => {
    const first = path.join(folders.root, 'append-link-first')
    const second = path.join(folders.root, 'append-link-second')
    const root = path.join(folders.root, 'append-link-root')
    await mkdir(first)
    await mkdir(second)
    await symlink(first, root, 'junction')
    await writeFile(path.join(first, 'AGENTS.md'), 'Prior.\n')
    await writeFile(path.join(second, 'AGENTS.md'), 'Other rules.\n')
    const write = await projectWrite(root, path.join(root, 'AGENTS.md'))
    beforeOpening(stagedBeside(path.join(first, 'AGENTS.md')), async () => {
      await unlink(root)
      await symlink(second, root, 'junction')
    })
    await expectRefusedAsChanged(write)
    expect(await readFile(path.join(first, 'AGENTS.md'), 'utf8')).toBe('Prior.\n')
    expect(await readFile(path.join(second, 'AGENTS.md'), 'utf8')).toBe('Other rules.\n')
    expect(await readdir(first)).toEqual(['AGENTS.md'])
    expect(await readdir(second)).toEqual(['AGENTS.md'])
  })

  it('identifies a folder by its canonical path and compares it again on every write', async () => {
    const workspace = path.join(folders.root, 'identified-root')
    await mkdir(workspace)
    const identity = await fileImportWriter.identifyRoot(workspace)
    expect(identity.canonical).toBe(realpathSync.native(workspace))
    await expect(
      fileImportWriter.createFile(path.join(workspace, 'new.md'), 'x', {
        path: workspace,
        identity,
      }),
    ).resolves.toBe('created')
    await expect(
      fileImportWriter.createFile(path.join(workspace, 'other.md'), 'x', {
        path: workspace,
        identity: { ...identity, canonical: path.join(folders.root, 'somewhere-else') },
      }),
    ).rejects.toMatchObject({ code: AGENT_IMPORT_ROOT_CHANGED_CODE })
    await expect(
      fileImportWriter.createFile(path.join(workspace, 'third.md'), 'x', {
        path: workspace,
        identity: { ...identity, fileId: `${identity.fileId}1` },
      }),
    ).rejects.toMatchObject({ code: AGENT_IMPORT_ROOT_CHANGED_CODE })
    expect(await readdir(workspace)).toEqual(['new.md'])
  })
})

describe('isPathPresent', () => {
  it('sees files, folders and links, and not what is missing', async () => {
    expect(await isPathPresent(path.join(folders.root, 'commands', 'small.md'))).toBe(true)
    expect(await isPathPresent(path.join(folders.root, 'commands', 'linked'))).toBe(true)
    expect(await isPathPresent(path.join(folders.root, 'nothing'))).toBe(false)
  })
})

/** One project write of the import, to a file under `workspace`. */
async function projectWrite(workspace: string, absolutePath: string): Promise<ImportWrite> {
  return {
    sourceExposure: 'project-tracked',
    homeDir: workspace,
    workspaceRoot: workspace,
    candidateIds: ['a'],
    absolutePath,
    content: 'x\n',
    mode: absolutePath.endsWith('AGENTS.md') ? 'append' : 'create',
    sections: [{ candidateId: 'a', heading: '## A', text: '## A\n\nx' }],
    root: workspace,
    isProject: true,
    rootIdentity: await fileImportWriter.identifyRoot(workspace),
  }
}

describe('writes through broken links (M83)', () => {
  it('refuses a file under a broken junction that leads out of the workspace', async () => {
    const workspace = path.join(folders.root, 'ws-junction')
    const target = path.join(folders.root, 'not-yet')
    await mkdir(workspace, { recursive: true })
    await symlink(target, path.join(workspace, '.agents'), 'junction')
    const result = await applyImportWrites(
      [await projectWrite(workspace, path.join(workspace, '.agents', 'skills', 'a', 'SKILL.md'))],
      fileImportWriter,
      process.platform,
    )
    expect(result.skipped).toEqual([{ candidateId: 'a', reason: 'outside' }])
    expect(await isPathPresent(target)).toBe(false)
  })

  // A file link needs a privilege on Windows; macOS and Linux show the append case.
  it.skipIf(process.platform === 'win32')(
    'refuses to append through a broken AGENTS.md link that leads out of the workspace',
    async () => {
      const workspace = path.join(folders.root, 'ws-link')
      const target = path.join(folders.root, 'bashrc')
      await mkdir(workspace, { recursive: true })
      await symlink(target, path.join(workspace, 'AGENTS.md'))
      const result = await applyImportWrites(
        [await projectWrite(workspace, path.join(workspace, 'AGENTS.md'))],
        fileImportWriter,
        process.platform,
      )
      expect(result.skipped).toEqual([{ candidateId: 'a', reason: 'outside' }])
      expect(await isPathPresent(target)).toBe(false)
    },
  )
})
