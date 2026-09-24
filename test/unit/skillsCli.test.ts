import { describe, expect, it } from 'vitest'
import {
  activationArgs,
  activationChanges,
  type CatalogSkill,
  isSkillOn,
  parseImportReport,
  parseSkillCatalog,
  scopeFlagValue,
  skillImportArgs,
  skillsListArgs,
} from '../../src/core/backends/musecode/skillsCli'

// Trimmed from Muse Code 1.3.0's own `muse skills list --json` (2026-09-24).
const CATALOG = JSON.stringify({
  skills: [
    {
      id: 'bundled:grill',
      name: 'grill',
      display_name: 'grill',
      description: 'Run an explicitly requested decision interview.',
      short_description: null,
      scope: 'bundled',
      source: { type: 'local' },
      path: 'bundled://muse-core/skills/grill/SKILL.md',
      activation: 'on',
      diagnostics: [],
    },
    {
      id: 'user:caveman',
      name: 'caveman',
      display_name: null,
      description: null,
      scope: 'user',
      activation: 'off',
    },
    {
      id: 'project:deploy',
      name: 'deploy',
      description: 'd',
      scope: 'project',
      activation: 'user-only',
    },
    {
      id: 'plugin:threejs:threejs',
      name: 'threejs',
      description: 't',
      scope: 'plugin',
      activation: 'on',
    },
    { id: 'foreign:x', name: 'x', description: 'x', scope: 'foreign', activation: 'on' },
  ],
})

// Muse Code 1.3.0's `muse skills import --from claude --dry-run --json` (2026-09-24).
const DRY_RUN = JSON.stringify({
  source: { type: 'claude', path: String.raw`C:\Users\u\.claude\skills` },
  dry_run: true,
  candidates: [
    {
      id: 'codex-review',
      source_path: String.raw`C:\Users\u\.claude\skills\codex-review\SKILL.md`,
      target_path: String.raw`C:\Users\u\.config\muse\skills\codex-review\SKILL.md`,
      action: 'copy',
      valid: true,
      classification: 'tool-specific',
      diagnostics: [],
    },
    { id: 'broken', action: 'copy', valid: false },
  ],
  installed: [],
  quarantined: [],
  skipped: [],
  failed: [],
})

function skill(overrides: Partial<CatalogSkill>): CatalogSkill {
  return {
    id: 'bundled:grill',
    name: 'grill',
    displayName: 'grill',
    description: '',
    scope: 'bundled',
    activation: 'on',
    ...overrides,
  }
}

describe('parseSkillCatalog', () => {
  it('reads every skill, filling a null display name and description', () => {
    const skills = parseSkillCatalog(CATALOG)
    expect(skills).toHaveLength(5)
    expect(skills[0]).toEqual({
      id: 'bundled:grill',
      name: 'grill',
      displayName: 'grill',
      description: 'Run an explicitly requested decision interview.',
      scope: 'bundled',
      activation: 'on',
    })
    expect(skills[1]).toMatchObject({ displayName: 'caveman', description: '' })
  })

  it('refuses output that is not JSON or not the documented shape', () => {
    expect(() => parseSkillCatalog('Skills: 26 loaded')).toThrow(/not JSON/)
    expect(() => parseSkillCatalog('{"skills":[{"id":1}]}')).toThrow(/unexpected shape/)
    expect(() => parseSkillCatalog('{}')).toThrow(/unexpected shape/)
  })
})

