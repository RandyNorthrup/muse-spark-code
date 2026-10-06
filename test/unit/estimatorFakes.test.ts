import { describe, expect, it } from 'vitest'
import dags from '../fixtures/estimator/dags.json'
import repository from '../fixtures/estimator/repository-history.json'
import { estimateLaneSchema } from '../../src/shared/estimate'
import {
  FakeEstimateHistory,
  FakeEstimateNode,
  FakeEstimateProvider,
  FakeEstimateStart,
} from './helpers/estimator/fakes'
import { fakeHistoryRecord } from './helpers/estimator/fixtures'

describe('M117 reusable fakes and evidence', () => {
  it('journals validated metadata without exposing mutable stored rows', async () => {
    const history = new FakeEstimateHistory()
    const record = fakeHistoryRecord()
    await history.append(record)
    record.actualHours = 100
    const first = await history.list()
    expect(first[0]!.actualHours).toBe(3)
    first[0]!.actualHours = 200
    const second = await history.list()
    expect(second[0]!.actualHours).toBe(3)
    expect(() => history.append({ ...record, actualHours: -1 })).toThrow()
  })

  it('exercises the provider lifecycle with prices and the five operations', async () => {
    const provider = new FakeEstimateProvider()
    const [size] = await provider.sizes()
    const [image] = await provider.images()
    expect(size?.hourlyUsd).toBe(0.02)
    const server = await provider.create(size!, image!, '#cloud-config\n')
    expect(await provider.status(server.id)).toEqual(server)
    await provider.delete(server.id)
    const deleted = await provider.status(server.id)
    expect(deleted.state).toBe('deleted')
    expect(provider.requests.map((request) => request.method)).toEqual([
      'GET',
      'GET',
      'POST',
      'GET',
      'DELETE',
      'GET',
    ])
    expect(provider.endpoints.map((endpoint) => endpoint.operation)).toEqual([
      'sizes',
      'images',
      'create',
      'status',
      'delete',
    ])
  })

  it.each(['/billing', '/payment', '/signup', '/accounts'])(
    'refuses %s before recording a provider request',
    (path) => {
      const provider = new FakeEstimateProvider()
      expect(() => {
        provider.request('POST', path)
      }).toThrow('Provider endpoint refused')
      expect(provider.requests).toEqual([])
    },
  )

  it.each([
    '/servers/../billing',
    '/servers/a?payment=true',
    '/servers/a/b',
    '/servers/a%2fb',
    'https://foreign.invalid/servers',
    '/sizes?account=1',
  ])('refuses endpoint escape %s', (path) => {
    expect(() => {
      new FakeEstimateProvider().request('GET', path)
    }).toThrow()
  })

  it('refuses unknown servers and invalid create data with no request', () => {
    const provider = new FakeEstimateProvider()
    expect(() => provider.status('missing')).toThrow('Unknown server')
    expect(() => provider.delete('missing')).toThrow('Unknown server')
    expect(() => provider.create(provider.size, provider.image, '')).toThrow()
    expect(provider.requests).toEqual([])
  })

  it('requires the same-wave prerequisite audit before starting', async () => {
    const board = new FakeEstimateStart()
    expect(() => board.start(['M117:G'])).toThrow('Prerequisite audit required')
    await board.audit(['M117:0'])
    expect(() => board.start(['M117:G'])).toThrow()
    expect(await board.audit(['M117:G'])).toEqual({ allowed: true, missingPrerequisites: [] })
    await board.start(['M117:G'])
    expect(board.starts).toEqual([['M117:G']])
    const blocked = new FakeEstimateStart(['M113:0'])
    const blockedAudit = await blocked.audit(['M117:G'])
    expect(blockedAudit.allowed).toBe(false)
    expect(() => blocked.start(['M117:G'])).toThrow()
    expect(blocked.starts).toEqual([])
  })

  it('records installation, pairing and wipe through the node port', async () => {
    const node = new FakeEstimateNode()
    const provider = new FakeEstimateProvider()
    const server = await provider.create(provider.size, provider.image, '#cloud-config')
    expect(() => node.pair(server)).toThrow('Installation required')
    await node.install(server)
    await node.pair(server)
    await node.teardownAndWipe(server)
    expect(node.calls).toEqual([
      { operation: 'install', serverId: server.id },
      { operation: 'pair', serverId: server.id },
      { operation: 'teardownAndWipe', serverId: server.id },
    ])
  })

  it('supplies hand-checkable DAGs without pretending they are Monte Carlo results', () => {
    expect(dags.map((dag) => dag.name)).toEqual(['chain', 'fan-out', 'diamond', 'affinity-bound'])
    for (const dag of dags) {
      const lanes = dag.lanes.map((lane) => estimateLaneSchema.parse(lane))
      expect(new Set(lanes.map((lane) => lane.id)).size).toBe(lanes.length)
      expect(
        lanes.every((lane) =>
          lane.dependencies.every((id) => lanes.some((other) => other.id === id)),
        ),
      ).toBe(true)
      const pathHours = dag.golden.criticalPath.reduce(
        (sum, id) => sum + lanes.find((lane) => lane.id === id)!.estimatedHours,
        0,
      )
      expect(pathHours).toBe(dag.golden.criticalPathHours)
      const finish = new Date(
        Date.parse('2026-10-06T12:00:00.000Z') + dag.golden.finishHoursWithTwoSlots * 3_600_000,
      ).toISOString()
      expect(dag.golden.p50).toBe(finish)
      expect(dag.golden.p90).toBe(finish)
      for (const entry of dag.golden.schedule) {
        const lane = lanes.find((candidate) => candidate.id === entry.laneId)!
        expect(Date.parse(entry.end) - Date.parse(entry.start)).toBe(
          lane.estimatedHours * 3_600_000,
        )
        for (const dependency of lane.dependencies) {
          const prior = dag.golden.schedule.find((candidate) => candidate.laneId === dependency)!
          expect(Date.parse(entry.start)).toBeGreaterThanOrEqual(Date.parse(prior.end))
        }
      }
    }
    expect(dags.find((dag) => dag.name === 'affinity-bound')!.golden.finishHoursWithTwoSlots).toBe(
      2,
    )
  })

  it('preserves repository evidence and refuses to invent missing estimates or rounds', () => {
    expect(repository.lanes.filter((lane) => lane.laneId.startsWith('M103:'))).toHaveLength(14)
    expect(repository.lanes.filter((lane) => lane.laneId.startsWith('M104:'))).toHaveLength(11)
    expect(
      repository.lanes.every(
        (lane) => !Object.is(lane.estimatedHours, 0) && lane.estimateEvidence === 'notRecorded',
      ),
    ).toBe(true)
    expect(repository.lanes.filter((lane) => lane.duration !== null)).toHaveLength(11)
    for (const lane of repository.lanes) {
      expect(lane.estimatedHours).toBeNull()
      expect(
        lane.dependencies.every((id) => repository.lanes.some((other) => other.laneId === id)),
      ).toBe(true)
      if (!lane.duration) continue
      expect(lane.duration.basis).toBe('gitElapsed')
      expect(lane.duration.firstCommit).toMatch(/^[a-f\d]{40}$/)
      expect(lane.duration.mergeCommit).toMatch(/^[a-f\d]{40}$/)
      expect(lane.duration.actualHours).toBe(
        (Date.parse(lane.duration.finishedAt) - Date.parse(lane.duration.startedAt)) / 3_600_000,
      )
      expect(lane.reviewRounds).toBeNull()
    }
    const serialized = JSON.stringify(repository)
    expect(serialized).not.toMatch(/(?:C:\\\\Users|\/Users\/|\/home\/|@|api_key|access_token)/i)
  })
})
