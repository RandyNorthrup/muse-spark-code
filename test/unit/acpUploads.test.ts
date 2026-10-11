import * as acp from '@agentclientprotocol/sdk'
import { describe, expect, it, vi } from 'vitest'
import { createAcpAgent, type AcpAgentDeps } from '../../src/acp/agent'
import { AcpPaidUse } from '../../src/acp/paid'
import { runUploadsCommand, uploadsText, type AcpUploadsPort } from '../../src/acp/uploads'
import { UI_TEXT } from '../../src/shared/constants'
import { FakeAgentHost } from './helpers/fakeAgent'
import { memoryPaidGrants } from './helpers/paidGrants'

const report = {
  provider: 'meta',
  isReadOnly: false,
  poolBytes: 100,
  usedBytes: 15,
  files: [
    {
      fileId: 'file-one',
      name: 'clip.mp4',
      bytes: 3,
      expiresAt: 1_800_000_000,
      ours: true,
      sessions: [],
    },
    {
      fileId: 'file-other',
      name: 'other.pdf',
      bytes: 12,
      expiresAt: 1_800_000_000,
      ours: false,
      sessions: [],
    },
  ],
}

function fakePort(): AcpUploadsPort & {
  read: ReturnType<typeof vi.fn>
  deleteFile: ReturnType<typeof vi.fn>
  deleteAllOurs: ReturnType<typeof vi.fn>
} {
  return {
    read: vi.fn(() => Promise.resolve(report)),
    deleteFile: vi.fn(() => Promise.resolve()),
    deleteAllOurs: vi.fn(() => Promise.resolve()),
  }
}

function sentTexts(sent: string[]): string {
  return sent.join('\n')
}

describe('runUploadsCommand', () => {
  it('lists the ledger files, says empty, and ignores other text', async () => {
    const sent: string[] = []
    const files = fakePort()
    expect(
      await runUploadsCommand('/uploads', {
        files,
        send: (text) => {
          sent.push(text)
        },
      }),
    ).toBe('handled')
    expect(sentTexts(sent)).toContain('clip.mp4')
    expect(sentTexts(sent)).toContain('other.pdf')
    expect(await runUploadsCommand('/attach clip.mp4', { files, send: () => undefined })).toBe(
      'ignored',
    )
    files.read.mockResolvedValue({ ...report, files: [] })
    await runUploadsCommand('/uploads', {
      files,
      send: (text) => {
        sent.push(text)
      },
    })
    expect(sent.at(-1)).toBe(UI_TEXT.media.filesEmpty)
  })

  it('deletes the chosen own file and lists what remains', async () => {
    const sent: string[] = []
    const files = fakePort()
    expect(
      await runUploadsCommand('/uploads delete file-one', {
        files,
        send: (text) => {
          sent.push(text)
        },
      }),
    ).toBe('handled')
    expect(files.deleteFile).toHaveBeenCalledWith('file-one', expect.any(Function))
  })

  it('keeps a foreign file with its reason and deletes nothing', async () => {
    const sent: string[] = []
    const files = fakePort()
    expect(
      await runUploadsCommand('/uploads delete file-other', {
        files,
        send: (text) => {
          sent.push(text)
        },
      }),
    ).toBe('handled')
    expect(files.deleteFile).not.toHaveBeenCalled()
    expect(sentTexts(sent)).toContain('other.pdf')
  })

  it('deletes all ours, refuses unknown ids and bad syntax, and says so without a ledger', async () => {
    const files = fakePort()
    const sent: string[] = []
    await runUploadsCommand('/uploads delete-all', {
      files,
      send: (text) => {
        sent.push(text)
      },
    })
    expect(files.deleteAllOurs).toHaveBeenCalledOnce()
    await expect(
      runUploadsCommand('/uploads delete file-missing', { files, send: () => undefined }),
    ).rejects.toThrow('file-missing')
    await expect(
      runUploadsCommand('/uploads explode', { files, send: () => undefined }),
    ).rejects.toThrow(UI_TEXT.media.uploadsUsage)
    expect(files.deleteFile).not.toHaveBeenCalled()
    await expect(
      runUploadsCommand('/uploads', { files: undefined, send: () => undefined }),
    ).rejects.toThrow(UI_TEXT.media.filesEmpty)
    await expect(
      runUploadsCommand('/uploads delete-all', { files: undefined, send: () => undefined }),
    ).rejects.toThrow(UI_TEXT.media.filesEmpty)
  })

  it('shows a failed provider delete with its reason and keeps the row', async () => {
    const files = fakePort()
    files.deleteFile.mockRejectedValueOnce(new Error('Offline'))
    await expect(
      runUploadsCommand('/uploads delete file-one', { files, send: () => undefined }),
    ).rejects.toThrow('Offline')
    files.read.mockResolvedValue(report)
    const sent: string[] = []
    await runUploadsCommand('/uploads', {
      files,
      send: (text) => {
        sent.push(text)
      },
    })
    expect(sentTexts(sent)).toContain('clip.mp4')
  })

  it('renders the shared list text', () => {
    expect(uploadsText({ ...report, files: [] })).toBe(UI_TEXT.media.filesEmpty)
    expect(uploadsText(report)).toContain(UI_TEXT.media.uploadedFiles)
  })
})

