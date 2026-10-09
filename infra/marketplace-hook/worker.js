// Muse Spark Code: GitHub Marketplace webhook receiver + download badges.
//
// POST /            GitHub Marketplace webhook. Accepts only requests signed with the shared
//                   secret (X-Hub-Signature-256, HMAC-SHA256 over the raw body, constant-time
//                   compare). A verified marketplace_purchase "purchased" / "cancelled" adds 1
//                   to a plain counter; nothing else from the event (no account names) is
//                   stored or logged.
// GET /badgen/app-installs, /shields/app-installs
//                   Current GitHub app installs (purchased minus cancelled), for a README badge.
// GET /badgen/downloads   badgen.net JSON  {subject, status, color}
// GET /shields/downloads  shields.io JSON  {schemaVersion, label, message, color}
//                   Total downloads across every channel: VS Code Marketplace, Open VSX, npm
//                   (muse-spark-code-acp), GitHub Release assets, and GitHub app installs.
//                   Cached in KV for an hour so the public APIs are called at most hourly.

const REPO = 'RandyNorthrup/muse-spark-code'
const VSM_ID = 'RandyNorthrup.muse-spark-code'
const OVSX = 'RandyNorthrup/muse-spark-code'
const NPM = 'muse-spark-code-acp'
const NPM_FIRST_DAY = '2026-01-01'
const CACHE_SECONDS = 3600
const COLOR = '3b6cf6'

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/') return webhook(request, env)
    if (request.method === 'GET' && url.pathname === '/badgen/app-installs') {
      return json(
        { subject: 'GitHub app installs', status: compact(await appInstalls(env)), color: COLOR },
        300,
      )
    }
    if (request.method === 'GET' && url.pathname === '/shields/app-installs') {
      const n = await appInstalls(env)
      return json(
        { schemaVersion: 1, label: 'GitHub app installs', message: compact(n), color: COLOR },
        300,
      )
    }
    if (request.method === 'GET' && url.pathname === '/badgen/downloads') {
      const total = await totalDownloads(env, ctx)
      return json({
        subject: 'downloads',
        status: total === null ? 'n/a' : compact(total),
        color: COLOR,
      })
    }
    if (request.method === 'GET' && url.pathname === '/shields/downloads') {
      const total = await totalDownloads(env, ctx)
      return json({
        schemaVersion: 1,
        label: 'downloads',
        message: total === null ? 'n/a' : compact(total),
        color: COLOR,
      })
    }
    return new Response(null, { status: request.method === 'GET' ? 404 : 405 })
  },
}

async function webhook(request, env) {
  const secret = env.GITHUB_WEBHOOK_SECRET
  if (typeof secret !== 'string' || secret.length < 32) return new Response(null, { status: 500 })
  const body = await request.arrayBuffer()
  if (body.byteLength > 65_536) return new Response(null, { status: 413 })
  const header = request.headers.get('X-Hub-Signature-256') ?? ''
  if (!header.startsWith('sha256=')) return new Response(null, { status: 401 })
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, body))
  const given = hexToBytes(header.slice(7))
  if (given === null || !crypto.subtle.timingSafeEqual(mac, given)) {
    return new Response(null, { status: 401 })
  }
  const event = request.headers.get('X-GitHub-Event') ?? ''
  if (event === 'marketplace_purchase') {
    let action
    try {
      action = String(JSON.parse(new TextDecoder().decode(body)).action ?? '')
    } catch {
      return new Response(null, { status: 400 })
    }
    if (action === 'purchased') await bump(env, 'app_installs')
    else if (action === 'cancelled') await bump(env, 'app_cancellations')
  }
  return new Response(null, { status: 204 })
}

async function bump(env, key) {
  const now = Number((await env.STATS.get(key)) ?? '0')
  await env.STATS.put(key, String(Number.isFinite(now) ? now + 1 : 1))
}

// Current installs: every verified "purchased" minus every verified "cancelled".
async function appInstalls(env) {
  const installs = Number((await env.STATS.get('app_installs')) ?? '0')
  const cancelled = Number((await env.STATS.get('app_cancellations')) ?? '0')
  const n =
    (Number.isFinite(installs) ? installs : 0) - (Number.isFinite(cancelled) ? cancelled : 0)
  return Math.max(0, n)
}

async function totalDownloads(env, ctx) {
  const cached = await env.STATS.get('total_downloads', { type: 'json' })
  if (cached && Date.now() - cached.at < CACHE_SECONDS * 1000) return cached.total
  const parts = await Promise.allSettled([vsMarketplace(), openVsx(), npm(), githubReleases()])
  const installs = await appInstalls(env)
  if (parts.some((p) => p.status === 'rejected')) {
    // Never publish a smaller number because one source is down: keep the last good total.
    return cached ? cached.total : null
  }
  const total = parts.reduce((sum, p) => sum + p.value, 0) + installs
  ctx.waitUntil(env.STATS.put('total_downloads', JSON.stringify({ total, at: Date.now() })))
  return total
}

async function vsMarketplace() {
  const res = await fetch(
    'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json;api-version=7.2-preview.1',
      },
      body: JSON.stringify({
        filters: [{ criteria: [{ filterType: 7, value: VSM_ID }] }],
        flags: 914,
      }),
    },
  )
  if (!res.ok) throw new Error(`vsm ${res.status}`)
  const reply = await res.json()
  const stats = reply.results?.[0]?.extensions?.[0]?.statistics ?? []
  const row = stats.find((s) => s.statisticName === 'downloadCount')
  return wholeNumber(row?.value)
}

async function openVsx() {
  const res = await fetch(`https://open-vsx.org/api/${OVSX}`)
  if (!res.ok) throw new Error(`ovsx ${res.status}`)
  const reply = await res.json()
  return wholeNumber(reply.downloadCount)
}

async function npm() {
  // The downloads API answers at most 18 months per request: walk the history in 500-day steps.
  let total = 0
  const end = new Date()
  for (let start = new Date(`${NPM_FIRST_DAY}T00:00:00Z`); start <= end;) {
    const stop = new Date(Math.min(start.getTime() + 499 * 86_400_000, end.getTime()))
    const res = await fetch(
      `https://api.npmjs.org/downloads/point/${day(start)}:${day(stop)}/${NPM}`,
    )
    if (!res.ok) throw new Error(`npm ${res.status}`)
    const reply = await res.json()
    total += wholeNumber(reply.downloads)
    start = new Date(stop.getTime() + 86_400_000)
  }
  return total
}

async function githubReleases() {
  let total = 0
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases?per_page=100&page=${page}`,
      {
        headers: { 'User-Agent': 'muse-marketplace-hook', Accept: 'application/vnd.github+json' },
      },
    )
    if (!res.ok) throw new Error(`github ${res.status}`)
    const releases = await res.json()
    for (const r of releases) {
      const assets = r.assets ?? []
      for (const a of assets) total += wholeNumber(a.download_count)
    }
    if (releases.length < 100) break
  }
  return total
}

function wholeNumber(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) throw new Error('bad count')
  return Math.floor(n)
}

function day(d) {
  return d.toISOString().slice(0, 10)
}

function compact(n) {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

function json(obj, maxAge = CACHE_SECONDS) {
  return Response.json(obj, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${maxAge}` },
  })
}

function hexToBytes(hex) {
  if (hex.length !== 64 || !/^[0-9a-f]+$/.test(hex)) return null
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}
