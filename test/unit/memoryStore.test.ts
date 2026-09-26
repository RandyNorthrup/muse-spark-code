import { describe, expect, it } from 'vitest'
import { projectMemoryFolder } from '../../src/core/memory/memoryLocation'
import {
  type MemoryNotePlace,
  type MemoryStore,
  memoryPathProblem,
} from '../../src/core/memory/memoryStore'
import { MEMORY_SNAPSHOT_MAX_NOTES, type MemoryScope } from '../../src/shared/constants'
import { HOME_DATA, memoryStoreOver, PERSONAL } from './helpers/fakeMemoryIo'

const PROJECT = '/ws/.agents/memory'
const PERSONAL_PROJECT = `${HOME_DATA}/projects/${projectMemoryFolder([], '/ws', 'linux')}`

function setup(
  initial: Record<string, string> = {},
  options: Parameters<typeof memoryStoreOver>[1] = {},
) {
  const files = new Map(Object.entries(initial))
  return { files, ...memoryStoreOver(files, options) }
}

async function place(
  store: MemoryStore,
  scope: MemoryScope,
  notePath: string,
): Promise<MemoryNotePlace> {
  const located = await store.locate(scope, notePath)
  if (!located.ok) {
    throw new Error(located.reason)
  }
  return located.value
}

describe('memoryPathProblem: Muse Code’s own checks', () => {
  it.each([
    ['', 'memory path must not be empty'],
    ['/etc/a.md', 'absolute memory paths are not allowed'],
    [String.raw`C:\a.md`, 'absolute memory paths are not allowed'],
    ['C:a.md', 'absolute memory paths are not allowed'],
    ['../escape.md', 'memory path traversal is not allowed'],
    [String.raw`notes\..\x.md`, 'memory path traversal is not allowed'],
    ['notes/', 'memory path must include a file name'],
    ['.hidden/x.md', 'hidden memory path components are not allowed'],
    ['.md', 'hidden memory path components are not allowed'],
    ['notes.txt', 'memory path must be a Markdown .md file'],
  ])('refuses %j', (given, reason) => {
    expect(memoryPathProblem(given)).toBe(reason)
  })

  it('takes a relative Markdown path, folders included', () => {
    expect(memoryPathProblem('notes/build.md')).toBeUndefined()
    expect(memoryPathProblem('MEMORY.md')).toBeUndefined()
  })
})

