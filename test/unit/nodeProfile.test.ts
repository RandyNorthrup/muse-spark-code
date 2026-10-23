// The first-run questionnaire (M110t TQ, D90.27): personas and
// languages map to packs, and the skill's real Phase 2 stack table
// parses out of its real SKILL.md. Pure, over real data.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildProfile,
  parseStackTable,
  personaPacks,
  previewPacks,
  QUESTION_STEPS,
  STRICTNESS_GATES,
  suggestPacks,
} from '../../src/shared/profile'

const SKILL_MD = path.join(
  __dirname,
  '..',
  '..',
  'vendor',
  'high-quality-projects-skill',
  'skills',
  'project_setup',
  'SKILL.md',
)

describe('suggestPacks', () => {
  it('maps personas and languages to packs, with reasons', () => {
    const suggestions = suggestPacks({ personas: ['web', 'systems'], languages: ['Go', ' c++ '] })
    expect(suggestions).toEqual([
      { pack: 'typescript', reason: 'for the web persona' },
      { pack: 'cpp', reason: 'for the systems persona' },
      { pack: 'rust', reason: 'for the systems persona' },
      { pack: 'go', reason: 'for Go' },
      { pack: 'shell', reason: 'for every stack' },
      { pack: 'crosscutting', reason: 'for every answer' },
    ])
  })

  it('accepts aliases and stack words, and deduplicates', () => {
    const suggestions = suggestPacks({
      personas: ['learning-and-students'],
      languages: ['golang', 'GO', 'flutter', 'klingon'],
    })
    expect(suggestions).toEqual([
      { pack: 'python', reason: 'for the learning and students persona' },
      { pack: 'go', reason: 'for Go' },
      { pack: 'mobile', reason: 'for Flutter (the Android SDK and mobile gates)' },
      { pack: 'shell', reason: 'for every stack' },
      { pack: 'crosscutting', reason: 'for every answer' },
    ])
  })

  it('says the Unity note through the C# pack', () => {
    const suggestions = suggestPacks({ personas: ['game-and-graphics'], languages: ['unity'] })
    expect(suggestions).toContainEqual({
      pack: 'csharp',
      reason: "for C# (Unity's editor has its own licence and is not a pack)",
    })
  })
})

describe('personaPacks', () => {
  it('installs the persona packs with shell and cross-cutting', () => {
    expect(personaPacks('data-and-ml')).toEqual(['python', 'shell', 'crosscutting'])
    expect(personaPacks('security-and-ctf')).toEqual(['shell', 'crosscutting'])
  })
})

describe('STRICTNESS_GATES', () => {
  it('carries the three documented gate sets', () => {
    expect(STRICTNESS_GATES.strict).toEqual([
      'format',
      'lint',
      'types',
      'dead-code',
      'duplication',
      'security',
      'tests',
    ])
    expect(STRICTNESS_GATES.standard).toEqual(['format', 'lint', 'types', 'tests', 'secrets'])
    expect(STRICTNESS_GATES.light).toEqual(['format', 'secrets', 'tests'])
  })
})

describe('parseStackTable', () => {
  it('reads the real Phase 2 rows in order', () => {
    const rows = parseStackTable(readFileSync(SKILL_MD, 'utf8'))
    expect(rows.map((row) => row.stack)).toEqual([
      'Python',
      'TS/JS',
      'Rust',
      'C++',
      'C#',
      'CSS',
      'HTML',
      'PowerShell',
      'Shell',
      'Go',
      'GitHub Actions',
    ])
    expect(rows[1]).toEqual({
      stack: 'TS/JS',
      format: 'prettier',
      lint: 'eslint strictTypeChecked',
      types: 'tsc strict+',
      deadCode: 'knip',
      security: 'npm audit, semgrep',
      test: 'vitest',
    })
  })

  it('yields no rows for the skill’s prose, never a guess', () => {
    const markdown = readFileSync(SKILL_MD, 'utf8')
    const start = markdown.indexOf('### The flags that make a linter a gate')
    const end = markdown.indexOf('### Required red drills')
    if (start === -1 || end === -1 || end <= start) throw new Error('skill sections moved')
    expect(parseStackTable(markdown.slice(start, end))).toEqual([])
  })

  it('asks personas, languages, level and strictness in that order', () => {
    expect(QUESTION_STEPS.map((step) => step.key)).toEqual([
      'personas',
      'languages',
      'level',
      'strictness',
    ])
    expect(QUESTION_STEPS.filter((step) => step.multi).map((step) => step.key)).toEqual([
      'personas',
      'languages',
    ])
  })

  it('files answers as a stamped versioned profile, validated', () => {
    const profile = buildProfile(
      {
        personas: ['web'],
        languages: ['TypeScript'],
        level: 'comfortable',
        strictness: 'standard',
      },
      '2026-10-22T00:00:00.000Z',
    )
    expect(profile).toEqual({
      version: 1,
      personas: ['web'],
      languages: ['TypeScript'],
      level: 'comfortable',
      strictness: 'standard',
      updatedAt: '2026-10-22T00:00:00.000Z',
    })
    expect(() =>
      buildProfile(
        { personas: [], languages: [], level: 'expert', strictness: 'strict' },
        '2026-10-22T00:00:00.000Z',
      ),
    ).toThrow()
  })

  it('previews each suggestion with its tools, licence, size and click-through', () => {
    const suggestions = suggestPacks({ personas: ['mobile'], languages: [] })
    const packs = new Map([
      [
        'mobile',
        {
          version: '1.0.0',
          description: 'Mobile.',
          license: 'Apache-2.0',
          tools: [{ name: 'kotlin', version: '2.0.0' }],
          sizeBytes: 1024,
          clickThrough: true,
        },
      ],
      [
        'shell',
        {
          version: '1.0.0',
          description: 'Shell.',
          license: 'MIT',
          tools: [],
          clickThrough: false,
        },
      ],
      [
        'crosscutting',
        {
          version: '1.0.0',
          description: 'Crosscutting.',
          license: 'MIT',
          tools: [],
          clickThrough: false,
        },
      ],
    ])
    const rows = previewPacks(suggestions, packs)
    expect(rows.map((row) => row.pack)).toEqual(suggestions.map((suggestion) => suggestion.pack))
    const mobile = rows.find((row) => row.pack === 'mobile')
    expect(mobile).toMatchObject({ version: '1.0.0', sizeBytes: 1024, clickThrough: true })
    expect(() => previewPacks(suggestions, new Map())).toThrow(/no definition previews/)
  })
})
