// The desktop Problems and Output stores (desktop/app/problems.ts,
// desktop/app/output.ts): real stores over the real bridge schemas, with
// the channel bounds and the megabyte clip.
import { describe, expect, it } from 'vitest'
import { OutputStore } from '../../../desktop/app/output'
import { ProblemsStore } from '../../../desktop/app/problems'
import {
  DESKTOP_OUTPUT_APPEND_MAX_CHARS,
  DESKTOP_OUTPUT_CHANNEL_MAX_CHARS,
  DESKTOP_OUTPUT_CHANNEL_NAME_MAX_CHARS,
  DIAGNOSTICS_MAX_ENTRIES,
} from '../../../src/shared/constants'

describe('M111 lane BP panel stores', () => {
  it('problems replace the whole list and refuse malformed rows by name', () => {
    const seen: unknown[] = []
    const store = new ProblemsStore((snapshot) => {
      seen.push(snapshot)
    })
    expect(store.snapshot()).toEqual({ problems: [] })
    store.replace([
      { path: 'src/a.ts', severity: 'error', line: 3, column: 7, message: 'nope', source: 'ts' },
      { path: 'src/b.ts', severity: 'hint', line: 1, column: 0, message: 'fyi' },
    ])
    expect(store.snapshot().problems).toHaveLength(2)
    expect(seen).toHaveLength(1)
    store.replace([])
    expect(store.snapshot()).toEqual({ problems: [] })
    expect(seen).toHaveLength(2)
    // Past the product's own entry bound the replace is refused, and the
    // refused replace leaves the last good list alone.
    const flood = Array.from({ length: DIAGNOSTICS_MAX_ENTRIES + 1 }, () => ({
      path: 'x.ts',
      severity: 'error',
      line: 1,
      column: 0,
      message: 'x',
    }))
    expect(() => {
      store.replace(flood)
    }).toThrow()
    expect(store.snapshot()).toEqual({ problems: [] })
  })

  it('output appends per channel, clips to the megabyte, clears one or all', () => {
    const appended: unknown[] = []
    const cleared: unknown[] = []
    const store = new OutputStore({
      onAppended: (frame) => {
        appended.push(frame)
      },
      onCleared: (frame) => {
        cleared.push(frame)
      },
    })
    expect(store.snapshot()).toEqual({ channels: [] })
    store.append('vite', 'ready in 300 ms\n')
    store.append('vite', 'hmm connected\n')
    store.append('tasks', 'built\n')
    expect(store.snapshot()).toEqual({
      channels: [
        { channel: 'vite', text: 'ready in 300 ms\nhmm connected\n', truncatedChars: 0 },
        { channel: 'tasks', text: 'built\n', truncatedChars: 0 },
      ],
    })
    expect(appended).toHaveLength(3)

    store.clear('vite')
    expect(store.snapshot()).toEqual({
      channels: [{ channel: 'tasks', text: 'built\n', truncatedChars: 0 }],
    })
    expect(cleared).toEqual([{ channel: 'vite' }])
    store.clear()
    expect(store.snapshot()).toEqual({ channels: [] })
    expect(cleared).toEqual([{ channel: 'vite' }, {}])
  })

  it('output refuses overlong names and chunks, and counts the clipped tail', () => {
    const appended: unknown[] = []
    const cleared: unknown[] = []
    const store = new OutputStore({
      onAppended: (frame) => {
        appended.push(frame)
      },
      onCleared: (frame) => {
        cleared.push(frame)
      },
    })
    const nameBound = new RegExp(`1 to ${String(DESKTOP_OUTPUT_CHANNEL_NAME_MAX_CHARS)} characters`)
    const chunkBound = new RegExp(`at most ${String(DESKTOP_OUTPUT_APPEND_MAX_CHARS)} characters`)
    expect(() => {
      store.append('', 'x')
    }).toThrow(nameBound)
    expect(() => {
      store.append('x'.repeat(DESKTOP_OUTPUT_CHANNEL_NAME_MAX_CHARS + 1), 'x')
    }).toThrow(nameBound)
    expect(() => {
      store.append('ok', 'x'.repeat(DESKTOP_OUTPUT_APPEND_MAX_CHARS + 1))
    }).toThrow(chunkBound)
    expect(() => {
      store.clear('')
    }).toThrow(nameBound)

    // 64 KiB appends fill the megabyte exactly; the next one clips.
    const chunk = 'y'.repeat(DESKTOP_OUTPUT_APPEND_MAX_CHARS)
    for (
      let index = 0;
      index < DESKTOP_OUTPUT_CHANNEL_MAX_CHARS / DESKTOP_OUTPUT_APPEND_MAX_CHARS;
      index += 1
    ) {
      store.append('flood', chunk)
    }
    expect(store.snapshot().channels).toEqual([
      {
        channel: 'flood',
        text: 'y'.repeat(DESKTOP_OUTPUT_CHANNEL_MAX_CHARS),
        truncatedChars: 0,
      },
    ])
    store.append('flood', 'zz')
    const [channel] = store.snapshot().channels
    expect(channel?.text).toBe(`${'y'.repeat(DESKTOP_OUTPUT_CHANNEL_MAX_CHARS - 2)}zz`)
    expect(channel?.truncatedChars).toBe(2)
    expect(appended).toHaveLength(
      DESKTOP_OUTPUT_CHANNEL_MAX_CHARS / DESKTOP_OUTPUT_APPEND_MAX_CHARS + 1,
    )
    expect(cleared).toEqual([])
  })
})
