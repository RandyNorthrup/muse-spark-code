import { describe, expect, it } from 'vitest'
import { type MemoryViewDeps, showMemory } from '../../src/host/commands/memoryCommands'
import type { PickItem } from '../../src/host/commands/pickItem'
import { memoryStoreOver, PERSONAL } from './helpers/fakeMemoryIo'

const PROJECT = '/ws/.agents/memory'

interface HarnessOptions {
  readonly files?: Record<string, string>
  /** Each pick's answer, in order (an id, or undefined for a dismissed pick). */
  readonly answers?: readonly (string | undefined)[]
  readonly name?: string | undefined
  readonly description?: string | undefined
  readonly isConfirmed?: boolean
  readonly workspaceRoot?: string | undefined
}

function harness(options: HarnessOptions = {}) {
  const files = new Map(Object.entries(options.files ?? {}))
  const { store } = memoryStoreOver(
    files,
    'workspaceRoot' in options ? { workspaceRoot: options.workspaceRoot } : {},
  )
  const picks: { items: readonly PickItem[]; title: string; placeholder: string }[] = []
  const opened: string[] = []
  const trashed: string[] = []
  const information: string[] = []
  const errors: string[] = []
  const confirmations: string[] = []
  const validations: (string | undefined)[] = []
  let docs = 0
  const answers = [...(options.answers ?? [])]
  const deps: MemoryViewDeps = {
    store,
    pick: (items, title, placeholder) => {
      picks.push({ items, title, placeholder })
      return Promise.resolve(answers.shift())
    },
    askName: async (validate) => {
      for (const attempt of ['../x', 'taken', options.name ?? '']) {
        validations.push(await validate(attempt))
      }
      return options.name
    },
    askDescription: () => Promise.resolve(options.description),
    confirm: (message) => {
      confirmations.push(message)
      return Promise.resolve(options.isConfirmed ?? true)
    },
    openFile: (fsPath) => {
      opened.push(fsPath)
      return Promise.resolve()
    },
    trash: (fsPath) => {
      trashed.push(fsPath)
      files.delete(fsPath)
      return Promise.resolve()
    },
    openDocs: () => {
      docs += 1
    },
    showInformation: (message) => {
      information.push(message)
    },
    showError: (message) => {
      errors.push(message)
    },
  }
  return {
    deps,
    files,
    picks,
    opened,
    trashed,
    information,
    errors,
    confirmations,
    validations,
    docs: () => docs,
  }
}

const NOTES = {
  [`${PROJECT}/MEMORY.md`]: '- [deploy](deploy.md) | Deploy day\n- [x](x.md) | X\n',
  [`${PROJECT}/deploy.md`]: '---\ndescription: Deploy day\n---\n\nFridays.',
  [`${PERSONAL}/prefs.md`]: 'Prefers tabs.',
  [`${PERSONAL}/taken.md`]: '',
}

