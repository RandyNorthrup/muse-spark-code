import {
  fleetSnapshotSchema,
  historyRecordSchema,
  providerImageSchema,
  providerSizeSchema,
  provisionedServerSchema,
  type EstimateHistoryPort,
  type EstimateNodePort,
  type EstimateProviderEndpoint,
  type EstimateProviderPort,
  type EstimateStartPort,
  type FleetSnapshot,
  type HistoryRecord,
  type ProviderImage,
  type ProviderSize,
  type ProvisionedServer,
} from '../../../../src/shared/estimate'

export const ESTIMATOR_AS_OF = '2026-10-06T12:00:00.000Z'

/** Fictional aliases and capacities: no host inspection, secrets, or network. */
export function fakeFleet(): FleetSnapshot {
  const disk = {
    status: 'known',
    volumeId: 'primary',
    roles: ['workspace', 'temp', 'state'],
    totalBytes: 107_374_182_400,
    freeBytes: 23_622_320_128,
    floorBytes: 10_737_418_240,
    headroomBytes: 12_884_901_888,
  }
  return fleetSnapshotSchema.parse({
    asOf: ESTIMATOR_AS_OF,
    machines: [
      {
        id: 'linux',
        classId: 'linux-x64-builder',
        source: 'node',
        os: 'linux',
        architecture: 'x64',
        cores: 8,
        ramGiB: 16,
        disks: [disk],
        governorSlots: 2,
        capacityByKind: [{ kind: 'core', slots: 2 }],
        caps: { slots: 2, cpuPercent: 80, memoryPercent: 80 },
      },
      {
        id: 'mac',
        classId: 'macos-arm64-builder',
        source: 'local',
        os: 'macos',
        architecture: 'arm64',
        cores: 8,
        ramGiB: 16,
        disks: [disk],
        governorSlots: 1,
        capacityByKind: [
          { kind: 'core', slots: 1 },
          { kind: 'ui', slots: 1 },
        ],
        caps: { slots: 1, cpuPercent: 80, memoryPercent: 80 },
      },
      {
        id: 'windows',
        classId: 'windows-x64-builder',
        source: 'device',
        os: 'windows',
        architecture: 'x64',
        cores: 8,
        ramGiB: 16,
        disks: [disk],
        governorSlots: 1,
        capacityByKind: [{ kind: 'host', slots: 1 }],
        caps: { slots: 1, cpuPercent: 80, memoryPercent: 80 },
      },
    ],
    roles: [
      { id: 'builder', laneKinds: ['contracts', 'core', 'ui', 'host', 'tests', 'integration'] },
    ],
    accounts: [
      {
        id: 'account-1',
        providerId: 'test-provider',
        requestsPerMinute: 10,
        tokensPerMinute: 10_000,
        usageLimits: [
          {
            id: 'daily',
            kind: 'calendar',
            period: 'day',
            timeZone: 'UTC',
            unit: 'requests',
            remaining: 1000,
            allowance: 1000,
            resetsAt: '2026-10-07T00:00:00.000Z',
          },
          {
            id: 'weekly',
            kind: 'calendar',
            period: 'week',
            timeZone: 'UTC',
            unit: 'requests',
            remaining: 5000,
            allowance: 5000,
            resetsAt: '2026-10-12T00:00:00.000Z',
          },
        ],
      },
    ],
    slots: [
      { id: 'linux-1', machineId: 'linux', roleId: 'builder', accountId: 'account-1' },
      { id: 'linux-2', machineId: 'linux', roleId: 'builder', accountId: 'account-1' },
      { id: 'mac-1', machineId: 'mac', roleId: 'builder', accountId: 'account-1' },
      { id: 'windows-1', machineId: 'windows', roleId: 'builder', accountId: 'account-1' },
    ],
    ci: [
      {
        id: 'ci-1',
        concurrentJobs: 2,
        occupiedJobs: 0,
        minutesRemaining: 120,
        periodEndsAt: '2026-11-01T00:00:00.000Z',
      },
    ],
  })
}

export class FakeEstimateHistory implements EstimateHistoryPort {
  private readonly records: HistoryRecord[]
  constructor(records: readonly HistoryRecord[] = []) {
    this.records = records.map((record) => historyRecordSchema.parse(record))
  }
  list(): Promise<readonly HistoryRecord[]> {
    return Promise.resolve(structuredClone(this.records))
  }
  append(record: HistoryRecord): Promise<void> {
    this.records.push(historyRecordSchema.parse(record))
    return Promise.resolve()
  }
}

