// Landing-page templates become exact static version badges in each package.
// Public image requests belong only to this check (and CI's release refresher).
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ReadmeProcessor } from '@vscode/vsce/out/package.js'
import { JSDOM } from 'jsdom'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { parseFragment } from 'parse5'
import { z } from 'zod'
import { PNG } from 'pngjs'

const VERSION = z.string().regex(/^\d+\.\d+\.\d+$/)
const REQUEST_MS = 10_000
const RASTER = /\.(?:png|jpe?g|gif|webp|avif)$/i
const STATIC_VERSION = /^\/badge\/(Marketplace|Open%20VSX|npm|GitHub%20release)-v(.+)-[^/]+$/
const DYNAMIC_VERSION =
  /\/(?:vs-marketplace\/v|visual-studio-marketplace\/v|open-vsx\/(?:version|v)|npm\/v|github\/(?:release|v\/release))\//
const REPOSITORY_IMAGE_PREFIX =
  'https://raw.githubusercontent.com/RandyNorthrup/muse-spark-code/main/'
const PUBLIC_MAIN_TREE =
  'https://api.github.com/repos/RandyNorthrup/muse-spark-code/git/trees/main?recursive=1'
const MAIN_TREE = z.object({
  truncated: z.literal(false),
  tree: z.array(z.object({ path: z.string(), type: z.enum(['blob', 'tree', 'commit']) })),
})

async function publicMainFiles(fetcher) {
  const reply = await fetcher(PUBLIC_MAIN_TREE, {
    cache: 'no-store',
    signal: globalThis.AbortSignal.timeout(REQUEST_MS),
  })
  if (!reply.ok) throw new Error(`Public main tree HTTP ${reply.status}`)
  const tree = MAIN_TREE.parse(await reply.json())
  return new Set(tree.tree.filter((entry) => entry.type === 'blob').map((entry) => entry.path))
}

async function checkoutImage(root, url) {
  const relative = decodeURIComponent(url.slice(REPOSITORY_IMAGE_PREFIX.length))
  if (
    !/^[\w./-]+$/.test(relative) ||
    relative.split('/').some((part) => ['', '.', '..'].includes(part))
  ) {
    throw new Error(`Invalid checkout image path: ${url}`)
  }
  const bytes = await readFile(path.join(root, ...relative.split('/')))
  if (bytes.length === 0) throw new Error(`Empty checkout image: ${relative}`)
  if (/\.png$/i.test(relative)) PNG.sync.read(bytes)
  return relative
}

/** Parse real HTML/Markdown images, excluding examples in code spans/fences. */
export function readmeImageUrls(markdown) {
  const tree = fromMarkdown(markdown)
  const definitions = new Map()
  const urls = new Set()
  function walk(node, visit) {
    visit(node)
    const children = node.children ?? node.childNodes ?? []
    for (const child of children) walk(child, visit)
  }
  walk(tree, (node) => {
    if (node.type === 'definition') definitions.set(node.identifier, node.url)
  })
  walk(tree, (node) => {
    switch (node.type) {
      case 'image': {
        urls.add(node.url)
        break
      }
      case 'imageReference': {
        urls.add(definitions.get(node.identifier))
        break
      }
      case 'html': {
        walk(parseFragment(node.value), (element) => {
          if (element.tagName === 'img') {
            urls.add(element.attrs.find((attr) => attr.name === 'src')?.value ?? '')
          }
        })
        break
      }
    }
  })
  return [...urls]
}

export function isBadgeUrl(url) {
  return !RASTER.test(new URL(url).pathname)
}

export function renderPackageReadme(markdown, version) {
  const parsed = VERSION.parse(version)
  return markdown.replaceAll('{version}', () => parsed)
}

