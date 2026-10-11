import { readFileSync } from 'node:fs'
import * as acp from '@agentclientprotocol/sdk'
import { build } from 'esbuild'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAcpAgent, type AcpAgentDeps } from '../../src/acp/agent'
import { AcpPaidUse } from '../../src/acp/paid'
import { createAcpSharing, isAcpSharingFailure, type AcpSharingPort } from '../../src/acp/sharing'
import { UI_TEXT } from '../../src/shared/constants'
import { EN, type UiText } from '../../src/shared/l10n/en'
import { fill, setUiText } from '../../src/shared/l10n/text'
import { FakeAgentHost } from './helpers/fakeAgent'
import { memoryPaidGrants } from './helpers/paidGrants'
import { until } from './helpers/acpWaits'
import { savedPromptFixture } from './helpers/sharingFixtures'
import { SHARING_CWD, sharingHarness } from './helpers/sharingCommands'

afterEach(() => {
  setUiText(EN, 'en')
})

function acpHarness(sharing?: AcpSharingPort) {
  const host = new FakeAgentHost()
  const updates: acp.SessionUpdate[] = []
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const deps: AcpAgentDeps = {
    questions: 'decline',
    backend: {
      kind: 'museCode',
      readiness: () => Promise.resolve({ state: 'ready' }),
      hostFor: () => Promise.resolve(host),
    },
    version: 'test',
    options: { canBypass: true, allowsContributorModels: false, initialMode: 'bypassPermissions' },
    signIn: { id: 'fake', name: 'Fake', description: 'Fake', args: [], command: 'fake' },
    defaultCwd: SHARING_CWD,
    log,
    paid: new AcpPaidUse({
      flagged: [],
      canRemember: () => false,
      grants: memoryPaidGrants(),
      log,
    }),
    ...(sharing !== undefined && { sharing }),
  }
  const agent = createAcpAgent(deps)
  const client = acp.client({ name: 'm118-test' }).onNotification('session/update', (context) => {
    updates.push(context.params.update)
  })
  return {
    host,
    updates,
    log,
    run: async (op: (client: acp.ClientContext, sessionId: string) => Promise<void>) => {
      await client.connectWith(agent, async (connection) => {
        await connection.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
        const { sessionId } = await connection.request('session/new', {
          cwd: SHARING_CWD,
          mcpServers: [],
        })
        await op(connection, sessionId)
      })
      for (const session of host.sessions) expect(session.sendTurn).not.toHaveBeenCalled()
    },
  }
}

function localPrompt(client: acp.ClientContext, sessionId: string, text: string) {
  return client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] })
}

/** A sharing prompt's rejection, captured for code/message/data assertions. */
async function refusedWire(
  client: acp.ClientContext,
  sessionId: string,
  text: string,
): Promise<unknown> {
  try {
    await localPrompt(client, sessionId, text)
  } catch (error: unknown) {
    return error
  }
  return undefined
}

/** The adapter's direct failure before the engine turns it into a RequestError. */
async function adapterShareFailure(port: AcpSharingPort): Promise<unknown> {
  try {
    await port.execute('/share chat', {
      cwd: SHARING_CWD,
      sessionId: 's',
      isActive: () => true,
      signal: new AbortController().signal,
    })
  } catch (error: unknown) {
    return error
  }
  return undefined
}

function expectAdapterFailure(
  failure: unknown,
  expected: { code: number; message: unknown },
): void {
  expect(isAcpSharingFailure(failure)).toBe(true)
  expect(failure).toMatchObject(expected)
}

function expectPrivateInternalFailure(failure: unknown, privateTexts: readonly string[]): void {
  expect(failure).toMatchObject({
    code: acp.RequestError.internalError().code,
    message: expect.stringContaining(UI_TEXT.actionFailed),
  })
  const wire = JSON.stringify(failure)
  for (const value of [...privateTexts, UI_TEXT.promptFileInvalid])
    expect(wire).not.toContain(value)
}

