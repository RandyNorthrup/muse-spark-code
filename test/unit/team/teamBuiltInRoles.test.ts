// Lane R (M96, PLAN.md D75): the seven built-in roles.

import { describe, expect, it } from 'vitest'
import {
  TEAM_BUILTIN_ROLE_IDS,
  TEAM_ROLE_DONE_MAX_CHARS,
  TEAM_ROLE_TOOLSETS,
  TEAM_ROLE_WHEN_TO_USE_MAX_CHARS,
} from '../../../src/shared/constants'
import { builtinRoleFile, builtinRoles, toolsOfGroups } from '../../../src/core/team/builtInRoles'
import { parseRoleFile } from '../../../src/core/team/roles'

describe('builtinRoles', () => {
  it('ships the seven roles, in table order', () => {
    expect(builtinRoles().map((role) => role.id)).toEqual([...TEAM_BUILTIN_ROLE_IDS])
  })

  it('keeps the routing and done texts within their bounds', () => {
    for (const role of builtinRoles()) {
      expect(role.whenToUse.length).toBeLessThanOrEqual(TEAM_ROLE_WHEN_TO_USE_MAX_CHARS)
      expect(role.done.length).toBeLessThanOrEqual(TEAM_ROLE_DONE_MAX_CHARS)
      expect(role.description.length).toBeGreaterThan(0)
      expect(role.body.length).toBeGreaterThan(0)
    }
  })

  it('expands every role tools from the one definition', () => {
    for (const role of builtinRoles()) {
      expect(role.tools).toEqual(toolsOfGroups(TEAM_ROLE_TOOLSETS[role.id]))
    }
  })

  it('keeps each tool once across overlapping groups', () => {
    expect(toolsOfGroups(['shell', 'readOnlyShell'])).toEqual(['bash', 'powershell'])
  })

  it('runs research and code-review read-only, and marketing without a shell', () => {
    const byId = new Map(builtinRoles().map((role) => [role.id, role]))
    for (const id of ['research', 'code-review'] as const) {
      expect(byId.get(id)?.workspace).toBe('read-only')
      expect(byId.get(id)?.tools).not.toContain('edit_file')
      expect(byId.get(id)?.tools).not.toContain('write_file')
      expect(byId.get(id)?.tools).not.toContain('run_checks')
    }
    // Read-only roles still run the read-only shell commands.
    expect(byId.get('research')?.tools).toContain('bash')
    expect(byId.get('marketing')?.tools).not.toContain('bash')
    expect(byId.get('marketing')?.tools).not.toContain('powershell')
    expect(byId.get('engineering')?.workspace).toBe('own-branch')
  })

  it('writes AGENT.md files that parse back to the same settings', () => {
    for (const role of builtinRoles()) {
      const parsed = parseRoleFile(builtinRoleFile(role.id))
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) {
        continue
      }
      expect(parsed.role.description).toBe(role.description)
      expect(parsed.role.whenToUse).toBe(role.whenToUse)
      expect(parsed.role.done).toBe(role.done)
      expect(parsed.role.workspace).toBe(role.workspace)
      expect(parsed.role.body).toBe(role.body)
      expect(parsed.role.report).toBe(role.report)
      expect(new Set(parsed.role.tools)).toEqual(new Set(role.tools))
      expect(parsed.role.writePaths).toEqual(role.writePaths)
    }
  })

  it('refuses to write a file for an unknown role', () => {
    expect(() => builtinRoleFile('nope')).toThrow('unknown built-in role nope')
  })
})
