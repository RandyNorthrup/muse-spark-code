// The deferred usage writers behind the activation budget: the service entry
// is bundled here from its real sources (no ambient dist/ needed), required
// the way production requires it on the first session, and a
// completion-bearing turn journals through the real store on a real temporary
// folder. No stand-in for any module: the bundle, the recording, the store
// and the filesystem are all real.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agentEvents'
import type { SubscriptionUsage } from '../../src/shared/usage'
import { createUsageRecording, type UsageRecording } from '../../src/core/usage/recording'
import { UsageJournalStore } from '../../src/core/usage/journalStore'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'

interface NotesBundle {
  MuseUsageDeltas: new (
    recording: UsageRecording,
    sessionId: string,
    modelId: string,
    isNew: boolean,
    now?: () => number,
  ) => { receive(event: AgentEvent, isReplay?: boolean): void }
  museCodeLimitInput: (usage: SubscriptionUsage) => {
    readonly plan?: string
    readonly windows: readonly { readonly id: string }[]
  }
}

function isNotesBundle(value: unknown): value is NotesBundle {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate['MuseUsageDeltas'] === 'function' &&
    typeof candidate['museCodeLimitInput'] === 'function'
  )
}

const state: { folder?: string; bundle?: NotesBundle } = {}

// Building the service entry takes seconds on a loaded rig: genuinely long,
// so this setup carries its own named deadline (one line: the build above).
beforeAll(async () => {
  state.folder = mkdtempSync(path.join(tmpdir(), 'notes-bundle-'))
  const outfile = path.join(state.folder, 'usageService.js')
  await build({
    entryPoints: ['src/runtime/usage/usageServiceEntry.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20.18',
    external: ['vscode'],
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  })
  const loaded: unknown = createRequire(outfile)(outfile)
  if (!isNotesBundle(loaded)) throw new Error('built usageService.js lacks the usage writers')
  state.bundle = loaded
}, 30_000)

afterAll(() => {
  if (state.folder !== undefined) rmSync(state.folder, { recursive: true, force: true })
})

function recordingInto(root: string, warnings: string[]): UsageRecording {
  const nowMs = 1_791_234_567_890
  const store = new UsageJournalStore(new NodeUsageFs(root), {
    writerId: 'notes-bundle-writer',
    now: () => nowMs,
    isEnabled: () => true,
    onWriteError: () => {
      warnings.push('usageWriteFailed')
    },
  })
  return createUsageRecording({
    client: 'test',
    now: () => nowMs,
    newId: (() => {
      let next = 0
      return () => `note-${String((next += 1))}`
    })(),
    isEnabled: () => true,
    writer: () => Promise.resolve(store),
    log: {
      trace: () => undefined,
      info: () => undefined,
      warn: (message: string) => {
        warnings.push(message)
      },
      error: (message: string) => {
        warnings.push(message)
      },
    },
  })
}

describe('usage writers load with the service bundle on first use', () => {
  it('journals one completion through the required chunk', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'notes-journal-'))
    try {
      const warnings: string[] = []
      const recording = recordingInto(root, warnings)
      const bundle = state.bundle
      if (bundle === undefined) throw new Error('notes bundle was not built')
      const deltas = new bundle.MuseUsageDeltas(recording, 'session-1', 'standing', true)
      deltas.receive({ type: 'turnStarted', turnId: 'turn-1' })
      const event: AgentEvent = {
        type: 'tokenUsage',
        inputTokens: 40,
        outputTokens: 7,
        modelId: 'standing',
        completion: { inputTokens: 40, outputTokens: 7, cachedTokens: 30, durationMs: 1200 },
      }
      deltas.receive(event)
      deltas.receive({ type: 'turnCompleted', turnId: 'turn-1', terminal: 'completed' })
      await recording.flush()
      expect(warnings).toEqual([])
      const records = await recording.today()
      expect(records).toHaveLength(1)
      expect(records[0]?.tokens.input).toBe(40)
      expect(records[0]?.tokens.output).toBe(7)
      expect(records[0]?.tokens.cached).toBe(30)
      expect(records[0]?.model).toBe('standing')
      expect(records[0]?.cost.certainty).toBe('plan')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('shapes a meter reading through the required chunk', () => {
    const bundle = state.bundle
    if (bundle === undefined) throw new Error('notes bundle was not built')
    const reading: SubscriptionUsage = {
      observedAtMs: 100,
      tier: 'opaque',
      window: { usedPercent: 110, resetsAtMs: 200, windowDurationMins: 300 },
      weekly: { usedPercent: 20, resetsAtMs: 500 },
    }
    const input = bundle.museCodeLimitInput(reading)
    expect(input.plan).toBe('opaque')
    expect(input.windows.map((window) => window.id)).toEqual(['window', 'weekly'])
    expect(bundle.museCodeLimitInput({ ...reading, tier: '' }).plan).toBeUndefined()
  })
})