function expectSharingFaultLog(
  log: ReturnType<typeof acpHarness>['log'],
  privateTexts: readonly string[],
): void {
  expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('sharing command failed'))
  expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('TypeError'))
  const logged = JSON.stringify(log.warn.mock.calls)
  for (const value of ['AcpSharingFailure', ...privateTexts]) expect(logged).not.toContain(value)
}

/** A sharing prompt refused without a model turn, release or backend call. */
async function refusedPrompt(
  text: string,
  expected: { code: number; message?: unknown },
  setup?: (local: ReturnType<typeof sharingHarness>) => void,
) {
  const local = sharingHarness()
  setup?.(local)
  const h = acpHarness(createAcpSharing(local.commands, () => local.ui))
  await h.run(async (client, sessionId) => {
    await expect(localPrompt(client, sessionId, text)).rejects.toMatchObject(expected)
    expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
  })
  expect(local.release).not.toHaveBeenCalled()
  return local
}

function confirmationHarness() {
  const local = sharingHarness()
  const answer = Promise.withResolvers<unknown>()
  local.ui.confirmShare.mockImplementation(() => answer.promise)
  return { local, answer, h: acpHarness(createAcpSharing(local.commands, () => local.ui)) }
}

async function observedReason(request: Promise<acp.PromptResponse>): Promise<string> {
  try {
    const response = await request
    return response.stopReason
  } catch {
    return 'error'
  }
}

