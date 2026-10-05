// Lane T: the `team` MCP server. The drills: another conversation's token
// is refused, as is none; a revoked token stops working; the tool list is
// byte-identical across conversations and team edits.

import { request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEAM_COLLECT_WAIT_MAX_SECONDS } from '../../src/core/team/teamConstants'
import * as z from 'zod/mini'
import { TeamMcpServer, type TeamSessionBinding } from '../../src/host/team/teamMcpServer'
import type { TeamMcpEndpoint } from '../../src/host/team/teamMcpServer'
import type { TeamCommandStore } from '../../src/core/team/teamTools'
import { FakeLogOutputChannel } from './helpers/fakes'

const servers: TeamMcpServer[] = []
const toolsResponseSchema = z.object({
  result: z.object({
    tools: z.array(
      z.object({
        name: z.string(),
        annotations: z.optional(z.record(z.string(), z.unknown())),
      }),
    ),
  }),
})
const callResponseSchema = z.object({
  result: z.object({
    content: z.array(z.object({ text: z.string() })),
    isError: z.optional(z.boolean()),
  }),
})

function commandStore(): TeamCommandStore {
  let saved: unknown
  return {
    load: () => saved,
    save: (records) => {
      saved = structuredClone(records)
      return Promise.resolve()
    },
  }
}

function binding(runs: string[] = []): { binding: TeamSessionBinding; runs: string[] } {
  return {
    runs,
    binding: {
      commandRecords: commandStore(),
      run: (tool, args) => {
        runs.push(tool)
        return Promise.resolve(JSON.stringify({ tool, args }))
      },
    },
  }
}

async function start(): Promise<{ server: TeamMcpServer; log: FakeLogOutputChannel }> {
  const log = new FakeLogOutputChannel()
  const server = new TeamMcpServer(log)
  servers.push(server)
  await server.start()
  return { server, log }
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close()
  }
})

interface Posted {
  readonly status: number
  json(): Promise<unknown>
}

// node:http, not fetch: this shell's proxy env tunnels loopback fetch to a
// 502, while the server under test speaks plain HTTP on 127.0.0.1.
async function post(
  endpoint: TeamMcpEndpoint,
  body: unknown,
  headers?: Record<string, string>,
): Promise<Posted> {
  const url = new URL(endpoint.url)
  const payload = JSON.stringify(body)
  const response = await new Promise<{ status: number; text: string }>((resolve, reject) => {
    const outgoing = httpRequest(
      {
        host: url.hostname,
        port: Number(url.port),
        path: url.pathname,
        method: 'POST',
        headers: { ...endpoint.headers, ...headers, 'content-type': 'application/json' },
      },
      (incoming) => {
        const chunks: Buffer[] = []
        incoming.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        incoming.on('end', () => {
          resolve({
            status: incoming.statusCode ?? 0,
            text: Buffer.concat(chunks).toString('utf8'),
          })
        })
        incoming.on('error', reject)
      },
    )
    outgoing.on('error', reject)
    outgoing.end(payload)
  })
  return {
    status: response.status,
    json: () => {
      const parsed: unknown = JSON.parse(response.text)
      return Promise.resolve(parsed)
    },
  }
}

async function postedJson(endpoint: TeamMcpEndpoint, body: unknown): Promise<unknown> {
  const response = await post(endpoint, body)
  return await response.json()
}

function listBody(id: number) {
  return { jsonrpc: '2.0', id, method: 'tools/list', params: {} }
}

function callBody(id: number, name: string, args: Record<string, unknown> = {}) {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }
}