describe('MemoryStore: where notes live', () => {
  it('places each scope where Muse Code keeps it, the project one by its repository path', async () => {
    const { store } = setup()
    await expect(place(store, 'project', 'deploy.md')).resolves.toEqual({
      scope: 'project',
      path: 'deploy.md',
      absolute: `${PROJECT}/deploy.md`,
      display: '.agents/memory/deploy.md',
    })
    await expect(place(store, 'personal', 'prefs.md')).resolves.toMatchObject({
      absolute: `${PERSONAL}/prefs.md`,
      display: `${PERSONAL}/prefs.md`,
    })
    await expect(
      place(store, 'personal_project', String.raw`notes\build.md`),
    ).resolves.toMatchObject({
      path: 'notes/build.md',
      absolute: `${PERSONAL_PROJECT}/notes/build.md`,
    })
  })

  it('finds the project folder Muse Code already made by its key', async () => {
    const existing = `${HOME_DATA}/projects/renamed-${projectMemoryFolder([], '/ws', 'linux').split('-').at(-1) ?? ''}`
    const { store } = setup({ [`${existing}/a.md`]: 'x' })
    await expect(place(store, 'personal_project', 'a.md')).resolves.toMatchObject({
      absolute: `${existing}/a.md`,
    })
  })

  it('refuses a note behind a link, even one that stays inside the root', async () => {
    const { store } = setup(
      { '/elsewhere/a.md': 'x' },
      { links: { [`${PROJECT}/linked`]: '/elsewhere' } },
    )
    await expect(store.locate('project', 'linked/a.md')).resolves.toEqual({
      ok: false,
      reason: 'memory path contains a symlink',
    })
  })

  it('refuses a scope reached through a link below its trusted root', async () => {
    const linkedRoots: readonly { scope: MemoryScope; link: string }[] = [
      { scope: 'project', link: '/ws/.agents' },
      { scope: 'project', link: PROJECT },
      { scope: 'personal', link: PERSONAL },
      { scope: 'personal_project', link: `${HOME_DATA}/projects` },
    ]
    for (const { scope, link } of linkedRoots) {
      const { store, warnings } = setup(
        { '/elsewhere/a.md': 'outside', '/elsewhere/memory/a.md': 'outside' },
        { links: { [link]: '/elsewhere' } },
      )
      await expect(store.locate(scope, 'a.md')).resolves.toEqual({
        ok: false,
        reason: 'memory path contains a symlink',
      })
      expect(await store.availableScopes()).not.toContain(scope)
      await expect(store.notes(scope)).rejects.toThrow('memory path contains a symlink')
      const snapshots = await store.snapshot()
      expect(snapshots.map((snapshot) => snapshot.scope)).not.toContain(scope)
      expect(warnings).toContain(
        `the ${scope} memory could not be read: memory path contains a symlink`,
      )
    }
  })

  it('refuses a Windows device name, as the file tools do', async () => {
    const { store } = setup({}, { platform: 'win32', workspaceRoot: String.raw`C:\ws` })
    await expect(store.locate('project', 'nul.md')).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining('names a Windows device'),
    })
    await expect(place(store, 'project', 'ok.md')).resolves.toMatchObject({
      absolute: String.raw`C:\ws\.agents\memory\ok.md`,
    })
  })

  it('has no project scopes without a folder and no personal ones without a home', async () => {
    const noFolder = setup({}, { workspaceRoot: undefined })
    await expect(noFolder.store.availableScopes()).resolves.toEqual(['personal'])
    await expect(noFolder.store.locate('project', 'a.md')).resolves.toEqual({
      ok: false,
      reason: 'no workspace folder is open, so this scope has no memory',
    })
    const noHome = setup({}, { dataRoot: undefined })
    await expect(noHome.store.availableScopes()).resolves.toEqual(['project'])
    await expect(noHome.store.root('personal')).resolves.toEqual({
      ok: false,
      reason: 'the home folder is unknown, so this scope has no memory',
    })
  })
})