function connectedUploads(uploads?: AcpUploadsPort) {
  const host = new FakeAgentHost()
  const updates: acp.SessionUpdate[] = []
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const deps: AcpAgentDeps = {
    ...(uploads !== undefined && { uploads }),
    questions: 'decline',
    backend: {
      kind: 'modelApi',
      readiness: () => Promise.resolve({ state: 'ready' }),
      hostFor: () => Promise.resolve(host),
    },
    version: 'uploads-test',
    options: { canBypass: false, allowsContributorModels: false, initialMode: 'manual' },
    signIn: {
      id: 'account-key',
      name: 'Account key',
      description: 'Test auth',
      args: [],
      command: 'test-auth',
    },
    defaultCwd: process.cwd(),
    paid: new AcpPaidUse({
      flagged: [],
      canRemember: () => false,
      grants: memoryPaidGrants(),
      log,
    }),
    log,
  }
  const agent = createAcpAgent(deps)
  const client = acp
    .client({ name: 'uploads-editor' })
    .onNotification('session/update', ({ params }) => {
      updates.push(params.update)
    })
  const texts = () =>
    updates.flatMap((update) =>
      update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text'
        ? [update.content.text]
        : [],
    )
  const run = async (op: (client: acp.ClientContext, id: string) => Promise<void>) => {
    await client.connectWith(agent, async (connection) => {
      await connection.request('initialize', {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      })
      const session = await connection.request('session/new', {
        cwd: process.cwd(),
        mcpServers: [],
      })
      await op(connection, session.sessionId)
    })
  }
  return { updates, texts, run }
}

describe('/uploads through the agent', () => {
  it('announces, lists and deletes through the ledger', async () => {
    const files = fakePort()
    const h = connectedUploads(files)
    await h.run(async (connection, id) => {
      await connection.request('session/prompt', {
        sessionId: id,
        prompt: [{ type: 'text', text: '/uploads' }],
      })
    })
    expect(h.texts().join('\n')).toContain('clip.mp4')
    const announced = h.updates.filter(
      (update) => update.sessionUpdate === 'available_commands_update',
    )
    expect(JSON.stringify(announced)).toContain('"uploads"')
    await h.run(async (connection, id) => {
      await connection.request('session/prompt', {
        sessionId: id,
        prompt: [{ type: 'text', text: '/uploads delete file-one' }],
      })
    })
    expect(files.deleteFile).toHaveBeenCalledWith('file-one', expect.any(Function))
  })

  it('says so and deletes nothing without the ledger', async () => {
    const h = connectedUploads(undefined)
    await expect(
      h.run(async (connection, id) => {
        await connection.request('session/prompt', {
          sessionId: id,
          prompt: [{ type: 'text', text: '/uploads' }],
        })
      }),
    ).rejects.toThrow(UI_TEXT.media.filesEmpty)
  })
})