describe('skill activation', () => {
  it('treats every activation but off as on', () => {
    expect(isSkillOn(skill({ activation: 'on' }))).toBe(true)
    expect(isSkillOn(skill({ activation: 'user-only' }))).toBe(true)
    expect(isSkillOn(skill({ activation: 'off' }))).toBe(false)
  })

  it('spells the listed scopes the way enable and disable take them', () => {
    expect(scopeFlagValue('bundled')).toBe('built-in')
    expect(scopeFlagValue('user')).toBe('user')
    expect(scopeFlagValue('project')).toBe('project')
    expect(scopeFlagValue('plugin')).toBe('plugin')
    expect(scopeFlagValue('foreign')).toBeUndefined()
  })

  it('changes only the rows whose checkbox moved, never an untoggleable scope', () => {
    const skills = parseSkillCatalog(CATALOG)
    // grill unchecked (on → off), caveman checked (off → on), deploy and
    // threejs left as they were, foreign ignored whatever its box says.
    const picked = new Set(['user:caveman', 'project:deploy', 'plugin:threejs:threejs'])
    expect(
      activationChanges(skills, picked).map((change) => [change.skill.name, change.isOn]),
    ).toEqual([
      ['grill', false],
      ['caveman', true],
    ])
    expect(
      activationChanges(skills, new Set(skills.map((entry) => entry.id))).map((c) => c.skill.name),
    ).toEqual(['caveman'])
  })

  it('builds enable and disable with the scope and, when trusted, the workspace', () => {
    const disable = { skill: skill({}), isOn: false }
    expect(activationArgs(disable, '/ws', true)).toEqual([
      'skills',
      'disable',
      'grill',
      '--scope',
      'built-in',
      '--workspace',
      '/ws',
      '--trust-workspace',
      '--json',
    ])
    const enable = { skill: skill({ name: 'caveman', scope: 'user' }), isOn: true }
    expect(activationArgs(enable, '/ws', false)).toEqual([
      'skills',
      'enable',
      'caveman',
      '--scope',
      'user',
      '--workspace',
      '/ws',
      '--json',
    ])
    expect(activationArgs(enable, undefined, true)).toEqual([
      'skills',
      'enable',
      'caveman',
      '--scope',
      'user',
      '--json',
    ])
    expect(() =>
      activationArgs({ skill: skill({ scope: 'foreign' }), isOn: true }, '/ws', true),
    ).toThrow(/cannot turn foreign skills on or off/)
  })

  it('lists with the workspace, trusting it only when VS Code does', () => {
    expect(skillsListArgs('/ws', true)).toEqual([
      'skills',
      'list',
      '--workspace',
      '/ws',
      '--trust-workspace',
      '--json',
    ])
    expect(skillsListArgs('/ws', false)).toEqual(['skills', 'list', '--workspace', '/ws', '--json'])
    expect(skillsListArgs(undefined, true)).toEqual(['skills', 'list', '--json'])
  })
})

describe('skill import', () => {
  it('builds the dry run and the import into the user scope', () => {
    expect(skillImportArgs('claude', true)).toEqual([
      'skills',
      'import',
      '--from',
      'claude',
      '--scope',
      'user',
      '--dry-run',
      '--json',
    ])
    expect(skillImportArgs('codex', false)).toEqual([
      'skills',
      'import',
      '--from',
      'codex',
      '--scope',
      'user',
      '--json',
    ])
  })

  it('reads the report, candidates and outcomes alike', () => {
    expect(parseImportReport(DRY_RUN)).toEqual({
      sourcePath: String.raw`C:\Users\u\.claude\skills`,
      isDryRun: true,
      candidates: [
        { id: 'codex-review', action: 'copy', isValid: true, reason: undefined },
        { id: 'broken', action: 'copy', isValid: false, reason: undefined },
      ],
      installed: [],
      quarantined: [],
      skipped: [],
      failed: [],
    })
    const done = parseImportReport(
      JSON.stringify({
        source: { type: 'codex', path: null },
        dry_run: false,
        candidates: [],
        installed: [{ id: 'a' }],
        quarantined: [],
        skipped: [{ id: 'b', reason: 'exists' }],
        failed: [{ id: 'c', error: 'unreadable' }],
      }),
    )
    expect(done.sourcePath).toBeUndefined()
    expect(done.installed).toEqual([
      { id: 'a', action: undefined, isValid: true, reason: undefined },
    ])
    expect(done.skipped[0]?.reason).toBe('exists')
    expect(done.failed[0]?.reason).toBe('unreadable')
  })

  it('refuses a report it cannot read', () => {
    expect(() => parseImportReport('oops')).toThrow(/not JSON/)
    expect(() => parseImportReport('{"dry_run":true}')).toThrow(/unexpected shape/)
  })
})
