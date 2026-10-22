// The first-run questionnaire's suggestions (M110t TQ): experiences
// follow from the named languages, and the skill's stack table parses
// out of its markdown. Pure.
import { describe, expect, it } from 'vitest'
import { parseStackTable, suggestExperiences } from '../../src/shared/profile'

describe('suggestExperiences', () => {
  it('maps each named language to its experience, with reasons', () => {
    const suggestions = suggestExperiences({ languages: ['TypeScript', 'python', ' Go '] })
    expect(suggestions).toEqual([
      { experience: 'node', reason: 'for TypeScript and JavaScript' },
      { experience: 'python', reason: 'for Python' },
      { experience: 'go', reason: 'for Go' },
      { experience: 'polyglot', reason: 'for working across stacks' },
    ])
  })

  it('suggests Unity as notes only, never a pack', () => {
    const suggestions = suggestExperiences({ languages: ['C#'] })
    expect(suggestions).toEqual([
      {
        experience: 'unity',
        reason: 'as cross-platform notes only: the Unity editor is not a pack',
      },
    ])
  })

  it('suggests nothing for unknown words', () => {
    expect(suggestExperiences({ languages: ['klingon'] })).toEqual([])
  })
})

describe('parseStackTable', () => {
  it('reads the Phase 2 stack rows in order', () => {
    const markdown = [
      '# Skill',
      '',
      '| Stack | Format | Lint | Types | Dead code | Security | Test | Notes |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      '| node | prettier | eslint | tsc | knip | audit | vitest | x |',
      '| python | ruff | ruff | mypy | vulture | pip-audit | pytest | y |',
      '',
      'Done.',
    ].join('\n')
    expect(parseStackTable(markdown)).toEqual([
      {
        stack: 'node',
        format: 'prettier',
        lint: 'eslint',
        types: 'tsc',
        deadCode: 'knip',
        security: 'audit',
        test: 'vitest',
      },
      {
        stack: 'python',
        format: 'ruff',
        lint: 'ruff',
        types: 'mypy',
        deadCode: 'vulture',
        security: 'pip-audit',
        test: 'pytest',
      },
    ])
  })

  it('yields no rows for unknown text, never a guess', () => {
    expect(parseStackTable('# Nothing here\n\nJust prose.')).toEqual([])
  })
})
