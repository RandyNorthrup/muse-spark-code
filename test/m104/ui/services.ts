import { vi } from 'vitest'
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
