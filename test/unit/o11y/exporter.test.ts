// M111 lane OB: the exporter posts OTLP/HTTP JSON to the person's own
// https collector only; it retries 429/502/503/504 with backoff, fails
// anything else at once, gives up past its bound, and never skips TLS
// verification. A real node:https server (an openssl-minted cert the
// client pins) receives the real posts.
import { execFile } from 'node:child_process'
import { createServer, type Server } from 'node:https'
import { chmod, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect } from 'vitest'
import {
  exportO11yLogs,
  exportO11yMetrics,
  exportO11yTraces,
  type O11yExporterPorts,
} from '../../../src/runtime/o11y/exporter'
import type { OtelSettings } from '../../../src/runtime/node/ops/metrics'
import { nodeNativeTest, nodeTempRoot } from '../helpers/nodeNative'

const built: { dir: string; ca: string; key: string; cert: string } = {
  dir: '',
  ca: '',
  key: '',
  cert: '',
}

beforeAll(async () => {
  if (process.platform === 'win32') return
  built.dir = await nodeTempRoot('m111-ob-export-')
  await chmod(built.dir, 0o700)
  const key = path.join(built.dir, 'key.pem')
  const cert = path.join(built.dir, 'cert.pem')
  await promisify(execFile)('openssl', [
    'req',
    '-x509',
    '-newkey',
    'ec',
    '-pkeyopt',
    'ec_paramgen_curve:prime256v1',
    '-noenc',
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
    '-addext',
    'subjectAltName=DNS:localhost,IP:127.0.0.1',
    '-addext',
    'basicConstraints=critical,CA:FALSE',
    '-keyout',
    key,
    '-out',
    cert,
  ])
  await chmod(key, 0o600)
  await chmod(cert, 0o600)
  built.key = await readFile(key, 'utf8')
  built.cert = await readFile(cert, 'utf8')
  built.ca = built.cert
})

afterAll(async () => {
  if (built.dir !== '') await rm(built.dir, { recursive: true, force: true })
})

interface ReceivedPost {
  readonly url: string
  readonly body: unknown
  readonly userAgent: string | undefined
}

async function collector(
  respond: (seen: ReceivedPost[]) => number,
): Promise<{ server: Server; url: string; seen: ReceivedPost[]; close: () => Promise<void> }> {
  const seen: ReceivedPost[] = []
  const server = createServer({ key: built.key, cert: built.cert }, (request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    request.on('end', () => {
      seen.push({
        url: request.url ?? '',
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
        userAgent: request.headers['user-agent'],
      })
      response.writeHead(respond(seen), { 'content-type': 'application/json' })
      response.end('{}')
    })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no test address')
  const port = address.port
  return {
    server,
    url: `https://localhost:${String(port)}`,
    seen,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
      }),
  }
}

function ports(settings: OtelSettings, now: () => number, isUntrusted = false): O11yExporterPorts {
  const base = {
    settings,
    headers: () => Promise.resolve({}),
    now,
    sleep: () => Promise.resolve(),
    random: () => 0,
  }
  return isUntrusted ? base : { ...base, ca: built.ca }
}

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0)

describe('o11y exporter', () => {
  nodeNativeTest('posts OTLP batches to the named https collector', async () => {
    const target = await collector(() => 200)
    try {
      const outcome = await exportO11yMetrics(
        [{ at: NOW, component: 'node', name: 'cpu.percent', value: 12, attributes: [] }],
        ports({ endpoint: target.url }, () => NOW),
      )
      expect(outcome).toEqual({ ok: true, batches: 1 })
      expect(target.seen).toHaveLength(1)
      expect(target.seen[0]?.url).toBe('/v1/metrics')
      const body = target.seen[0]?.body as {
        resourceMetrics: { resource: unknown; scopeMetrics: { metrics: { name: string }[] }[] }[]
      }
      expect(body.resourceMetrics[0]?.scopeMetrics[0]?.metrics[0]?.name).toBe('cpu.percent')
      expect(target.seen[0]?.userAgent).toContain('muse-spark-code-otlp')
    } finally {
      await target.close()
    }
  })

  nodeNativeTest('retries a 503, then succeeds; a 400 fails at once', async () => {
    const flaky = await collector((seen) => (seen.length < 2 ? 503 : 200))
    try {
      const outcome = await exportO11yLogs(
        [{ at: NOW, component: 'node', severity: 9, message: 'up', attributes: [] }],
        ports({ endpoint: flaky.url }, () => NOW),
      )
      expect(outcome).toEqual({ ok: true, batches: 1 })
      expect(flaky.seen).toHaveLength(2)
      expect(flaky.seen[1]?.url).toBe('/v1/logs')
    } finally {
      await flaky.close()
    }
    const strict = await collector(() => 400)
    try {
      const outcome = await exportO11yTraces(
        [
          {
            traceId: 'a'.repeat(32),
            spanId: 'b'.repeat(16),
            component: 'node',
            name: 'op',
            startMs: NOW,
            endMs: NOW + 1,
            error: false,
            attributes: [],
          },
        ],
        ports({ endpoint: strict.url }, () => NOW),
      )
      expect(outcome).toEqual({ ok: false, reason: 'refused' })
      expect(strict.seen).toHaveLength(1)
    } finally {
      await strict.close()
    }
  })

  nodeNativeTest('stays off without an https endpoint', async () => {
    const target = await collector(() => 200)
    try {
      // The gate decides first, even with nothing to send.
      expect(
        await exportO11yMetrics(
          [],
          ports({ endpoint: undefined }, () => NOW),
        ),
      ).toEqual({ ok: false, reason: 'off' })
      expect(
        await exportO11yMetrics(
          [{ at: NOW, component: 'node', name: 'cpu.percent', value: 1, attributes: [] }],
          ports({ endpoint: undefined }, () => NOW),
        ),
      ).toEqual({ ok: false, reason: 'off' })
      expect(
        await exportO11yMetrics(
          [{ at: NOW, component: 'node', name: 'cpu.percent', value: 1, attributes: [] }],
          ports({ endpoint: 'http://localhost:4318' }, () => NOW),
        ),
      ).toEqual({ ok: false, reason: 'not-https' })
      expect(target.seen).toHaveLength(0)
    } finally {
      await target.close()
    }
  })

  nodeNativeTest('gives up past its bound and never skips verification', async () => {
    let tick = 0
    const clock = (): number => {
      tick += 60_000
      return NOW + tick
    }
    const outcome = await exportO11yMetrics(
      [{ at: NOW, component: 'node', name: 'cpu.percent', value: 1, attributes: [] }],
      ports({ endpoint: 'https://localhost:1' }, clock),
    )
    expect(outcome).toEqual({ ok: false, reason: 'gave-up' })
    expect(tick).toBeLessThan(60_000 * 12)

    // Without the pinned CA the self-signed collector is untrusted: the
    // send fails closed instead of succeeding unverified.
    const target = await collector(() => 200)
    try {
      let untrustedTick = 0
      const untrusted = await exportO11yMetrics(
        [{ at: NOW, component: 'node', name: 'cpu.percent', value: 1, attributes: [] }],
        ports(
          { endpoint: target.url },
          () => {
            untrustedTick += 60_000
            return NOW + untrustedTick
          },
          true,
        ),
      )
      expect(untrusted).toEqual({ ok: false, reason: 'gave-up' })
      expect(target.seen).toHaveLength(0)
    } finally {
      await target.close()
    }
  })
})
