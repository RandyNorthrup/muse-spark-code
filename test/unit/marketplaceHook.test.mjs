// The badge Worker (infra/marketplace-hook) imports in Node: its counter routes
// run against a fake KV. The webhook needs the Workers runtime's
// crypto.subtle.timingSafeEqual and the downloads route calls public APIs, so
// neither runs here.
import { describe, expect, it } from 'vitest'
import worker from '../../infra/marketplace-hook/worker.js'

const HOST = 'https://muse-marketplace-hook.objectipy.workers.dev'

function stats(values) {
  return { get: async (key) => values[key] ?? null }
}

async function get(path, values = {}, method = 'GET') {
  return worker.fetch(
    new globalThis.Request(`${HOST}${path}`, { method }),
    { STATS: stats(values) },
    {},
  )
}

describe('marketplace hook badge Worker', () => {
  it('serves current app installs as purchased minus cancelled in both badge formats', async () => {
    const values = { app_installs: '1503', app_cancellations: '3' }
    const badgen = await get('/badgen/app-installs', values)
    expect(badgen.headers.get('cache-control')).toBe('public, max-age=300')
    expect(await badgen.json()).toEqual({
      subject: 'GitHub app installs',
      status: '1.5k',
      color: '3b6cf6',
    })
    const shields = await get('/shields/app-installs', values)
    expect(await shields.json()).toEqual({
      schemaVersion: 1,
      label: 'GitHub app installs',
      message: '1.5k',
      color: '3b6cf6',
    })
  })

  it('never shows a negative or unreadable install count', async () => {
    const reply = await get('/badgen/app-installs', {
      app_installs: 'garbage',
      app_cancellations: '2',
    })
    const body = await reply.json()
    expect(body.status).toBe('0')
  })

  it('answers unknown routes 404 and unknown methods 405', async () => {
    const missing = await get('/nope')
    const wrongMethod = await get('/badgen/downloads', {}, 'PUT')
    expect(missing.status).toBe(404)
    expect(wrongMethod.status).toBe(405)
  })
})
