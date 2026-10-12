import { describe, expect, it, vi } from 'vitest'
import { runUploadsCommand, uploadsText, type AcpUploadsPort } from '../../src/acp/uploads'
import { UI_TEXT } from '../../src/shared/constants'
import { fakeUploadedFilesLedger, uploadedFilesReportFixture } from './helpers/uploadedFiles'
import { connectedAgent } from './helpers/acpConnected'
import { until } from './helpers/acpWaits'

const report = uploadedFilesReportFixture()

function fakePort() {
  return fakeUploadedFilesLedger(report)
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
    expect(files.deleteFile).toHaveBeenCalledWith('file-one', expect.any(Function), undefined)
  })

  it('deletes by listed number and shows the id the delete needs', async () => {
    const sent: string[] = []
    const files = fakePort()
    await runUploadsCommand('/uploads', {
      files,
      send: (text) => {
        sent.push(text)
      },
    })
    expect(sentTexts(sent)).toContain('file-one')
    expect(sentTexts(sent)).toContain('file-other')
    expect(await runUploadsCommand('/uploads delete 1', { files, send: () => undefined })).toBe(
      'handled',
    )
    expect(files.deleteFile).toHaveBeenCalledWith('file-one', expect.any(Function), undefined)
    await expect(
      runUploadsCommand('/uploads delete 9', { files, send: () => undefined }),
    ).rejects.toThrow('9')
    expect(files.deleteFile).toHaveBeenCalledTimes(1)
  })

  it('refuses zero and other invalid one-based selectors with a sentence', async () => {
    // Finding 3: `/uploads delete 0` wrapped to the last listed file
    // through Array.at(-1). Every non-listed number is refused instead.
    const files = fakePort()
    for (const selector of ['0', '00', '007', '99999999999999999999999']) {
      await expect(
        runUploadsCommand(`/uploads delete ${selector}`, { files, send: () => undefined }),
      ).rejects.toThrow()
    }
    expect(files.deleteFile).not.toHaveBeenCalled()
    // Zero is not a listed number: the usage sentence, not a delete.
    await expect(
      runUploadsCommand('/uploads delete 0', { files, send: () => undefined }),
    ).rejects.toThrow(UI_TEXT.media.uploadsUsage)
    // A well-formed number past the list names what is missing.
    await expect(
      runUploadsCommand('/uploads delete 9', { files, send: () => undefined }),
    ).rejects.toThrow('9')
    expect(files.deleteFile).not.toHaveBeenCalled()
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

  it('deletes a foreign file the confirmer allows', async () => {
    const files = fakePort()
    const confirmForeign = vi.fn(() => Promise.resolve(true))
    expect(
      await runUploadsCommand('/uploads delete file-other', {
        files,
        send: () => undefined,
        confirmForeign,
      }),
    ).toBe('handled')
    expect(confirmForeign).toHaveBeenCalledWith('other.pdf')
    expect(files.deleteFile).toHaveBeenCalledWith('file-other', expect.any(Function), undefined)
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

describe('runUploadsCommand cancellation', () => {
  it('deletes nothing when cancelled before the read', async () => {
    const files = fakePort()
    const controller = new AbortController()
    controller.abort()
    const signal = controller.signal
    await expect(
      runUploadsCommand('/uploads delete file-one', { files, send: () => undefined, signal }),
    ).rejects.toThrow()
    await expect(
      runUploadsCommand('/uploads delete-all', { files, send: () => undefined, signal }),
    ).rejects.toThrow()
    await expect(
      runUploadsCommand('/uploads', { files, send: () => undefined, signal }),
    ).rejects.toThrow()
    expect(files.read).not.toHaveBeenCalled()
    expect(files.deleteFile).not.toHaveBeenCalled()
    expect(files.deleteAllOurs).not.toHaveBeenCalled()
  })

  it('deletes nothing when cancelled during the report read', async () => {
    const files = fakePort()
    const controller = new AbortController()
    files.read.mockImplementationOnce(() => {
      // As session/cancel does: the in-flight read finishes after the abort.
      return new Promise<typeof report>((resolve) => {
        controller.signal.addEventListener(
          'abort',
          () => {
            resolve(report)
          },
          { once: true },
        )
      })
    })
    const pending = runUploadsCommand('/uploads delete file-one', {
      files,
      send: () => undefined,
      signal: controller.signal,
    })
    await until(() => files.read.mock.calls.length > 0)
    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(files.deleteFile).not.toHaveBeenCalled()
  })

  it('passes the signal into the provider delete', async () => {
    const files = fakePort()
    const controller = new AbortController()
    await runUploadsCommand('/uploads delete file-one', {
      files,
      send: () => undefined,
      signal: controller.signal,
    })
    expect(files.deleteFile).toHaveBeenCalledWith(
      'file-one',
      expect.any(Function),
      controller.signal,
    )
    await runUploadsCommand('/uploads delete-all', {
      files,
      send: () => undefined,
      signal: controller.signal,
    })
    expect(files.deleteAllOurs).toHaveBeenCalledWith(controller.signal)
  })
})

function connectedUploads(uploads?: AcpUploadsPort) {
  const h = connectedAgent({
    editor: 'uploads-editor',
    version: 'uploads-test',
    ...(uploads !== undefined && { extra: { uploads } }),
  })
  const texts = () =>
    h.updates.flatMap((update) =>
      update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text'
        ? [update.content.text]
        : [],
    )
  return { ...h, texts }
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
    expect(files.deleteFile).toHaveBeenCalledWith(
      'file-one',
      expect.any(Function),
      expect.any(AbortSignal),
    )
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

  it('confirms and deletes a foreign file through the editor permission', async () => {
    const files = fakePort()
    const asked: unknown[] = []
    const h = connectedAgent({
      editor: 'uploads-editor',
      version: 'uploads-test',
      extra: { uploads: files },
      answerPermission: (params) => {
        asked.push(params)
        return { outcome: { outcome: 'selected', optionId: 'uploads-foreign-allow' } }
      },
    })
    await h.run(async (connection, id) => {
      const answer = await connection.request('session/prompt', {
        sessionId: id,
        prompt: [{ type: 'text', text: '/uploads delete file-other' }],
      })
      expect(answer.stopReason).toBe('end_turn')
    })
    expect(files.deleteFile).toHaveBeenCalledWith(
      'file-other',
      expect.any(Function),
      expect.any(AbortSignal),
    )
    // The editor was asked with the same question VS Code dialogs.
    expect(JSON.stringify(asked)).toContain('other.pdf')
  })

  it('keeps a foreign file when the editor cannot answer the permission', async () => {
    const files = fakePort()
    const h = connectedUploads(files)
    await h.run(async (connection, id) => {
      const answer = await connection.request('session/prompt', {
        sessionId: id,
        prompt: [{ type: 'text', text: '/uploads delete file-other' }],
      })
      expect(answer.stopReason).toBe('end_turn')
    })
    expect(files.deleteFile).not.toHaveBeenCalled()
    expect(h.texts().join('\n')).toContain('other.pdf')
  })

  it('cancels a delete held on its report read without touching the provider', async () => {
    const files = fakePort()
    // Only the delete's own read holds, on a gate this test owns: later
    // reads answer at once, so the test can never hang on them. The gate
    // opens only after the agent logged the cancel: finishing the read
    // earlier lets the command reach its post-delete listing read first,
    // before the cancel it must obey.
    let isFirstRead = true
    const gate = new AbortController()
    files.read.mockImplementation(() => {
      if (!isFirstRead) return Promise.resolve(report)
      isFirstRead = false
      return new Promise<typeof report>((resolve) => {
        gate.signal.addEventListener(
          'abort',
          () => {
            resolve(report)
          },
          { once: true },
        )
      })
    })
    const h = connectedUploads(files)
    await h.run(async (connection, id) => {
      const prompt = connection.request('session/prompt', {
        sessionId: id,
        prompt: [{ type: 'text', text: '/uploads delete file-one' }],
      })
      // Wait until the delete holds its report read, then cancel as the
      // editor's session/cancel does.
      await until(() => files.read.mock.calls.length > 0)
      await connection.notify('session/cancel', { sessionId: id })
      await until(() =>
        h.log.info.mock.calls.some(([line]) => String(line).includes('cancelled before its turn')),
      )
      gate.abort()
      const answer = await prompt
      expect(answer.stopReason).toBe('cancelled')
    })
    expect(files.deleteFile).not.toHaveBeenCalled()
    expect(files.deleteAllOurs).not.toHaveBeenCalled()
  })
})
