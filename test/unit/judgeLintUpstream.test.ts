import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { describe, expect, it } from 'vitest'
import {
  decodeLintConfig,
  decodeLintPackRules,
  normalizeLintRules,
} from '../../src/core/judge/lint/config'
import { decodeLintEvals, decodeLintPackManifest } from '../../src/core/judge/lint/formats'
import {
  createLintWording,
  lintQuestion,
  type LintModelText,
} from '../../src/core/judge/lint/rules'
import { lintRule } from './helpers/judgeLint'

const root = path.resolve(import.meta.dirname, '../fixtures/judge/lint/upstream')
const read = async (name: string) => await readFile(path.resolve(root, name), 'utf8')
const capture = z
  .strictObject({
    repository: z.string(),
    revision: z.string(),
    license: z.string(),
    normalization: z.string(),
    modelAttempts: z.literal(0),
    files: z.array(
      z.strictObject({ fixture: z.string(), upstreamPath: z.string(), sha256: z.string() }),
    ),
  })
  .parse(JSON.parse(await read('capture.json')))

describe('actual pinned upstream JSON reference', () => {
  it('preserves upstream criteria and base/localized exception instructions', async () => {
    const text: LintModelText = z
      .strictObject({
        pass: z.string(),
        fail: z.string(),
        skip: z.string(),
        abstain: z.string(),
        instructionPrefix: z.string(),
        localizedInstructionPrefix: z.string(),
        exceptionsPrefix: z.string(),
      })
      .parse(JSON.parse(await read('wording.json')))
    const wording = createLintWording(text)
    const rule = lintRule({
      description: 'Use explicit errors.',
      exceptions: ['Optional capability unavailable', 'Documented empty result'],
      allowSkip: true,
      allowAbstain: true,
    })
    expect(lintQuestion(rule, wording).question).toEqual({
      type: 'choice',
      criteria: { A: text.pass, B: text.fail, C: text.skip, D: text.abstain },
      instructions:
        'Determine whether the supplied code complies with this rule:\nUse explicit errors.\n\nExplicit exceptions:\n- Optional capability unavailable\n- Documented empty result',
    })
    expect(lintQuestion(rule, wording, true).question.instructions).toBe(
      'Determine whether state.source violates this rule. Use state.parentSource only as surrounding context:\nUse explicit errors.\n\nExplicit exceptions:\n- Optional capability unavailable\n- Documented empty result',
    )
    expect(lintQuestion(lintRule({ exceptions: [] }), wording).question.instructions).toBe(
      'Determine whether the supplied code complies with this rule:\nFixture rule',
    )
    for (const [allowSkip, allowAbstain] of [
      [false, false],
      [true, false],
      [false, true],
    ] as const) {
      expect(
        Object.values(
          lintQuestion(lintRule({ allowSkip, allowAbstain }), wording).question.criteria ?? {},
        ),
      ).toEqual([
        text.pass,
        text.fail,
        ...(allowSkip ? [text.skip] : []),
        ...(allowAbstain ? [text.abstain] : []),
      ])
    }
  })
  it('retains licensed source data at the PLAN pin with normalized-byte hashes', async () => {
    expect(capture.revision).toBe('73a7a94ab08a4e314709d68c2863687a4646f29b')
    expect(capture.files).toHaveLength(4)
    expect(capture.modelAttempts).toBe(0)
    expect(await read('LICENSE')).toContain('Copyright (c) 2026 codegirl-007')
    for (const item of capture.files) {
      const captured = await read(item.fixture)
      const content = captured.replaceAll('\r\n', '\n')
      expect(createHash('sha256').update(content).digest('hex')).toBe(item.sha256)
    }
  })

  it('decodes all thirteen upstream presets, twenty-six rules and 674 labelled evals', async () => {
    const config = decodeLintConfig(await read('pinned-jevlint.txt'))
    const rules = normalizeLintRules(config)
    expect(Object.keys(config.languages)).toHaveLength(13)
    expect(rules).toHaveLength(26)
    expect(rules.some((rule) => rule.kinds.includes('docComment'))).toBe(true)
    expect(rules.some((rule) => rule.localize.includes('statement'))).toBe(true)
    expect(decodeLintEvals(await read('pinned-jevlint-evals.txt'), config).cases).toHaveLength(674)
  })

  it('decodes the actual upstream example manifest and pack rule document', async () => {
    const manifest = decodeLintPackManifest(await read('pinned-pack.txt'))
    expect(manifest).toEqual({
      version: 1,
      id: 'codegirl-007/database-joins',
      languages: ['go'],
      rules: 'rules.json',
    })
    const rules = decodeLintPackRules(await read('pinned-pack-rules.txt'))
    expect(rules.length).toBeGreaterThan(0)
    expect(
      normalizeLintRules(decodeLintConfig(JSON.stringify({ languages: { go: {} }, rules }))),
    ).toHaveLength(rules.length)
  })

  it('rejects a Muse setting added to the captured upstream config', async () => {
    const config: unknown = JSON.parse(await read('pinned-jevlint.txt'))
    expect(() =>
      decodeLintConfig(
        JSON.stringify({ ...z.record(z.string(), z.unknown()).parse(config), museSpark: {} }),
      ),
    ).toThrow()
  })
})
