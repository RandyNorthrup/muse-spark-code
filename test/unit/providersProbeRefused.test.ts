// A refused loopback connection names its codes on the probe path.
//
// `providers add`/`providers test` run the free key test through
// `probeProvider`. When the endpoint refuses the connection, the person
// reads the network codes and that whether the request arrived is unknown
// (0.19.0, lane PROVERRORS) — never the fixed "could not be reached"
// sentence. The refusal is produced for real here: a loopback server is
// bound and closed so the port is really refused, and the probe runs
// through the real resolver, the real endpoint pin and the real transport.
//
// The two static imports warm the probe's lazily loaded bundles at
// collection time, so the assertion itself runs inside the repository's
// own per-test timeout.
import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import '../../src/host/backend/configuredProvidersEntry'
import '../../src/host/backend/modelApiEntry'
import { presetById } from '../../src/core/providers/presets'
import { resolveProvider } from '../../src/runtime/exec/providerExec'
import { resolveEndpointHost } from '../../src/runtime/providerPaths'
import { probeProvider } from '../../src/runtime/providersCommands'

/** A loopback port nothing listens on: bound, read back, then closed. */
async function refusedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      resolve()
    })
    server.on('error', (error: unknown) => {
      reject(error instanceof Error ? error : new Error('listen failed'))
    })
  })
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('no loopback port')
  const port = address.port
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })
  return port
}

describe('probeProvider against a refused loopback endpoint', () => {
  it('names the connection codes instead of the fixed unreachable sentence', async () => {
    const port = await refusedPort()
    const resolved = await resolveProvider(
      {
        v: 1,
        providers: [
          {
            id: 'loopdead',
            preset: 'ollama',
            address: `http://127.0.0.1:${String(port)}`,
            auth: 'none',
            models: ['dead-1'],
            privateNetwork: true,
          },
        ],
      },
      'loopdead',
      presetById,
      resolveEndpointHost,
    )
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    const probe = await probeProvider(
      globalThis.fetch,
      resolved.provider,
      undefined,
      resolveEndpointHost,
    )
    expect(probe.ok).toBe(false)
    if (probe.ok || probe.paid) return
    expect(probe.reason).toContain('ECONNREFUSED')
    expect(probe.reason).toContain('whether the request arrived is unknown')
    expect(probe.reason).not.toContain('could not be reached')
  })
})
