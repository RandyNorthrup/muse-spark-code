// @vitest-environment jsdom
// M104 lane C: the packed `panel --companion`. The packed agent boots,
// prints its launch URL, and serves the real session over the MHP
// routes; the suite plays the window over HTTP (the exchange, the page,
// the stream, lifecycle, the ready question and its state) and proves
// the guards and the browser handoff from the outside. The browser never
// opens here: the main boot resolves no opener on its sterile PATH, and
// the handoff boot hands a recording stub. No provider, key or network
// is touched.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withDeadline } from '../../src/core/timeouts'
import { HTTP_STATUS, IDE_MCP_LOOPBACK_HOST } from '../../src/shared/constants'
import {
  panelBindingSchema,
  panelEnvelopeSchema,
  type MhpPanelBinding,
} from '../../src/shared/hostApi/panel'
import { hostToWebviewMessageSchema } from '../../src/shared/protocol'
import {
  call,
  envelope,
  expectGuardRefusal,
  expectPanelRefusal,
  lifecycle,
  openStream,
  panelHeaders,
  waitFor,
} from './helpers/companionWindow'
import { isolatedRuntimeEnvironment } from './helpers/isolatedRuntimeEnvironment'
import { removeFolder } from './helpers/temporaryFolders'

interface PackedPanel {
  readonly child: ChildProcessWithoutNullStreams
  readonly url: string
  readonly origin: string
  readonly token: string
  readonly exchangeStatus: number
  readonly pageBody: string
  readonly binding: MhpPanelBinding
  readonly folder: string
  stderr(): string
}

interface BootedPanel {
  readonly child: ChildProcessWithoutNullStreams
  readonly url: string
  stderr(): string
}

/** Boots the packed agent until it prints its launch URL, or fails loudly. */
async function bootPacked(
  folder: string,
  workspace: string,
  pathVariable: string,
): Promise<BootedPanel> {
  const child = spawn(
    process.execPath,
    [path.join(process.cwd(), 'dist', 'acp.js'), 'panel', '--companion', '--workspace', workspace],
    {
      cwd: workspace,
      env: {
        ...isolatedRuntimeEnvironment(path.join(folder, 'home'), folder),
        PATH: pathVariable,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let output = ''
  let errors = ''
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8')
  })
  child.stderr.on('data', (chunk: Buffer) => {
    errors += chunk.toString('utf8')
  })
  const exited = new Promise<number | null>((resolve) => {
    child.on('exit', (code) => {
      resolve(code)
    })
    child.on('error', () => {
      resolve(null)
    })
  })
  const announced = (async () => {
    for (;;) {
      const end = output.indexOf('\n')
      if (end !== -1) return output.slice(0, end)
      const code = await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10))])
      if (typeof code === 'number' || code === null)
        throw new Error(`the packed panel exited ${String(code)} before it announced: ${errors}`)
    }
  })()
  // The packed agent boots its session before it announces.
  const url = await withDeadline(announced, 30_000, 'the packed panel never announced its URL')
  return {
    child,
    url,
    stderr: () => errors,
  }
}

async function stopPacked(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  child.kill('SIGTERM')
  return await withDeadline(
    new Promise<number | null>((resolve) => {
      child.on('exit', (code) => {
        resolve(code)
      })
      child.on('error', () => {
        resolve(null)
      })
    }),
    10_000,
    'the packed panel ignored SIGTERM',
  )
}

function launchCode(url: string): { origin: string; code: string } {
  const parsed = new URL(url)
  return { origin: parsed.origin, code: parsed.hash.slice('#k='.length) }
}