describe('TeamMcpServer tokens', () => {
  it('mints a token per conversation and answers its calls', async () => {
    const { server } = await start()
    const first = binding()
    const endpoint = await server.endpointForConversation(first.binding)
    const listed = toolsResponseSchema.parse(await postedJson(endpoint, listBody(1)))
    expect(listed.result.tools.map((tool) => tool.name)).toEqual([
      'roster',
      'delegate',
      'collect',
      'cancel',
      'merge',
    ])
    const called = callResponseSchema.parse(await postedJson(endpoint, callBody(2, 'roster')))
    expect(first.runs).toEqual(['roster'])
    expect(JSON.parse(called.result.content[0]?.text ?? '')).toMatchObject({ tool: 'roster' })
  })

  it('routes each conversation’s token to its own tasks', async () => {
    const { server } = await start()
    const first = binding()
    const second = binding()
    const endpointA = await server.endpointForConversation(first.binding)
    const endpointB = await server.endpointForConversation(second.binding)
    await post(endpointA, callBody(1, 'roster'))
    await post(endpointB, callBody(2, 'cancel', { task_ids: ['task-b'] }))
    expect(first.runs).toEqual(['roster'])
    expect(second.runs).toEqual(['cancel'])
  })

  it('refuses no token, and another window’s token', async () => {
    const { server, log } = await start()
    const other = await start()
    const first = binding()
    const endpointA = await server.endpointForConversation(first.binding)
    // No token.
    const bare = await post({ url: endpointA.url, headers: {} }, listBody(1))
    expect(bare.status).toBe(401)
    // A token minted by another window's server is unknown here.
    const elsewhere = await other.server.endpointForConversation(binding().binding)
    const crossed = await post(
      { url: endpointA.url, headers: elsewhere.headers },
      callBody(2, 'roster'),
    )
    expect(crossed.status).toBe(401)
    expect(first.runs).toEqual([])
    expect(log.warn).toHaveBeenCalledWith(
      'Team tool server refused a request without its conversation token',
    )
  })

  it('refuses a revoked conversation’s token', async () => {
    const { server } = await start()
    const first = binding()
    const endpoint = await server.endpointForConversation(first.binding)
    server.revokeConversation(endpoint)
    const response = await post(endpoint, listBody(1))
    expect(response.status).toBe(401)
    expect(first.runs).toEqual([])
  })

  it('lists byte-identical tools across conversations and team edits', async () => {
    const { server } = await start()
    const endpointA = await server.endpointForConversation(binding().binding)
    const endpointB = await server.endpointForConversation(binding().binding)
    const first = JSON.stringify(await postedJson(endpointA, listBody(1)))
    const second = JSON.stringify(await postedJson(endpointB, listBody(1)))
    expect(first).toBe(second)
  })

  it('answers initialize and reports unknown tools as errors', async () => {
    const { server } = await start()
    const endpoint = await server.endpointForConversation(binding().binding)
    const hello = await postedJson(endpoint, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    })
    expect(hello).toMatchObject({ result: { serverInfo: { name: 'muse_spark_team' } } })
    const unknown = callResponseSchema.parse(await postedJson(endpoint, callBody(2, 'reschedule')))
    expect(unknown.result.isError).toBe(true)
  })

  it('marks roster and collect read-only in the listing', async () => {
    const { server } = await start()
    const endpoint = await server.endpointForConversation(binding().binding)
    const listed = toolsResponseSchema.parse(await postedJson(endpoint, listBody(1)))
    const byName = new Map(listed.result.tools.map((tool) => [tool.name, tool]))
    expect(byName.get('roster')?.annotations).toMatchObject({ readOnlyHint: true })
    expect(byName.get('collect')?.annotations).toMatchObject({ readOnlyHint: true })
    expect(byName.get('merge')?.annotations).toBeUndefined()
  })
})