describe('M118 ACP local commands over the SDK prompt path', () => {
  it('cancels an uncooperative sharing port and immediately accepts another prompt', async () => {
    const pending = Promise.withResolvers<string>()
    const sharing = {
      commands: () => [],
      execute: vi.fn<AcpSharingPort['execute']>(() => pending.promise),
    }
    const h = acpHarness(sharing)
    await h.run(async (client, sessionId) => {
      let reason: string | undefined
      const response = (async () => {
        reason = await observedReason(localPrompt(client, sessionId, '/share chat'))
      })()
      await until(() => sharing.execute.mock.calls.length === 1)
      await client.notify('session/cancel', { sessionId })
      await until(() => reason !== undefined)
      expect(reason).toBe('cancelled')
      expect(sharing.execute.mock.calls[0]?.[1].signal.aborted).toBe(true)
      await response
      sharing.execute.mockResolvedValueOnce(UI_TEXT.promptLibrary)
      expect(await localPrompt(client, sessionId, '/prompt list')).toEqual({
        stopReason: 'end_turn',
      })
    })
  })
  it('announces local commands and saves/lists/inserts/shares without a model turn, in Bypass too', async () => {
    const local = sharingHarness()
    const h = acpHarness(createAcpSharing(local.commands, () => local.ui))
    await h.run(async (client, sessionId) => {
      expect(
        await localPrompt(client, sessionId, '/prompt save --title "My review" -- Exact\r\nbody'),
      ).toEqual({ stopReason: 'end_turn' })
      expect(local.write).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'My review', body: 'Exact\r\nbody' }),
      )
      await localPrompt(client, sessionId, '/prompt list --tag review')
      await localPrompt(client, sessionId, `/prompt use ${savedPromptFixture.id}`)
      await localPrompt(client, sessionId, '/share chat --mode full --format json')
      await localPrompt(client, sessionId, `/prompt share ${savedPromptFixture.id}`)
    })
    const announced = h.updates.find(
      (update) => update.sessionUpdate === 'available_commands_update',
    )
    expect(announced).toMatchObject({
      availableCommands: expect.arrayContaining([
        expect.objectContaining({ name: 'share', description: UI_TEXT.shareChat }),
        expect.objectContaining({ name: 'prompt', description: UI_TEXT.promptLibrary }),
      ]),
    })
    expect(JSON.stringify(h.updates)).toContain(UI_TEXT.promptScopeUser)
    expect(local.ui.insertPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'insert', send: false }),
      'Prepared text',
      expect.any(AbortSignal),
    )
    expect(local.release).toHaveBeenCalledTimes(2)
  })
  it('returns prepared text to a client without a composer, without sending it', async () => {
    const local = sharingHarness()
    const h = acpHarness(
      createAcpSharing(local.commands, () => ({
        showPreview: local.ui.showPreview,
        preparePrompt: local.ui.preparePrompt,
      })),
    )
    await h.run(async (client, sessionId) => {
      await localPrompt(client, sessionId, `/prompt use ${savedPromptFixture.id}`)
    })
    expect(JSON.stringify(h.updates)).toContain('Prepared text')
    expect(local.ui.insertPrompt).not.toHaveBeenCalled()
  })
  it.each([' ', '\t', '\n'])(
    'keeps whitespace-prefixed local commands off the backend: %j',
    async (prefix) => {
      const local = sharingHarness()
      const h = acpHarness(createAcpSharing(local.commands, () => local.ui))
      await h.run(async (client, sessionId) => {
        h.host.sessions[0]!.sendTurn.mockRejectedValue(new Error('backend must never run'))
        for (const command of [
          '/prompt list',
          '/prompt save --title Review -- Private body\r\n',
          '/share chat',
        ]) {
          expect(await localPrompt(client, sessionId, `${prefix}${command}`)).toEqual({
            stopReason: 'end_turn',
          })
        }
      })
      expect(local.write).toHaveBeenCalledWith(
        expect.objectContaining({ body: 'Private body\r\n' }),
      )
      expect(local.release).toHaveBeenCalledTimes(1)
    },
  )
  it.each([' ', '\t', '\n'])(
    'reserves whitespace-prefixed local commands without a binding: %j',
    async (prefix) => {
      const h = acpHarness()
      await h.run(async (client, sessionId) => {
        h.host.sessions[0]!.sendTurn.mockRejectedValue(new Error('backend must never run'))
        for (const command of ['/share chat', '/prompt list']) {
          await expect(localPrompt(client, sessionId, `${prefix}${command}`)).rejects.toThrow(
            fill(UI_TEXT.acpUnknownArgument, { argument: command.split(' ', 1)[0] ?? '' }),
          )
        }
      })
    },
  )
  it('reserves local names against skills and fails explicitly when runtime binding is absent', async () => {
    const h = acpHarness()
    await h.run(async (client, sessionId) => {
      const session = h.host.sessions[0]!
      session.skills = [
        {
          selector: 'share',
          displayName: 'shadow',
          description: 'shadow',
          argumentHint: undefined,
        },
      ]
      await expect(localPrompt(client, sessionId, '/share chat')).rejects.toThrow(
        fill(UI_TEXT.acpUnknownArgument, { argument: '/share' }),
      )
      await expect(localPrompt(client, sessionId, '/prompt list')).rejects.toThrow(
        fill(UI_TEXT.acpUnknownArgument, { argument: '/prompt' }),
      )
    })
    expect(JSON.stringify(h.updates)).not.toContain('shadow')
  })
  it('still advertises local commands when backend skills cannot be listed', async () => {
    const local = sharingHarness()
    const h = acpHarness(createAcpSharing(local.commands, () => local.ui))
    await h.run(async (client, sessionId) => {
      h.host.sessions[0]!.listSkills.mockRejectedValue(new Error('no skill catalog'))
      await localPrompt(client, sessionId, '/prompt list')
    })
    expect(h.updates).toContainEqual(
      expect.objectContaining({
        sessionUpdate: 'available_commands_update',
        availableCommands: expect.arrayContaining([expect.objectContaining({ name: 'prompt' })]),
      }),
    )
  })
  it.each([
    '/share chat --format pdf',
    '/share chat other-session',
    '/prompt run p1',
    '/prompt save --title Review',
    '/prompt use p1 --cwd /elsewhere',
  ])('refuses invalid input instead of submitting it: %s', async (text) => {
    const local = sharingHarness()
    const h = acpHarness(createAcpSharing(local.commands, () => local.ui))
    await h.run(async (client, sessionId) => {
      await expect(localPrompt(client, sessionId, text)).rejects.toThrow()
    })
    expect(local.write).not.toHaveBeenCalled()
    expect(local.release).not.toHaveBeenCalled()
  })
  describe('sharing refusals read honestly, never as internal error (DFACPERR)', () => {
    const refused = acp.RequestError.invalidRequest().code
    const badParams = acp.RequestError.invalidParams().code
    it('refuses an empty conversation share with the CLI sentence', async () => {
      await refusedPrompt(
        '/share chat',
        { code: refused, message: expect.stringContaining(UI_TEXT.exportNothing) },
        (local) => {
          local.renderPreview.mockRejectedValueOnce(new Error(UI_TEXT.exportNothing))
        },
      )
    })
    it('refuses a share in a confidential workspace as invalid request', async () => {
      await refusedPrompt(
        '/share chat',
        { code: refused, message: expect.stringContaining(UI_TEXT.shareConfidential) },
        (local) => {
          local.setConfidential(true)
        },
      )
    })
    it.each(['/share chat --format pdf', '/prompt run p1', '/prompt save --title Review'])(
      'refuses bad arguments as invalid params: %s',
      async (text) => {
        const local = await refusedPrompt(text, { code: badParams })
        expect(local.write).not.toHaveBeenCalled()
      },
    )
    it("refuses another session's chat as invalid params", async () => {
      await refusedPrompt('/share chat other-session', {
        code: badParams,
        message: expect.stringContaining(
          fill(UI_TEXT.acpUnknownArgument, { argument: 'other-session' }),
        ),
      })
    })
    it.each([
      ['/share chat --exported-at yesterday', '--exported-at'],
      ['/share chat --attachment-content ""', '--attachment-content'],
      ['/prompt save --title Good --tag "" -- body', '--tag'],
    ])('refuses caller-owned validation as invalid params naming %s', async (text, flag) => {
      // The mini-zod schemas read these flags; their English diagnostics and
      // any quoted caller values never reach the client.
      const local = await refusedPrompt(text, {
        code: badParams,
        message: expect.stringContaining(fill(UI_TEXT.acpUnknownArgument, { argument: flag })),
      })
      expect(local.write).not.toHaveBeenCalled()
      expect(local.release).not.toHaveBeenCalled()
    })
    it('fails refusals as bundle-crossing failures the engine maps, never SDK errors', async () => {
      const local = sharingHarness()
      local.renderPreview.mockRejectedValueOnce(new Error(UI_TEXT.exportNothing))
      const port = createAcpSharing(local.commands, () => local.ui)
      const failure = await adapterShareFailure(port)
      expectAdapterFailure(failure, {
        code: acp.RequestError.invalidRequest().code,
        message: expect.stringContaining(UI_TEXT.exportNothing),
      })
      expect(failure).not.toBeInstanceOf(acp.RequestError)
    })
    it('maps an independently bundled sharing copy to its code, not internal error', async () => {
      // The shipped split: the lazy sharing bundle carries its own failure
      // class copy, so the engine reads name and code, never `instanceof`.
      const bundled = await build({
        entryPoints: ['src/acp/sharing.ts'],
        bundle: true,
        platform: 'node',
        format: 'esm',
        write: false,
        logLevel: 'silent',
      })
      const source = bundled.outputFiles[0]?.text ?? ''
      expect(source).not.toContain('"RequestError"')
      const module = (await import(
        `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
      )) as {
        createAcpSharing: typeof createAcpSharing
      }
      const foreign = module.createAcpSharing(
        {
          execute: () => Promise.reject(new Error(UI_TEXT.exportNothing)),
        } as unknown as Parameters<typeof createAcpSharing>[0],
        () => ({
          showPreview: () => Promise.resolve(),
        }),
      )
      const h = acpHarness(foreign)
      await h.run(async (client, sessionId) => {
        await expect(localPrompt(client, sessionId, '/share chat')).rejects.toMatchObject({
          code: acp.RequestError.invalidRequest().code,
          message: expect.stringContaining(UI_TEXT.exportNothing),
        })
        expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
      })
    })
    it('keeps an unexpected sharing failure internal with no path or prompt text', async () => {
      const secret = 'lstat failed under /home/someone/private for sentinel-prompt-text'
      const local = sharingHarness()
      local.renderPreview.mockRejectedValueOnce(new TypeError(secret))
      const h = acpHarness(createAcpSharing(local.commands, () => local.ui))
      await h.run(async (client, sessionId) => {
        const failure = await refusedWire(client, sessionId, '/share chat')
        expectPrivateInternalFailure(failure, ['/home/someone', 'sentinel-prompt-text'])
      })
      expect(local.release).not.toHaveBeenCalled()
      expectSharingFaultLog(h.log, ['/home/someone', 'sentinel-prompt-text'])
    })
    it('carries the original fault as cause on an internal sharing failure', async () => {
      const fault = new TypeError('lstat failed under /home/someone/private')
      const local = sharingHarness()
      local.renderPreview.mockRejectedValueOnce(fault)
      const port = createAcpSharing(local.commands, () => local.ui)
      const failure = await adapterShareFailure(port)
      expectAdapterFailure(failure, {
        code: acp.RequestError.internalError().code,
        message: UI_TEXT.actionFailed,
      })
      if (!isAcpSharingFailure(failure)) throw new Error('Missing sharing failure')
      expect(failure.cause).toBe(fault)
    })
    it('keeps a prompt-store failure internal with no raw text', async () => {
      const local = sharingHarness()
      local.storageFor.mockImplementationOnce(() => ({
        list: () => Promise.reject(new TypeError('readdir /home/someone/prompts: denied')),
        write: local.write,
        remove: () => Promise.reject(new Error('unused remove in fake')),
      }))
      const h = acpHarness(createAcpSharing(local.commands, () => local.ui))
      await h.run(async (client, sessionId) => {
        const failure = await refusedWire(client, sessionId, '/prompt list')
        expectPrivateInternalFailure(failure, ['/home/someone'])
      })
      expectSharingFaultLog(h.log, ['/home/someone'])
    })
    it.each([['/share chat --typo'], [String.raw`/share "a\xb"`]])(
      'refuses bad slash syntax in the installed language: %s',
      async (text) => {
        const table = JSON.parse(
          readFileSync(new URL('../../l10n/ui.de.json', import.meta.url), 'utf8'),
        ) as UiText
        setUiText(table, 'de')
        try {
          // Node's "Unknown option" and JSON quote diagnostics never surface.
          await refusedPrompt(text, {
            code: badParams,
            message: expect.stringContaining(fill(UI_TEXT.acpUnknownArgument, { argument: text })),
          })
        } finally {
          setUiText(EN, 'en')
        }
      },
    )
  })
  it('rejects mixed/attached content in a local command', async () => {
    const local = sharingHarness()
    const h = acpHarness(createAcpSharing(local.commands, () => local.ui))
    await h.run(async (client, sessionId) => {
      await expect(
        client.request('session/prompt', {
          sessionId,
          prompt: [
            { type: 'text', text: '/prompt list' },
            { type: 'text', text: '' },
          ],
        }),
      ).rejects.toThrow()
    })
  })
  it.each(['cancel', 'close', 'reload', 'exit'])(
    'invalidates the pending final action on session %s',
    async (ending) => {
      const local = sharingHarness()
      const answer = Promise.withResolvers<unknown>()
      local.ui.confirmShare.mockImplementation(() => answer.promise)
      let isActive: (() => boolean) | undefined
      const h = acpHarness(
        createAcpSharing(local.commands, (context) => {
          isActive = context.isActive
          return local.ui
        }),
      )
      await h.run(async (client, sessionId) => {
        const response = observedReason(localPrompt(client, sessionId, '/share chat'))
        let reason: string | undefined
        void response.then((value) => {
          reason = value
        })
        await until(() => local.ui.confirmShare.mock.calls.length === 1)
        switch (ending) {
          case 'cancel': {
            await client.notify('session/cancel', { sessionId })
            break
          }
          case 'close': {
            await client.request('session/close', { sessionId })
            break
          }
          case 'reload': {
            await client.request('session/load', { sessionId, cwd: SHARING_CWD, mcpServers: [] })
            break
          }
          case 'exit': {
            h.host.exit('fake backend exit')
            break
          }
        }
        // notify() acknowledges sending, not the remote cancellation handler.
        await until(() => isActive?.() === false)
        await until(() => reason !== undefined)
        expect(reason).toBe(ending === 'exit' ? 'error' : 'cancelled')
        const preview = local.ui.confirmShare.mock.calls[0]![0]
        answer.resolve({
          step: 'confirmed',
          previewId: preview.previewId,
          request: preview.request,
        })
        expect(await response).toBe(ending === 'exit' ? 'error' : 'cancelled')
      })
      expect(local.release).not.toHaveBeenCalled()
    },
  )
  it('holds the session busy through the final confirmation', async () => {
    const { local, answer, h } = confirmationHarness()
    await h.run(async (client, sessionId) => {
      const response = localPrompt(client, sessionId, '/share chat')
      await until(() => local.ui.confirmShare.mock.calls.length === 1)
      await expect(localPrompt(client, sessionId, '/prompt list')).rejects.toThrow(
        UI_TEXT.acpPromptBusy,
      )
      answer.resolve(undefined)
      expect(await response).toEqual({ stopReason: 'end_turn' })
    })
    expect(local.release).not.toHaveBeenCalled()
  })
  it('keeps a newer local prompt busy when an older cancelled preparation finishes', async () => {
    const { local, answer, h } = confirmationHarness()
    const skills = Promise.withResolvers<[]>()
    await h.run(async (client, sessionId) => {
      h.host.sessions[0]!.listSkills.mockImplementationOnce(() => skills.promise)
      const old = localPrompt(client, sessionId, '/prompt list')
      await until(() => h.host.sessions[0]!.listSkills.mock.calls.length === 1)
      await client.notify('session/cancel', { sessionId })
      await until(() =>
        h.log.info.mock.calls.some(
          ([text]) => typeof text === 'string' && text.includes('cancelled before'),
        ),
      )
      const current = observedReason(localPrompt(client, sessionId, '/share chat'))
      await until(() => local.ui.confirmShare.mock.calls.length === 1)
      skills.resolve([])
      expect(await old).toEqual({ stopReason: 'cancelled' })
      await expect(localPrompt(client, sessionId, '/prompt list')).rejects.toThrow(
        UI_TEXT.acpPromptBusy,
      )
      answer.resolve(undefined)
      expect(await current).toBe('end_turn')
    })
  })
  it.each(['preview', 'confirm', 'prepare', 'insert'] as const)(
    'cancels pending %s UI and frees the session without resolving the UI',
    async (stage) => {
      const local = sharingHarness()
      const pending = Promise.withResolvers<undefined>()
      const ui = {
        preview: local.ui.showPreview,
        confirm: local.ui.confirmShare,
        prepare: local.ui.preparePrompt,
        insert: local.ui.insertPrompt,
      }[stage]
      ui.mockImplementation(() => pending.promise)
      let isActive: (() => boolean) | undefined
      let signal: AbortSignal | undefined
      const h = acpHarness(
        createAcpSharing(local.commands, (context) => {
          isActive = context.isActive
          signal = context.signal
          return local.ui
        }),
      )
      await h.run(async (client, sessionId) => {
        let reason: string | undefined
        const response = (async () => {
          reason = await observedReason(
            localPrompt(
              client,
              sessionId,
              stage === 'preview' || stage === 'confirm'
                ? '/share chat'
                : `/prompt use ${savedPromptFixture.id}`,
            ),
          )
        })()
        await until(() => ui.mock.calls.length === 1)
        await client.notify('session/cancel', { sessionId })
        await until(() => isActive?.() === false)
        await until(() => reason !== undefined)
        expect(reason).toBe('cancelled')
        expect(signal?.aborted).toBe(true)
        await response
        expect(await localPrompt(client, sessionId, '/prompt list')).toEqual({
          stopReason: 'end_turn',
        })
      })
      expect(local.release).not.toHaveBeenCalled()
    },
  )
})
