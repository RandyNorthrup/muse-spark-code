// M115w W0: the watchdog's contracts over real code. The state machine
// walks its whole table, refuses illegal moves out loud, and re-drives an
// edited or reopened issue without repeating a post; findings v1 and the
// policy parse what they claim and reject the rest.
import { describe, expect, it } from 'vitest'
import {
  defaultWatchdogPolicy,
  detectWatchdogLanguage,
  nextWatchdogState,
  triageFindingsSchema,
  watchdogIssueSchema,
  watchdogPolicySchema,
  type WatchdogEvent,
  type WatchdogState,
} from '../../src/shared/watchdog'

const FLOW: { from: WatchdogState; on: WatchdogEvent; to: WatchdogState }[] = [
  { from: 'seen', on: 'acknowledged', to: 'acknowledged' },
  { from: 'acknowledged', on: 'triaged', to: 'triaged' },
  { from: 'triaged', on: 'infoRequested', to: 'awaitingInfo' },
  { from: 'awaitingInfo', on: 'infoReceived', to: 'triaged' },
  { from: 'triaged', on: 'planned', to: 'planned' },
  { from: 'planned', on: 'replied', to: 'replied' },
  { from: 'replied', on: 'closed', to: 'closed' },
]

describe('watchdog state machine', () => {
  it('walks the report-only flow to a close', () => {
    for (const step of FLOW) expect(nextWatchdogState(step.from, step.on)).toBe(step.to)
  })

  it('closes from any open state and reopens without repeating the acknowledgement', () => {
    const open: WatchdogState[] = ['seen', 'acknowledged', 'triaged', 'awaitingInfo', 'planned']
    for (const state of open) expect(nextWatchdogState(state, 'closed')).toBe('closed')
    expect(nextWatchdogState('closed', 'reopened')).toBe('acknowledged')
    expect(nextWatchdogState('replied', 'reopened')).toBe('replied')
  })

  it('re-drives an edited or polled issue in place', () => {
    expect(nextWatchdogState('acknowledged', 'edited')).toBe('triaged')
    expect(nextWatchdogState('triaged', 'edited')).toBe('triaged')
    expect(nextWatchdogState('replied', 'edited')).toBe('triaged')
    const states: WatchdogState[] = [
      'seen',
      'acknowledged',
      'triaged',
      'awaitingInfo',
      'planned',
      'replied',
    ]
    for (const state of states) expect(nextWatchdogState(state, 'polled')).toBe(state)
    expect(nextWatchdogState('closed', 'polled')).toBe('closed')
  })

  it('says an illegal move instead of taking it', () => {
    expect(() => nextWatchdogState('seen', 'triaged')).toThrow('seen')
    expect(() => nextWatchdogState('closed', 'acknowledged')).toThrow('closed')
    expect(() => nextWatchdogState('acknowledged', 'replied')).toThrow('acknowledged')
  })
})

describe('watchdog records and policy', () => {
  it('parses findings v1 and rejects another version', () => {
    const findings = triageFindingsSchema.parse({
      version: 1,
      verdict: 'needsInfo',
      summary: 'No reproduction steps.',
      questions: ['What did you do?'],
    })
    expect(findings.verdict).toBe('needsInfo')
    expect(() => triageFindingsSchema.parse({ ...findings, version: 2 })).toThrow()
  })

  it('requires the run id that keeps a restart from posting twice', () => {
    const record = {
      repository: 'owner/name',
      issueNumber: 146,
      issueId: 1,
      state: 'seen',
      runId: 'run-1',
      seenAtMs: 1,
      labelsApplied: [],
      lastTitle: 't',
      lastCommentCount: 0,
      lastIssueUpdatedAt: '2026-10-22T00:00:00Z',
      updatedAtMs: 1,
    }
    expect(watchdogIssueSchema.parse(record).runId).toBe('run-1')
    const { runId: _dropped, ...without } = record
    expect(() => watchdogIssueSchema.parse(without)).toThrow()
  })

  it('watches openly by default: everything unpaused, nothing auto-closed', () => {
    const policy = defaultWatchdogPolicy('owner/name')
    expect(watchdogPolicySchema.parse(policy)).toEqual(policy)
    expect(policy.paused).toBe(false)
    expect(policy.postsBeyondAck).toBe('ask')
    expect(policy.closePolicy).toBe('never')
    expect(policy.watchLabels).toEqual([])
  })

  it('detects English, the documented fallback', () => {
    expect(detectWatchdogLanguage('The window crashes on open.')).toBe('en')
    expect(detectWatchdogLanguage('La fenêtre se bloque à l’ouverture.')).toBe('en')
  })
})
