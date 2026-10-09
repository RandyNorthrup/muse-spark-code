import type * as macModule from '../../src/core/resources/trees/mac'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { processAuthority } from '../../src/runtime/lsp/processAuthority'
import { RUNTIME_STOP } from '../../src/shared/constants'

interface Row {
  pid: number
  parent: number
  pgid: number
  startTime: string
  exited: boolean
}
const fixture = vi.hoisted(() => ({
  rows: new Map<number, Row>(),
  sent: new Array<{ pid: number; signal: string }>(),
  isUnknown: false,
}))
vi.mock('../../src/core/resources/trees/mac', async (importOriginal) => {
  const actual = await importOriginal<typeof macModule>()
  return {
    MacResourceTreeReader: class extends actual.MacResourceTreeReader {
      constructor(deps: macModule.MacTreeDeps) {
        super({
          ...deps,
          inspect: (pid) => Promise.resolve(fixture.rows.get(pid) ?? null),
          run: () =>
            fixture.isUnknown
              ? Promise.reject(new Error('unknown'))
              : Promise.resolve(
                  Array.from(
                    fixture.rows.values(),
                    (row) =>
                      `${String(row.pid)} ${String(row.parent)} ${String(row.pgid)} ${row.exited ? 'Z' : 'S'} 0:00.00 4`,
                  ).join('\n'),
                ),
          sendSignal: (pid, signal) => {
            fixture.sent.push({ pid, signal })
            fixture.rows.delete(pid)
          },
        })
      }
    },
  }
})
const platform = Object.getOwnPropertyDescriptor(process, 'platform')
if (platform === undefined) throw new Error('fixture platform')
afterEach(() => {
  fixture.rows.clear()
  fixture.sent.length = 0
  fixture.isUnknown = false
  Object.defineProperty(process, 'platform', platform)
  vi.restoreAllMocks()
})
function row(pid: number, parent: number, startTime: string, pgid = pid, hasExited = false): Row {
  return { pid, parent, startTime, pgid, exited: hasExited }
}
async function owned() {
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  fixture.rows.set(710, row(710, 1, '100000001'))
  const authority = await processAuthority('/trusted/install', '/private/storage')
  const ticket = await authority.register(710, { type: 'group', pgid: 710 })
  return { authority, ticket }
}
async function expectFailedStop({ authority, ticket }: Awaited<ReturnType<typeof owned>>) {
  vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(RUNTIME_STOP.exitMs)
  await expect(authority.stop(ticket)).rejects.toThrow('ESTOP_TREE')
  expect(fixture.sent).toEqual([])
  expect(authority.registry.tickets()).toHaveLength(1)
}

describe('LSP uses the M107 process authority', () => {
  it('rejects the same-second recycled parent and its unrelated detached child', async () => {
    const { authority, ticket } = await owned()
    fixture.rows.set(711, row(711, 710, '100000010'))
    expect(await authority.registry.members(ticket)).toContainEqual({
      pid: 711,
      startTime: '100000010',
    })
    fixture.rows.set(711, row(711, 1, '100000020'))
    fixture.rows.set(712, row(712, 711, '100000030'))
    await authority.stop(ticket)
    expect(fixture.sent).toEqual([{ pid: 710, signal: 'SIGKILL' }])
    expect(fixture.rows.has(712)).toBe(true)
  })
  it('refuses fast-exit group-number reuse without signalling the replacement', async () => {
    const { authority, ticket } = await owned()
    fixture.rows.set(710, row(710, 1, '100000002'))
    fixture.rows.set(712, row(712, 710, '100000003', 710))
    await expectFailedStop({ authority, ticket })
  })
  it('retains detached descendants across root reuse while refusing the reused group', async () => {
    const { authority, ticket } = await owned()
    fixture.rows.set(711, row(711, 710, '100000010'))
    await authority.registry.members(ticket)
    fixture.rows.set(711, row(711, 1, '100000010'))
    fixture.rows.set(710, row(710, 1, '100000020'))
    fixture.rows.set(712, row(712, 710, '100000030', 710))
    await authority.stop(ticket)
    expect(fixture.sent).toEqual([{ pid: 711, signal: 'SIGKILL' }])
    expect(fixture.rows.has(710)).toBe(true)
    expect(fixture.rows.has(712)).toBe(true)
  })
  it('enrolls a new genuine child at a departed PID through fresh parent proof', async () => {
    const { authority, ticket } = await owned()
    fixture.rows.set(711, row(711, 710, '100000010'))
    await authority.registry.members(ticket)
    fixture.rows.delete(711)
    await authority.registry.members(ticket)
    fixture.rows.set(711, row(711, 710, '100000020'))
    await authority.stop(ticket)
    expect(fixture.sent.map((entry) => entry.pid)).toEqual([711, 710])
  })
  it('treats persistent zombies as exited, including a zombie root', async () => {
    const { authority, ticket } = await owned()
    fixture.rows.set(711, row(711, 710, '100000010'))
    await authority.registry.members(ticket)
    fixture.rows.set(711, row(711, 1, '100000010', 711, true))
    fixture.rows.set(710, row(710, 1, '100000001', 710, true))
    await authority.stop(ticket)
    expect(fixture.sent).toEqual([])
    expect(authority.registry.tickets()).toEqual([])
  })
  it('preserves unknown enumeration as failure instead of an empty success', async () => {
    const { authority, ticket } = await owned()
    fixture.isUnknown = true
    await expectFailedStop({ authority, ticket })
  })
  it('keeps per-member refusals and never treats an admitted signal as exit', async () => {
    const { authority, ticket } = await owned()
    const killing = vi.spyOn(authority.registry, 'kill').mockResolvedValue({
      status: 'done',
      members: [{ identity: ticket.root, result: 'refused' }],
    })
    const waiting = vi.spyOn(globalThis, 'setTimeout')
    await expect(authority.stop(ticket)).rejects.toThrow('ESTOP_TREE')
    expect(waiting).not.toHaveBeenCalled()
    expect(authority.registry.tickets()).toHaveLength(1)
    waiting.mockRestore()
    killing.mockResolvedValue({
      status: 'done',
      members: [{ identity: ticket.root, result: 'done' }],
    })
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(RUNTIME_STOP.exitMs)
    await expect(authority.stop(ticket)).rejects.toThrow('ESTOP_TREE')
    expect(authority.registry.tickets()).toHaveLength(1)
    now.mockRestore()
  })
})
