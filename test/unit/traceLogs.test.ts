// Recorded Muse Code 1.4.4-R5419.1 trace lines, captured 2026-10-10 by
// docs/certification/m53-captures/win11-1.4.4 (the driver and hashes are
// recorded in m53.md). All file operations and parsing below are real.
import { appendFileSync, mkdirSync, renameSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createInsightsReader,
  createTraceLineSplitter,
  readTraceAttemptSummary,
  readTraceLogs,
  readTraceAttempts,
  traceLogDirectory,
} from '../../src/runtime/usage/traceLogs'
import { USAGE_INSIGHTS_TTL_MS } from '../../src/shared/constants'
import { capturedTraceAdmissions, traceHome } from './helpers/capturedTraces'
import { removeFolder } from './helpers/temporaryFolders'

const captured = capturedTraceAdmissions()
const lines = captured.lines
const text = `${lines.join('\n')}\n`
const NOW = Date.parse('2026-10-10T17:05:00Z')
const roots: string[] = []
function home(): string {
  return traceHome(roots, 'rlusage-traces-')
}
function file(root: string, name = 'cli-captured.log'): string {
  return path.join(traceLogDirectory({ homeDir: root }), name)
}
afterAll(async () => {
  for (const root of roots) await removeFolder(root)
})

describe('recorded trace snapshots on the real filesystem', () => {
  it('shares unchanged facts, then counts an appended complete line and a replaced file', async () => {
    const root = home()
    const deps = { homeDir: root }
    writeFileSync(file(root), text)
    writeFileSync(file(root, 'notes.txt'), text)
    const first = await readTraceLogs(deps)
    expect(first).toHaveLength(1)
    expect(first[0]?.attempts).toHaveLength(captured.admissions)
    const again = await readTraceLogs(deps)
    expect(again[0]).toBe(first[0])
    const line = lines[0]
    if (line === undefined) throw new Error('Missing captured admission')
    appendFileSync(file(root), line)
    const torn = await readTraceLogs(deps)
    expect(torn[0]?.attempts).toHaveLength(captured.admissions)
    appendFileSync(file(root), '\n')
    const complete = await readTraceLogs(deps)
    expect(complete[0]?.attempts).toHaveLength(captured.admissions + 1)
    renameSync(file(root), file(root, 'rotated.txt'))
    writeFileSync(file(root), `${line}\n`)
    const replaced = await readTraceLogs(deps)
    expect(replaced[0]?.attempts).toHaveLength(1)
  })

  it('counts every captured byte past the former file-size limit and every old file past 200', async () => {
    const largeHome = home()
    const copies = 4000
    writeFileSync(file(largeHome), text.repeat(copies))
    expect(Buffer.byteLength(text.repeat(copies))).toBeGreaterThan(8 * 1024 * 1024)
    const large = await readTraceLogs({ homeDir: largeHome })
    expect(large[0]?.attempts).toHaveLength(captured.admissions * copies)
    const manyHome = home()
    const count = 205
    for (let index = 0; index < count; index += 1) {
      const target = file(manyHome, `cli-${String(index)}.log`)
      writeFileSync(target, text)
      utimesSync(target, new Date(0), new Date(0))
    }
    const rows = await readTraceAttempts({ homeDir: manyHome })
    expect(rows.reduce((sum, row) => sum + row.attempts, 0)).toBe(count * captured.admissions)
  })

  it('keeps successful traces and discloses an unreadable entry instead of claiming empty', async () => {
    const root = home()
    const deps = { homeDir: root }
    mkdirSync(file(root, 'cli-directory.log'))
    await expect(readTraceAttemptSummary(deps)).rejects.toThrow('traceLogsUnavailable')
    const unavailable = await createInsightsReader({ ...deps, now: () => NOW }).read()
    expect(unavailable).toEqual({ report: undefined, notice: 'unavailable', empty: false })
    writeFileSync(file(root), text)
    const partial = await readTraceAttemptSummary(deps)
    expect(partial.stale).toBe(true)
    expect(partial.attempts.reduce((sum, row) => sum + row.attempts, 0)).toBe(captured.admissions)
    const insights = await createInsightsReader({ ...deps, now: () => NOW }).read()
    expect(insights.notice).toBe('behind')
    expect(insights.report?.day.attempts).toBe(captured.admissions)
  })

  it('distinguishes no files from failure and refreshes insights after the existing cache TTL', async () => {
    const root = home()
    let now = NOW
    const reader = createInsightsReader({ homeDir: root, now: () => now })
    expect(await reader.read()).toEqual({ report: undefined, notice: undefined, empty: true })
    writeFileSync(file(root), text)
    const cached = await reader.read()
    expect(cached.empty).toBe(true)
    now += USAGE_INSIGHTS_TTL_MS
    const refreshed = await reader.read()
    expect(refreshed.empty).toBe(false)
    expect(refreshed.notice).toBeUndefined()
    expect(refreshed.report?.day.attempts).toBe(captured.admissions)
  })

  it('keeps the last good numbers with a stale note when a log turns unreadable', async () => {
    const root = home()
    const deps = { homeDir: root }
    writeFileSync(file(root), text)
    const first = await readTraceLogs(deps)
    expect(first).toHaveLength(1)
    renameSync(file(root), file(root, 'cli-moved-aside.txt'))
    mkdirSync(file(root))
    const behind = await readTraceAttemptSummary(deps)
    expect(behind.stale).toBe(true)
    expect(behind.attempts.reduce((sum, row) => sum + row.attempts, 0)).toBe(captured.admissions)
    await expect(readTraceLogs(deps)).rejects.toThrow('traceLogsUnavailable')
  })

  it('preserves captured lines across every chunk boundary, CRLF, and a torn final line', () => {
    const line = lines[0]
    if (line === undefined) throw new Error('Missing captured admission')
    for (let split = 0; split <= line.length + 2; split += 1) {
      const seen: string[] = []
      const splitter = createTraceLineSplitter((value) => {
        seen.push(value)
      })
      const input = `${line}\r\n${line}`
      splitter.push(input.slice(0, split))
      splitter.push(input.slice(split))
      expect(seen).toEqual([line])
    }
  })
})
