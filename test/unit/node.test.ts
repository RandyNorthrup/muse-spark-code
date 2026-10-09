import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import {
  NODE_AUDIT_MAX_BYTES,
  NODE_AUDIT_RETENTION_DAYS,
  NODE_MAX_ARGV_ITEMS,
  NODE_MAX_ARG_CHARS,
  NODE_MAX_CHALLENGES,
  NODE_MAX_FILE_BYTES,
  NODE_MAX_LABEL_CHARS,
  NODE_MAX_NAMES,
  NODE_MAX_PAGE_ITEMS,
  NODE_MAX_PASSKEYS,
  NODE_MAX_PATH_CHARS,
  NODE_MAX_SESSIONS,
  NODE_MAX_TERMINAL_DIMENSION,
  NODE_MAX_WORKSPACES,
  NODE_SETUP_TTL_MS,
  NODE_TERMINAL_INPUT_BYTES,
  NODE_TERMINAL_OUTPUT_BYTES,
} from '../../src/shared/constants'
import {
  nodeAuditSchema,
  nodeConfigSchema,
  nodeDashboardSchema,
  nodeEventSchema,
  nodeFileEntrySchema,
  nodeFileListSchema,
  nodeFileTextSchema,
  nodeLanAddressSchema,
  nodeRelativePathSchema,
  nodeStateSchema,
  nodeTerminalClientFrameSchema,
  nodeTerminalHostEventSchema,
  nodeTerminalSizeSchema,
  nodeToolRequestSchema,
  nodeToolResultSchema,
  nodeWorkspaceSchema,
  type NodeTerminalHostEvent,
} from '../../src/shared/node'
import { FakeNodeToolHost } from './helpers/node/toolHost'
import {
  nodeAudit,
  nodeConfig,
  nodeDashboard,
  nodeEvent,
  nodeHash,
  nodeSession,
  nodeState,
} from './helpers/node/records'
import { nodeSchemaDocuments } from './helpers/node/schemaDocuments'

const workspace = { id: 'workspace-1', label: 'Repo', path: 'repo', trusted: false, lastUsedAt: 0 }
const file = { path: 'src/main.ts', kind: 'file', sizeBytes: 1 }
const request = { id: 'run-1', workspaceId: 'workspace-1', argv: ['git', 'status'], cwd: null }
const result = { id: 'run-1', user: 'muse-tools', exitCode: 0, stdout: '', stderr: '' }

