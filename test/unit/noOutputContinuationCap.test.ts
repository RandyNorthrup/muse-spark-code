import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  execGuardViaSymlinkedScripts,
  runGuardProcess,
  withGuardScratch,
} from './helpers/guardProcess'

const REPO = process.cwd()
const SCRIPT = path.join(REPO, 'scripts', 'check-no-output-continuation-cap.mjs')
const HOST = path.join(REPO, 'src', 'core', 'backends', 'modelapi', 'ModelApiHost.ts')

function run(args: readonly string[], cwd = REPO): { status: number; output: string } {
  return runGuardProcess(SCRIPT, args, cwd, 60_000)
}

// NOLIMITSRUN (PLAN.md D121): a reply cut at the output limit keeps going
// for as long as the model is mid-answer — no count of ours ends it.
describe('output continuation guard', () => {
  it('passes on the shipped host', () => {
    const result = run([HOST])
    expect(result.status).toBe(0)
    expect(result.output).toContain('no cap ok')
  })

  it('fails a planted count cap with the line that names the problem', () => {
    withGuardScratch('output-cap-guard', (dir) => {
      const planted = path.join(dir, 'ModelApiHost.ts')
      cpSync(HOST, planted)
      writeFileSync(
        planted,
        `${readFileSync(planted, 'utf8')}\n// planted count cap\nif (outputContinuations < MODEL_API_CONTINUATIONS_MAX) {}\n`,
      )
      const result = run([planted])
      expect(result.status).not.toBe(0)
      expect(result.output).toContain('MODEL_API_CONTINUATIONS_MAX still caps the continuation')
    })
  })

  it('fails on missing input, never passes', () => {
    expect(run([]).status).not.toBe(0)
    expect(run([]).output).toContain('pass the ModelApiHost.ts path')
    withGuardScratch('output-cap-guard-empty', (dir) => {
      const empty = path.join(dir, 'empty.ts')
      writeFileSync(empty, '')
      const result = run([empty])
      expect(result.status).not.toBe(0)
      expect(result.output).toContain('empty input')
    })
  })

  it('passes through a symlinked directory', () => {
    const output = execGuardViaSymlinkedScripts(
      REPO,
      'check-no-output-continuation-cap.mjs',
      [HOST],
      'output-cap-guard-link',
      60_000,
    )
    expect(output).toContain('no cap ok')
  })
})
