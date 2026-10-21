// A note that a run stored Meta's key in the credential store and has not
// yet removed it. The key itself is never written: the note says when, by
// which run and from which folder.
//
// The run removes what it stored when it ends, when it is interrupted and
// when it fails. A process that is ended outright (a closed machine, a
// tool's time limit) runs nothing, and a key left that way looks to the
// next run like the person's own. The note is how the next run knows, and
// it stands outside the run's own folder so that it outlives it.
//
// The next run never removes a Meta key on the strength of the note: the
// person may have stored their own key since. It says, first of all and in
// its record, that a key is stored and that an earlier run left one, and
// how to remove it; while no key is stored any more, it clears the note.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** Where the note stands: the system's temporary folder, under the run's own name. */
export const markerFile = (parent = tmpdir()) =>
  path.join(parent, 'real-life-run', 'meta-key-stored.json')

/**
The note of an earlier run, when there is one.
@returns {{ storedAt: string, run: string } | undefined}
*/
export function readMarker(file = markerFile()) {
  let note
  try {
    note = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    // No note, or one nobody can read: nothing is known of an earlier run.
  }
  return typeof note?.storedAt === 'string' ? note : undefined
}

/** Notes that this run is about to store Meta's key. */
export function writeMarker(note, file = markerFile()) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(note, null, 2)}\n`)
}

/** Names left by runs, never keys: each invocation owns a separate note. */
export function providerMarkers(parent = tmpdir()) {
  const folder = path.join(parent, 'real-life-run', 'providers')
  return existsSync(folder)
    ? readdirSync(folder).filter((name) => /^rl-[a-f0-9]{24}-\d+$/u.test(name))
    : []
}

/** Persist ownership before storing a key, including when --keep is off. */
export function writeProviderMarker(provider, parent = tmpdir()) {
  const folder = path.join(parent, 'real-life-run', 'providers')
  mkdirSync(folder, { recursive: true })
  writeFileSync(path.join(folder, provider), '')
}

/** A successful deletion retires only this provider's note. */
export function clearProviderMarker(provider, parent = tmpdir()) {
  rmSync(path.join(parent, 'real-life-run', 'providers', provider), { force: true })
}

/** Clears the note: no key of a run is in the store. */
export function clearMarker(file = markerFile()) {
  rmSync(file, { force: true })
}
