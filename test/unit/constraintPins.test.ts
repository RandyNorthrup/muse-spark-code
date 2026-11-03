// RLF-PINNED (M101): the person's side constraints, captured
// deterministically from their own words and carried verbatim past
// compaction. The session paths run the product's real host and file
// store; no provider answer is invented — the accepted-compaction layout
// is exercised as the store and a resumed session hold it, and the
// rejected path is the host's own NOOP.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  extractPinnedConstraints,
  mergePinnedConstraints,
  pinnedConstraintsItem,
  pinnedConstraintsText,
  withoutPinnedConstraints,
} from '../../src/core/backends/modelapi/constraintPins'
import { ModelApiSession } from '../../src/core/backends/modelapi/ModelApiHost'
import type { InputItem } from '../../src/core/backends/modelapi/schemas'
import {
  parseStoredSession,
  type StoredSession,
} from '../../src/core/backends/modelapi/sessionStore'
import { DEFAULT_MODEL_ID, MODEL_API_MODEL_TEXT } from '../../src/shared/constants'
import {
  awaitSaved,
  loadedModelApiRig,
  modelApiRig,
  TEST_ACCOUNT_ID,
} from './helpers/conversationPanel'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function folder(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'muse-pins-'))
  folders.push(dir)
  return dir
}

function asSession(live: unknown): ModelApiSession {
  if (!(live instanceof ModelApiSession))
    throw new TypeError('the rig session is not a ModelApiSession')
  return live
}

function message(role: 'user' | 'assistant', text: string): InputItem {
  return {
    type: 'message',
    role,
    content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }],
  }
}

function compactionCard(pins: readonly string[]): StoredSession['transcript'][number] {
  return {
    turnId: 'compaction',
    item: {
      itemId: 'compaction-item',
      kind: 'compaction',
      status: 'completed',
      pinnedConstraints: [...pins],
      fallbackText: 'Context compacted',
    },
  }
}

/** A stored session as the file store holds it, with this test's own turns. */
function storedSession(
  dir: string,
  fields: Pick<StoredSession, 'sessionId' | 'turnIds' | 'pinnedConstraints' | 'replay'> &
    Partial<StoredSession>,
): StoredSession {
  return {
    version: 1,
    accountId: TEST_ACCOUNT_ID,
    workspaceRoot: dir,
    modelId: DEFAULT_MODEL_ID,
    approvalMode: 'promptUnmatched',
    effort: 'high',
    createdAt: '2026-11-02T10:00:00.000Z',
    lastActivityAt: '2026-11-02T10:05:00.000Z',
    todos: [],
    transcript: [],
    outputs: {},
    usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0, reasoningTokens: 0 },
    ...fields,
  }
}

/** Each session parsed and saved through the real file store, then a host loaded over them. */
async function storedRig(
  dir: string,
  sessions: readonly StoredSession[],
): Promise<Awaited<ReturnType<typeof loadedModelApiRig>>> {
  const writer = modelApiRig(dir)
  for (const stored of sessions) {
    const parsed = parseStoredSession(structuredClone(stored))
    if (!parsed.ok) throw new Error(parsed.reason)
    await writer.store.save(parsed.session)
  }
  const rig = await loadedModelApiRig(dir)
  for (const stored of sessions) await awaitSaved(rig, stored.sessionId)
  return rig
}

