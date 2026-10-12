// One place that decides how often a person is told about a damaged file
// (CATCHMONEY R3, Part 2.1; review P2-4, P2-6): history settings, quote
// choices and schedule consent all report through a `DamageNoter`. The rule
// is the same everywhere: once per distinct damage, again when the damage
// changes, and again when it recurs after the file was healthy. Never on
// every sample. The once-marker is written atomically and cleared when the
// file reads valid again, so a recurrence after a repair is reported again.

import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'

/** Durable once-marker storage; every method is best-effort and never throws. */
export interface DamageMarkerStore {
  /** The marked damage identity, or undefined when no marker (or no valid one) exists. */
  readMarker(): string | undefined
  /** Records the damage identity atomically. */
  writeMarker(identity: string): void
  /** Clears the marker: the next damage, even an identical one, announces again. */
  clearMarker(): void
}

/**
 * Announces a damaged read once per distinct identity. `announce` runs at
 * most once per identity until the damage changes or the file reads healthy
 * in between; `noteHealthy` clears the marker so a recurrence announces
 * again. All storage failures only repeat an announcement, never hide one.
 */
export class DamageNoter {
  private readonly seen = new Set<string>()
  private isDirty = false
  private healthyMarkerChecked = false

  public constructor(
    private readonly store: DamageMarkerStore,
    private readonly announce: (identity: string) => void,
  ) {}

  /** A read that failed: `identity` names the distinct damage (content hash, or `kind:code`). */
  public noteDamaged(identity: string): void {
    this.isDirty = true
    this.healthyMarkerChecked = false
    if (this.seen.has(identity)) {
      return
    }
    this.seen.add(identity)
    if (this.store.readMarker() === identity) {
      return
    }
    this.store.writeMarker(identity)
    this.announce(identity)
  }

  /** A read that succeeded: a later recurrence of any damage announces again. */
  public noteHealthy(): void {
    if (!this.healthyMarkerChecked) {
      // A marker left by an earlier process must not hide a recurrence.
      this.healthyMarkerChecked = true
      this.store.clearMarker()
    }
    if (!this.isDirty) {
      return
    }
    this.isDirty = false
    this.seen.clear()
    this.store.clearMarker()
  }
}

/** A no-op marker store: dedupes within the process only. */
export function memoryDamageMarkers(): DamageMarkerStore {
  let marker: string | undefined
  return {
    readMarker: () => marker,
    writeMarker: (identity) => {
      marker = identity
    },
    clearMarker: () => {
      marker = undefined
    },
  }
}

/**
 * A file-backed marker store: `<file>.reported` holds `{ identity }`,
 * written through a temporary file and rename so a crash cannot leave a
 * torn marker. A torn marker only repeats an announcement, never hides one.
 */
export function fileDamageMarkers(file: string): DamageMarkerStore {
  const markerFile = `${file}.reported`
  const temporaryFile = `${file}.reported.tmp`
  return {
    readMarker: () => {
      try {
        const marker: unknown = JSON.parse(readFileSync(markerFile, 'utf8'))
        return typeof marker === 'object' &&
          marker !== null &&
          'identity' in marker &&
          typeof marker.identity === 'string'
          ? marker.identity
          : undefined
      } catch {
        // A missing or damaged marker announces, never hides.
        return
      }
    },
    writeMarker: (identity) => {
      try {
        writeFileSync(temporaryFile, JSON.stringify({ identity }))
        renameSync(temporaryFile, markerFile)
      } catch {
        // Best effort: an unwritten marker only repeats the announcement.
      }
    },
    clearMarker: () => {
      try {
        rmSync(markerFile, { force: true })
      } catch {
        // Best effort: a leftover marker only repeats an announcement.
      }
    },
  }
}
