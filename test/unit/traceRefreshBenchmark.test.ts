import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createTraceLogReader,
  defaultTraceLogFs,
  traceLogDirectory,
  type TraceLogFs,
} from '../../src/runtime/usage/traceLogs'
import { removeFolder } from './helpers/temporaryFolders'

const folders: string[] = []
afterAll(async () => {
  for (const folder of folders.splice(0)) await removeFolder(folder)
})

// Generated logs shaped like the real ones: mostly timestamped filler
// lines without events, with sparse admissions spread through each file.
function fileContent(seed: number, bytes: number): string {
  const filler =
    '2026-10-12T05:00:00.000Z INFO tbh.local.runtime heartbeat tick worker=bootstrap queue_depth=0\n'
  const admission = (i: number) =>
    `2026-10-12T05:${String(i % 60).padStart(2, '0')}:00.000Z INFO tbh.local.model x event="model.attempt.lifecycle" run_id="run-${String(seed)}" attempt_id="a" task_id="t" phase="admission" outcome="accepted"\n`
  // All ASCII, so string length is the byte length; re-measuring each
  // iteration would make generation quadratic.
  let text = ''
  let i = 0
  while (text.length < bytes) {
    text += i % 97 === 0 ? admission(i) : filler
    i += 1
  }
  return text
}

describe('trace refresh benchmark', () => {
  // Genuinely long on purpose: 200 files at real-world sizes. The asserts
  // are relations (open counts), never absolute wall time; the printed
  // times are information for the certification record.
  it(
    'first refresh parses, unchanged refresh opens nothing, one grown file opens one',
    { timeout: 60_000 },
    async () => {
      const home = mkdtempSync(path.join(tmpdir(), 'muse-trace-bench-'))
      folders.push(home)
      const directory = traceLogDirectory({ homeDir: home })
      mkdirSync(directory, { recursive: true })
      const names = Array.from({ length: 200 }, (_, i) => `cli-${String(i).padStart(3, '0')}.log`)
      for (const [i, name] of names.entries()) {
        let bytes = 150 * 1024
        if (i >= 190) bytes = 1500 * 1024
        else if (i >= 150) bytes = 500 * 1024
        writeFileSync(path.join(directory, name), fileContent(i, bytes))
      }
      let opens = 0
      const counting: TraceLogFs = {
        ...defaultTraceLogFs,
        streamLines: async (file, maxBytes, onLine) => {
          opens += 1
          await defaultTraceLogFs.streamLines(file, maxBytes, onLine)
        },
      }
      const reader = createTraceLogReader({ homeDir: home, fs: counting })
      const firstStart = performance.now()
      const first = await reader.readLogs()
      const firstMs = performance.now() - firstStart
      const firstAttempts = first.flatMap((facts) => facts.attempts).length
      expect(first).toHaveLength(200)
      expect(opens).toBe(200)
      expect(firstAttempts).toBeGreaterThan(0)

      const secondStart = performance.now()
      const second = await reader.readLogs()
      const secondMs = performance.now() - secondStart
      expect(second).toHaveLength(200)
      expect(opens).toBe(200)
      expect(second.flatMap((facts) => facts.attempts)).toHaveLength(firstAttempts)

      appendFileSync(
        path.join(directory, names[0] ?? ''),
        '2026-10-12T05:59:00.000Z INFO tbh.local.model x event="model.attempt.lifecycle" run_id="grown" attempt_id="a" task_id="t" phase="admission" outcome="accepted"\n',
      )
      const thirdStart = performance.now()
      const third = await reader.readLogs()
      const thirdMs = performance.now() - thirdStart
      expect(third).toHaveLength(200)
      expect(opens).toBe(201)
      expect(third.flatMap((facts) => facts.attempts)).toHaveLength(firstAttempts + 1)

      // Wall times are information for the certification record, kept
      // beside the run like the M102 performance timing (never asserted).
      const folder = path.join(process.cwd(), 'temp')
      await mkdir(folder, { recursive: true })
      await writeFile(
        path.join(folder, 'trace-refresh-bench.json'),
        JSON.stringify({
          files: 200,
          firstMs,
          firstOpens: 200,
          unchangedMs: secondMs,
          unchangedOpens: 0,
          oneGrownMs: thirdMs,
          oneGrownOpens: 1,
        }),
      )
    },
  )
})