describe('team MCP admission', () => {
  it('reuses a conversation token and validates arguments before dispatch', async () => {
    const { server } = await start()
    const first = binding()
    const endpoint = await server.endpointForConversation(first.binding)
    expect(await server.endpointForConversation(first.binding)).toEqual(endpoint)
    const answer = await postedJson(endpoint, callBody(1, 'delegate', { tasks: [] }))
    expect(answer).toMatchObject({ result: { isError: true } })
    expect(first.runs).toEqual([])
    const collect = await postedJson(endpoint, callBody(2, 'collect', { wait_seconds: 999 }))
    expect(collect).toMatchObject({
      result: {
        content: [
          {
            text: JSON.stringify({
              tool: 'collect',
              args: { wait_seconds: TEAM_COLLECT_WAIT_MAX_SECONDS },
            }),
          },
        ],
      },
    })
    const omitted = callResponseSchema.parse(await postedJson(endpoint, callBody(3, 'collect')))
    expect(JSON.parse(omitted.result.content[0]?.text ?? '')).toEqual({
      tool: 'collect',
      args: { wait_seconds: 0 },
    })
  })

  it('restores retry answers across rebind and server recreation, without sharing conversations', async () => {
    const first = await start()
    const commands = commandStore()
    let starts = 0
    const run = () => {
      starts += 1
      return Promise.resolve(`task-${String(starts)}`)
    }
    const args = {
      command_id: 'durable',
      tasks: [{ role: 'qa', brief: 'Test.', reason: { code: 'specialty', detail: 'Tests.' } }],
    }
    let endpoint = await first.server.endpointForConversation({ commandRecords: commands, run })
    await postedJson(endpoint, callBody(1, 'delegate', args))
    first.server.revokeConversation(endpoint)
    endpoint = await first.server.endpointForConversation({ commandRecords: commands, run })
    const rebound = callResponseSchema.parse(
      await postedJson(endpoint, callBody(2, 'delegate', args)),
    )
    expect(rebound.result.content[0]?.text).toBe('task-1')
    first.server.close()
    const recreated = await start()
    endpoint = await recreated.server.endpointForConversation({ commandRecords: commands, run })
    const reopened = callResponseSchema.parse(
      await postedJson(endpoint, callBody(3, 'delegate', args)),
    )
    expect(reopened.result.content[0]?.text).toBe('task-1')
    expect(starts).toBe(1)
    const other = await recreated.server.endpointForConversation({
      commandRecords: commandStore(),
      run,
    })
    await postedJson(other, callBody(4, 'delegate', args))
    expect(starts).toBe(2)
  })

  it('refuses uncertain retry claims after revocation while delegation is pending', async () => {
    const { server } = await start()
    const commands = commandStore()
    const entered = Promise.withResolvers<undefined>()
    let starts = 0
    const endpoint = await server.endpointForConversation({
      commandRecords: commands,
      run: (_tool, _args, signal) => {
        starts += 1
        entered.resolve(undefined)
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              reject(new Error('interrupted'))
            },
            { once: true },
          )
        })
      },
    })
    const args = {
      command_id: 'interrupted',
      tasks: [{ role: 'qa', brief: 'Test.', reason: { code: 'specialty', detail: 'Tests.' } }],
    }
    const pending = postedJson(endpoint, callBody(1, 'delegate', args))
    await entered.promise
    server.revokeConversation(endpoint)
    await pending
    const reopened = await server.endpointForConversation({
      commandRecords: commands,
      run: () => {
        starts += 1
        return Promise.resolve('duplicate')
      },
    })
    const retried = callResponseSchema.parse(
      await postedJson(reopened, callBody(2, 'delegate', args)),
    )
    expect(retried.result.isError).toBe(true)
    expect(retried.result.content[0]?.text).toContain('uncertain')
    expect(starts).toBe(1)
  })

  it('does not start a delegation revoked while its claim is saving', async () => {
    const { server } = await start()
    const entered = Promise.withResolvers<undefined>()
    const held = Promise.withResolvers<undefined>()
    const commands = commandStore()
    const run = vi.fn(() => Promise.resolve('unexpected'))
    const endpoint = await server.endpointForConversation({
      commandRecords: {
        load: commands.load,
        save: async (records) => {
          entered.resolve(undefined)
          await held.promise
          await commands.save(records)
        },
      },
      run,
    })
    const pending = postedJson(
      endpoint,
      callBody(1, 'delegate', {
        command_id: 'revoked-during-save',
        tasks: [{ role: 'qa', brief: 'Test.', reason: { code: 'specialty', detail: 'Tests.' } }],
      }),
    )
    await entered.promise
    server.revokeConversation(endpoint)
    held.resolve(undefined)
    const answer = callResponseSchema.parse(await pending)
    expect(answer.result.isError).toBe(true)
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses retry ids when durable conversation storage is unavailable', async () => {
    const { server } = await start()
    const runs: string[] = []
    const endpoint = await server.endpointForConversation({
      run: (tool) => {
        runs.push(tool)
        return Promise.resolve('unexpected')
      },
    })
    const answer = callResponseSchema.parse(
      await postedJson(
        endpoint,
        callBody(1, 'delegate', {
          command_id: 'missing-store',
          tasks: [{ role: 'qa', brief: 'Test.', reason: { code: 'specialty', detail: 'Tests.' } }],
        }),
      ),
    )
    expect(answer.result.isError).toBe(true)
    expect(answer.result.content[0]?.text).toContain('retry storage is unavailable')
    expect(runs).toEqual([])
  })

  it('refuses an endpoint whose already-listening startup was closed before binding', async () => {
    const { server } = await start()
    const pending = server.endpointForConversation(binding().binding)
    server.close()
    await expect(pending).rejects.toThrow('closed during startup')
    const endpoint = await server.endpointForConversation(binding().binding)
    expect(await postedJson(endpoint, listBody(1))).toHaveProperty('result')
  })

  it('settles a shared start on close and permits an immediate restart', async () => {
    const server = new TeamMcpServer(new FakeLogOutputChannel())
    servers.push(server)
    const pending = server.endpointForConversation(binding().binding)
    const shared = server.start()
    const outcomes = Promise.allSettled([pending, shared])
    server.close()
    const restarted = server.start()
    // Bounded assertion: the unfixed promises cannot hang the whole test timeout.
    let settled: PromiseSettledResult<unknown>[] | undefined
    void outcomes.then((results) => {
      settled = results
    })
    await expect.poll(() => settled).toBeDefined()
    expect(settled?.map((result) => result.status)).toEqual(['rejected', 'rejected'])
    expect(await restarted).toMatch(/^http:\/\/127\.0\.0\.1:/)
    expect(await server.start()).toBe(await restarted)
  })

  it('shares concurrent delegate retries within a conversation', async () => {
    const { server } = await start()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<string>()
    let starts = 0
    const endpoint = await server.endpointForConversation({
      commandRecords: commandStore(),
      run: () => {
        starts += 1
        entered.resolve(undefined)
        return starts === 1 ? release.promise : Promise.resolve('unexpected second start')
      },
    })
    const args = {
      command_id: 'same',
      tasks: [{ role: 'qa', brief: 'Test.', reason: { code: 'specialty', detail: 'Tests.' } }],
    }
    const first = postedJson(endpoint, callBody(1, 'delegate', args))
    await entered.promise
    const retry = postedJson(endpoint, callBody(2, 'delegate', args))
    try {
      const changed = callResponseSchema.parse(
        await postedJson(
          endpoint,
          callBody(3, 'delegate', {
            ...args,
            tasks: [{ ...args.tasks[0], brief: 'Other work.' }],
          }),
        ),
      )
      expect(changed.result.isError).toBe(true)
      expect(starts).toBe(1)
    } finally {
      release.resolve('task-1')
    }
    expect(await first).toMatchObject({ result: { content: [{ text: 'task-1' }] } })
    expect(await retry).toMatchObject({ result: { content: [{ text: 'task-1' }] } })
    expect(starts).toBe(1)
  })

  it('cancels only its conversation even when request ids collide, and revocation cancels the rest', async () => {
    const { server } = await start()
    const signals: AbortSignal[] = []
    const entered = Promise.withResolvers<undefined>()
    const waiting = (): TeamSessionBinding => ({
      run: (_tool, _args, signal) => {
        signals.push(signal)
        if (signals.length === 2) entered.resolve(undefined)
        return new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              resolve('stopped')
            },
            { once: true },
          )
        })
      },
    })
    const a = await server.endpointForConversation(waiting())
    const b = await server.endpointForConversation(waiting())
    const first = postedJson(a, callBody(7, 'collect'))
    const second = postedJson(b, callBody(7, 'collect'))
    await entered.promise
    await post(a, { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 7 } })
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
    server.revokeConversation(b)
    expect(signals[1]?.aborted).toBe(true)
    await first
    await second
  })
})
