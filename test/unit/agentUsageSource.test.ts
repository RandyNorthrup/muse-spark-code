const clean = (text: string) => text.replaceAll('private-model-canary', '[redacted]')
import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRuntimeReportSources } from '../../src/runtime/reporting/sources'
import {
  agentUsageSource,
  isAgentUsagePath,
  type AgentUsageFile,
} from '../../src/core/reporting/sources/agentUsage'
import { reportOptions, REPORT_FIXTURE_AS_OF } from './helpers/reporting/snapshot'
import type { LocalFileIo } from '../../src/core/reporting/sources/local'

// Numeric projection of the 2026-10-06 win11 capture. Ids/models are fixture values.
const claude = () => ({
  type: 'assistant',
  timestamp: '2026-10-06T11:59:59Z',
  message: {
    id: 'fixture-message',
    model: 'fixture-model',
    usage: {
      input_tokens: 2,
      cache_creation_input_tokens: 14_453,
      cache_read_input_tokens: 14_335,
      output_tokens: 210,
    },
    ignored: 'private-conversation-canary',
  },
})
const codex = () => ({
  type: 'event_msg',
  timestamp: '2026-10-06T11:59:59Z',
  payload: {
    type: 'token_count',
    info: {
      total_token_usage: { input_tokens: 19_462, cached_input_tokens: 12_544, output_tokens: 153 },
    },
    rate_limits: {
      primary: { used_percent: 100, window_minutes: 10_080, resets_at: 1_791_580_375 },
      secondary: null,
      ignored: 'private-account-canary',
    },
  },
})
const context = () => ({
  asOf: REPORT_FIXTURE_AS_OF,
  workspaceKey: 'fixture',
  options: reportOptions('usage'),
  signal: new AbortController().signal,
})
function file(agent: AgentUsageFile['agent'], text: string): AgentUsageFile {
  const io: LocalFileIo = {
    read: vi.fn(() => Promise.resolve(text)),
    list: vi.fn(() => Promise.resolve([])),
  }
  return {
    agent,
    file:
      agent === 'codex'
        ? 'sessions/2026/10/06/rollout-fixture.jsonl'
        : 'projects/fixture/session.jsonl',
    io,
  }
}
describe('captured, opt-in external agent usage', () => {
  it('is opt-in and never reads or lists a disabled source', async () => {
    const source = file('claudeCode', JSON.stringify(claude()))
    const result = await agentUsageSource([], [source], (text) => text).read(context())
    expect(result).toMatchObject({
      record: { status: 'notApplicable', reason: expect.any(String) },
      data: null,
    })
    expect(source.io.read).not.toHaveBeenCalled()
    expect(source.io.list).not.toHaveBeenCalled()
    const discover = vi.fn(() => Promise.resolve([source]))
    await agentUsageSource([], discover, clean).read(context())
    expect(discover).not.toHaveBeenCalled()
  })
  it('projects Claude counters, deduplicates messages and never retains conversation fields', async () => {
    const row = claude()
    const result = await agentUsageSource(
      ['claudeCode'],
      [file('claudeCode', `${JSON.stringify(row)}\n${JSON.stringify(row)}\n`)],
      (text) => text,
    ).read(context())
    expect(result.record.status).toBe('ok')
    expect(result.data?.[0]?.usage).toMatchObject({
      inputTokens: 28_790,
      outputTokens: 210,
      cachedTokens: 14_335,
      costUsd: null,
      certainty: 'unknown',
      limits: [],
    })
    expect(result.data?.[0]?.file).toBe('~/.claude/projects/fixture/session.jsonl')
    expect(JSON.stringify(result)).not.toContain('private-conversation-canary')
    expect(result.data?.[0]?.usage.breakdown[0]?.key).toBe('fixture-model')
  })
  it('takes the latest Codex cumulative totals and captured limit windows, never sums events', async () => {
    const older = codex()
    older.timestamp = '2026-10-06T11:00:00Z'
    older.payload.info.total_token_usage.input_tokens = 10
    const newer = codex()
    const result = await agentUsageSource(
      ['codex'],
      [file('codex', `${JSON.stringify(newer)}\n${JSON.stringify(older)}`)],
      (text) => text,
    ).read(context())
    expect(result.data?.[0]?.usage).toMatchObject({
      inputTokens: 19_462,
      outputTokens: 153,
      cachedTokens: 12_544,
      costUsd: null,
      limits: [{ key: 'primary', used: 100, limit: 100, resetsAt: '2026-10-09T21:12:55.000Z' }],
    })
    expect(JSON.stringify(result)).not.toContain('private-account-canary')
    expect(
      await agentUsageSource(
        ['codex'],
        [file('codex', `${JSON.stringify(older)}\n${JSON.stringify(newer)}`)],
        (text) => text,
      ).read(context()),
    ).toEqual(result)
  })
  it('chooses the latest Claude usage revision by instant across offsets and source order', async () => {
    const older = claude()
    older.timestamp = '2026-10-06T13:59:58+02:00'
    older.message.usage.output_tokens = 1
    const newer = claude()
    const first = await agentUsageSource(
      ['claudeCode'],
      [file('claudeCode', `${JSON.stringify(newer)}\n${JSON.stringify(older)}`)],
      clean,
    ).read(context())
    expect(first.data?.[0]?.usage.outputTokens).toBe(210)
    const second = await agentUsageSource(
      ['claudeCode'],
      [file('claudeCode', `${JSON.stringify(older)}\n${JSON.stringify(newer)}`)],
      clean,
    ).read(context())
    expect(second).toEqual(first)
  })
  it('refuses credential and traversal paths before invoking any file reader', async () => {
    const source = file('codex', JSON.stringify(codex()))
    for (const name of [
      'auth.json',
      '.credentials.json',
      '.env',
      'sessions/2026/10/06/auth.json',
      'sessions/2026/10/06/rollout-fixture.jsonl/../auth.json',
      String.raw`sessions\2026\10\06\..\auth.json`,
      'sessions/2026/10/06/rollout-fixture.pem',
    ]) {
      const result = await agentUsageSource(
        ['codex'],
        [{ ...source, file: name }],
        (text) => text,
      ).read(context())
      expect(result).toMatchObject({ record: { status: 'unavailable' }, data: null })
    }
    expect(source.io.read).not.toHaveBeenCalled()
    expect(isAgentUsagePath('codex', String.raw`sessions\2026\10\06\rollout-fixture.jsonl`)).toBe(
      true,
    )
  })
  it('rejects malformed usage and names missing sources instead of inventing zero usage', async () => {
    const malformed = claude()
    malformed.message.usage.input_tokens = -1
    const observed1 = await agentUsageSource(
      ['claudeCode'],
      [file('claudeCode', JSON.stringify(malformed))],
      (text) => text,
    ).read(context())
    expect(observed1.data).toBeNull()
    const limitsOnly = { ...codex(), payload: { ...codex().payload, info: null } }
    const observed2 = await agentUsageSource(
      ['codex'],
      [file('codex', JSON.stringify(limitsOnly))],
      (text) => text,
    ).read(context())
    expect(observed2.data).toBeNull()
    const observed3 = await agentUsageSource(['codex'], [], (text) => text).read(context())
    expect(observed3.record.status).toBe('unavailable')
  })
  it('excludes future observations and makes a partially missing selection explicit', async () => {
    const future = codex()
    future.timestamp = '2026-10-07T12:00:00Z'
    future.payload.info.total_token_usage.input_tokens = 99_999
    const source = file('codex', `${JSON.stringify(codex())}\n${JSON.stringify(future)}`)
    const result = await agentUsageSource(['codex', 'claudeCode'], [source], (text) => text).read(
      context(),
    )
    expect(result.record.status).toBe('partial')
    expect(result.data?.[0]?.usage.inputTokens).toBe(19_462)
  })
  it('scrubs source names and model keys before the snapshot and preserves stable file order', async () => {
    const row = claude()
    row.message.model = 'private-model-canary'

    const first = file('claudeCode', JSON.stringify(row))
    const second = file('codex', JSON.stringify(codex()))
    const result = await agentUsageSource(['claudeCode', 'codex'], [second, first], clean).read(
      context(),
    )
    expect(JSON.stringify(result)).not.toContain('private-model-canary')
    expect(
      await agentUsageSource(['claudeCode', 'codex'], [first, second], clean).read(context()),
    ).toEqual(result)
  })
  it('discovers only captured usage session files for enabled sources in the standalone runtime', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'm113-agents-'))
    try {
      await mkdir(path.join(root, '.claude/projects/fixture'), { recursive: true })
      await mkdir(path.join(root, '.codex/sessions/2026/10/06'), { recursive: true })
      await writeFile(
        path.join(root, '.claude/projects/fixture/session.jsonl'),
        JSON.stringify(claude()),
      )
      await writeFile(
        path.join(root, '.codex/sessions/2026/10/06/rollout-fixture.jsonl'),
        JSON.stringify(codex()),
      )
      await writeFile(path.join(root, '.codex/auth.json'), 'Synthetic fixture marker')
      const input = {
        workspaceRoot: root,
        homeDir: root,
        platform: process.platform,
        env: {},
        scrub: clean,
        enabledAgents: ['claudeCode', 'codex'] satisfies AgentUsageFile['agent'][],
      }
      const result = await createRuntimeReportSources(input).sources.agentUsage.read(context())
      expect(result.record.status).toBe('ok')
      expect(result.data?.map((row) => row.agent)).toEqual(['claudeCode', 'codex'])
      expect(JSON.stringify(result)).not.toContain('Synthetic fixture marker')
      const disabled = await createRuntimeReportSources({
        ...input,
        homeDir: path.join(root, 'missing'),
        enabledAgents: [],
      }).sources.agentUsage.read(context())
      expect(disabled.record.status).toBe('notApplicable')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('discovers accepted Claude subagent sessions below each project', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'm113-subagents-'))
    try {
      await mkdir(path.join(root, '.claude/projects/fixture/subagents'), { recursive: true })
      await writeFile(
        path.join(root, '.claude/projects/fixture/session.jsonl'),
        JSON.stringify(claude()),
      )
      const child = claude()
      child.message.id = 'fixture-child-message'
      child.message.usage = {
        input_tokens: 100,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
      }
      await writeFile(
        path.join(root, '.claude/projects/fixture/subagents/child.jsonl'),
        JSON.stringify(child),
      )
      await writeFile(
        path.join(root, '.claude/projects/fixture/subagents/notes.md'),
        'Synthetic fixture marker',
      )
      const result = await createRuntimeReportSources({
        workspaceRoot: root,
        homeDir: root,
        platform: process.platform,
        env: {},
        scrub: clean,
        enabledAgents: ['claudeCode'],
      }).sources.agentUsage.read(context())
      expect(result.record.status).toBe('ok')
      expect(result.data?.map((row) => row.file)).toEqual([
        '~/.claude/projects/fixture/session.jsonl',
        '~/.claude/projects/fixture/subagents/child.jsonl',
      ])
      expect(
        result.data?.find((row) => row.file.endsWith('subagents/child.jsonl'))?.usage.inputTokens,
      ).toBe(100)
      expect(JSON.stringify(result)).not.toContain('Synthetic fixture marker')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('does not double-count duplicate file selections', async () => {
    const source = file('codex', JSON.stringify(codex()))
    const result = await agentUsageSource(['codex'], [source, source], clean).read(context())
    expect(result.record.status).toBe('unavailable')
    expect(result.data).toBeNull()
  })
})