describe('constraint capture (RLF-PINNED)', () => {
  it('captures an explicit Constraints section, bullet and numbered lines alike', () => {
    const text = [
      'Fix the parser.',
      '',
      'Constraints:',
      '- Never use var anywhere',
      '2. The public API stays the same',
      '',
      'Thanks!',
    ].join('\n')
    expect(extractPinnedConstraints(text)).toEqual([
      'Never use var anywhere',
      'The public API stays the same',
    ])
  })

  it('captures imperative must/never/always lines outside a section', () => {
    const text = [
      'Tidy the totals module.',
      'Never modify totals.test.js.',
      'The exported names must stay exactly as they are.',
      'Always run the check before you finish.',
      'Do not add a default export.',
    ].join('\n')
    expect(extractPinnedConstraints(text)).toEqual([
      'Never modify totals.test.js.',
      'The exported names must stay exactly as they are.',
      'Always run the check before you finish.',
      'Do not add a default export.',
    ])
  })

  it('leaves ordinary prose, questions and fenced code uncaptured', () => {
    const text = [
      'Fix the loop bound so it visits exactly the elements.',
      'Must the helper really allocate here?',
      '```js',
      '// never returns null; the caller must check',
      '```',
      'The log said the worker never started, whatever that means',
    ].join('\n')
    // The last line carries "never" as a directive-shaped word: when in
    // doubt capture, and the person can unpin it — the fenced code and
    // the question never count.
    expect(extractPinnedConstraints(text)).toEqual([
      'The log said the worker never started, whatever that means',
    ])
  })

  it('keeps a pin’s own words byte-for-byte, inner spacing included', () => {
    const pin = 'Never  use   `var` — not even in tests!'
    expect(extractPinnedConstraints(`- ${pin}`)).toEqual([pin])
    expect(pinnedConstraintsText([pin])).toBe(`${MODEL_API_MODEL_TEXT.compactionPinned}\n- ${pin}`)
    const item = pinnedConstraintsItem([pin])
    expect(item).toEqual({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: pinnedConstraintsText([pin]) }],
    })
    expect(pinnedConstraintsItem([])).toBeUndefined()
  })

  it('folds duplicates in stated order when turns repeat a pin', () => {
    expect(
      mergePinnedConstraints(['Never use var'], ['Always test', 'Never use var', 'Always test']),
    ).toEqual(['Never use var', 'Always test'])
  })

  it('takes the pinned block out of a summariser input and nothing else', () => {
    const pins = ['Never use var']
    const pinned = pinnedConstraintsItem(pins)
    if (pinned === undefined) throw new Error('no pinned item')
    const summary: InputItem = {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Summary of the conversation so far …' }],
    }
    const mention: InputItem = {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Earlier I said: Never use var — still true?' }],
    }
    expect(withoutPinnedConstraints([summary, pinned, mention], pins)).toEqual([summary, mention])
    expect(withoutPinnedConstraints([summary, mention], [])).toEqual([summary, mention])
  })
})

