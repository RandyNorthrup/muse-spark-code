// Recorded Muse Code 1.4.4-R5419.1 trace admissions, captured 2026-10-10 by
// docs/certification/m53-captures/win11-1.4.4 (the driver and hashes are
// recorded in m53.md). Suites read real trace facts through the real reader,
// never invented lines; the zero-tolerance duplication gate keeps the
// capture loading and the trace-home setup in this one place.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import { traceLogDirectory } from '../../../src/runtime/usage/traceLogs'

/** The first captured trace that admitted attempts: its lines and its count. */
export function capturedTraceAdmissions(): {
  readonly lines: readonly string[]
  readonly admissions: number
} {
  const capture = z
    .object({
      traces: z.array(z.object({ admissionLines: z.array(z.string()), admissions: z.number() })),
    })
    .parse(
      JSON.parse(
        readFileSync('docs/certification/m53-captures/win11-1.4.4/trace-counts.json', 'utf8'),
      ),
    )
  const captured = capture.traces.find((trace) => trace.admissions > 0)
  if (captured === undefined || captured.admissionLines.length !== captured.admissions) {
    throw new Error('Missing captured trace admissions')
  }
  return { lines: captured.admissionLines, admissions: captured.admissions }
}

/** A home folder with an empty trace directory, registered for cleanup. */
export function traceHome(roots: string[], prefix: string): string {
  mkdirSync('temp', { recursive: true })
  const root = mkdtempSync(path.resolve('temp', prefix))
  roots.push(root)
  mkdirSync(traceLogDirectory({ homeDir: root }), { recursive: true })
  return root
}

/** A home folder whose trace directory holds the lines as one log file. */
export function traceHomeWithLines(
  roots: string[],
  lines: readonly string[],
  prefix: string,
  name = 'cli-captured.log',
): string {
  const root = traceHome(roots, prefix)
  writeFileSync(path.join(traceLogDirectory({ homeDir: root }), name), `${lines.join('\n')}\n`)
  return root
}
