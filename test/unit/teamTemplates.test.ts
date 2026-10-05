// Team templates (M96 lane F): each template's roles, modes, tool sets
// and suggested pools from the agents the user has.

import { describe, expect, it } from 'vitest'
import {
  buildTemplateDraft,
  defaultModeFor,
  defaultToolGroupsFor,
  prefilledTaskCap,
  setupStepLabel,
  TEAM_TEMPLATES,
  templateName,
  templateRoles,
  TEAM_ROLE_TYPICAL_TASK_TOKENS,
  type TeamAgentOffer,
} from '../../src/core/team/templates'

const META: TeamAgentOffer = { modelRef: 'muse-spark-1.3', vendor: 'meta', payKind: 'key' }
const CODEX: TeamAgentOffer = { modelRef: 'codex-cli', vendor: 'openai', payKind: 'subscription' }
const LOCAL: TeamAgentOffer = { modelRef: 'ollama-qwen', vendor: 'ollama', payKind: 'local' }

describe('templateRoles', () => {
  it('names the four templates', () => {
    expect([...TEAM_TEMPLATES]).toEqual(['solo', 'pair', 'full', 'custom'])
  })

  it('staffs no role for Solo and Custom', () => {
    expect(templateRoles('solo')).toEqual([])
    expect(templateRoles('custom')).toEqual([])
  })

  it('pairs engineering with code-review', () => {
    expect(templateRoles('pair')).toEqual(['engineering', 'code-review'])
  })

  it('staffs six roles for Full team, marketing offered', () => {
    expect(templateRoles('full')).toEqual([
      'research',
      'design',
      'engineering',
      'qa',
      'code-review',
      'docs',
    ])
  })
})

describe('buildTemplateDraft', () => {
  it('builds an empty draft for Solo', () => {
    expect(buildTemplateDraft('solo', [META])).toEqual({ template: 'solo', roles: [] })
  })

  it('puts Pair review on another vendor (the owner split)', () => {
    const draft = buildTemplateDraft('pair', [META, CODEX])
    expect(draft.roles.map((role) => role.role)).toEqual(['engineering', 'code-review'])
    expect(draft.roles[0]?.pool[0]?.modelRef).toBe('muse-spark-1.3')
    expect(draft.roles[1]?.pool[0]?.modelRef).toBe('codex-cli')
  })

  it('keeps Pair review on the same vendor when nothing else is offered', () => {
    const draft = buildTemplateDraft('pair', [META])
    expect(draft.roles[1]?.pool).toEqual([])
  })

  it('prefills each Full team role with its mode, tools and task cap', () => {
    const draft = buildTemplateDraft('full', [META, CODEX, LOCAL])
    expect(draft.roles).toHaveLength(6)
    for (const key of templateRoles('full')) {
      const role = draft.roles.find((entry) => entry.role === key)
      expect(role?.mode).toBe(defaultModeFor(key))
      expect(role?.toolGroups).toEqual(defaultToolGroupsFor(key))
      const [taskCap] = role?.pool[0]?.caps ?? []
      expect(taskCap?.measure).toBe('tokens')
      expect(taskCap?.window).toBe('task')
    }
    const engineering = draft.roles.find((role) => role.role === 'engineering')
    expect(engineering?.pool[0]?.caps[0]?.amount).toBe(TEAM_ROLE_TYPICAL_TASK_TOKENS.engineering)
  })

  it('starts reviewers and researchers read-only', () => {
    expect(defaultModeFor('research')).toBe('read-only')
    expect(defaultModeFor('code-review')).toBe('read-only')
    expect(defaultModeFor('engineering')).toBe('own-branch')
    expect(defaultModeFor('marketing')).toBe('own-branch')
  })

  it('leaves every pool empty when no agent is offered', () => {
    const draft = buildTemplateDraft('full', [])
    expect(draft.roles).toHaveLength(6)
    for (const role of draft.roles) {
      expect(role.pool).toEqual([])
    }
    expect(defaultToolGroupsFor('marketing')).toEqual(['read', 'write', 'web'])
  })

  it('prefills the task cap from the role typical use', () => {
    expect(prefilledTaskCap('qa')).toEqual({ measure: 'tokens', window: 'task', amount: 200_000 })
  })
})

describe('labels', () => {
  it('names each template and numbers the setup steps', () => {
    expect(templateName('solo')).toBe('Solo')
    expect(templateName('pair')).toContain('Pair')
    expect(templateName('full')).toBe('Full team')
    expect(templateName('custom')).toBe('Custom')
    expect(setupStepLabel(3)).toContain('3')
  })
})
