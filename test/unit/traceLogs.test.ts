import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createInsightsReader,
  readTraceLogs,
  readTraceAttempts,
  traceLogDirectory,
} from '../../src/runtime/usage/traceLogs'
import { removeFolder } from './helpers/temporaryFolders'

const home = mkdtempSync(path.join(tmpdir(), 'muse-trace-home-'))
const directory = traceLogDirectory({ homeDir: home })
mkdirSync(directory, { recursive: true })

const admission = (at: string, runId: string) =>
  `${at} INFO tbh.local.model x event="model.attempt.lifecycle" run_id="${runId}" attempt_id="a" task_id="t" phase="admission" outcome="accepted"\n`

afterAll(() => removeFolder(home))

describe('readTraceLogs', () => {
  it('reads the .log files under the CLI data root and ignores other files', async () => {
    writeFileSync(path.join(directory, 'cli-a.log'), admission('2026-09-23T03:00:00.000Z', 'r1'))
    writeFileSync(path.join(directory, 'notes.txt'), 'not a log')
    const logs = await readTraceLogs({ homeDir: home })
    expect(logs).toHaveLength(1)
    expect(logs[0]?.attempts).toHaveLength(1)
  })

  it('is empty without the directory', async () => {
    expect(await readTraceLogs({ homeDir: path.join(home, 'nowhere') })).toEqual([])
  })
})

describe('readTraceAttempts', () => {
  it('keeps attempts older than a week and distinguishes the captured reminder and subagent origins', async () => {
    const oldHome = path.join(home, 'old')
    const oldDirectory = traceLogDirectory({ homeDir: oldHome })
    mkdirSync(oldDirectory, { recursive: true })
    writeFileSync(
      path.join(oldDirectory, 'cli-old.log'),
      [
        '2025-01-01T00:00:00.000Z INFO event="tool.surface.registered" run_id=reminder x registered_tool_count=1',
        '2025-01-01T00:00:00.000Z INFO event="native_subagent.child" x child_run_id=child',
        admission('2025-01-01T00:01:00.000Z', 'turn'),
        admission('2025-01-01T00:02:00.000Z', 'reminder'),
        admission('2025-01-01T00:03:00.000Z', 'child'),
      ].join('\n'),
    )
    const rows = await readTraceAttempts({ homeDir: oldHome })
    expect(rows.map(({ origin, attempts }) => ({ origin, attempts }))).toEqual([
      { origin: 'reminder', attempts: 1 },
      { origin: 'subagent', attempts: 1 },
      { origin: 'turn', attempts: 1 },
    ])
  })
})

describe('createInsightsReader', () => {
  it('summarises the day and the week and re-reads only after the TTL', async () => {
    const now = Date.parse('2026-09-23T04:00:00.000Z')
    let clock = now
    const reader = createInsightsReader({ homeDir: home, now: () => clock })
    const first = await reader.read()
    expect(first?.day.attempts).toBe(1)
    writeFileSync(path.join(directory, 'cli-b.log'), admission('2026-09-23T03:30:00.000Z', 'r2'))
    // Inside the TTL the cached report stands.
    const cached = await reader.read()
    expect(cached?.day.attempts).toBe(1)
    clock += 60_000
    const fresh = await reader.read()
    expect(fresh?.day.attempts).toBe(2)
  })

  it('reports nothing at all without logs', async () => {
    const reader = createInsightsReader({ homeDir: path.join(home, 'empty'), now: () => 0 })
    expect(await reader.read()).toBeUndefined()
  })
})
