// Release-only, public requests. Cache refresh failures never undo publication.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'

const POLL_MS = 30_000
const PROPAGATION_MS = 15 * 60_000
const REQUEST_MS = 10_000
const VERSION = z.string().regex(/^v?\d+\.\d+\.\d+$/)
const GALLERY = z.object({
  results: z
    .array(
      z.object({
        extensions: z.array(
          z.object({
            publisher: z.object({ publisherName: z.string() }),
            extensionName: z.string(),
            versions: z.array(z.object({ version: VERSION })).min(1),
          }),
        ),
      }),
    )
    .min(1),
})
const OPEN_VSX = z.object({ version: VERSION })
const NPM = z.object({ 'dist-tags': z.object({ latest: VERSION }) })
const GITHUB = z.object({ tag_name: VERSION })

/** Exact hosts and HTTPS only; handle quoted/unquoted HTML src, entities and duplicates. */
export function imageUrls(html, hosts = ['badgen.net', 'img.shields.io']) {
  const urls = new Set()
  for (const [tag] of html.matchAll(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const source = tag
      .matchAll(/\s([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)
      .find(([, name]) => name.toLowerCase() === 'src')
    if (source === undefined) continue
    try {
      const url = new URL(
        (source[2] ?? source[3] ?? source[4]).replaceAll(/&(?:amp|#38|#x26);/gi, '&'),
      )
      if (
        url.protocol === 'https:' &&
        hosts.includes(url.hostname) &&
        !url.username &&
        !url.password
      ) {
        urls.add(url.href)
      }
    } catch {
      // Local and malformed images are not badge or camo URLs.
    }
  }
  return [...urls]
}

/** Compare stable release triplets numerically; accept GitHub's leading v. */
export function compareVersions(actual, expected) {
  const left = VERSION.parse(actual).replace(/^v/, '').split('.').map(Number)
  const right = VERSION.parse(expected).replace(/^v/, '').split('.').map(Number)
  for (const [index, part] of left.entries()) {
    if (part !== right[index]) return Math.sign(part - right[index])
  }
  return 0
}

function staleVersion(url, svg, version) {
  // Count/static badges do not represent the release version.
  if (
    !/\/(?:vs-marketplace\/v|open-vsx\/(?:version|v)|github\/(?:release|v\/release)|npm\/v|visual-studio-marketplace\/v)\//.test(
      new URL(url).pathname,
    )
  ) {
    return false
  }
  const text = svg.replaceAll(/<[^>]*>/g, ' ')
  const actual = /\bv?\d+\.\d+\.\d+\b/.exec(text)?.[0]
  if (actual === undefined) throw new Error('badge has no release version')
  return compareVersions(actual, version) < 0
}

export async function refreshReadmeBadges(manifest, readme, repository, deps = {}) {
  const fetcher = deps.fetch ?? fetch
  const sleep = deps.sleep ?? setTimeout
  const now = deps.now ?? Date.now
  const log = deps.log ?? console.log
  const warn = (message) => log(`::warning::README badges: ${message}`)
  const version = VERSION.parse(manifest.version)
  const { publisher, name } = manifest
  const extension = `${publisher}.${name}`
  const deadline = now() + PROPAGATION_MS
  async function request(url, options = {}, timeout = REQUEST_MS) {
    const reply = await fetcher(url, {
      ...options,
      cache: 'no-store',
      signal: globalThis.AbortSignal.timeout(Math.max(1, timeout)),
    })
    if (!reply.ok) throw new Error(`HTTP ${reply.status}`)
    return reply
  }
  const channels = new Map([
    [
      'Marketplace',
      async (timeout) => {
        const reply = await request(
          'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery',
          {
            method: 'POST',
            headers: {
              Accept: 'application/json;api-version=3.0-preview.1',
              'Content-Type': 'application/json',
            },
            // Pinned vsce PublicGalleryAPI: Name=7, IncludeVersions=1, IncludeLatestVersionOnly=512.
            body: JSON.stringify({
              filters: [
                { pageNumber: 1, pageSize: 1, criteria: [{ filterType: 7, value: extension }] },
              ],
              assetTypes: [],
              flags: 513,
            }),
          },
          timeout,
        )
        const extensions = GALLERY.parse(await reply.json()).results.flatMap(
          (result) => result.extensions,
        )
        return extensions.find(
          (entry) =>
            `${entry.publisher.publisherName}.${entry.extensionName}`.toLowerCase() ===
            extension.toLowerCase(),
        )?.versions[0].version
      },
    ],
    [
      'Open VSX',
      async (timeout) => {
        const reply = await request(
          `https://open-vsx.org/api/${encodeURIComponent(publisher)}/${encodeURIComponent(name)}`,
          {},
          timeout,
        )
        return OPEN_VSX.parse(await reply.json()).version
      },
    ],
    [
      'npm',
      async (timeout) => {
        const reply = await request('https://registry.npmjs.org/muse-spark-code-acp', {}, timeout)
        return NPM.parse(await reply.json())['dist-tags'].latest
      },
    ],
    [
      'GitHub',
      async (timeout) => {
        const reply = await request(
          `https://api.github.com/repos/${repository}/releases/latest`,
          {},
          timeout,
        )
        return GITHUB.parse(await reply.json()).tag_name
      },
    ],
  ])
  while (channels.size > 0 && now() < deadline) {
    await Promise.all(
      [...channels].map(async ([channel, latest]) => {
        try {
          const actual = await latest(Math.min(REQUEST_MS, deadline - now()))
          if (compareVersions(actual, version) === 0) {
            log(`${channel}: ${version} public`)
            channels.delete(channel)
          }
        } catch {
          log(`${channel}: public version unavailable; retrying within propagation deadline`)
        }
      }),
    )
    if (channels.size > 0) await sleep(Math.min(POLL_MS, Math.max(0, deadline - now())))
  }
  if (channels.size > 0)
    warn(`propagation deadline reached: ${channels.keys().toArray().join(', ')}`)

  const badges = imageUrls(readme)
  if (badges.length === 0) warn('README contains no supported badge URLs')
  for (const url of badges) {
    try {
      const reply = await request(url)
      const svg = await reply.text()
      log(`Badge GET ${url}: ${reply.status}`)
      if (!staleVersion(url, svg, version)) continue
      const busted = new URL(url)
      busted.searchParams.set('refresh', `${version}-${now()}`)
      const retryReply = await request(busted.href)
      const retry = await retryReply.text()
      if (staleVersion(url, retry, version)) warn(`cache-busted badge still stale: ${url}`)
      // The README uses the original URL, not the cache-busted variant.
      const originalReply = await request(url)
      const original = await originalReply.text()
      if (staleVersion(url, original, version)) warn(`original badge still stale: ${url}`)
      else log(`Badge refreshed: ${url}`)
    } catch {
      warn(`badge request failed or version unreadable: ${url}`)
    }
  }
  try {
    const pageReply = await request(`https://github.com/${repository}`)
    const page = await pageReply.text()
    const images = imageUrls(page, ['camo.githubusercontent.com'])
    if (images.length === 0) warn('repository page contains no camo image URLs')
    for (const url of images) {
      try {
        const reply = await fetcher(url, {
          method: 'PURGE',
          signal: globalThis.AbortSignal.timeout(REQUEST_MS),
        })
        log(`Camo PURGE ${url}: ${reply.status}`)
        if (!reply.ok) warn(`camo purge returned HTTP ${reply.status}: ${url}`)
      } catch {
        warn(`camo purge request failed: ${url}`)
      }
    }
  } catch {
    warn('repository page request failed')
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    await refreshReadmeBadges(
      JSON.parse(readFileSync('package.json', 'utf8')),
      readFileSync('README.md', 'utf8'),
      process.env.GITHUB_REPOSITORY ?? 'RandyNorthrup/muse-spark-code',
    )
  } catch {
    console.warn(
      '::warning::README badge refresh could not complete; published releases are unchanged',
    )
  }
}
