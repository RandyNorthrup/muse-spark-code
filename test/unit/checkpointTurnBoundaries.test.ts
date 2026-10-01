import { afterEach, describe, expect, it } from 'vitest'
import {
  captured,
  harness,
  read,
  REAL_GIT_TIMEOUT_MS,
  removeCheckpointFolders,
  restoreOutcome,
  write,
} from './helpers/checkpointHarness'

afterEach(removeCheckpointFolders)

describe('turns in two windows that touch at one clock tick (M72)', () => {
  it(
    'protects the other window’s edit when its turn ends at the tick this turn starts',
    async () => {
      let clock = 1000
      const h = await harness({ now: () => clock })
      const other = h.reopen()
      await write(h.root, 'x.txt', 'x0\n')
      await write(h.root, 'y.txt', 'y0\n')
      // Window A's turn starts at tick 1000.
      await h.store.record('sA', 'tA', await captured(h.store))
      // Window B's turn starts at tick 2000, before A edits x.
      clock = 2000
      await other.record('sB', 'tB', await captured(other))
      // A's edit lands inside B's turn, and A's turn ends at the same tick 2000.
      await write(h.root, 'x.txt', 'x1\n')
      await h.store.endTurn('sA', 'tA')
      clock = 3000
      await write(h.root, 'y.txt', 'y1\n')
      await other.endTurn('sB', 'tB')
      const outcome = await restoreOutcome(other, 'tB', 'sB')
      expect(outcome.ok).toBe(true)
      // B's own edit goes back; A's edit, which B's end capture holds, stays.
      expect(await read(h.root, 'y.txt')).toBe('y0\n')
      expect(await read(h.root, 'x.txt')).toBe('x1\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
