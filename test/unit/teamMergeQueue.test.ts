import { describe, expect, it, vi } from 'vitest'
import {
  admitMergeBatch,
  nextMergeBatch,
  orderMergeQueue,
  type MergeCandidate,
} from '../../src/core/team/mergeQueue'
import {
  mergeFile,
  type MergeRoutineDeps,
  type MergeVersion,
} from '../../src/core/team/mergeRoutine'

function candidate(id: string, overrides: Partial<MergeCandidate> = {}): MergeCandidate {
  return {
    id,
    dependsOn: [],
    priority: 'normal',
    conflictsWith: [],
    changedLines: 1,
    files: [{ shared: false, protected: false }],
    finishedAt: 1,
    onConflict: 'rework',
    ...overrides,
  }
}
const batch = ['A', 'B', 'C', 'D'].map((id) => candidate(id))

describe('merge queue', () => {
  it('orders dependencies before finish, inherits priority and applies every tie breaker', () => {
    const tasks = [
      candidate('late', { finishedAt: 100 }),
      candidate('early', { dependsOn: ['late'], priority: 'urgent', finishedAt: 0 }),
      candidate('normal'),
      candidate('many-conflicts', { conflictsWith: ['normal', 'wide'] }),
      candidate('wide', { changedLines: 100 }),
      candidate('protected', { files: [{ shared: true, protected: true }] }),
    ]
    expect(orderMergeQueue(tasks, new Set()).ordered.map((task) => task.id)).toEqual([
      'late',
      'early',
      'normal',
      'wide',
      'many-conflicts',
      'protected',
    ])
    expect(
      orderMergeQueue(
        [candidate('a', { dependsOn: ['missing'] }), candidate('b', { dependsOn: ['a'] })],
        new Set(),
      ).held.map((task) => task.id),
    ).toEqual(['a', 'b'])
  })

  it('keeps consecutive small batches closed under dependency and predicted conflicts', () => {
    expect(nextMergeBatch(batch, new Set())).toHaveLength(4)
    expect(nextMergeBatch([candidate('D', { dependsOn: ['C'] })], new Set())).toEqual([])
    expect(
      nextMergeBatch([candidate('C'), candidate('D', { dependsOn: ['C'] })], new Set()),
    ).toHaveLength(2)
    expect(
      nextMergeBatch([candidate('A'), candidate('B', { conflictsWith: ['A'] })], new Set()),
    ).toHaveLength(1)
    expect(
      nextMergeBatch([candidate('A', { changedLines: 200 }), candidate('B')], new Set()),
    ).toHaveLength(1)
  })

  it('backs out one culprit and lands only the last cumulative combination checked', async () => {
    const checked: string[][] = []
    const rework = vi.fn().mockResolvedValue(undefined)
    const result = await admitMergeBatch<string[]>([], batch, new Set(), {
      merge: (tree, task) => Promise.resolve({ status: 'merged', tree: [...tree, task.id] }),
      check: (tree) => {
        checked.push(tree)
        return Promise.resolve(tree.includes('C') ? [{ id: 'check', output: 'C fails' }] : [])
      },
      rework,
    })
    expect(result).toMatchObject({
      tree: ['A', 'B', 'D'],
      admitted: ['A', 'B', 'D'],
      returned: ['C'],
      checkRuns: 6,
    })
    expect(checked.at(-1)).toEqual(result.tree)
    expect(rework).toHaveBeenCalledWith(batch[2], [{ id: 'check', output: 'C fails' }])
  })

  it('catches interacting candidates that pass alone and holds failed prerequisites', async () => {
    const tasks = batch.map((task) =>
      task.id === 'D' ? candidate('D', { dependsOn: ['C'] }) : task,
    )
    const checked: string[][] = []
    const result = await admitMergeBatch<string[]>([], tasks, new Set(), {
      merge: (tree, task) => Promise.resolve({ status: 'merged', tree: [...tree, task.id] }),
      check: (tree) => {
        checked.push(tree)
        return Promise.resolve(
          tree.includes('A') && tree.includes('C') ? [{ id: 'interaction', output: 'A + C' }] : [],
        )
      },
      rework: vi.fn().mockResolvedValue(undefined),
    })
    expect(result).toMatchObject({ tree: ['A', 'B'], returned: ['C'], held: ['D'], checkRuns: 5 })
    expect(checked.at(-1)).toEqual(['A', 'B', 'C'])
    expect(checked).toContainEqual(result.tree)
  })

  it('reruns only failing checks and marks the exact passing batch flaky', async () => {
    const check = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'flaky', output: 'first' }])
      .mockResolvedValueOnce([])
    const result = await admitMergeBatch<string[]>([], batch, new Set(), {
      merge: (tree, task) => Promise.resolve({ status: 'merged', tree: [...tree, task.id] }),
      check,
      rework: vi.fn(),
    })
    expect(result).toMatchObject({ tree: ['A', 'B', 'C', 'D'], flaky: ['flaky'], checkRuns: 2 })
    expect(check).toHaveBeenNthCalledWith(2, result.tree, ['flaky'])
  })

  it('keeps default rework and structured conflicts out of the admitted tree', async () => {
    const rework = vi.fn().mockResolvedValue(undefined)
    const tasks = [
      candidate('text'),
      candidate('json', { onConflict: 'markers' }),
      candidate('log', { onConflict: 'markers' }),
      candidate('markers', { onConflict: 'markers' }),
    ]
    const result = await admitMergeBatch<string[]>([], tasks, new Set(), {
      merge: (tree, task) =>
        Promise.resolve({
          status: 'conflict',
          kind: task.id === 'json' ? 'json-table' : task.id === 'log' ? 'changelog' : 'text',
          tree: [...tree, task.id],
          output: 'conflict',
        }),
      check: () => Promise.resolve([]),
      rework,
    })
    expect(result).toMatchObject({
      admitted: ['markers'],
      returned: ['text', 'json', 'log'],
      tree: ['markers'],
    })
    expect(rework).toHaveBeenCalledTimes(3)
  })
})

