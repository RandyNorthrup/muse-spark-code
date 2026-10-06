import * as acp from '@agentclientprotocol/sdk'
import { describe, expect, it, vi } from 'vitest'
import { createAcpAgent, type AcpAgentDeps } from '../../src/acp/agent'
import { AcpPaidUse } from '../../src/acp/paid'
import { createAcpSharing, type AcpSharingPort } from '../../src/acp/sharing'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { FakeAgentHost } from './helpers/fakeAgent'
import { memoryPaidGrants } from './helpers/paidGrants'
import { until } from './helpers/acpWaits'
import { savedPromptFixture } from './helpers/sharingFixtures'
import { SHARING_CWD, sharingHarness } from './helpers/sharingCommands'

function acpHarness(sharing?: AcpSharingPort) {
  const host = new FakeAgentHost()
  const updates: acp.SessionUpdate[] = []
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const deps: AcpAgentDeps = {
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

async function observedReason(request: Promise<acp.PromptResponse>): Promise<string> {
  try {
    const response = await request
    return response.stopReason
  } catch {
    return 'error'
  }
}

describe('M118 ACP local commands over the SDK prompt path', () => {
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
    const local = sharingHarness()
    const answer = Promise.withResolvers<unknown>()
    local.ui.confirmShare.mockImplementation(() => answer.promise)
    const h = acpHarness(createAcpSharing(local.commands, () => local.ui))
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
})