describe('pinned constraints in a real session (RLF-PINNED)', () => {
  it('captures, saves and unpins through the real host and file store', async () => {
    const dir = folder()
    const rig = modelApiRig(dir, undefined, undefined, { constraintPinning: true })
    const live = asSession(
      await rig.host.startSession({
        workspaceRoot: dir,
        modelId: DEFAULT_MODEL_ID,
        approvalMode: 'promptUnmatched',
      }),
    )
    live.noteUserConstraints(
      [
        'Fix the parser.',
        '',
        'Constraints:',
        '- Never use var anywhere',
        '- Always run the tests before you finish',
        '',
        'The public names must stay as they are.',
      ].join('\n'),
    )
    const pins = [
      'Never use var anywhere',
      'Always run the tests before you finish',
      'The public names must stay as they are.',
    ]
    expect(live.pinnedConstraintList()).toEqual(pins)
    expect(live.snapshot().pinnedConstraints).toEqual(pins)

    // The host's own persist round-trips the pins byte-for-byte through
    // the file store.
    await awaitSaved(rig, live.sessionId)
    await rig.host.flush()
    const stored = await rig.store.load(live.sessionId)
    expect(JSON.stringify(stored?.pinnedConstraints)).toBe(JSON.stringify(pins))

    // A rejected compaction (nothing to compact) leaves history and pins untouched.
    const before = live.snapshot()
    const outcome = await live.compact()
    expect(outcome.status).toBe('noop')
    const after = live.snapshot()
    expect(after.replay).toEqual(before.replay)
    expect(after.pinnedConstraints).toEqual(pins)

    // Unpin removes exactly that pin; a second unpin of it reports false.
    expect(live.unpinConstraint('Never use var anywhere')).toBe(true)
    expect(live.pinnedConstraintList()).toEqual(pins.slice(1))
    expect(live.unpinConstraint('Never use var anywhere')).toBe(false)
    await rig.host.flush()
  })

  it('does not capture while pinning is not armed', async () => {
    const dir = folder()
    const rig = modelApiRig(dir)
    const live = asSession(
      await rig.host.startSession({
        workspaceRoot: dir,
        modelId: DEFAULT_MODEL_ID,
        approvalMode: 'promptUnmatched',
      }),
    )
    live.noteUserConstraints('Constraints:\n- Never use var anywhere')
    expect(live.pinnedConstraintList()).toEqual([])
    expect(live.snapshot().pinnedConstraints).toBeUndefined()
    await rig.host.flush()
  })

  it('resumes the accepted-compaction layout byte-for-byte and rebuilds it on unpin', async () => {
    const dir = folder()
    const pins = ['Never use var anywhere', 'Always run the tests before you finish']
    const pinned = pinnedConstraintsItem(pins)
    if (pinned === undefined) throw new Error('no pinned item')
    const stored = storedSession(dir, {
      sessionId: 'pinned-session',
      turnIds: ['t1'],
      compactedThroughTurnId: 't1',
      pinnedConstraints: pins,
      replay: [
        { turnId: 'compaction', item: message('user', 'summary of earlier turns') },
        { turnId: 'pinned', item: pinned },
        { turnId: 't1', item: message('assistant', 'working on it') },
      ],
      transcript: [compactionCard(pins)],
    })
    const parsed = parseStoredSession(structuredClone(stored))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.reason)
    expect(JSON.stringify(parsed.session.pinnedConstraints)).toBe(JSON.stringify(pins))
    expect(JSON.stringify(parsed.session.replay[1]?.item)).toBe(JSON.stringify(pinned))

    const rig = await storedRig(dir, [stored])
    const loaded = await rig.host.resumeSession('pinned-session', DEFAULT_MODEL_ID)
    const live = asSession(loaded.session)
    expect(live.pinnedConstraintList()).toEqual(pins)
    const snapshot = live.snapshot()
    expect(snapshot.replay[1]?.turnId).toBe('pinned')
    expect(JSON.stringify(snapshot.replay[1]?.item)).toBe(JSON.stringify(pinned))

    // Unpinning rebuilds the very block the next request re-sends.
    expect(live.unpinConstraint('Never use var anywhere')).toBe(true)
    const afterUnpin = live.snapshot()
    const remaining = pinnedConstraintsItem(['Always run the tests before you finish'])
    expect(JSON.stringify(afterUnpin.replay[1]?.item)).toBe(JSON.stringify(remaining))
    expect(afterUnpin.pinnedConstraints).toEqual(['Always run the tests before you finish'])

    // Unpinning the last pin takes the entry out of the replay entirely.
    expect(live.unpinConstraint('Always run the tests before you finish')).toBe(true)
    const cleared = live.snapshot()
    expect(cleared.replay.some((entry) => entry.turnId === 'pinned')).toBe(false)
    expect(cleared.pinnedConstraints).toBeUndefined()
    await rig.host.flush()
  })

  it('a fork keeps the pins its kept turns stated, and every pin a compaction carries', async () => {
    const dir = folder()
    // A section line with no must/never/always: only the section makes it a pin.
    const tabs = 'Use tabs for indentation'
    const noVar = 'Never use var anywhere'
    const pinned = pinnedConstraintsItem([tabs, noVar])
    if (pinned === undefined) throw new Error('no pinned item')
    const rig = await storedRig(dir, [
      storedSession(dir, {
        sessionId: 'uncompacted',
        turnIds: ['t1', 't2'],
        pinnedConstraints: [tabs, noVar],
        replay: [
          { turnId: 't1', item: message('user', `Constraints:\n- ${tabs}`) },
          { turnId: 't1', item: message('assistant', 'done') },
          { turnId: 't2', item: message('user', noVar) },
          { turnId: 't2', item: message('assistant', 'done') },
        ],
      }),
      // After a compaction, t1's words survive only in the pinned block.
      storedSession(dir, {
        sessionId: 'compacted',
        turnIds: ['t1', 't2'],
        compactedThroughTurnId: 't1',
        pinnedConstraints: [tabs, noVar],
        replay: [
          { turnId: 'compaction', item: message('user', 'summary of earlier turns') },
          { turnId: 'pinned', item: pinned },
          { turnId: 't2', item: message('user', noVar) },
          { turnId: 't2', item: message('assistant', 'done') },
        ],
        transcript: [compactionCard([tabs, noVar])],
      }),
    ])
    const fork = async (sessionId: string, lastTurnId?: string): Promise<ModelApiSession> => {
      const loaded = await rig.host.forkSession(sessionId, DEFAULT_MODEL_ID, lastTurnId)
      return asSession(loaded.session)
    }

    // A rewind to t1 drops the pin only t2 stated; a whole fork keeps both.
    const rewound = await fork('uncompacted', 't1')
    expect(rewound.pinnedConstraintList()).toEqual([tabs])
    const whole = await fork('uncompacted')
    expect(whole.pinnedConstraintList()).toEqual([tabs, noVar])

    const compacted = await fork('compacted')
    expect(compacted.pinnedConstraintList()).toEqual([tabs, noVar])
    const snapshot = compacted.snapshot()
    expect(JSON.stringify(snapshot.replay[1]?.item)).toBe(JSON.stringify(pinned))
    const card = snapshot.transcript.find((entry) => entry.item.kind === 'compaction')
    expect(card?.item.pinnedConstraints).toEqual([tabs, noVar])
    await rig.host.flush()
  })
})