const file = (text: string): MergeVersion => ({ bytes: Buffer.from(text), mode: '100644' })
function deps(): MergeRoutineDeps {
  return {
    text: vi.fn().mockResolvedValue({ bytes: Buffer.from('merged'), conflicts: false }),
    jsonTable: vi.fn().mockResolvedValue({ status: 'refused', reason: 'duplicate key' }),
    changelog: vi.fn().mockResolvedValue({ status: 'conflict', markers: null }),
  }
}
describe('the shared merge routine', () => {
  it('routes structured files even on unchanged sides, without text fallback', async () => {
    const services = deps()
    for (const kind of ['json-table', 'changelog'] as const) {
      const result = await mergeFile(
        { path: 'shared', kind, base: file('base'), ours: file('base'), theirs: file('branch') },
        services,
      )
      expect(result.status).not.toBe('clean')
    }
    expect(services.text).not.toHaveBeenCalled()
  })
  it('handles binary, added, deleted, symlink and executable files explicitly', async () => {
    const services = deps()
    const merge = (
      base: MergeVersion | null,
      ours: MergeVersion | null,
      theirs: MergeVersion | null,
    ) => mergeFile({ path: 'a', kind: 'text', base, ours, theirs }, services)
    expect(await merge(null, null, file('new'))).toEqual({ status: 'clean', file: file('new') })
    expect(await merge(file('old'), file('old'), null)).toEqual({ status: 'clean', file: null })
    expect(await merge(file('old'), file('edited'), null)).toEqual({
      status: 'conflict',
      markers: null,
    })
    expect(await merge(file('\0old'), file('\0ours'), file('\0theirs'))).toEqual({
      status: 'conflict',
      markers: null,
    })
    expect(await merge(file('old'), { ...file('link'), mode: '120000' }, file('edited'))).toEqual({
      status: 'conflict',
      markers: null,
    })
    expect(
      await merge(file('old'), file('ours'), { ...file('old'), mode: '100755' }),
    ).toMatchObject({ status: 'clean', file: { mode: '100755' } })
    expect(await merge(file('base'), file('ours'), file('theirs'))).toMatchObject({
      status: 'clean',
      file: file('merged'),
    })
  })
})
