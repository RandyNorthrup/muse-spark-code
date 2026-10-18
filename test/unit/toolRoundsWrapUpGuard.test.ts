import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  execGuardViaSymlinkedScripts,
  runGuardProcess,
  withGuardScratch,
} from './helpers/guardProcess'

const REPO = process.cwd()
const SCRIPT = path.join(REPO, 'scripts', 'check-wrap-up-request.mjs')
const HOST = path.join(REPO, 'src', 'core', 'backends', 'modelapi', 'ModelApiHost.ts')

function run(args: readonly string[], cwd = REPO): { status: number; output: string } {
  return runGuardProcess(SCRIPT, args, cwd, 60_000)
}

describe('wrap-up single-builder guard', () => {
  it('passes on the shipped host', () => {
    const result = run([HOST])
    expect(result.status).toBe(0)
    expect(result.output).toContain('single builder ok')
  })

  it('fails a planted second writer with the line that names the problem', () => {
    withGuardScratch('wrap-up-guard', (dir) => {
      const planted = path.join(dir, 'ModelApiHost.ts')
      cpSync(HOST, planted)
      writeFileSync(
        planted,
        `${readFileSync(planted, 'utf8')}\n// planted second builder\nturn.wrapUpLimit = 0\n`,
      )
      const result = run([planted])
      expect(result.status).not.toBe(0)
      expect(result.output).toContain('expected exactly one wrapUpLimit write, found 2')
    })
  })

  it('fails on missing input, never passes', () => {
    expect(run([]).status).not.toBe(0)
    expect(run([]).output).toContain('pass the ModelApiHost.ts path')
    withGuardScratch('wrap-up-guard-empty', (dir) => {
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
      'check-wrap-up-request.mjs',
      [HOST],
      'wrap-up-guard-link',
      60_000,
    )
    expect(output).toContain('single builder ok')
  })
})
