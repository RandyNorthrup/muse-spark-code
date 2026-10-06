import { expect, vi } from 'vitest'
import {
  MHP_METHODS,
  type HostServices,
  type MhpRequestMethod,
} from '../../../src/shared/hostApi/methods'
import { parseMhpResult } from '../../../src/shared/hostApi/protocol'

/** Schema-validating fake host: only the services exercised by these views exist. */
export function fakeServices(prefix = 'surface-') {
  const requests: { method: MhpRequestMethod; params: unknown }[] = []
  const responses = new Map<MhpRequestMethod, (params: unknown) => Promise<unknown>>()
  let serial = 0
  const host: HostServices = {
    request: async (method, params) => {
      MHP_METHODS[method].params.parse(params)
      requests.push({ method, params })
      const custom = responses.get(method)
      let result: unknown
      if (custom !== undefined) result = await custom(params)
      else if (method === 'surfaces/open') result = { surfaceId: `${prefix}${String(++serial)}` }
      else if (
        [
          'surfaces/close',
          'surfaces/focus',
          'ui/notify',
          'ui/clipboard',
          'ui/openExternal',
        ].includes(method)
      )
        result = null
      else throw new Error('UNEXPECTED_HOST_METHOD')
      return parseMhpResult(method, { jsonrpc: '2.0', id: 1, result }).result
    },
    notify: vi.fn(),
  }
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  return { host, requests, responses, log }
}

/** Hold the next host acquisition without guessing a wire or timing deadline. */
export function holdSurfaceOpen(responses: ReturnType<typeof fakeServices>['responses']) {
  const held = Promise.withResolvers<unknown>()
  responses.set('surfaces/open', () => held.promise)
  return held
}

/** A real host only accepts closes for IDs it still owns. */
export function liveSurfaceClose(live: Set<string>) {
  return vi.fn((params: unknown) => {
    const { surfaceId } = MHP_METHODS['surfaces/close'].params.parse(params)
    return live.delete(String(surfaceId))
      ? Promise.resolve(null)
      : Promise.reject(new Error('ALREADY_CLOSED'))
  })
}

export function expectSurfaceCloses(
  requests: readonly { readonly method: string; readonly params: unknown }[],
  ...surfaceIds: string[]
): void {
  expect(requests.filter((request) => request.method === 'surfaces/close')).toEqual(
    surfaceIds.map((surfaceId) => ({ method: 'surfaces/close', params: { surfaceId } })),
  )
}

/** Exercise both completion orders while retaining view-specific stale-state assertions. */
export async function finishSurfaceOpens(
  order: string,
  older: PromiseWithResolvers<unknown>,
  newer: PromiseWithResolvers<unknown>,
  first: Promise<void>,
  second: Promise<void>,
  onOlderClosed: () => Promise<void>,
): Promise<void> {
  if (order === 'older-first') {
    older.resolve({ surfaceId: 'older' })
    await first
    const coalesced = onOlderClosed()
    newer.resolve({ surfaceId: 'newer' })
    await coalesced
  } else {
    newer.resolve({ surfaceId: 'newer' })
    await second
    older.resolve({ surfaceId: 'older' })
  }
  await Promise.all([first, second])
}

export async function expectPendingRelease(release: () => Promise<void>) {
  let hasDisposed = false
  const closing = (async () => {
    await release()
    hasDisposed = true
  })()
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
  expect(hasDisposed).toBe(false)
  return { closing }
}