/** A hostile endpoint probe lives only in tests. Production has five methods. */
export class FakeEstimateProvider implements EstimateProviderPort {
  private readonly servers = new Map<string, ProvisionedServer>()
  private nextId = 1
  readonly id = 'fake-provider'
  readonly apiOrigin = 'https://estimator-provider.invalid'
  readonly endpoints: readonly EstimateProviderEndpoint[] = [
    { operation: 'sizes', method: 'GET', path: '/sizes' },
    { operation: 'images', method: 'GET', path: '/images' },
    { operation: 'create', method: 'POST', path: '/servers' },
    { operation: 'status', method: 'GET', path: '/servers/{id}' },
    { operation: 'delete', method: 'DELETE', path: '/servers/{id}' },
  ]
  readonly requests: { method: string; path: string }[] = []
  readonly size: ProviderSize = { id: 'small', classId: 'linux-x64-small', hourlyUsd: 0.02 }
  readonly image: ProviderImage = { id: 'container', os: 'linux', architecture: 'x64' }

  request(method: string, path: string): void {
    const isAllowed = this.endpoints.some((endpoint) => {
      if (endpoint.method !== method) return false
      return endpoint.path.includes('{id}')
        ? /^\/servers\/[\w-]+$/.test(path)
        : endpoint.path === path
    })
    if (!isAllowed) throw new Error('Provider endpoint refused')
    this.requests.push({ method, path })
  }
  sizes(): Promise<readonly ProviderSize[]> {
    this.request('GET', '/sizes')
    return Promise.resolve([providerSizeSchema.parse(this.size)])
  }
  images(): Promise<readonly ProviderImage[]> {
    this.request('GET', '/images')
    return Promise.resolve([providerImageSchema.parse(this.image)])
  }
  create(size: ProviderSize, image: ProviderImage, cloudInit: string): Promise<ProvisionedServer> {
    providerSizeSchema.parse(size)
    providerImageSchema.parse(image)
    if (size.id !== this.size.id || image.id !== this.image.id || cloudInit.length === 0) {
      throw new Error('Unknown size/image or empty installation data')
    }
    this.request('POST', '/servers')
    const server = provisionedServerSchema.parse({
      id: `server-${String(this.nextId++)}`,
      sizeId: size.id,
      imageId: image.id,
      state: 'running',
    })
    this.servers.set(server.id, server)
    return Promise.resolve(structuredClone(server))
  }
  status(id: string): Promise<ProvisionedServer> {
    const server = this.servers.get(id)
    if (!server) throw new Error('Unknown server')
    this.request('GET', `/servers/${id}`)
    return Promise.resolve(structuredClone(server))
  }
  delete(id: string): Promise<void> {
    const server = this.servers.get(id)
    if (!server) throw new Error('Unknown server')
    this.request('DELETE', `/servers/${id}`)
    this.servers.set(id, { ...server, state: 'deleted' })
    return Promise.resolve()
  }
}

export class FakeEstimateStart implements EstimateStartPort {
  readonly audits: string[][] = []
  readonly starts: string[][] = []
  constructor(readonly missingPrerequisites: readonly string[] = []) {}
  audit(laneIds: readonly string[]): ReturnType<EstimateStartPort['audit']> {
    this.audits.push([...laneIds])
    return Promise.resolve({
      allowed: this.missingPrerequisites.length === 0,
      missingPrerequisites: this.missingPrerequisites,
    })
  }
  start(laneIds: readonly string[]): Promise<void> {
    if (
      this.missingPrerequisites.length > 0 ||
      this.audits.every((audit) => JSON.stringify(audit) !== JSON.stringify(laneIds))
    ) {
      throw new Error('Prerequisite audit required')
    }
    this.starts.push([...laneIds])
    return Promise.resolve()
  }
}

export class FakeEstimateNode implements EstimateNodePort {
  readonly calls: { operation: string; serverId: string }[] = []
  install(server: ProvisionedServer): Promise<void> {
    this.calls.push({ operation: 'install', serverId: server.id })
    return Promise.resolve()
  }
  pair(server: ProvisionedServer): Promise<void> {
    if (this.calls.every((call) => !(call.operation === 'install' && call.serverId === server.id)))
      throw new Error('Installation required')
    this.calls.push({ operation: 'pair', serverId: server.id })
    return Promise.resolve()
  }
  teardownAndWipe(server: ProvisionedServer): Promise<void> {
    this.calls.push({ operation: 'teardownAndWipe', serverId: server.id })
    return Promise.resolve()
  }
}
