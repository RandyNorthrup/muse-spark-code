import { beforeAll, describe, expect, it } from 'vitest'
import {
  initialBrokerState,
  step,
  type Command,
  type Effect,
  type Event,
  type Result,
  type ConnectionToken,
} from '../../../src/core/vault/broker/state'
import { runVaultRelease } from '../../../src/core/vault/broker/broker'
import { type VaultAuditWriter } from '../../../src/core/vault/broker/ports'
import { type VaultSlotRecord, type VaultTicket } from '../../../src/shared/vault'
import { VAULT_APPROVAL_TTL_MS } from '../../../src/shared/constants'
import { FakeVaultSlot, InMemoryVault } from '../helpers/vault/core'
import { item, requester, use, grant } from '../helpers/vault/fixtures'
import { vaultCommandDigest } from '../../../src/core/vault/broker/policy'

const capture: { slot?: VaultSlotRecord } = {}
beforeAll(async () => {
  capture.slot = await new FakeVaultSlot('osStore').wrap(Buffer.alloc(32, 1))
})
type Deferred = Extract<Effect, { kind: 'io' | 'audit' | 'release' }>
interface Task {
  effect: Deferred
  result: Result
}
const seed = 109_003
/** Executes the production reducer and final release runner; I/O is snapshotted at dispatch. */
class Model {
  state = initialBrokerState()
  now = 1_000_000
  sequence = 0
  epoch = 0
  tasks: Task[] = []
  replies = new Map<string, unknown>()
  rows = new Map<string, string[]>()
  writes = 0
  checks = 0
  stored = item()
  standing = grant()
  identity = requester()
  peer = {
    hostId: this.identity.hostId,
    userId: 'fake-user',
    processId: this.identity.peerProcessId,
    ui: true,
  }
  store = new InMemoryVault()
  writer: VaultAuditWriter = this.newWriter()
  constructor() {
    this.stored.metadata.bindings = [
      { kind: 'environment', commandDigest: vaultCommandDigest(use().command), names: use().names },
    ]
    this.stored.metadata.policy.mode = 'alwaysAllow'
    this.standing.target = this.stored.metadata.bindings[0]!
  }
  newWriter(): VaultAuditWriter {
    let isClosed = false
    return {
      append: () =>
        isClosed ? Promise.reject(new Error('closed model writer')) : Promise.resolve(),
      read: () => Promise.resolve([]),
      close: () => {
        isClosed = true
      },
    }
  }
  event(
    input:
      | Omit<Extract<Event, { kind: 'command' }>, 'id' | 'nonce' | 'now'>
      | Omit<Extract<Event, { kind: 'completed' }>, 'id' | 'nonce' | 'now'>
      | Omit<Extract<Event, { kind: 'audited' }>, 'id' | 'nonce' | 'now'>,
  ): string {
    const id = (++this.sequence).toString(16).padStart(32, '0')
    const transition = step(this.state, {
      ...input,
      id,
      nonce: (this.sequence + 1_000_000).toString(16).padStart(32, '0'),
      now: this.now,
    })
    this.state = transition.state
    for (const effect of transition.effects) this.apply(effect)
    this.invariants()
    return id
  }
  apply(effect: Effect): void {
    switch (effect.kind) {
      case 'cleanup': {
        const currentKey = this.state.key
        for (const bytes of [
          effect.resources.key,
          effect.resources.source,
          effect.resources.buffer,
        ]) {
          if (bytes !== undefined && bytes === currentKey)
            throw new Error('cleanup targeted the installed generation')
          bytes?.fill(0)
        }
        const material = effect.resources.item?.material
        if (material)
          for (const value of Object.values(material))
            if (value instanceof Uint8Array) value.fill(0)
        if (effect.resources.store && effect.resources.store === this.state.store)
          throw new Error('cleanup targeted the installed store')
        if (effect.resources.writer && effect.resources.writer === this.state.writer)
          throw new Error('cleanup targeted the installed audit writer')
        effect.resources.store?.lock()
        effect.resources.writer?.close()

        break
      }
      case 'closeLifetime': {
        effect.lifetime.close()
        break
      }
      case 'settle': {
        this.replies.set(effect.id, effect.error ?? effect.value)
        break
      }
      case 'io': {
        this.tasks.push({ effect, result: this.snapshot(effect) })
        break
      }
      case 'release':
      case 'audit': {
        this.tasks.push({ effect, result: {} })
        break
      }
      case 'authenticated': {
        effect.receive(effect.identity, effect.token)
        break
      }
      case 'registered': {
        {
          effect.receive(effect.token)
          // No default
        }
        break
      }
    }
  }
  command(command: Command): string {
    const generation = this.state.generation
    const id = this.event({ kind: 'command', command })
    if (command.kind === 'lock') {
      expect(this.state.generation).toBeGreaterThan(generation)
      expect(this.state.key).toBeUndefined()
      expect(this.state.store).toBeUndefined()
      expect(this.state.buffers.size).toBe(0)
    }
    return id
  }
  snapshot(effect: Extract<Effect, { kind: 'io' }>): Result {
    const op = this.state.operations.get(effect.tags.operationId)
    if (!op) throw new Error('model effect has no owner')
    switch (effect.tags.phase) {
      case 'host':
      case 'launched':
      case 'presence': {
        return { value: true }
      }
      case 'authenticate': {
        return {
          identity: { peer: this.peer, requester: this.identity, firstParty: false, manage: false },
        }
      }
      case 'epoch':
      case 'unlockEpoch':
      case 'installEpoch': {
        return { value: this.epoch }
      }
      case 'bump': {
        this.epoch += 1
        return { value: this.epoch }
      }
      case 'unwrap': {
        return { source: Buffer.alloc(32, 1), slot: capture.slot! }
      }
      case 'open': {
        this.store = new InMemoryVault()
        return { store: this.store }
      }
      case 'writer': {
        this.writer = this.newWriter()
        return { writer: this.writer }
      }
      case 'list': {
        return { value: [structuredClone(this.stored.metadata)] }
      }
      case 'read': {
        return { item: structuredClone(this.stored) }
      }
      case 'grants': {
        return { value: [structuredClone(this.standing)] }
      }
      case 'consume': {
        this.standing.uses += 1
        return { value: true }
      }
      case 'terminate': {
        return { value: true }
      }
      case 'saved':
      case 'removed': {
        return {}
      }
      default: {
        throw new Error(`unmodelled phase ${op.phase}`)
      }
    }
  }
  complete(index = 0): void {
    const task = this.tasks.splice(index, 1)[0]
    if (!task) throw new Error('invalid scheduler choice')
    const effect = task.effect
    if (effect.kind === 'audit') {
      const row = this.state.audits.get(effect.operationId)
      if (row?.version === effect.version && row.writer === effect.writer) {
        const history = this.rows.get(effect.operationId) ?? []
        history.push(effect.row.outcome)
        this.rows.set(effect.operationId, history)
      }
      this.event({
        kind: 'audited',
        operationId: effect.operationId,
        version: effect.version,
        writer: effect.writer,
      })
    } else if (effect.kind === 'release') {
      let error: unknown
      try {
        const result = runVaultRelease(this.state, effect, this.now)
        if (result instanceof Promise) throw new Error('model release must be synchronous')
      } catch (error_: unknown) {
        error = error_
      }
      this.event({
        kind: 'completed',
        tags: effect.tags,
        result: {},
        ...(error !== undefined && { error }),
      })
    } else this.event({ kind: 'completed', tags: effect.tags, result: task.result })
  }
  drain(): void {
    while (this.tasks.length > 0) this.complete()
  }
  hold(phase: string): void {
    while (
      this.tasks.every((task) => task.effect.kind === 'audit' || task.effect.tags.phase !== phase)
    ) {
      if (this.tasks.length === 0)
        throw new Error(
          `missing phase ${phase}: ${Array.from(this.replies, ([, value]) => value)
            .map((reply) => (reply instanceof Error ? reply.message : JSON.stringify(reply)))
            .join(',')}`,
        )
      this.complete()
    }
  }
  setup(): void {
    this.command({
      kind: 'register',
      peer: this.peer,
      registration: { requester: this.identity, ceiling: 'ask' },
    })
    this.drain()
    this.command({ kind: 'unlock', slotId: null })
    this.drain()
  }
  proposal(): string {
    return this.command({
      kind: 'request',
      requester: this.identity,
      handle: this.stored.metadata.handle,
      use: use(),
      taint: { tainted: false, reasons: [] },
    })
  }
  redeemTicket(): VaultTicket {
    this.proposal()
    this.drain()
    const ticket = Array.from(this.state.tickets, ([, admission]) => admission)[0]?.ticket
    if (!ticket) throw new Error('model expected ticket')
    this.command({
      kind: 'redeem',
      requesterId: this.identity.id,
      ticket,
      use: use(),
      lifetime: { close: () => undefined, terminate: () => Promise.resolve(true) },
    })
    return ticket
  }
  answerApproval(): void {
    this.stored.metadata.policy.mode = 'askOncePerSession'
    this.proposal()
    this.drain()
    const request = Array.from(this.state.pending, ([, admission]) => admission)[0]?.request
    if (!request) throw new Error('model expected approval')
    this.command({
      kind: 'answer',
      peer: this.peer,
      answer: { requestId: request.id, digest: request.digest, decision: 'allowSession' },
    })
    this.hold('list')
  }
  privateRead(): void {
    const metadata = this.stored.metadata
    metadata.firstParty = true
    metadata.hidden = true
    metadata.kind = 'apiKey'
    metadata.policy.mode = 'never'
    metadata.bindings = [{ kind: 'origin', origin: 'https://example.test' }]
    this.stored = {
      metadata,
      material: {
        kind: 'apiKey',
        value: Buffer.alloc(32, 1),
        origin: 'https://example.test',
        auth: 'bearer',
      },
    }
    this.command({
      kind: 'private',
      peer: this.peer,
      request: {
        v: 1,
        kind: 'firstPartyRead',
        itemId: metadata.id,
        origin: 'https://example.test',
        client: 'model',
      },
      send: (bytes) => {
        this.writes += 1
        expect(this.state.key).toBeDefined()
        expect(bytes.some((byte) => byte !== 0)).toBe(true)
      },
    })
  }
  invariants(): void {
    this.checks += 1
    if (this.state.key) expect(this.state.key.some((byte) => byte !== 0)).toBe(true)
    for (const admission of [
      ...this.state.pending.values(),
      ...this.state.tickets.values(),
      ...this.state.active.values(),
    ]) {
      expect(admission.generation).toBe(this.state.generation)
      expect(this.state.registrations.get(admission.token.id)?.token).toBe(admission.token)
    }
    for (const held of this.state.buffers.values())
      expect(held.generation).toBe(this.state.generation)
    for (const history of this.rows.values()) {
      const terminal = history.findIndex((outcome) => outcome !== 'pending')
      if (terminal !== -1) expect(history.slice(terminal + 1)).toEqual([])
    }
  }
}
const scenarios: Record<string, (model: Model) => void> = {
  'cancel and re-register during authentication': (model) => {
    const connection: ConnectionToken = { kind: 'connection', id: 'c'.repeat(32) }
    model.command({ kind: 'connect', connection })
    model.command({
      kind: 'authenticate',
      connection,
      identify: () => Promise.reject(new Error('model uses snapshot')),
      receive: () => {
        throw new Error('stale authentication acquired authority')
      },
    })
    model.command({ kind: 'cancel', requesterId: model.identity.id, grantId: null })
    model.command({
      kind: 'register',
      peer: model.peer,
      registration: { requester: model.identity, ceiling: 'ask' },
    })
  },
  'lock during a private read': (model) => {
    model.privateRead()
    model.hold('read')
    model.command({ kind: 'lock', bump: true })
    model.command({ kind: 'unlock', slotId: null })
  },
  'lock during a queued private send': (model) => {
    model.privateRead()
    model.hold('release')
    model.command({ kind: 'lock', bump: true })
    model.command({ kind: 'unlock', slotId: null })
  },
  'grant expiry during material release': (model) => {
    model.standing.expiresAt = model.now + 1
    const ticket = model.redeemTicket()
    model.drain()
    model.command({
      kind: 'material',
      ticketId: ticket.id,
      requesterId: model.identity.id,
      use: use(),
      run: () => {
        model.writes += 1
        return Promise.resolve()
      },
    })
    model.hold('release')
    model.now += 2
  },
  'revoke during a grant redeem': (model) => {
    model.redeemTicket()
    model.hold('grants')
    model.command({ kind: 'revoke', peer: model.peer, grantId: model.standing.id })
  },
  'approval deadline expiry during an answer': (model) => {
    model.answerApproval()
    model.now += VAULT_APPROVAL_TTL_MS
    model.command({ kind: 'tick' })
  },
  'item expiry during an answer': (model) => {
    model.stored.metadata.dates.expiresAt = model.now + 1
    model.answerApproval()
    model.now += 2
    model.command({ kind: 'tick' })
  },
  'audit rotation with pending rows': (model) => {
    model.proposal()
    while (model.tasks.every((task) => task.effect.kind !== 'audit')) model.complete()
    model.command({ kind: 'lock', bump: true })
    model.command({ kind: 'unlock', slotId: null })
  },
  'unlock lock unlock with late old completions': (model) => {
    model.command({ kind: 'lock', bump: true })
    model.drain()
    model.command({ kind: 'unlock', slotId: null })
    model.hold('open')
    model.command({ kind: 'lock', bump: true })
    model.command({ kind: 'unlock', slotId: null })
  },
}
function prepare(scenario: (model: Model) => void): Model {
  const model = new Model()
  model.setup()
  scenario(model)
  return model
}
describe('M109 deterministic effect interleavings', () => {
  for (const [name, scenario] of Object.entries(scenarios))
    it(`exhaustive: ${name}`, () => {
      const prefixes: number[][] = [[]]
      let schedules = 0,
        events = 0
      while (prefixes.length > 0) {
        const choices = prefixes.pop()!
        const model = prepare(scenario)
        try {
          for (const choice of choices) model.complete(choice)
          if (model.tasks.length === 0) {
            expect(model.writes).toBe(0)
            expect(model.state.sessions.size).toBe(0)
            schedules += 1
            events += model.checks
          } else
            for (let index = 0; index < model.tasks.length; index += 1)
              prefixes.push([...choices, index])
        } catch (error: unknown) {
          throw new Error(`${name}, seed ${String(seed)}, choices ${choices.join(',')}`, {
            cause: error,
          })
        }
      }
      expect(schedules).toBeGreaterThan(0)
      process.stdout.write(
        `M109 scheduler ${name}: ${String(schedules)} schedules, ${String(events)} invariant steps\n`,
      )
    })
  it('seeded larger sets keep all six invariants after every event', () => {
    let random = seed
    let schedules = 0,
      events = 0
    for (let round = 0; round < 100; round += 1)
      for (const [name, scenario] of Object.entries(scenarios)) {
        const model = prepare(scenario)
        // A larger independent set of stale status and epoch completions accompanies the safety transition.
        for (let extra = 0; extra < 4; extra += 1) model.command({ kind: 'status' })
        const choices: number[] = []
        try {
          while (model.tasks.length > 0) {
            random = (Math.imul(random, 1_664_525) + 1_013_904_223) >>> 0
            const choice = random % model.tasks.length
            choices.push(choice)
            model.complete(choice)
          }
          expect(model.writes).toBe(0)
          schedules += 1
          events += model.checks
        } catch (error: unknown) {
          throw new Error(
            `${name}, seed ${String(seed)}, round ${String(round)}, choices ${choices.join(',')}`,
            { cause: error },
          )
        }
      }
    process.stdout.write(
      `M109 scheduler seed ${String(seed)}: ${String(schedules)} schedules, ${String(events)} invariant steps\n`,
    )
  })
  it('RVM109B3 P1-2 a queued private send has no plaintext authority after Lock', () => {
    const model = new Model()
    model.setup()
    model.privateRead()
    model.hold('release')
    model.command({ kind: 'lock', bump: true })
    model.drain()
    expect(model.writes).toBe(0)
  })
  it('a queued private send cannot outlive the item expiry without a timer tick', () => {
    const model = new Model()
    model.setup()
    model.stored.metadata.dates.expiresAt = model.now + 1
    model.privateRead()
    model.hold('release')
    model.now += 2
    model.drain()
    expect(model.writes).toBe(0)
  })
})