describe('packed panel --companion (real agent, real session)', () => {
  let panel: PackedPanel | undefined

  // The packed agent boots its session before it announces.
  beforeAll(async () => {
    const folder = realpathSync(mkdtempSync(path.join(tmpdir(), 'panel-companion-packed-')))
    const workspace = path.join(folder, 'workspace')
    mkdirSync(workspace, { recursive: true })
    // The sterile PATH resolves no opener: the handoff fails fast and loud.
    const booted = await bootPacked(folder, workspace, path.dirname(process.execPath))
    const { origin, code } = launchCode(booted.url)
    const exchanged = await call(`${origin}/session`, {
      headers: panelHeaders(origin),
      body: JSON.stringify({ code }),
    })
    if (exchanged.status !== HTTP_STATUS.ok) {
      await stopPacked(booted.child)
      await removeFolder(folder)
      throw new Error(`the packed panel refused the exchange: ${String(exchanged.status)}`)
    }
    const authorization = exchanged.authorization ?? ''
    const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''
    if (token === '') {
      await stopPacked(booted.child)
      await removeFolder(folder)
      throw new Error('the packed panel exchanged no token')
    }
    const page = new DOMParser().parseFromString(exchanged.body, 'text/html')
    const embedded = page.querySelector('#muse-panel')?.textContent ?? ''
    const binding = panelBindingSchema.parse(JSON.parse(embedded))
    panel = {
      child: booted.child,
      url: booted.url,
      origin,
      token,
      exchangeStatus: exchanged.status,
      pageBody: exchanged.body,
      binding,
      folder,
      stderr: booted.stderr,
    }
  }, 30_000)

  afterAll(async () => {
    if (panel === undefined) return
    await stopPacked(panel.child)
    await removeFolder(panel.folder)
    panel = undefined
  })

  function use(): PackedPanel {
    if (panel === undefined) throw new Error('the packed panel is gone')
    return panel
  }

  it('announces its launch URL on loopback, and tries no browser it cannot reach', () => {
    const announced = new URL(use().url)
    expect(announced.hostname).toBe(IDE_MCP_LOOPBACK_HOST)
    expect(announced.hash).toMatch(/^#k=[\da-f]{64}$/)
    expect(use().stderr()).toContain('The browser did not open')
  })

  it('exchanges the launch code for the window’s page and binding', () => {
    const { token, exchangeStatus, pageBody, binding } = use()
    expect(exchangeStatus).toBe(HTTP_STATUS.ok)
    expect(token).toMatch(/^[\da-f]{64}$/)
    const page = new DOMParser().parseFromString(pageBody, 'text/html')
    expect(page.querySelector('#muse-modules')).not.toBeNull()
    expect(page.body.dataset['bridge']).toBe('companion')
    expect(page.body.dataset['surface']).toBe('chat')
    expect(binding.surface).toMatch(/^[\da-f]{64}$/)
    expect(binding.surfaceKind).toBe('chat')
  })

  it('streams the session’s state after the window’s ready question', async () => {
    const { origin, token, binding } = use()
    const stream = openStream(`${origin}/panel/events`, panelHeaders(origin, token))
    expect(await stream.opened).toBe(HTTP_STATUS.ok)
    try {
      for (const event of ['opened', 'ready'] as const) {
        const posted = await call(`${origin}/panel/surface`, {
          headers: panelHeaders(origin, token),
          body: lifecycle(binding, event),
        })
        expect(posted.status).toBe(HTTP_STATUS.noContent)
      }
      const asked = await call(`${origin}/panel/message`, {
        headers: panelHeaders(origin, token),
        body: envelope(binding.surface, { type: 'ready' }),
      })
      expect(asked.status).toBe(HTTP_STATUS.noContent)
      await waitFor(stream.frames, 6)
      const states = stream.frames.map((frame) => {
        const parsed = panelEnvelopeSchema.parse(frame)
        if (parsed.direction !== 'toPanel') throw new Error('the session wrote back upstream')
        return hostToWebviewMessageSchema.parse(parsed.payload).type
      })
      expect(states.at(0)).toBe('init')
      for (const type of [
        'init',
        'authState',
        'paidState',
        'surfaceState',
        'composerState',
        'gitState',
      ])
        expect(states).toContain(type)
    } finally {
      stream.close()
    }
  })

  it('refuses a post without the window’s token', async () => {
    const { origin, binding } = use()
    const refused = await call(`${origin}/panel/message`, {
      headers: panelHeaders(origin),
      body: envelope(binding.surface, { type: 'ready' }),
    })
    expectGuardRefusal(refused, HTTP_STATUS.unauthorized, 'EPANEL_BEARER')
  })

  it('refuses a post from another origin', async () => {
    const { origin, token, binding } = use()
    const refused = await call(`${origin}/panel/message`, {
      headers: { ...panelHeaders(origin, token), Origin: 'http://evil.test' },
      body: envelope(binding.surface, { type: 'ready' }),
    })
    expectGuardRefusal(refused, HTTP_STATUS.forbidden, 'EPANEL_ORIGIN')
  })

  it('refuses an envelope for a surface the window never opened', async () => {
    const { origin, token } = use()
    const refused = await call(`${origin}/panel/message`, {
      headers: panelHeaders(origin, token),
      body: envelope('no-such-surface', { type: 'ready' }),
    })
    expectPanelRefusal(refused, HTTP_STATUS.notFound, 'MHP_PANEL_UNKNOWN_SURFACE')
  })

  // Last: stops the shared child, so nothing after it may use the panel.
  it('exits 0 on SIGTERM', async () => {
    const { child, folder } = use()
    panel = undefined
    expect(await stopPacked(child)).toBe(0)
    await removeFolder(folder)
  })
})