describe('MemoryStore: the tools', () => {
  it('writes a new note with type and description as front matter, as captured', async () => {
    const t = setup()
    const deploy = await place(t.store, 'project', 'deploy.md')
    await expect(
      t.store.add(deploy, {
        content: 'Deploys run on Fridays.',
        type: 'reference',
        description: 'Deploy day',
      }),
    ).resolves.toEqual({
      ok: true,
      value:
        '{"success":true,"scope":"project","path":"deploy.md","operation":"add","message":"memory note written"}',
    })
    expect(t.files.get(`${PROJECT}/deploy.md`)).toBe(
      '---\ntype: reference\ndescription: Deploy day\n---\n\nDeploys run on Fridays.',
    )
    const plain = await place(t.store, 'personal_project', 'notes/build.md')
    await t.store.add(plain, { content: 'Build with npm run build.' })
    expect(t.files.get(`${PERSONAL_PROJECT}/notes/build.md`)).toBe('Build with npm run build.')
  })

  it('appends after a blank line and keeps the front matter as it was', async () => {
    const t = setup({ [`${PROJECT}/deploy.md`]: '---\ntype: reference\n---\n\nFridays.\n\n' })
    const deploy = await place(t.store, 'project', 'deploy.md')
    await t.store.add(deploy, { content: 'Rollbacks use the previous tag.', type: 'project' })
    expect(t.files.get(`${PROJECT}/deploy.md`)).toBe(
      '---\ntype: reference\n---\n\nFridays.\n\nRollbacks use the previous tag.',
    )
    t.files.set(`${PROJECT}/empty.md`, '')
    await t.store.add(await place(t.store, 'project', 'empty.md'), { content: 'First.' })
    expect(t.files.get(`${PROJECT}/empty.md`)).toBe('First.')
  })

  it('adds a new note’s line to its scope’s index, once, and never for an append or the index', async () => {
    const t = setup({ [`${PROJECT}/MEMORY.md`]: '- [old](old.md) | Old\n' })
    await t.store.add(await place(t.store, 'project', 'deploy.md'), {
      content: 'Deploys run on Fridays.',
      description: 'Deploy day',
    })
    await t.store.add(await place(t.store, 'project', 'deploy.md'), { content: 'More.' })
    await t.store.add(await place(t.store, 'project', 'MEMORY.md'), { content: '- by hand' })
    await t.store.add(await place(t.store, 'personal', 'prefs.md'), {
      content: '# Tabs\n\nAlways.',
    })
    expect(t.files.get(`${PROJECT}/MEMORY.md`)).toBe(
      '- [old](old.md) | Old\n- [deploy](deploy.md) | Deploy day\n\n- by hand',
    )
    expect(t.files.get(`${PERSONAL}/MEMORY.md`)).toBe('- [prefs](prefs.md) | Tabs\n')
    const listed = setup({ [`${PROJECT}/MEMORY.md`]: '- [x](x.md)\n' })
    await listed.store.add(await place(listed.store, 'project', 'x.md'), { content: 'x' })
    expect(listed.files.get(`${PROJECT}/MEMORY.md`)).toBe('- [x](x.md)\n')
  })

  it('keeps one valid index link for a note whose name has Markdown punctuation', async () => {
    const t = setup()
    const note = await place(t.store, 'project', 'notes/a](b)%.md')
    await t.store.add(note, { content: 'First.', description: 'Plan' })
    await t.store.add(note, { content: 'Second.' })
    expect(t.files.get(`${PROJECT}/MEMORY.md`)).toBe(
      '- [a\\](b)%](notes/a%5D%28b%29%25.md) | Plan\n',
    )
    await t.store.forget(note)
    expect(t.files.get(`${PROJECT}/MEMORY.md`)).toBe('')
  })

  it('keeps a note written when its index line cannot be, and says so', async () => {
    const t = setup({}, { unwritable: new Set([`${PROJECT}/MEMORY.md`]) })
    const outcome = await t.store.add(await place(t.store, 'project', 'a.md'), { content: 'x' })
    expect(outcome.ok).toBe(true)
    expect(t.files.get(`${PROJECT}/a.md`)).toBe('x')
    expect(t.warnings).toEqual([
      ".agents/memory/a.md was written, but its MEMORY.md line was not: EACCES: permission denied, open '/ws/.agents/memory/MEMORY.md'",
    ])
  })

  it('never overwrites a note another writer created after add first read it', async () => {
    const target = `${PROJECT}/race.md`
    const t = setup(
      {},
      {
        beforeCreate: (key, files) => {
          if (key === target) {
            files.set(key, 'the other writer')
          }
        },
      },
    )
    const result = await t.store.add(await place(t.store, 'project', 'race.md'), {
      content: 'our note',
    })
    expect(result).toEqual({ ok: false, reason: 'a memory note already exists at that path' })
    expect(t.files.get(target)).toBe('the other writer')
    expect(t.files.has(`${PROJECT}/MEMORY.md`)).toBe(false)
  })

  it('reads a window of lines with their breaks, as captured', async () => {
    const note = '---\ntype: reference\ndescription: Deploy day\n---\n\nDeploys run on Fridays.'
    const t = setup({ [`${PROJECT}/deploy.md`]: note })
    const deploy = await place(t.store, 'project', 'deploy.md')
    await expect(t.store.read(deploy, {})).resolves.toEqual({
      ok: true,
      value: JSON.stringify({
        success: true,
        scope: 'project',
        path: 'deploy.md',
        start_line_number: 1,
        content: note,
        truncated: false,
      }),
    })
    const window = await t.store.read(deploy, { offset: 2, limit: 3 })
    expect(window.ok && JSON.parse(window.value)).toMatchObject({
      start_line_number: 2,
      content: 'type: reference\ndescription: Deploy day\n---\n',
      truncated: true,
    })
    const past = await t.store.read(deploy, { offset: 40 })
    expect(past.ok && JSON.parse(past.value)).toMatchObject({ content: '', truncated: false })
  })

  it('refuses a read out of range, of a missing note, or of one that is not text', async () => {
    const t = setup({ [`${PROJECT}/a.md`]: 'x' }, { unreadable: new Set([`${PROJECT}/bin.md`]) })
    const a = await place(t.store, 'project', 'a.md')
    await expect(t.store.read(a, { offset: 0 })).resolves.toEqual({
      ok: false,
      reason: 'offset must be at least 1',
    })
    await expect(t.store.read(a, { limit: 0 })).resolves.toEqual({
      ok: false,
      reason: 'limit must be at least 1',
    })
    await expect(t.store.read(await place(t.store, 'project', 'missing.md'), {})).resolves.toEqual({
      ok: false,
      reason: 'memory file not found',
    })
    await expect(t.store.read(await place(t.store, 'project', 'bin.md'), {})).resolves.toEqual({
      ok: false,
      reason: '/ws/.agents/memory/bin.md is not UTF-8 text',
    })
  })

  it('replaces one exact string, as captured, and refuses anything else', async () => {
    const t = setup({ [`${PROJECT}/deploy.md`]: 'Deploys run on Fridays. Fridays! $& kept' })
    const deploy = await place(t.store, 'project', 'deploy.md')
    await expect(
      t.store.edit(deploy, { old_str: 'Mondays', new_str: 'Tuesdays' }),
    ).resolves.toEqual({
      ok: false,
      reason: 'old_str not found: "Mondays"',
    })
    await expect(t.store.edit(deploy, { old_str: 'Fridays', new_str: 'x' })).resolves.toEqual({
      ok: false,
      reason: 'ambiguous old_str "Fridays"',
    })
    await expect(t.store.edit(deploy, { old_str: '', new_str: 'x' })).resolves.toEqual({
      ok: false,
      reason: 'old_str must not be empty',
    })
    await expect(
      t.store.edit(await place(t.store, 'project', 'none.md'), { old_str: 'a', new_str: 'b' }),
    ).resolves.toEqual({ ok: false, reason: 'memory file not found' })
    await expect(
      t.store.edit(deploy, { old_str: 'Fridays.', new_str: '$& Thursdays.' }),
    ).resolves.toEqual({
      ok: true,
      value:
        '{"success":true,"scope":"project","path":"deploy.md","operation":"edit","message":"memory note edited"}',
    })
    expect(t.files.get(`${PROJECT}/deploy.md`)).toBe(
      'Deploys run on $& Thursdays. Fridays! $& kept',
    )
  })

  it('reports a write the file system refuses', async () => {
    const t = setup(
      { [`${PROJECT}/a.md`]: 'old' },
      { unwritable: new Set([`${PROJECT}/a.md`, `${PROJECT}/b.md`]) },
    )
    const a = await place(t.store, 'project', 'a.md')
    await expect(t.store.edit(a, { old_str: 'old', new_str: 'new' })).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining('EACCES'),
    })
    await expect(
      t.store.add(await place(t.store, 'project', 'b.md'), { content: 'x' }),
    ).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('EACCES') })
    expect(t.files.has(`${PROJECT}/MEMORY.md`)).toBe(false)
  })
})

