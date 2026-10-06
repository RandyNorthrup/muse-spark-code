import { describe, expect, it } from 'vitest'
import { ScheduleGrants } from '../../src/core/schedules/grant'
import { FakeScheduleApprovalStream } from './helpers/schedules/approvals'
import { fakeRunContext } from './helpers/schedules/fixtures'

const matcher = new ScheduleGrants('bash')
const grant = {
  ...fakeRunContext().grant,
  rules: [
    { id: 'command', kind: 'command', prefix: 'npm test' },
    { id: 'files', kind: 'path', glob: 'src/**/*.ts', access: 'edit' },
    { id: 'mcp', kind: 'tool', name: 'mcp' },
  ],
} satisfies Parameters<ScheduleGrants['matches']>[0]

describe('schedule grant matching', () => {
  it('matches conservative command prefixes and refuses executable suffixes', () => {
    const action = new FakeScheduleApprovalStream('modelApi').request('shell')
    expect(matcher.matches(grant, { ...action, command: 'npm test -- --run' })?.id).toBe('command')
    expect(
      matcher.matches(
        {
          ...grant,
          rules: [{ id: 'bad', kind: 'command', prefix: 'npm test; curl example.test' }],
        },
        action,
      ),
    ).toBeUndefined()
    for (const command of [
      'npm testing',
      'npm test; curl example.test',
      'npm test $(id)',
      'eval npm test',
      './npm test',
      'npm test > file',
    ])
      expect(matcher.matches(grant, { ...action, command })).toBeUndefined()
  })
  it('matches all canonical edit paths in one relative glob with the right access', () => {
    const action = new FakeScheduleApprovalStream('museCode').request('edit')
    expect(matcher.matches(grant, action)?.id).toBe('files')
    expect(matcher.matches(grant, { ...action, paths: ['src/deep/example.ts'] })?.id).toBe('files')
    for (const paths of [
      [],
      ['src/example.ts', 'other.ts'],
      ['/src/example.ts'],
      ['src/../example.ts'],
      [String.raw`src\..\example.ts`],
    ])
      expect(matcher.matches(grant, { ...action, paths })).toBeUndefined()
    expect(
      matcher.matches(
        { ...grant, rules: [{ id: 'read', kind: 'path', glob: '**', access: 'read' }] },
        action,
      ),
    ).toBeUndefined()
  })
  it('matches literal and Unicode segments without regex backtracking for repeated wildcards', () => {
    const action = new FakeScheduleApprovalStream('modelApi').request('edit')
    const own = {
      ...grant,
      rules: [{ id: 'one', kind: 'path', glob: 'src/?.(ts)', access: 'edit' }],
    } satisfies Parameters<ScheduleGrants['matches']>[0]
    expect(matcher.matches(own, { ...action, paths: ['src/🦋.(ts)'] })?.id).toBe('one')
    expect(matcher.matches(own, { ...action, paths: ['src/aa.(ts)'] })).toBeUndefined()
    const rule = own.rules[0]
    if (rule === undefined) throw new Error('Missing test rule')
    rule.glob = `src/${'*a'.repeat(100)}b`
    expect(matcher.matches(own, { ...action, paths: [`src/${'a'.repeat(100)}`] })).toBeUndefined()
  })
  it('never grants physical, protected, asking or paid actions through broad tools or paths', () => {
    const stream = new FakeScheduleApprovalStream('museCode')
    for (const kind of ['physical', 'protectedPath', 'requiresAsking', 'paidExtra'] as const) {
      const action = stream.request(kind)
      expect(
        matcher.matches(
          { ...grant, rules: [{ id: 'broad', kind: 'tool', name: action.tool }] },
          action,
        ),
      ).toBeUndefined()
    }
    const action = stream.request('edit')
    for (const path of ['.git/hooks/pre-commit', 'AGENTS.md', 'nested/.claude/settings.json'])
      expect(
        matcher.matches(
          { ...grant, rules: [{ id: 'broad', kind: 'path', glob: '**', access: 'edit' }] },
          { ...action, paths: [path] },
        ),
      ).toBeUndefined()
  })
  it('matches exact tool names and does not widen a command grant through a tool grant', () => {
    const stream = new FakeScheduleApprovalStream('modelApi')
    expect(matcher.matches(grant, stream.request('mcp'))?.id).toBe('mcp')
    expect(matcher.matches(grant, { ...stream.request('mcp'), tool: 'mcp-other' })).toBeUndefined()
    expect(
      matcher.matches(
        { ...grant, rules: [{ id: 'shell', kind: 'tool', name: 'shell' }] },
        stream.request('shell'),
      ),
    ).toBeUndefined()
  })
  it('uses PowerShell token rules rather than accepting encoded commands', () => {
    const shell = new FakeScheduleApprovalStream('modelApi').request('shell')
    const powershell = new ScheduleGrants('powershell')
    expect(powershell.matches(grant, { ...shell, command: 'NPM test' })?.id).toBe('command')
    expect(
      powershell.matches(
        { ...grant, rules: [{ id: 'ps', kind: 'command', prefix: 'powershell' }] },
        { ...shell, command: 'powershell -EncodedCommand code' },
      ),
    ).toBeUndefined()
  })
})
