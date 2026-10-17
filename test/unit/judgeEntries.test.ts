import { describe, expect, it } from 'vitest'
import { entryKey, JudgeEntryStore, type JudgeEntryParts } from '../../src/core/judge/entries'

function parts(overrides: Partial<JudgeEntryParts> = {}): JudgeEntryParts {
  return {
    backend: 'model-api',
    sessionId: 'session-1',
    turnId: 'turn-1',
    tool: 'runCommand',
    args: { command: 'rm -rf /tmp/cache', workdir: '/repo' },
    ...overrides,
  }
}

describe('entryKey', () => {
  it('is stable and order-independent over arguments', () => {
    const left = entryKey(parts())
    expect(entryKey(parts())).toBe(left)
    expect(entryKey(parts({ args: { workdir: '/repo', command: 'rm -rf /tmp/cache' } }))).toBe(left)
    expect(entryKey(parts())).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes with a changed argument, tool, turn, session or backend', () => {
    const key = entryKey(parts())
    expect(entryKey(parts({ args: { command: 'ls', workdir: '/repo' } }))).not.toBe(key)
    expect(entryKey(parts({ tool: 'writeFile' }))).not.toBe(key)
    expect(entryKey(parts({ turnId: 'turn-2' }))).not.toBe(key)
    expect(entryKey(parts({ sessionId: 'session-2' }))).not.toBe(key)
    expect(entryKey(parts({ backend: 'musecode' }))).not.toBe(key)
  })

  it('refuses non-JSON arguments rather than colliding keys', () => {
    expect(() => entryKey(parts({ args: { run: () => undefined } }))).toThrow(TypeError)
    expect(() => entryKey(parts({ args: NaN }))).toThrow(TypeError)
  })

  it('accepts true and false in nested JSON without colliding with numbers', () => {
    const args = { command: 'ls', dryRun: true, flags: [false, { enabled: true }] }
    const key = entryKey(parts({ args }))
    expect(entryKey(parts({ args: { flags: args.flags, dryRun: true, command: 'ls' } }))).toBe(key)
    expect(entryKey(parts({ args: { ...args, dryRun: false } }))).not.toBe(key)
    expect(entryKey(parts({ args: true }))).not.toBe(entryKey(parts({ args: 1 })))
    expect(entryKey(parts({ args: false }))).not.toBe(entryKey(parts({ args: 0 })))
    expect(() => entryKey(parts({ args: { ...args, value: Infinity } }))).toThrow(TypeError)
  })
})

describe('JudgeEntryStore', () => {
  it('starts an entry once: the same exact action keeps the first entry', () => {
    const store = new JudgeEntryStore()
    const first = store.start(parts())
    expect(store.start(parts())).toBe(first)
    expect(store.size).toBe(1)
  })

  it('reads a ready caution once, then drops late results', () => {
    const store = new JudgeEntryStore()
    const key = store.start(parts())
    expect(store.settle(key, 'caution')).toBe(true)
    expect(store.readLatch(key)).toBe('caution')
    // The fence has passed: a second read and any later settle find nothing.
    expect(store.readLatch(key)).toBeUndefined()
    expect(store.settle(key, 'caution')).toBe(false)
    expect(store.size).toBe(0)
  })

  it('leaves the verdict for pending, failed and none entries', () => {
    const store = new JudgeEntryStore()
    const pending = store.start(parts({ turnId: 'pending-turn' }))
    expect(store.readLatch(pending)).toBeUndefined()

    const failed = store.start(parts({ turnId: 'failed-turn' }))
    expect(store.settle(failed, 'failed')).toBe(true)
    expect(store.readLatch(failed)).toBeUndefined()

    const none = store.start(parts({ turnId: 'none-turn' }))
    expect(store.settle(none, 'none')).toBe(true)
    expect(store.readLatch(none)).toBe('none')
  })

  it('drops a result that arrives after its fence passed', () => {
    const store = new JudgeEntryStore()
    const key = store.start(parts())
    // The fence reads while pending and consumes the entry.
    expect(store.readLatch(key)).toBeUndefined()
    expect(store.settle(key, 'caution')).toBe(false)
    expect(store.readLatch(key)).toBeUndefined()
  })

  it('never settles an unknown key', () => {
    const store = new JudgeEntryStore()
    const unknown = { key: 'missing' }
    expect(store.settle(unknown, 'caution')).toBe(false)
    expect(store.readLatch(unknown)).toBeUndefined()
  })

  it.each(['discard', 'fence', 'turn', 'session'] as const)(
    'drops stale callbacks after %s even when the identical action restarts',
    (reason) => {
      for (const outcome of ['caution', 'none', 'failed'] as const) {
        const store = new JudgeEntryStore()
        const old = store.start(parts())
        const removals = {
          discard: () => store.discard(old),
          fence: () => store.readLatch(old),
          turn: () => store.discardTurn('session-1', 'turn-1'),
          session: () => store.discardSession('session-1'),
        }
        removals[reason]()
        const replacement = store.start(parts())
        expect(replacement.key).toBe(old.key)
        expect(store.settle(old, outcome)).toBe(false)
        expect(store.readLatch(old)).toBeUndefined()
        expect(store.discard(old)).toBe(false)
        expect(store.settle(replacement, 'caution')).toBe(true)
        expect(store.readLatch(replacement)).toBe('caution')
      }
    },
  )

  it('rejects a forged handle even with a live key', () => {
    const store = new JudgeEntryStore()
    const live = store.start(parts())
    const forged = { key: live.key }
    expect(store.settle(forged, 'caution')).toBe(false)
    expect(store.readLatch(forged)).toBeUndefined()
    expect(store.discard(forged)).toBe(false)
    expect(store.settle(live, 'none')).toBe(true)
    expect(store.readLatch(live)).toBe('none')
  })

  it('discards a cancelled action, a replaced turn and a replaced session', () => {
    const store = new JudgeEntryStore()
    const key = store.start(parts())
    expect(store.discard(key)).toBe(true)
    expect(store.discard(key)).toBe(false)
    expect(store.settle(key, 'caution')).toBe(false)

    const first = store.start(parts({ sessionId: 's', turnId: 't1' }))
    const second = store.start(parts({ sessionId: 's', turnId: 't2' }))
    const other = store.start(parts({ sessionId: 'other', turnId: 't1' }))
    expect(store.discardTurn('s', 't1')).toBe(1)
    expect(store.settle(first, 'caution')).toBe(false)
    expect(store.settle(second, 'caution')).toBe(true)
    expect(store.discardSession('s')).toBe(1)
    expect(store.readLatch(second)).toBeUndefined()
    expect(store.settle(other, 'none')).toBe(true)
    expect(store.readLatch(other)).toBe('none')
    expect(store.size).toBe(0)
  })
})
