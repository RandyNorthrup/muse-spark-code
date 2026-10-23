// M110b K: `/peek` names the tap's agents, or prints one agent's recent
// stream as scrubbed JSONL; anything else says so in words.
import { describe, expect, it } from 'vitest'
import { VaultScrubService } from '../../src/core/vault/scrub'
import { createPeekScrubHook } from '../../src/core/peek/scrubHook'
import { PeekTap } from '../../src/core/peek/tap'
import { parsePeekCommand, runPeekText } from '../../src/runtime/peek/acpPeek'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { UI_TEXT } from '../../src/shared/constants'
import { peekEventSchema, type PeekEvent } from '../../src/shared/peek'

const STATUS: AgentEvent = { type: 'sessionStatus', status: 'working' }

async function openTap(): Promise<PeekTap> {
  const service = new VaultScrubService()
  await service.unlock(() => Promise.resolve([]))
  return new PeekTap(createPeekScrubHook(service))
}

describe('peek command', () => {
  it('parses the bare command, one id, and nothing else', () => {
    expect(parsePeekCommand('/peek')).toEqual({})
    expect(parsePeekCommand('/peek agent-1')).toEqual({ agentId: 'agent-1' })
    expect(parsePeekCommand('/peek  agent-1  ')).toEqual({ agentId: 'agent-1' })
    expect(parsePeekCommand('/peek a b')).toBe('invalid')
    expect(parsePeekCommand('/vault')).toBeUndefined()
    expect(parsePeekCommand('peek')).toBeUndefined()
  })
  it('bare /peek names every agent, and says when none run', async () => {
    const tap = await openTap()
    expect(await runPeekText(tap, {})).toBe(UI_TEXT.peekNoAgents)
    tap.register('agent-1', 'agent-1')
    tap.register('agent-2', 'team worker 3')
    expect(await runPeekText(tap, {})).toBe('agent-1\nagent-2 — team worker 3')
  })
  it('/peek <id> prints the recent stream as one versioned event per line', async () => {
    const tap = await openTap()
    tap.register('agent-1', 'agent-1')
    tap.offer('agent-1', STATUS)
    tap.offer('agent-1', { type: 'skillsChanged' })
    const text = await runPeekText(tap, { agentId: 'agent-1' })
    const lines = text.split('\n')
    expect(lines.length).toBe(2)
    const [first, second] = lines.map((line): PeekEvent => peekEventSchema.parse(JSON.parse(line)))
    if (first === undefined || second === undefined) throw new Error('peek printed short')
    expect(first).toMatchObject({ v: 1, streamId: 'agent-1', seq: 0 })
    expect(second).toMatchObject({ v: 1, streamId: 'agent-1', seq: 1 })
    expect(first.body).toEqual(STATUS)
  })
  it('an unknown id is refused naming the id', async () => {
    const tap = await openTap()
    tap.register('agent-1', 'agent-1')
    const text = await runPeekText(tap, { agentId: 'agent-9' })
    expect(text).toContain('agent-9')
    expect(text).toBe(UI_TEXT.peekUnknownAgent.replace('{id}', 'agent-9'))
  })
})