describe('MemoryStore: the view and the snapshot', () => {
  it('lists a scope’s notes, the index first, hidden files and links left out', async () => {
    const t = setup(
      {
        [`${PROJECT}/z.md`]: 'Zed.',
        [`${PROJECT}/MEMORY.md`]: '- [z](z.md)',
        [`${PROJECT}/notes/a.md`]: '---\ndescription: Alpha\n---\n\n',
        [`${PROJECT}/.muse-memory.lock`]: 'pid=1',
        [`${PROJECT}/.hidden/h.md`]: 'h',
        [`${PROJECT}/readme.txt`]: 'no',
      },
      { links: { [`${PROJECT}/linked`]: '/elsewhere' } },
    )
    const notes = await t.store.notes('project')
    expect(notes.map((note) => [note.path, note.summary])).toEqual([
      ['MEMORY.md', '- [z](z.md)'],
      ['notes/a.md', 'Alpha'],
      ['z.md', 'Zed.'],
    ])
    expect(notes[1]).toMatchObject({
      absolute: `${PROJECT}/notes/a.md`,
      display: '.agents/memory/notes/a.md',
    })
    await expect(setup({}, { workspaceRoot: undefined }).store.notes('project')).resolves.toEqual(
      [],
    )
  })

  it('creates an empty note with its description and index line, and refuses a taken one', async () => {
    const t = setup({ [`${PERSONAL}/taken.md`]: '' })
    await expect(t.store.create('personal', 'tabs.md', ' Indentation ')).resolves.toMatchObject({
      absolute: `${PERSONAL}/tabs.md`,
    })
    expect(t.files.get(`${PERSONAL}/tabs.md`)).toBe('---\ndescription: Indentation\n---\n\n')
    expect(t.files.get(`${PERSONAL}/MEMORY.md`)).toBe('- [tabs](tabs.md) | Indentation\n')
    await t.store.create('personal', 'bare.md', '')
    expect(t.files.get(`${PERSONAL}/bare.md`)).toBe('')
    await expect(t.store.create('personal', 'taken.md', '')).rejects.toThrow(
      'a memory note already exists at that path',
    )
    await expect(t.store.create('personal', '../x.md', '')).rejects.toThrow(
      'memory path traversal is not allowed',
    )
    const unreadable = setup({}, { unreadable: new Set([`${PERSONAL}/odd.md`]) })
    await expect(unreadable.store.create('personal', 'odd.md', '')).rejects.toThrow(
      'already exists',
    )
  })

  it('never replaces a note another writer created after the view checked its name', async () => {
    const target = `${PERSONAL}/race.md`
    const t = setup(
      {},
      {
        beforeCreate: (key, files) => {
          if (key === target) {
            files.set(key, 'the other writer')
          }
        },
      },
    )
    await expect(t.store.create('personal', 'race.md', '')).rejects.toThrow(
      'a memory note already exists at that path',
    )
    expect(t.files.get(target)).toBe('the other writer')
    expect(t.files.has(`${PERSONAL}/MEMORY.md`)).toBe(false)
  })

  it('takes a deleted note’s lines out of its index, and leaves the index alone otherwise', async () => {
    const t = setup({ [`${PROJECT}/MEMORY.md`]: '- [a](a.md) | A\n- [b](b.md) | B\n' })
    await t.store.forget(await place(t.store, 'project', 'a.md'))
    expect(t.files.get(`${PROJECT}/MEMORY.md`)).toBe('- [b](b.md) | B\n')
    await t.store.forget(await place(t.store, 'project', 'MEMORY.md'))
    await t.store.forget(await place(t.store, 'personal', 'none.md'))
    expect(t.files.get(`${PROJECT}/MEMORY.md`)).toBe('- [b](b.md) | B\n')
    expect(t.files.has(`${PERSONAL}/MEMORY.md`)).toBe(false)
  })

  it('snapshots each scope that keeps notes: its index and the other notes’ paths', async () => {
    const many = Object.fromEntries(
      Array.from({ length: MEMORY_SNAPSHOT_MAX_NOTES + 2 }, (_, i) => [
        `${PERSONAL}/n${String(i).padStart(2, '0')}.md`,
        'n',
      ]),
    )
    const t = setup({
      ...many,
      [`${PROJECT}/MEMORY.md`]: '- [a](a.md) | A\n',
      [`${PROJECT}/a.md`]: 'A',
      [`${PERSONAL_PROJECT}/MEMORY.md`]: Array.from({ length: 300 }, () => '- x').join('\n'),
    })
    const snapshot = await t.store.snapshot()
    expect(snapshot.map((scope) => scope.scope)).toEqual([
      'personal_project',
      'project',
      'personal',
    ])
    expect(snapshot[1]).toEqual({
      scope: 'project',
      index: '- [a](a.md) | A',
      notes: ['a.md'],
      hasMoreNotes: false,
    })
    expect(snapshot[2]).toMatchObject({ index: undefined, hasMoreNotes: true })
    expect(snapshot[2]?.notes).toHaveLength(MEMORY_SNAPSHOT_MAX_NOTES)
    expect(snapshot[0]?.index?.endsWith('[MEMORY.md truncated]')).toBe(true)
    expect(t.warnings).toEqual([
      expect.stringMatching(/^personal_project MEMORY\.md: 300 lines exceeds/),
    ])
    await expect(setup().store.snapshot()).resolves.toEqual([])
  })

  it('turns a scope that cannot be read into a warning', async () => {
    const t = setup(
      { [`${PROJECT}/MEMORY.md`]: '- x' },
      { unreadable: new Set([`${PROJECT}/MEMORY.md`]) },
    )
    await expect(t.store.snapshot()).resolves.toEqual([])
    expect(t.warnings).toEqual([
      'the project memory could not be read: /ws/.agents/memory/MEMORY.md is not UTF-8 text',
    ])
  })
})