/** Validate source policy, vsce's actual pinned trust policy and public bytes. */
export async function checkReadmeBadges(documents, version, options = {}) {
  VERSION.parse(version)
  const skipReason = options.skipReason
  if (skipReason !== undefined && (typeof skipReason !== 'string' || !skipReason.trim())) {
    throw new Error('Badge network skip requires a named reason')
  }
  if (skipReason !== undefined && options.ci)
    throw new Error('Badge network skip is forbidden in CI')
  const images = new Set()
  const versionLabels = new Map()
  for (const { name, markdown, labels = [] } of documents) {
    const found = new Set()
    const trusted = []
    const markup = new JSDOM('')
    for (const source of readmeImageUrls(markdown)) {
      const url = z.url().parse(source)
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
        throw new Error(`${name}: image must use credential-free HTTPS: ${source}`)
      }
      images.add(url)
      if (!isBadgeUrl(url)) continue
      // Force extensionless service URLs through vsce's SVG trust guard too.
      const trustTarget = new URL(url)
      if (!trustTarget.pathname.endsWith('.svg')) trustTarget.pathname += '.svg'
      // Serialised by a DOM, which escapes the attribute itself.
      const image = markup.window.document.createElement('img')
      image.setAttribute('src', trustTarget.href)
      trusted.push(image.outerHTML)
      if (labels.length === 0) continue
      if (DYNAMIC_VERSION.test(parsed.pathname)) {
        throw new Error(`${name}: dynamic version badge is forbidden: ${source}`)
      }
      const match = STATIC_VERSION.exec(parsed.pathname)
      if (match === null || parsed.hostname !== 'img.shields.io') continue
      const label = decodeURIComponent(match[1])
      if (match[2] !== version)
        throw new Error(`${name}: version mismatch: ${source}; expected ${version}`)
      found.add(label)
      versionLabels.set(url, label)
    }
    // No copied host allowlist: use the same processor that packages the VSIX.
    markup.window.close()
    await new ReadmeProcessor({}).onFile({
      path: 'extension/readme.md',
      contents: Buffer.from(trusted.join('\n')),
    })
    for (const label of labels) {
      if (!found.has(label)) throw new Error(`${name}: missing static ${label} version badge`)
    }
  }
  const checkout = new Map()
  if (options.repositoryRoot !== undefined) {
    for (const url of images) {
      if (url.startsWith(REPOSITORY_IMAGE_PREFIX) && !isBadgeUrl(url)) {
        checkout.set(url, await checkoutImage(options.repositoryRoot, url))
      }
    }
  }
  if (skipReason !== undefined) {
    return `Badges: ${images.size} HTTPS images; network skipped: ${skipReason}`
  }
  const fetcher = options.fetch ?? fetch
  const mainFiles = checkout.size === 0 ? new Set() : await publicMainFiles(fetcher)
  let localImages = 0
  for (const url of images) {
    const relative = checkout.get(url)
    if (relative !== undefined && !mainFiles.has(relative)) {
      localImages += 1
      continue
    }
    const reply = await fetcher(url, {
      cache: 'no-store',
      signal: globalThis.AbortSignal.timeout(REQUEST_MS),
    })
    if (!reply.ok) throw new Error(`Badge image HTTP ${reply.status}: ${url}`)
    if (reply.url && new URL(reply.url).protocol !== 'https:') {
      throw new Error(`Badge image redirected away from HTTPS: ${url}`)
    }
    if (!isBadgeUrl(url)) {
      if (!/^image\//i.test(reply.headers.get('content-type') ?? '')) {
        throw new Error(`Content image did not return an image: ${url}`)
      }
      await reply.body?.cancel()
      continue
    }
    if (!/^image\/svg\+xml\b/i.test(reply.headers.get('content-type') ?? '')) {
      throw new Error(`Badge did not return SVG: ${url}`)
    }
    const body = await reply.text()
    if (/<!DOCTYPE/i.test(body)) throw new Error(`Badge SVG contains a doctype: ${url}`)
    const dom = new JSDOM(body, { contentType: 'image/svg+xml' })
    try {
      const svg = dom.window.document.documentElement
      if (svg.localName !== 'svg' || svg.namespaceURI !== 'http://www.w3.org/2000/svg') {
        throw new Error(`Invalid SVG badge: ${url}`)
      }
      // Each text node apart: shields.io writes the label and the value as
      // adjacent <text> nodes, so the joined textContent runs them together
      // ("Marketplacev0.14.1v0.14.1") and no version stands alone in it.
      const walker = dom.window.document.createTreeWalker(svg, dom.window.NodeFilter.SHOW_TEXT)
      const pieces = []
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        pieces.push(node.nodeValue ?? '')
      }
      const text = pieces.join(' ')
      if (/\b(?:error|not found|retired|unavailable|invalid)\b/i.test(text)) {
        throw new Error(`Badge renders an error: ${url}`)
      }
      const label = versionLabels.get(url)
      if (label !== undefined) {
        const versions = text.match(/\bv?\d+\.\d+\.\d+\b/g) ?? []
        if (
          !text.includes(label) ||
          versions.every((value) => value.replace(/^v/, '') !== version)
        ) {
          throw new Error(`Badge rendered label/version mismatch: ${url}`)
        }
      }
    } finally {
      dom.window.close()
    }
  }
  return `Badges: ${images.size} HTTPS images; SVG badges and content images verified; ${localImages} new checkout images`
}

async function main() {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version
  const documents = [
    { name: 'README.md', markdown: readFileSync('README.md', 'utf8') },
    ...[
      ['docs/marketplace-readme.md', ['Marketplace', 'Open VSX']],
      ['docs/npm-readme.md', ['npm', 'GitHub release']],
    ].map(([name, labels]) => ({
      name,
      labels,
      markdown: renderPackageReadme(readFileSync(name, 'utf8'), version),
    })),
  ]
  const args = process.argv.slice(2)
  if (args.length > 0) {
    const [kind, stage] = args
    if (args.length !== 2 || !['--packaged-vsix', '--packaged-acp'].includes(kind)) {
      throw new Error('Expected --packaged-vsix <stage> or --packaged-acp <stage>')
    }
    const packagedVersion = JSON.parse(
      readFileSync(path.join(stage, 'package.json'), 'utf8'),
    ).version
    if (packagedVersion !== version) throw new Error('Staged manifest version mismatch')
    documents.push({
      name: path.join(stage, 'README.md'),
      markdown: readFileSync(path.join(stage, 'README.md'), 'utf8'),
      labels: kind === '--packaged-vsix' ? ['Marketplace', 'Open VSX'] : ['npm', 'GitHub release'],
    })
  }
  console.log(
    await checkReadmeBadges(documents, version, {
      skipReason: process.env.BADGE_CHECK_SKIP_NETWORK,
      ci: Boolean(process.env.CI),
      repositoryRoot: process.cwd(),
    }),
  )
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    await main()
  } catch (error) {
    console.error(`Badges: ${error.message}`)
    process.exitCode = 1
  }
}
