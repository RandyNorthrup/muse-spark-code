// A loopback server for the desktop scenes: `/desktop-scene/<id>` renders
// from the contracts, tokens and language tables; every other path serves
// repository files (the token CSS and the scene CSS), never outside it.
// scripts/lib/harnessServer.mjs mounts the same route for the screenshot
// harness; this standalone server keeps desktop captures free of the chat
// harness's bundle build.

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { desktopSceneHtml, parseSceneRequest } from './scenes.mjs'

export const LOOPBACK = '127.0.0.1'

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
}

/** The rendered scene for a request URL, or undefined when it names no scene. */
export async function desktopSceneResponse(repoRoot, url) {
  const request = parseSceneRequest(url)
  if (request === undefined) return undefined
  try {
    return { status: 200, body: await desktopSceneHtml(repoRoot, request) }
  } catch (error) {
    return {
      status: 404,
      body: error instanceof Error ? error.message : 'the scene cannot be rendered',
    }
  }
}

/** Serves the desktop scenes and repository files on an unused loopback port. */
export async function serveDesktopScenes(repoRoot) {
  const root = path.resolve(repoRoot)
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${LOOPBACK}`)
    const scene = await desktopSceneResponse(root, url)
    if (scene !== undefined) {
      response.writeHead(scene.status, { 'content-type': 'text/html; charset=utf-8' })
      response.end(scene.body)
      return
    }
    const target = path.resolve(root, `.${decodeURIComponent(url.pathname)}`)
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end()
      return
    }
    try {
      const body = await readFile(target)
      response.writeHead(200, {
        'content-type': CONTENT_TYPES[path.extname(target)] ?? 'application/octet-stream',
      })
      response.end(body)
    } catch (error) {
      const isMissing = error instanceof Error && error.code === 'ENOENT'
      response.writeHead(isMissing ? 404 : 500).end()
    }
  })
  return await new Promise((resolve) => {
    server.listen(0, LOOPBACK, () => {
      resolve({ server, port: server.address().port })
    })
  })
}

/** The URL of one scene on a server from {@link serveDesktopScenes}. */
export function desktopSceneUrl(port, { scene, theme = 'dark', lang = 'en' }) {
  return `http://${LOOPBACK}:${String(port)}/desktop-scene/${encodeURIComponent(scene)}?theme=${encodeURIComponent(theme)}&lang=${encodeURIComponent(lang)}`
}
