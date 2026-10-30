// Scan this computer's probes (src/host/providers/localProbe.ts) through
// the production fetch (fetchLoopback) against owned loopback: a refused
// connection and our own timeout read as unanswered; a 2xx answer reports
// with its snippet and any other status reads as unanswered. The probe's
// rethrow for a failure of the fetch itself stays for a non-conforming
// fetch; fetchLoopback's failures are all TypeErrors, so no real case
// reaches it.
import { describe, expect, it } from 'vitest'
import { fetchLoopback } from '../../src/host/providers/loopbackFetch'
import { probeLocalServers } from '../../src/host/providers/localProbe'
import { closedPort, httpEndpoint, silentPort } from './helpers/loopbackServers'

describe('probeLocalServers', () => {
  it('reads a refused loopback connection as unanswered', async () => {
    const port = await closedPort()
    const [result] = await probeLocalServers(
      [{ host: '127.0.0.1', port, path: '/' }],
      fetchLoopback,
      5000,
    )
    expect(result?.answered).toBe(false)
    expect(result?.status).toBe(undefined)
    expect(result?.snippet).toBe('')
  })

  it('reads our own timeout as unanswered', async () => {
    const silent = await silentPort()
    try {
      const [result] = await probeLocalServers(
        [{ host: '127.0.0.1', port: silent.port, path: '/' }],
        fetchLoopback,
        50,
      )
      expect(result?.answered).toBe(false)
      expect(result?.status).toBe(undefined)
      expect(silent.hits()).toBe(1)
    } finally {
      await silent.close()
    }
  })

  it('reports a 2xx answer with its snippet', async () => {
    const endpoint = await httpEndpoint((response) => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('hello')
    })
    try {
      const [result] = await probeLocalServers(
        [{ host: '127.0.0.1', port: endpoint.port, path: '/' }],
        fetchLoopback,
        5000,
      )
      expect(result?.answered).toBe(true)
      expect(result?.status).toBe(200)
      expect(result?.snippet).toBe('hello')
    } finally {
      await endpoint.close()
    }
  })

  it('reads a non-2xx answer as unanswered', async () => {
    const endpoint = await httpEndpoint((response) => {
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('nope')
    })
    try {
      const [result] = await probeLocalServers(
        [{ host: '127.0.0.1', port: endpoint.port, path: '/' }],
        fetchLoopback,
        5000,
      )
      expect(result?.answered).toBe(false)
      expect(result?.status).toBe(404)
      expect(result?.snippet).toBe('')
    } finally {
      await endpoint.close()
    }
  })
})