describe('home node records', () => {
  it('starts without a listener and round trips all public records', () => {
    expect(nodeConfigSchema.parse(nodeConfig()).listener).toBeNull()
    for (const [schema, value] of [
      [nodeStateSchema, nodeState()],
      [nodeDashboardSchema, nodeDashboard()],
      [nodeAuditSchema, nodeAudit()],
      [nodeEventSchema, nodeEvent()],
      [nodeWorkspaceSchema, workspace],
      [nodeFileEntrySchema, file],
      [nodeToolResultSchema, result],
    ] as const)
      expect(schema.parse(structuredClone(value))).toEqual(value)
  })
  it.each([
    '127.0.0.1',
    '10.0.0.2',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.2',
    '::1',
    'fd42::1',
    'fe80::1',
  ])('accepts chosen home address %s', (ip) => {
    expect(nodeLanAddressSchema.safeParse(ip).success).toBe(true)
  })
  it.each([
    '0.0.0.0',
    '::',
    '8.8.8.8',
    '172.15.1.1',
    '172.32.1.1',
    '169.254.169.254',
    '224.0.0.1',
    'ff02::1',
    'fd00:ec2::254',
    'fd00:0ec2:0:0:0:0:0:0254',
    '::ffff:127.0.0.1',
    '192.168.999.1',
  ])('H01 refuses unsafe bind %s', (ip) => {
    expect(nodeLanAddressSchema.safeParse(ip).success).toBe(false)
  })
  it.each([
    '../x',
    'x/../y',
    '.',
    './x',
    'x/.',
    '/tmp/x',
    'x//y',
    'x/',
    String.raw`C:\x`,
    'x\0y',
    'x\ny',
    '',
  ])('H10 refuses unnormalized relative path %s', (path) => {
    expect(nodeRelativePathSchema.safeParse(path).success).toBe(false)
  })
  it('accepts literal names without decoding them as URL paths', () => {
    expect(nodeRelativePathSchema.parse('src/你好 world.ts')).toBe('src/你好 world.ts')
    expect(nodeRelativePathSchema.parse('%2e%2e/file')).toBe('%2e%2e/file')
  })
  it.each([
    ['version', { ...nodeConfig(), v: 2 }],
    ['role', { ...nodeConfig(), mode: 'worker' }],
    ['secret', { ...nodeConfig(), apiKey: 'SYNTHETIC-NODE-CANARY' }],
    ['port zero', { ...nodeConfig(), listener: { address: '127.0.0.1', port: 0 } }],
    ['port overflow', { ...nodeConfig(), listener: { address: '127.0.0.1', port: 65_536 } }],
    ['empty label', { ...nodeConfig(), label: '' }],
    ['label cap', { ...nodeConfig(), label: 'a'.repeat(NODE_MAX_LABEL_CHARS + 1) }],
    ['control label', { ...nodeConfig(), label: 'home\nother' }],
    ['no names', { ...nodeConfig(), browserNames: [] }],
    [
      'name cap',
      {
        ...nodeConfig(),
        browserNames: Array.from({ length: NODE_MAX_NAMES + 1 }, (_, i) => `n${String(i)}.local`),
      },
    ],
    ['duplicate names', { ...nodeConfig(), browserNames: ['home.local', 'home.local'] }],
    ['relative root', { ...nodeConfig(), workspaceRoot: 'workspaces' }],
    ['traversal root', { ...nodeConfig(), workspaceRoot: '/../state' }],
    ['root length', { ...nodeConfig(), workspaceRoot: `/${'a'.repeat(NODE_MAX_PATH_CHARS)}` }],
    ['audit size zero', { ...nodeConfig(), audit: { maxBytes: 0, retentionDays: 1 } }],
    [
      'audit size cap',
      { ...nodeConfig(), audit: { maxBytes: NODE_AUDIT_MAX_BYTES + 1, retentionDays: 1 } },
    ],
    ['audit retention zero', { ...nodeConfig(), audit: { maxBytes: 1, retentionDays: 0 } }],
    [
      'audit retention cap',
      { ...nodeConfig(), audit: { maxBytes: 1, retentionDays: NODE_AUDIT_RETENTION_DAYS + 1 } },
    ],
  ])('config rejects %s', (_label, value) => {
    expect(nodeConfigSchema.safeParse(value).success).toBe(false)
  })
  it.each([
    ['version', { ...nodeState(), v: 2 }],
    ['generation', { ...nodeState(), generation: 0 }],
    [
      'setup plaintext',
      { ...nodeState(), setup: { code: 'SYNTHETIC-NODE-CANARY', issuedAt: 0, expiresAt: 1 } },
    ],
    [
      'setup lifetime',
      {
        ...nodeState(),
        setup: { codeHash: nodeHash, issuedAt: 0, expiresAt: NODE_SETUP_TTL_MS + 1 },
      },
    ],
    ['setup order', { ...nodeState(), setup: { codeHash: nodeHash, issuedAt: 1, expiresAt: 1 } }],
    ['sessions persisted', { ...nodeState(), sessions: [nodeSession()] }],
    [
      'workspaces cap',
      {
        ...nodeState(),
        workspaces: Array.from({ length: NODE_MAX_WORKSPACES + 1 }, (_, i) => ({
          ...workspace,
          id: `w${String(i)}`,
        })),
      },
    ],
    [
      'owner mismatch',
      {
        ...nodeState(),
        setup: null,
        passkeys: [
          { id: 'YQ', ownerId: 'other', publicKey: 'YQ', counter: 0, failures: 0, disabled: false },
        ],
      },
    ],
    [
      'setup after enrollment',
      {
        ...nodeState(),
        passkeys: [
          { id: 'YQ', ownerId: 'owner', publicKey: 'YQ', counter: 0, failures: 0, disabled: false },
        ],
      },
    ],
    [
      'duplicate passkey',
      {
        ...nodeState(),
        setup: null,
        passkeys: Array.from({ length: 2 }, () => ({
          id: 'YQ',
          ownerId: 'owner',
          publicKey: 'YQ',
          counter: 0,
          failures: 0,
          disabled: false,
        })),
      },
    ],
    ['duplicate workspace', { ...nodeState(), workspaces: [workspace, workspace] }],
    [
      'passkey cap',
      {
        ...nodeState(),
        setup: null,
        passkeys: Array.from({ length: NODE_MAX_PASSKEYS + 1 }, (_, i) => ({
          id: `k${String(i)}`,
          ownerId: 'owner',
          publicKey: 'YQ',
          counter: 0,
          failures: 0,
          disabled: false,
        })),
      },
    ],
  ])('state rejects %s', (_label, value) => {
    expect(nodeStateSchema.safeParse(value).success).toBe(false)
  })
  it.each([
    ['unattended contradiction', { ...nodeDashboard(), attendance: 'unattended' }],
    ['locked contradiction', { ...nodeDashboard(), locked: true }],
    [
      'unsealed locked',
      {
        ...nodeDashboard(),
        attendance: 'unattended',
        sessions: [],
        locked: true,
        keyStoreSealed: false,
      },
    ],
    ['cpu cap', { ...nodeDashboard(), cpuPercent: 101 }],
    ['cpu negative', { ...nodeDashboard(), cpuPercent: -1 }],
    ['memory order', { ...nodeDashboard(), memory: { usedBytes: 3, totalBytes: 2 } }],
    ['disk order', { ...nodeDashboard(), disk: { freeBytes: 3, totalBytes: 2 } }],
    [
      'session cap',
      { ...nodeDashboard(), sessions: Array.from({ length: NODE_MAX_SESSIONS + 1 }, nodeSession) },
    ],
    ['challenge cap', { ...nodeDashboard(), pendingChallenges: NODE_MAX_CHALLENGES + 1 }],
  ])('dashboard rejects %s', (_label, value) => {
    expect(nodeDashboardSchema.safeParse(value).success).toBe(false)
  })
  it.each(['bearer', 'setupCode', 'key', 'data', 'stderr', 'message', 'path'])(
    'H06/H13 audit refuses payload field %s',
    (field) => {
      expect(
        nodeAuditSchema.safeParse({ ...nodeAudit(), [field]: 'SYNTHETIC-NODE-CANARY' }).success,
      ).toBe(false)
    },
  )
  it('H15 audit distinguishes verified auth proofs from allowed access only for auth', () => {
    const { v, seq, time, nodeId, sessionId, previousHash, hash } = nodeAudit()
    const fields = { v, seq, time, nodeId, sessionId, previousHash, hash, outcome: 'verified' }
    expect(
      nodeAuditSchema.safeParse({
        ...fields,
        kind: 'signin',
        action: 'signin',
        credentialIdHash: nodeHash,
      }).success,
    ).toBe(true)
    expect(
      nodeAuditSchema.safeParse({ ...fields, kind: 'stepUp', actionDigest: nodeHash }).success,
    ).toBe(true)
    expect(nodeAuditSchema.safeParse({ ...nodeAudit(), outcome: 'verified' }).success).toBe(false)
  })
  it.each([
    ['version', { ...nodeEvent(), v: 2 }],
    ['sequence', { ...nodeEvent(), seq: 0 }],
    ['fractional sequence', { ...nodeEvent(), seq: 1.5 }],
    ['time', { ...nodeEvent(), time: -1 }],
    ['identity digest', { ...nodeEvent(), nodeId: 'unhashed' }],
    ['bearer', { ...nodeEvent(), bearer: 'SYNTHETIC-NODE-CANARY' }],
  ])('event rejects %s', (_label, value) => {
    expect(nodeEventSchema.safeParse(value).success).toBe(false)
  })
  it.each([
    ['input characters', { type: 'input', data: 'a'.repeat(NODE_TERMINAL_INPUT_BYTES + 1) }],
    ['input UTF8 bytes', { type: 'input', data: '界'.repeat(NODE_TERMINAL_INPUT_BYTES) }],
    ['resize zero', { type: 'resize', size: { cols: 0, rows: 24 } }],
    ['resize cap', { type: 'resize', size: { cols: NODE_MAX_TERMINAL_DIMENSION + 1, rows: 24 } }],
    ['token short', { type: 'auth', bearer: 'tiny', terminalId: 'terminal-1' }],
  ])('terminal frame rejects %s', (_label, value) => {
    expect(nodeTerminalClientFrameSchema.safeParse(value).success).toBe(false)
  })
  it.each([
    [
      'file UTF8',
      nodeFileTextSchema,
      { path: 'x', digest: nodeHash, text: '界'.repeat(NODE_MAX_FILE_BYTES) },
    ],
    [
      'file characters',
      nodeFileTextSchema,
      { path: 'x', digest: nodeHash, text: 'x'.repeat(NODE_MAX_FILE_BYTES + 1) },
    ],
    [
      'listing length',
      nodeFileListSchema,
      { entries: Array.from({ length: NODE_MAX_PAGE_ITEMS + 1 }, () => file), nextCursor: null },
    ],
    [
      'output UTF8',
      nodeEventSchema,
      {
        ...nodeEvent(),
        type: 'terminalOutput',
        terminalId: 't',
        data: '界'.repeat(NODE_TERMINAL_OUTPUT_BYTES),
      },
    ],
    [
      'stdout UTF8',
      nodeToolResultSchema,
      { ...result, stdout: '界'.repeat(NODE_TERMINAL_OUTPUT_BYTES) },
    ],
    [
      'stderr UTF8',
      nodeToolResultSchema,
      { ...result, stderr: '界'.repeat(NODE_TERMINAL_OUTPUT_BYTES) },
    ],
    ['tool user', nodeToolResultSchema, { ...result, user: 'muse-node' }],
  ] as const)('H09/H11 refuses %s', (_label, schema, value) => {
    expect(schema.safeParse(value).success).toBe(false)
  })
  it.each([
    ['empty argv', { ...request, argv: [] }],
    ['empty executable', { ...request, argv: ['', 'status'] }],
    ['argv cap', { ...request, argv: Array.from({ length: NODE_MAX_ARGV_ITEMS + 1 }, () => 'x') }],
    ['arg cap', { ...request, argv: ['x'.repeat(NODE_MAX_ARG_CHARS + 1)] }],
    ['arg NUL', { ...request, argv: ['x\0y'] }],
    ['later arg cap', { ...request, argv: ['printf', 'x'.repeat(NODE_MAX_ARG_CHARS + 1)] }],
    ['later arg NUL', { ...request, argv: ['printf', '\0'] }],
    ['environment', { ...request, env: { TOKEN: 'SYNTHETIC-NODE-CANARY' } }],
  ])('H11 tool request rejects %s', (_label, value) => {
    expect(nodeToolRequestSchema.safeParse(value).success).toBe(false)
  })
  it('preserves empty arguments after the executable through validation and dispatch', async () => {
    const emptyArgument = { ...request, argv: ['printf', '%s\n', ''] }
    expect(nodeToolRequestSchema.parse(emptyArgument)).toEqual(emptyArgument)
    const host = new FakeNodeToolHost(new Set(['workspace-1']), [
      { exitCode: 0, stdout: '\n', stderr: '' },
    ])
    await host.run(emptyArgument, new AbortController().signal)
    expect(host.requests).toEqual([emptyArgument])
  })
  it('fake tool host records exact calls, exits, cancellation and terminal cleanup', async () => {
    const host = new FakeNodeToolHost(new Set(['workspace-1']), [
      { exitCode: 7, stdout: 'out', stderr: 'err' },
    ])
    expect(await host.run(request, new AbortController().signal)).toEqual({
      ...result,
      exitCode: 7,
      stdout: 'out',
      stderr: 'err',
    })
    const controller = new AbortController()
    controller.abort()
    await expect(host.run(request, controller.signal)).rejects.toThrow('aborted')
    expect(host.requests).toEqual([request])
    await expect(host.run(request, new AbortController().signal)).rejects.toThrow('no scripted')
    const onEvent = vi.fn(() => Promise.resolve())
    const signal = new AbortController().signal
    expect(() => host.openTerminal('unknown', { cols: 80, rows: 24 }, onEvent, signal)).toThrow(
      'workspace',
    )
    expect(() => host.openTerminal('workspace-1', { cols: 0, rows: 24 }, onEvent, signal)).toThrow()
    const { id, user } = await host.openTerminal(
      'workspace-1',
      { cols: 80, rows: 24 },
      onEvent,
      signal,
    )
    expect(user).toBe('muse-tools')
    await host.writeTerminal(id, 'echo hello\r')
    await host.resizeTerminal(id, { cols: 100, rows: 30 })
    expect(host.terminals.get(id)).toMatchObject({ cols: 100, rows: 30, input: ['echo hello\r'] })
    await host.closeTerminal(id)
    expect(() => host.writeTerminal(id, 'x')).toThrow('terminal')
    await host.openTerminal('workspace-1', { cols: 80, rows: 24 }, onEvent, signal)
    await host.stopAll('stopped')
    expect(host.terminals.size).toBe(0)
    expect(nodeTerminalSizeSchema.parse({ cols: 80, rows: 24 })).toEqual({ cols: 80, rows: 24 })
  })
  it('streams PTY output before spontaneous exit with backpressure and final disposal', async () => {
    const host = new FakeNodeToolHost(new Set(['workspace-1']))
    const events: NodeTerminalHostEvent[] = []
    const pending = Promise.withResolvers<undefined>()
    const { id } = await host.openTerminal(
      'workspace-1',
      { cols: 80, rows: 24 },
      async (event) => {
        events.push(event)
        if (event.type === 'terminalOutput') await pending.promise
      },
      new AbortController().signal,
    )
    const output = host.outputTerminal(id, 'hello')
    const ended = host.endTerminal(id, 7)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(events).toEqual([{ type: 'terminalOutput', terminalId: id, data: 'hello' }])
    expect(host.terminals.has(id)).toBe(true)
    expect(() => host.outputTerminal(id, 'late')).toThrow('terminal')
    pending.resolve(undefined)
    await Promise.all([output, ended])
    expect(events).toEqual([
      { type: 'terminalOutput', terminalId: id, data: 'hello' },
      { type: 'terminalEnded', terminalId: id, exitCode: 7, reason: 'exit' },
    ])
    for (const event of events) expect(nodeTerminalHostEventSchema.parse(event)).toEqual(event)
    expect(host.terminals.size).toBe(0)
    await host.closeTerminal(id)
    expect(events).toHaveLength(2)
  })
  it('disposes PTYs and observers on disconnect, lock and rejected output delivery', async () => {
    const host = new FakeNodeToolHost(new Set(['workspace-1']))
    const controller = new AbortController()
    const events: NodeTerminalHostEvent[] = []
    const observer = (event: NodeTerminalHostEvent): Promise<void> => {
      events.push(event)
      return Promise.resolve()
    }
    const { id } = await host.openTerminal(
      'workspace-1',
      { cols: 80, rows: 24 },
      observer,
      controller.signal,
    )
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    controller.abort()
    await Promise.resolve()
    await host.closeTerminal(id)
    expect(events).toEqual([
      { type: 'terminalEnded', terminalId: id, exitCode: null, reason: 'lost' },
    ])
    expect(host.terminals.size).toBe(0)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    await expect(
      host.openTerminal('workspace-1', { cols: 80, rows: 24 }, observer, controller.signal),
    ).rejects.toThrow('aborted')
    const locked = await host.openTerminal(
      'workspace-1',
      { cols: 80, rows: 24 },
      observer,
      new AbortController().signal,
    )
    await host.stopAll('locked')
    expect(events.at(-1)).toEqual({
      type: 'terminalEnded',
      terminalId: locked.id,
      exitCode: null,
      reason: 'locked',
    })
    const rejected = await host.openTerminal(
      'workspace-1',
      { cols: 80, rows: 24 },
      () => Promise.reject(new Error('sink lost')),
      new AbortController().signal,
    )
    await expect(host.outputTerminal(rejected.id, 'hello')).rejects.toThrow('sink lost')
    expect(host.terminals.size).toBe(0)
  })
  it('bounds queued PTY output and requires scripts to wait for acknowledgement', async () => {
    const host = new FakeNodeToolHost(new Set(['workspace-1']))
    const ack = Promise.withResolvers<undefined>()
    const onEvent = vi.fn(() => ack.promise)
    const { id } = await host.openTerminal(
      'workspace-1',
      { cols: 80, rows: 24 },
      onEvent,
      new AbortController().signal,
    )
    const output = host.outputTerminal(id, 'x'.repeat(NODE_TERMINAL_OUTPUT_BYTES))
    expect(() => host.outputTerminal(id, 'x')).toThrow('backpressure')
    expect(() => host.outputTerminal(id, '界'.repeat(NODE_TERMINAL_OUTPUT_BYTES))).toThrow()
    ack.resolve(undefined)
    await output
    await host.outputTerminal(id, 'after acknowledgement')
    await host.closeTerminal(id)
    expect(onEvent).toHaveBeenCalledTimes(3)
    expect(host.terminals.size).toBe(0)
  })
  it('versioned JSON schema documents match their canonical parsers', async () => {
    for (const [name, document] of Object.entries(nodeSchemaDocuments())) {
      const committed: unknown = JSON.parse(
        await readFile(`docs/schemas/node-${name}-v1.schema.json`, 'utf8'),
      )
      expect(committed, name).toEqual(document)
    }
  })
})
