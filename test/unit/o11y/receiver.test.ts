// M111 lane OB: the local OTLP receiver answers the three signal routes
// on loopback, stores what validates, and refuses the rest in fixed
// words. A real HTTP server and real client requests; a non-loopback
// bind throws instead of widening (D65).
import { rm } from 'node:fs/promises'
import { afterEach, describe, expect } from 'vitest'
import { O11Y_RECEIVER_MAX_BODY_BYTES } from '../../../src/shared/constants'
import { startO11yReceiver } from '../../../src/runtime/o11y/receiver'
import { O11yRingStore } from '../../../src/runtime/o11y/store'
import { NodePrivateFiles } from '../../../src/runtime/node/privateFiles'
import { nodeNativeTest, nodeTempRoot } from '../helpers/nodeNative'

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0)
const NANOS = `${String(NOW)}000000`
const directories: string[] = []

afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true })
})

function metricBatch(): unknown {
  return {
    resourceMetrics: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'node' } }] },
        scopeMetrics: [
          {
            metrics: [
              {
                name: 'cpu.percent',
                gauge: { dataPoints: [{ timeUnixNano: NANOS, asDouble: 12 }] },
              },
            ],
          },
        ],
      },
    ],
  }
}

describe('o11y receiver', () => {
  nodeNativeTest('stores a valid batch and refuses the rest in fixed words', async () => {
    const dir = await nodeTempRoot('m111-ob-receiver-')
    directories.push(dir)
    const store = new O11yRingStore(new NodePrivateFiles(dir), () => NOW)
    const receiver = await startO11yReceiver({ store, port: 0 })
    try {
      const ok = await fetch(`${receiver.url}/v1/metrics`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(metricBatch()),
      })
      expect(ok.status).toBe(200)
      const metrics = await store.readMetricWindow(0, NOW, 20)
      expect(metrics.series).toHaveLength(1)

      const malformed = await fetch(`${receiver.url}/v1/metrics`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{oops',
      })
      expect(malformed.status).toBe(400)
      expect(await malformed.json()).toEqual({ error: 'malformed' })

      const protobuf = await fetch(`${receiver.url}/v1/metrics`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-protobuf' },
        body: 'bytes',
      })
      expect(protobuf.status).toBe(415)

      const missing = await fetch(`${receiver.url}/v1/traces`)
      expect(missing.status).toBe(404)

      const tooLarge = await fetch(`${receiver.url}/v1/logs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: `{"resourceLogs":[],"pad":"${'x'.repeat(O11Y_RECEIVER_MAX_BODY_BYTES)}"}`,
      })
      expect(tooLarge.status).toBe(413)
      expect(receiver.refused.get('malformed')).toBe(1)
      expect(receiver.refused.get('too-large')).toBe(1)
    } finally {
      await receiver.close()
    }
  })

  nodeNativeTest('binds loopback and refuses anything else', async () => {
    const dir = await nodeTempRoot('m111-ob-receiver-bind-')
    directories.push(dir)
    const store = new O11yRingStore(new NodePrivateFiles(dir), () => NOW)
    await expect(startO11yReceiver({ store, host: '0.0.0.0', port: 0 })).rejects.toThrow(RangeError)
    const receiver = await startO11yReceiver({ store, port: 0 })
    try {
      expect(receiver.url.startsWith('http://127.0.0.1:')).toBe(true)
    } finally {
      await receiver.close()
    }
  })
})
