import { describe, expect, it, vi } from 'vitest'
import { isParallelRead, scheduleTools } from '../../src/core/backends/modelapi/toolScheduler'
import { MODEL_API_PARALLEL_READS } from '../../src/shared/constants'

const call = (id: number, isRead = true, requiresAsking = false) => ({ id, isRead, requiresAsking })
type Call = ReturnType<typeof call>

function scheduler(calls: readonly Call[], isParallel = true) {
  const steps: string[] = []
  const settle = vi.fn((entry: Call, result: PromiseSettledResult<string>) => {
    steps.push(`post:${String(entry.id)}`)
    if (result.status === 'rejected') throw result.reason
    return Promise.resolve(true)
  })
  const options = {
    calls,
    parallel: isParallel,
    isRead: (entry: Call) => entry.isRead,
    prepare: (entry: Call) => {
      steps.push(`pre:${String(entry.id)}`)
      return Promise.resolve(entry)
    },
    canParallel: (entry: Call) => !entry.requiresAsking,
    run: (entry: Call) => {
      steps.push(`run:${String(entry.id)}`)
      return Promise.resolve(`result:${String(entry.id)}`)
    },
    settle,
    skip: (entry: Call) => {
      steps.push(`skip:${String(entry.id)}`)
    },
  }
  return { options, steps, settle }
}

describe('read-only tool scheduler', () => {
  it('trusts only the fixed harness read set, never MCP hints or mutations', () => {
    for (const name of [
      'read_file',
      'list_files',
      'search',
      'recall_output',
      'hover',
      'find_definition',
      'mcp__ide__getDiagnostics',
    ])
      expect(isParallelRead(name)).toBe(true)
    for (const name of [
      'bash',
      'powershell',
      'write_file',
      'edit_file',
      'ask_user',
      'rename_symbol',
      'mcp__other__getDiagnostics',
      'mcp__ide__other',
    ])
      expect(isParallelRead(name)).toBe(false)
  })

  it('overlaps four reads, prepares serially and settles reversed completions in call order', async () => {
    const calls = Array.from({ length: MODEL_API_PARALLEL_READS + 1 }, (_, id) => call(id))
    const rig = scheduler(calls)
    const gates = calls.map(() => Promise.withResolvers<string>())
    let active = 0
    let peak = 0
    const running = scheduleTools({
      ...rig.options,
      run: async (entry) => {
        rig.steps.push(`run:${String(entry.id)}`)
        active += 1
        peak = Math.max(peak, active)
        const gate = gates[entry.id]
        if (gate === undefined) throw new Error('missing gate')
        const result = await gate.promise
        active -= 1
        return result
      },
    })
    await vi.waitFor(() => {
      expect(active).toBe(MODEL_API_PARALLEL_READS)
    })
    expect(rig.steps.slice(0, MODEL_API_PARALLEL_READS)).toEqual(
      calls.slice(0, -1).map((entry) => `pre:${String(entry.id)}`),
    )
    for (const entry of calls.toReversed()) gates[entry.id]?.resolve(`result:${String(entry.id)}`)
    expect(await running).toEqual({ isComplete: true })
    expect(peak).toBe(MODEL_API_PARALLEL_READS)
    expect(rig.settle.mock.calls.map(([entry]) => entry.id)).toEqual(calls.map((entry) => entry.id))
  })

  it('treats writes, shell and asking reads as barriers', async () => {
    const rig = scheduler([call(0), call(1), call(2, false), call(3), call(4, true, true), call(5)])
    await scheduleTools(rig.options)
    expect(rig.steps.indexOf('run:2')).toBeGreaterThan(rig.steps.indexOf('post:1'))
    expect(rig.steps.indexOf('pre:3')).toBeGreaterThan(rig.steps.indexOf('post:2'))
    expect(rig.steps.indexOf('run:4')).toBeGreaterThan(rig.steps.indexOf('post:3'))
    expect(rig.steps.indexOf('pre:5')).toBeGreaterThan(rig.steps.indexOf('post:4'))
  })

  it('keeps off execution serial and skips the tail once a post hook stops', async () => {
    const rig = scheduler([call(0), call(1), call(2)], false)
    rig.settle.mockImplementationOnce(() => Promise.resolve(false))
    expect(await scheduleTools(rig.options)).toEqual({ isComplete: false })
    expect(rig.steps).toEqual(['pre:0', 'run:0', 'skip:1', 'skip:2'])
  })

  it('stops settling a completed read group after a post hook stops and pairs its tail', async () => {
    const rig = scheduler([call(0), call(1), call(2)])
    rig.settle.mockImplementationOnce(() => Promise.resolve(false))
    expect(await scheduleTools(rig.options)).toEqual({ isComplete: false })
    expect(rig.settle).toHaveBeenCalledTimes(1)
    expect(rig.steps.slice(-2)).toEqual(['skip:1', 'skip:2'])
  })

  it('drains rejected reads and skips only unsettled outputs', async () => {
    const rig = scheduler([call(0), call(1), call(2)])
    const ran: number[] = []
    await expect(
      scheduleTools({
        ...rig.options,
        run: (entry) => {
          ran.push(entry.id)
          return entry.id === 0 ? Promise.reject(new Error('Stop')) : Promise.resolve('ok')
        },
      }),
    ).rejects.toThrow('Stop')
    expect(ran).toEqual([0, 1, 2])
    expect(rig.steps.slice(-2)).toEqual(['skip:1', 'skip:2'])
  })

  it('matches serial replay bytes for generated batches with barriers and arbitrary completion delays', async () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const calls = Array.from({ length: 12 }, (_, id) =>
        call(id, (id + seed) % 5 !== 0, (id * seed) % 7 === 1),
      )
      const replay = async (isParallel: boolean) => {
        const rig = scheduler(calls, isParallel)
        const outputs: string[] = []
        await scheduleTools({
          ...rig.options,
          run: async (entry) => {
            for (let tick = 0; tick < (seed + entry.id) % 4; tick += 1) await Promise.resolve()
            return JSON.stringify({
              call_id: entry.id,
              output: `bytes:${String(seed)}:${String(entry.id)}`,
            })
          },
          settle: (_entry, result) => {
            if (result.status === 'rejected') throw result.reason
            outputs.push(result.value)
            return Promise.resolve(true)
          },
        })
        return outputs.join('\n')
      }
      expect(await replay(true)).toBe(await replay(false))
    }
  })
})
