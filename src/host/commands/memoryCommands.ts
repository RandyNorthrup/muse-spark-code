// `Muse Spark: Memory` (M49, PLAN.md D41): the notes Muse Code keeps for
// this workspace in its three scopes, on both backends (they share one
// memory). A note opens in an editor to read or change; a new one is created
// empty (its description as front matter) and opened; a deleted one goes to
// the trash after a modal. The view keeps each scope's MEMORY.md true: a note
// it creates gets its line, a note it deletes loses its lines. Every VS Code
// interaction is injected.

import type { MemoryNote, MemoryStore } from '../../core/memory/memoryStore'
import {
  MEMORY_INDEX_FILE,
  MEMORY_NOTE_EXTENSION,
  type MemoryScope,
  UI_TEXT,
} from '../../shared/constants'
import { fill, plural } from '../../shared/l10n/text'
import type { PickItem, PickOne } from './pickItem'

export interface MemoryViewDeps {
  readonly store: Pick<
    MemoryStore,
    'availableScopes' | 'notes' | 'root' | 'locate' | 'hasNote' | 'create' | 'forget'
  >
  readonly pick: PickOne
  /** An input box for the note's name; `validate` answers undefined for a good value, else why not. */
  readonly askName: (
    validate: (value: string) => Promise<string | undefined>,
  ) => Promise<string | undefined>
  /** The note's one-line description, possibly empty; undefined when the box was dismissed. */
  readonly askDescription: () => Promise<string | undefined>
  /** A modal; true when the user chose `action`. */
  readonly confirm: (message: string, detail: string, action: string) => Promise<boolean>
  readonly openFile: (fsPath: string) => Promise<void>
  /** Moves a file to the trash. */
  readonly trash: (fsPath: string) => Promise<void>
  readonly openDocs: () => void
  readonly showInformation: (message: string) => void
  readonly showError: (message: string) => void
}

const NOTE_PREFIX = 'note:'
const NEW_NOTE = 'action:new'
const DOCS = 'action:docs'
const OPEN = 'open'
const DELETE = 'delete'
const EXTENSION = /\.[^./\\]+$/

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function noteItem(note: MemoryNote, index: number): PickItem {
  const detail = note.path === MEMORY_INDEX_FILE ? UI_TEXT.memoryIndexDetail : note.summary
  return {
    id: `${NOTE_PREFIX}${String(index)}`,
    label: note.path,
    description: UI_TEXT.memoryScopes[note.scope],
    ...(detail !== '' && { detail }),
  }
}

/** The name as typed, `.md` added when it has no extension. */
function noteName(value: string): string {
  const name = value.trim()
  return name === '' || EXTENSION.test(name) ? name : `${name}${MEMORY_NOTE_EXTENSION}`
}

async function deleteNote(deps: MemoryViewDeps, note: MemoryNote): Promise<void> {
  const isConfirmed = await deps.confirm(
    fill(UI_TEXT.memoryDeleteConfirm, { path: note.path }),
    UI_TEXT.memoryDeleteConfirmDetail,
    UI_TEXT.memoryDeleteAction,
  )
  if (!isConfirmed) {
    return
  }
  await deps.trash(note.absolute)
  await deps.store.forget(note)
  deps.showInformation(fill(UI_TEXT.memoryDeleted, { path: note.path }))
}

async function noteActions(deps: MemoryViewDeps, note: MemoryNote): Promise<void> {
  const choice = await deps.pick(
    [
      { id: OPEN, label: UI_TEXT.memoryOpen, detail: note.absolute },
      {
        id: DELETE,
        label: UI_TEXT.memoryDelete,
        detail:
          note.path === MEMORY_INDEX_FILE
            ? UI_TEXT.memoryDeleteIndexDetail
            : UI_TEXT.memoryDeleteDetail,
      },
    ],
    note.path,
    UI_TEXT.memoryScopes[note.scope],
  )
  if (choice === OPEN) {
    await deps.openFile(note.absolute)
  } else if (choice === DELETE) {
    await deleteNote(deps, note)
  }
}

async function pickScope(
  deps: MemoryViewDeps,
  scopes: readonly MemoryScope[],
): Promise<MemoryScope | undefined> {
  const items = await Promise.all(
    scopes.map(async (scope): Promise<PickItem> => {
      const root = await deps.store.root(scope)
      return {
        id: scope,
        label: UI_TEXT.memoryScopes[scope],
        description: scope,
        ...(root.ok && { detail: root.value }),
      }
    }),
  )
  const choice = await deps.pick(items, UI_TEXT.memoryNewTitle, UI_TEXT.memoryScopePlaceholder)
  return scopes.find((scope) => scope === choice)
}

/** Why the typed name cannot be a new note in `scope`, or undefined. */
async function nameProblem(
  deps: MemoryViewDeps,
  scope: MemoryScope,
  value: string,
): Promise<string | undefined> {
  const place = await deps.store.locate(scope, noteName(value))
  if (!place.ok) {
    return `${UI_TEXT.memoryNameInvalid} (${place.reason})`
  }
  return (await deps.store.hasNote(place.value)) ? UI_TEXT.memoryNameTaken : undefined
}

async function newNote(deps: MemoryViewDeps, scopes: readonly MemoryScope[]): Promise<void> {
  const scope = await pickScope(deps, scopes)
  if (scope === undefined) {
    return
  }
  const name = await deps.askName((value) => nameProblem(deps, scope, value))
  if (name === undefined) {
    return
  }
  const description = await deps.askDescription()
  if (description === undefined) {
    return
  }
  const place = await deps.store.create(scope, noteName(name), description)
  await deps.openFile(place.absolute)
}

async function showMemoryView(deps: MemoryViewDeps): Promise<void> {
  const scopes = await deps.store.availableScopes()
  const byScope = await Promise.all(scopes.map((scope) => deps.store.notes(scope)))
  const notes = byScope.flat()
  const choice = await deps.pick(
    [
      ...notes.map((note, index) => noteItem(note, index)),
      { id: NEW_NOTE, label: UI_TEXT.memoryNewNote, detail: UI_TEXT.memoryNewNoteDetail },
      { id: DOCS, label: UI_TEXT.memoryDocs },
    ],
    UI_TEXT.memoryTitle,
    notes.length === 0 ? UI_TEXT.memoryNone : plural(UI_TEXT.memoryCount, notes.length),
  )
  if (choice === undefined) {
    return
  }
  if (choice.startsWith(NOTE_PREFIX)) {
    const note = notes[Number(choice.slice(NOTE_PREFIX.length))]
    if (note !== undefined) {
      await noteActions(deps, note)
    }
    return
  }
  if (choice === NEW_NOTE) {
    await newNote(deps, scopes)
    return
  }
  deps.openDocs()
}

/** The view; a failure on the way (a folder that cannot be read or written) is said, not thrown. */
export async function showMemory(deps: MemoryViewDeps): Promise<void> {
  try {
    await showMemoryView(deps)
  } catch (error: unknown) {
    deps.showError(`${UI_TEXT.memoryFailed}: ${describe(error)}`)
  }
}