describe('showMemory (M49)', () => {
  it('lists every scope’s notes with their scope and summary, then the actions', async () => {
    const t = harness({ files: NOTES })
    await showMemory(t.deps)
    expect(t.picks[0]?.title).toBe('Muse memory')
    expect(t.picks[0]?.placeholder).toBe('4 memory notes')
    expect(t.picks[0]?.items).toEqual([
      {
        id: 'note:0',
        label: 'MEMORY.md',
        description: 'Project memory, shared with the repository',
        detail: 'The index Muse reads at the start of every session',
      },
      {
        id: 'note:1',
        label: 'deploy.md',
        description: 'Project memory, shared with the repository',
        detail: 'Deploy day',
      },
      {
        id: 'note:2',
        label: 'prefs.md',
        description: 'Your memory for every project',
        detail: 'Prefers tabs.',
      },
      { id: 'note:3', label: 'taken.md', description: 'Your memory for every project' },
      {
        id: 'action:new',
        label: 'New note…',
        detail: 'A Markdown note Muse reads in later sessions, listed in MEMORY.md',
      },
      { id: 'action:docs', label: 'Memory in Muse Code (documentation)' },
    ])
  })

  it('says when there are no notes, and opens the documentation', async () => {
    const t = harness({ answers: ['action:docs'] })
    await showMemory(t.deps)
    expect(t.picks[0]?.placeholder).toBe('No memory notes yet for this workspace')
    expect(t.docs()).toBe(1)
    const dismissed = harness({ answers: [undefined] })
    await showMemory(dismissed.deps)
    expect(dismissed.docs()).toBe(0)
  })

  it('opens a note in an editor', async () => {
    const t = harness({ files: NOTES, answers: ['note:2', 'open'] })
    await showMemory(t.deps)
    expect(t.picks[1]?.title).toBe('prefs.md')
    expect(t.picks[1]?.items[0]).toEqual({
      id: 'open',
      label: 'Open',
      detail: `${PERSONAL}/prefs.md`,
    })
    expect(t.opened).toEqual([`${PERSONAL}/prefs.md`])
  })

  it('deletes a note to the trash after a modal, and takes its line out of MEMORY.md', async () => {
    const t = harness({ files: NOTES, answers: ['note:1', 'delete'] })
    await showMemory(t.deps)
    expect(t.confirmations).toEqual(['Delete the memory note deploy.md?'])
    expect(t.trashed).toEqual([`${PROJECT}/deploy.md`])
    expect(t.files.get(`${PROJECT}/MEMORY.md`)).toBe('- [x](x.md) | X\n')
    expect(t.information).toEqual(['Deleted deploy.md'])
    const declined = harness({ files: NOTES, answers: ['note:1', 'delete'], isConfirmed: false })
    await showMemory(declined.deps)
    expect(declined.trashed).toEqual([])
    const index = harness({ files: NOTES, answers: ['note:0', undefined] })
    await showMemory(index.deps)
    expect(index.picks[1]?.items[1]?.detail).toBe('Moves the index to the trash; the notes stay')
  })

  it('creates a note in the chosen scope, checks the name as Muse Code would, and opens it', async () => {
    const t = harness({
      files: NOTES,
      answers: ['action:new', 'personal'],
      name: 'notes/tabs',
      description: 'Indentation',
    })
    await showMemory(t.deps)
    expect(t.picks[1]?.items.map((item) => [item.id, item.description])).toEqual([
      ['personal_project', 'personal_project'],
      ['project', 'project'],
      ['personal', 'personal'],
    ])
    expect(t.picks[1]?.items[2]?.detail).toBe(PERSONAL)
    expect(t.validations).toEqual([
      'Muse Code does not accept that name (memory path traversal is not allowed)',
      'A note with that name already exists.',
      undefined,
    ])
    expect(t.files.get(`${PERSONAL}/notes/tabs.md`)).toBe('---\ndescription: Indentation\n---\n\n')
    expect(t.files.get(`${PERSONAL}/MEMORY.md`)).toBe('- [tabs](notes/tabs.md) | Indentation\n')
    expect(t.opened).toEqual([`${PERSONAL}/notes/tabs.md`])
  })

  it('stops wherever the user dismisses the new note', async () => {
    for (const options of [
      { answers: ['action:new', undefined] },
      { answers: ['action:new', 'personal'], name: undefined },
      { answers: ['action:new', 'personal'], name: 'a.md', description: undefined },
    ]) {
      const t = harness(options)
      await showMemory(t.deps)
      expect(t.opened).toEqual([])
      expect(t.files.size).toBe(0)
    }
  })

  it('offers only the personal scope without a folder, and reports a failure', async () => {
    const t = harness({
      workspaceRoot: undefined,
      answers: ['action:new', 'personal'],
      name: 'a.md',
      description: '',
    })
    await showMemory(t.deps)
    expect(t.picks[1]?.items.map((item) => item.id)).toEqual(['personal'])
    const failing = harness({ files: NOTES, answers: ['note:1', 'delete'] })
    await showMemory({
      ...failing.deps,
      trash: () => Promise.reject(new Error('EPERM: operation not permitted')),
    })
    expect(failing.errors).toEqual([
      'The memory could not be changed: EPERM: operation not permitted',
    ])
  })
})
