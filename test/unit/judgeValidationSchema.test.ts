// Production integration proofs alongside main's isolated deferred-bundle fixtures.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import { requireFile } from '../../src/host/lazyBundle'
import { beforeAll, describe, expect, it } from 'vitest'
import type * as validation from '../../src/host/validationEntry'

beforeAll(() => {
  execFileSync(process.execPath, ['scripts/build.mjs', '--production'], { stdio: 'pipe' })
})

describe('integrated Judge factories and shared parser', () => {
  it('ships distinct callable factories for the installed phase-1 and explicit phase-2 paths', () => {
    const phase1 = requireFile(path.resolve('dist/judge.js'))
    const phase2 = requireFile(path.resolve('dist/judgeP2.js'))
    expect(phase1).toHaveProperty('createWindowJudge', expect.any(Function))
    expect(phase1).not.toHaveProperty('createJudgeFeatures')
    expect(phase2).toHaveProperty('createJudgeFeatures', expect.any(Function))
    expect(phase2).not.toHaveProperty('createWindowJudge')
    expect(readFileSync('dist/meta/judge.json', 'utf8')).toContain('src/host/judge/judgeEntry.ts')
  })

  it('loads JSON Schema conversion only on conversion and refuses a malformed writer', () => {
    const entry = path.resolve('dist/validation.js')
    const nativeRequire = createRequire(entry)
    const loaded: string[] = []
    const writer = { isMalformed: false }
    const module: { exports: unknown } = { exports: {} }
    const tracedRequire = (name: string): unknown => {
      loaded.push(name)
      return name === './validationSchema.js' && writer.isMalformed ? {} : nativeRequire(name)
    }
    const run = vm.compileFunction(readFileSync(entry, 'utf8'), [
      'require',
      'module',
      'exports',
      '__filename',
    ])
    Reflect.apply(run, undefined, [
      (file: string): unknown => {
        loaded.push(file)
        return file === 'node:module' ? { createRequire: () => tracedRequire } : nativeRequire(file)
      },
      module,
      module.exports,
      entry,
    ])
    const parser: typeof validation = Object.assign({}, nativeRequire(entry), module.exports)
    expect(parser.string().safeParse(1).success).toBe(false)
    expect(loaded).not.toContain('./validationSchema.js')
    expect(parser.toJSONSchema(parser.strictObject({ value: parser.string() }))).toMatchObject({
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    })
    expect(loaded).toContain('./validationSchema.js')
    writer.isMalformed = true
    expect(() => parser.toJSONSchema(parser.string())).toThrow('validation-schema-unavailable')
  })
})
