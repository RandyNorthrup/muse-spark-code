/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { createPlaybookBridge } from '../../src/webview/playbook/bridge'
import { scheduleChannel } from '../../src/webview/schedules/channel'
import { deliverUsageReply } from '../../src/webview/hostBridges/usageBridge'
import { httpHostBridge } from '../../src/webview/hostBridges/httpHostBridge'
import { companionUsagePort } from '../../src/webview/usage/companion'
import type { MessageSource } from '../../src/webview/hostBridge'

afterEach(() => {
  vi.unstubAllGlobals()
})

function messages(): EventTarget {
  return new EventTarget()
}

function readReply(target: MessageSource): Promise<unknown> {
  return new Promise((resolve) => {
    target.addEventListener('message', (event) => {
      resolve(event.data)
    })
  })
}

describe('CATCHAUDIT named-condition catches', () => {
  it('playbook bridge: a failed post settles unavailable, a foreign failure propagates', async () => {
    const failing = createPlaybookBridge(
      messages(),
      () => {
        throw new Error('post-canary')
      },
      1000,
      'workspace',
    )
    await expect(failing.read()).rejects.toThrow(UI_TEXT.playbookUnavailable)
    failing.dispose()
    const hostile: unknown = 'bridge-boom'
    const hostileBridge = createPlaybookBridge(
      messages(),
      () => {
        throw hostile
      },
      1000,
      'workspace',
    )
    await expect(hostileBridge.read()).rejects.toBe(hostile)
    hostileBridge.dispose()
  })

  it('schedule channel: a failed post settles load-failed, a foreign failure propagates', async () => {
    const failing = scheduleChannel(messages(), () => {
      throw new Error('post-canary')
    })
    await expect(failing.request({ method: 'schedules/list', workspaceKey: 'w' })).rejects.toThrow(
      UI_TEXT.scheduleV2.editor.loadFailed,
    )
    const hostile: unknown = 'channel-boom'
    const hostileChannel = scheduleChannel(messages(), () => {
      throw hostile
    })
    await expect(
      hostileChannel.request({ method: 'schedules/list', workspaceKey: 'w' }),
    ).rejects.toBe(hostile)
  })

  it('usage bridge: unparseable text reads invalid, a foreign failure propagates', async () => {
    const target = messages()
    const reply = readReply(target)
    deliverUsageReply(target, 'not json')
    await expect(reply).resolves.toMatchObject({ type: 'usage/error', code: 'invalidMessage' })
    const realParse = JSON.parse
    const jsonBoom: unknown = 'json-boom'
    vi.stubGlobal('JSON', {
      ...JSON,
      parse: () => {
        throw jsonBoom
      },
    })
    try {
      expect(() => {
        deliverUsageReply(messages(), '{}')
      }).toThrow('json-boom')
    } finally {
      vi.stubGlobal('JSON', realParse)
    }
  })

  it('http bridge: a failed request reads failed, a foreign failure propagates', async () => {
    const failing = httpHostBridge({
      request: () => Promise.reject(new Error('request-canary')),
      savedState: () => undefined,
      saveState: () => {
        /* The test bridge persists nothing. */
      },
    })
    const reply = readReply(failing.messages)
    failing.post({
      type: 'usage/query',
      query: { range: 'today', groupBy: 'provider', metric: 'cost' },
    })
    await expect(reply).resolves.toMatchObject({ type: 'usage/error', code: 'readFailed' })
    const hostile: unknown = 'http-boom'
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const hostileBridge = httpHostBridge({
        request: vi.fn().mockRejectedValue(hostile),
        savedState: () => undefined,
        saveState: () => {
          /* The test bridge persists nothing. */
        },
      })
      hostileBridge.post({
        type: 'usage/query',
        query: { range: 'today', groupBy: 'provider', metric: 'cost' },
      })
      const deadline = Date.now() + 2000
      while (!unhandled.includes(hostile)) {
        if (Date.now() > deadline) throw new Error('no unhandled rejection observed')
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('usage companion: a broken stream closes waiters with its cause', async () => {
    const failure = new Error('stream-canary')
    vi.stubGlobal('fetch', () => Promise.reject(failure))
    const port = companionUsagePort()
    await expect(
      port.request({
        type: 'usage/query',
        query: { range: 'today', groupBy: 'provider', metric: 'cost' },
      }),
    ).rejects.toMatchObject({
      message: 'EPANEL_CLOSED',
      cause: failure,
    })
  })
})
