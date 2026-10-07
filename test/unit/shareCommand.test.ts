import path from 'node:path'
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { parseSharingArgs, parseSharingSlash } from '../../src/runtime/sharing/args'
import { runSharingCommand, SharingCommands } from '../../src/runtime/sharing/commands'
import { UI_TEXT } from '../../src/shared/constants'
import { canonicalPath } from '../../src/host/canonicalPath'
import { savedPromptFixture, shareChatFixture } from './helpers/sharingFixtures'
import { SHARING_CWD, SHARING_TIME, sharingHarness } from './helpers/sharingCommands'
import { until } from './helpers/acpWaits'

async function expectRejectedPreview(h: ReturnType<typeof sharingHarness>): Promise<void> {
  await expect(
    h.commands.execute(parseSharingArgs(['share', 'chat', 's1']), h.context),
  ).rejects.toThrow()
  expect(h.ui.showPreview).not.toHaveBeenCalled()
  expect(h.release).not.toHaveBeenCalled()
}

function useWithoutReviewer(h: ReturnType<typeof sharingHarness>) {
  return h.commands.execute(parseSharingArgs(['prompts', 'use', savedPromptFixture.id]), {
    ...h.context,
    ui: { showPreview: h.ui.showPreview },
  })
}

function usePrompt(h: ReturnType<typeof sharingHarness>) {
  return h.commands.execute(parseSharingArgs(['prompts', 'use', savedPromptFixture.id]), h.context)
}

async function confirmHeadless(h: ReturnType<typeof sharingHarness>, argv: string[]) {
  const context = { ...h.context, ui: { showPreview: h.ui.showPreview } }
  const preview = await runSharingCommand(parseSharingArgs(argv), h.commands, context)
  if (preview.kind !== 'cancelled' || preview.preview === undefined)
    throw new Error('preview absent')
  return {
    preview: preview.preview,
    result: await runSharingCommand(
      parseSharingArgs([...argv, '--confirm', preview.preview.previewId]),
      h.commands,
      context,
    ),
  }
}

describe('M118 CLI/slash syntax', () => {
  it.each([
    ['copy', 'copy'],
    ['save', 'file'],
    ['open', 'browser'],
    ['file', 'file'],
    ['browser', 'browser'],
  ])('records an explicitly selected %s destination as %s', (flag, destination) => {
    expect(parseSharingArgs(['share', 'chat', 's1', '--destination', flag])).toMatchObject({
      destinationExplicit: true,
      request: { destination },
    })
    expect(parseSharingArgs(['share', 'chat', 's1'])).toMatchObject({ destinationExplicit: false })
  })
  it('routes only explicitly bound local commands and preserves existing serve behaviour', () => {
    expect(parseCommandLine(['share', 'chat', 's1'])).toMatchObject({ command: 'invalid' })
    expect(parseCommandLine(['prompts', 'list'])).toMatchObject({ command: 'invalid' })
    expect(parseCommandLine(['prompts', 'list'], parseSharingArgs)).toMatchObject({
      command: 'prompts',
      action: 'list',
    })
    expect(parseCommandLine(['share', 'chat', 's1', '--bad'], parseSharingArgs)).toMatchObject({
      command: 'invalid',
      exitCode: 2,
    })
    expect(parseCommandLine([])).toMatchObject({ command: 'serve' })
  })
  it('defaults to conversation, code blocks/names, no diffs/contents; carries ranges and formats', () => {
    expect(parseSharingArgs(['share', 'chat', 's1'])).toMatchObject({
      request: {
        target: 'chat',
        sessionId: 's1',
        mode: 'conversation',
        format: 'md',
        destination: 'copy',
        options: { codeBlocks: true, attachmentNames: true, diffs: false, attachmentContents: [] },
      },
    })
    expect(
      parseSharingArgs([
        'share',
        'chat',
        's1',
        '--from',
        'u1',
        '--to',
        'a1',
        '--mode',
        'full',
        '--format',
        'html',
        '--out',
        'share.html',
        '--diffs',
        '--no-code-blocks',
        '--no-attachment-names',
        '--attachment-content',
        'a1',
      ]),
    ).toMatchObject({
      out: 'share.html',
      request: {
        range: { from: 'u1', to: 'a1' },
        mode: 'full',
        format: 'html',
        destination: 'file',
        options: {
          codeBlocks: false,
          attachmentNames: false,
          diffs: true,
          attachmentContents: ['a1'],
        },
      },
    })
  })
  it.each([
    ['wrong', 'share', 'p1'],
    ['share'],
    ['share', 'prompt'],
    ['share', 'prompt', 's1'],
    ['share', 'chat'],
    ['share', 'chat', 's1', 's2'],
    ['share', 'chat', 's1', '--mode', 'everything'],
    ['share', 'chat', 's1', '--format', 'pdf'],
    ['share', 'chat', 's1', '--from', 'u1'],
    ['share', 'chat', 's1', '--to', 'a1'],
    ['share', 'chat', 's1', '--destination', 'gist'],
    ['share', 'chat', 's1', '--out', 'a', '--destination', 'browser'],
    ['prompts', 'run', 'p1'],
    ['prompts', 'save'],
    ['prompts', 'save', '--title', ''],
    ['prompts', 'save', '--title', 'Review', '--scope', 'machine'],
    ['prompts', 'list', '--scope', 'user'],
    ['prompts', 'share', 'p1', '--from', 'u1', '--to', 'a1'],
    ['prompts', 'use'],
    ['prompts', 'use', 'p1', '--chat', 'send'],
    ['prompts', 'use', 'p1', '--mode', 'full'],
  ])('refuses invalid or unrelated flags: %j', (...argv) => {
    expect(() => parseSharingArgs(argv)).toThrow()
  })
  it('preserves slash save text verbatim and parses quoted title/tags', () => {
    const text = 'Review {{selection}}\r\n\n```ts\n--mode full\n```'
    const parsed = parseSharingSlash(
      `/prompt save --title "A -- review" --tag 'two words' -- ${text}`,
      's1',
    )
    expect(parsed?.body).toBe(text)
    expect(parsed?.command).toMatchObject({
      action: 'save',
      title: 'A -- review',
      tags: ['two words'],
    })
    expect(parseSharingSlash('/share chat --format json', 's1')?.command).toMatchObject({
      request: { sessionId: 's1', format: 'json' },
    })
    expect(parseSharingSlash('/shareholder', 's1')).toBeUndefined()
    expect(parseSharingSlash('/review', 's1')).toBeUndefined()
  })
  it('treats a CRLF after the slash body marker as one delimiter', () => {
    expect(parseSharingSlash('/prompt save --title Review --\r\nBody\r\n', 's1')?.body).toBe(
      'Body\r\n',
    )
  })
  it.each([
    '/prompt save --title Review',
    '/prompt use p1 -- text',
    '/prompt list --cwd /other',
    '/share chat --confirm token',
    '/prompt save --title "unterminated -- text',
  ])('rejects unsafe/ambiguous slash input: %s', (text) => {
    expect(() => parseSharingSlash(text, 's1')).toThrow()
  })
})

describe('M118 local share admission', () => {
  it.each(['cancel', 'confidential'])(
    'rechecks %s after asynchronous output confinement',
    async (ending) => {
      const h = sharingHarness()
      const commands = new SharingCommands({
        ...h.deps,
        io: {
          realPath: (absolute) => {
            if (ending === 'cancel') h.setActive(false)
            else h.setConfidential(true)
            return Promise.resolve(absolute)
          },
        },
      })
      const result = commands.execute(
        parseSharingArgs(['share', 'chat', 's1', '--out', 'chat.md']),
        h.context,
      )
      if (ending === 'cancel') expect(await result).toMatchObject({ kind: 'cancelled' })
      else await expect(result).rejects.toThrow(UI_TEXT.shareConfidential)
      expect(h.release).not.toHaveBeenCalled()
    },
  )
  it.each(['preview', 'confirm', 'prepare', 'insert'] as const)(
    'aborts pending command %s UI without a cooperative UI promise',
    async (stage) => {
      const h = sharingHarness()
      const pending = Promise.withResolvers<undefined>()
      const ui = {
        preview: h.ui.showPreview,
        confirm: h.ui.confirmShare,
        prepare: h.ui.preparePrompt,
        insert: h.ui.insertPrompt,
      }[stage]
      ui.mockImplementation(() => pending.promise)
      let kind: string | undefined
      const response = (async () => {
        const result = await h.commands.execute(
          parseSharingArgs(
            stage === 'preview' || stage === 'confirm'
              ? ['share', 'chat', 's1']
              : ['prompts', 'use', savedPromptFixture.id],
          ),
          h.context,
        )
        kind = result.kind
      })()
      await until(() => ui.mock.calls.length === 1)
      expect(ui.mock.calls[0]?.at(-1)).toBe(h.context.signal)
      h.abort()
      await until(() => kind !== undefined)
      expect(kind).toBe('cancelled')
      await response
      expect(h.release).not.toHaveBeenCalled()
      if (stage === 'preview') expect(h.ui.confirmShare).not.toHaveBeenCalled()
    },
  )
  it.each(['copy', 'save', 'open'])(
    'releases only the explicitly confirmed headless %s destination',
    async (destination) => {
      const h = sharingHarness()
      const argv = [
        'share',
        'chat',
        's1',
        '--destination',
        destination,
        '--exported-at',
        SHARING_TIME,
        ...(destination === 'save' ? ['--out', 'chat.md'] : []),
      ]
      const { result, preview } = await confirmHeadless(h, argv)
      expect(result).toMatchObject({ kind: 'shared', exitCode: 0 })
      expect(h.release).toHaveBeenCalledWith(
        preview,
        destination === 'save' ? path.join(SHARING_CWD, 'chat.md') : undefined,
        SHARING_CWD,
        h.context.signal,
      )
    },
  )
  it('confines output to the configured share folder and passes its resolved path/root', async () => {
    const h = sharingHarness()
    const allowedRoot = path.resolve('/configured-shares')
    const commands = new SharingCommands({ ...h.deps, shareFolder: () => allowedRoot })
    expect(
      await commands.execute(
        parseSharingArgs(['share', 'chat', 's1', '--out', 'chat.md']),
        h.context,
      ),
    ).toMatchObject({ kind: 'shared' })
    expect(h.release.mock.calls[0]?.slice(1)).toEqual([
      path.join(allowedRoot, 'chat.md'),
      allowedRoot,
      h.context.signal,
    ])
    h.release.mockClear()
    expect(
      await commands.execute(
        parseSharingArgs(['share', 'chat', 's1', '--out', path.join(SHARING_CWD, 'chat.md')]),
        h.context,
      ),
    ).toMatchObject({ kind: 'cancelled' })
    expect(h.release).not.toHaveBeenCalled()
  })
  it.each(['../outside.md', path.resolve('/outside/confirmed-share.md')])(
    'refuses a confirmed output outside the allowed root: %s',
    async (out) => {
      const h = sharingHarness()
      const argv = [
        'share',
        'chat',
        's1',
        '--destination',
        'file',
        '--out',
        out,
        '--exported-at',
        SHARING_TIME,
      ]
      const { result } = await confirmHeadless(h, argv)
      expect(result).toMatchObject({ kind: 'cancelled', exitCode: 7 })
      expect(result).toHaveProperty('message', expect.stringContaining('--out'))
      expect(result).toHaveProperty('message', expect.stringContaining('outside'))
      expect(h.release).not.toHaveBeenCalled()
    },
  )
  it('refuses a symlinked output parent escaping the allowed root', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'm118x-share-'))
    try {
      const cwd = path.join(folder, 'workspace')
      const outside = path.join(folder, 'outside')
      await mkdir(cwd)
      await mkdir(outside)
      await symlink(
        outside,
        path.join(cwd, 'linked'),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
      const h = sharingHarness()
      const commands = new SharingCommands({
        ...h.deps,
        io: { realPath: (absolute) => canonicalPath(absolute, { followsBrokenLinks: true }) },
      })
      const result = await runSharingCommand(
        parseSharingArgs([
          'share',
          'chat',
          's1',
          '--destination',
          'file',
          '--out',
          'linked/chat.md',
        ]),
        commands,
        { ...h.context, cwd },
      )
      expect(result).toMatchObject({ kind: 'cancelled', exitCode: 7 })
      expect(result).toHaveProperty('message', expect.stringContaining('link'))
      expect(h.release).not.toHaveBeenCalled()
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })
  it.each([
    { flags: [], missing: '--destination' },
    { flags: ['--out', 'chat.md'], missing: '--destination' },
    { flags: ['--destination', 'file'], missing: '--out' },
  ])(
    'requires the explicit headless release flag $missing with $flags',
    async ({ flags, missing }) => {
      const h = sharingHarness()
      const argv = ['share', 'chat', 's1', '--exported-at', SHARING_TIME, ...flags]
      const { result } = await confirmHeadless(h, argv)
      expect(result).toMatchObject({ kind: 'cancelled', exitCode: 7 })
      expect(result).toHaveProperty('message', expect.stringContaining(missing))
      expect(h.release).not.toHaveBeenCalled()
    },
  )
  it.each(['inactive', 'aborted'])(
    'refuses an %s operation before any read or UI action',
    async (ending) => {
      const h = sharingHarness()
      if (ending === 'aborted') h.abort()
      else h.setActive(false)
      expect(
        await h.commands.execute(parseSharingArgs(['share', 'chat', 's1']), h.context),
      ).toMatchObject({ kind: 'cancelled' })
      expect(h.renderPreview).not.toHaveBeenCalled()
      expect(h.ui.showPreview).not.toHaveBeenCalled()
      expect(h.release).not.toHaveBeenCalled()
    },
  )
  it('checks confidentiality again before displaying a newly rendered preview', async () => {
    const h = sharingHarness()
    const render = h.renderPreview.getMockImplementation()!
    h.renderPreview.mockImplementation((...args) => {
      h.setConfidential(true)
      return render(...args)
    })
    await expect(
      h.commands.execute(parseSharingArgs(['share', 'chat', 's1']), h.context),
    ).rejects.toThrow(UI_TEXT.shareConfidential)
    expect(h.ui.showPreview).not.toHaveBeenCalled()
    expect(h.release).not.toHaveBeenCalled()
  })
  it.each(['md', 'html', 'json'])(
    'shows exact bytes before a final action in %s and forwards inclusive range/options',
    async (format) => {
      const h = sharingHarness()
      h.ui.confirmShare.mockImplementation((preview) => {
        expect(h.release).not.toHaveBeenCalled()
        expect(h.ui.showPreview).toHaveBeenCalledWith(preview, h.context.signal)
        return Promise.resolve({
          step: 'confirmed',
          previewId: preview.previewId,
          request: preview.request,
        })
      })
      const result = await h.commands.execute(
        parseSharingArgs(['share', 'chat', 's1', '--format', format, '--from', 'u1', '--to', 'a1']),
        h.context,
      )
      expect(result.kind).toBe('shared')
      expect(h.renderPreview).toHaveBeenCalledWith(
        SHARING_CWD,
        expect.objectContaining({ range: { from: 'u1', to: 'a1' }, format }),
        SHARING_TIME,
      )
      expect(h.release.mock.calls[0]?.[0]).toEqual(h.ui.showPreview.mock.calls[0]?.[0])
    },
  )
  it.each([true, undefined])(
    'fails closed before reading a confidential/unknown workspace: %s',
    async (policy) => {
      const h = sharingHarness()
      h.setConfidential(policy)
      await expect(
        h.commands.execute(parseSharingArgs(['share', 'chat', 's1']), h.context),
      ).rejects.toThrow(UI_TEXT.shareConfidential)
      expect(h.renderPreview).not.toHaveBeenCalled()
      expect(h.release).not.toHaveBeenCalled()
    },
  )
  it('rechecks confidentiality after a pending confirmation', async () => {
    const h = sharingHarness()
    h.ui.confirmShare.mockImplementation((preview) => {
      h.setConfidential(true)
      return Promise.resolve({
        step: 'confirmed',
        previewId: preview.previewId,
        request: preview.request,
      })
    })
    await expect(
      h.commands.execute(parseSharingArgs(['share', 'chat', 's1']), h.context),
    ).rejects.toThrow(UI_TEXT.shareConfidential)
    expect(h.release).not.toHaveBeenCalled()
  })
  it.each(['absent', 'paid', 'ordinary', 'stale', 'changed', 'hosted'])(
    'does not release an %s final action',
    async (answer) => {
      const h = sharingHarness()
      h.ui.confirmShare.mockImplementation((preview) => {
        if (answer === 'absent') return Promise.resolve(undefined)
        if (answer === 'paid')
          return Promise.resolve({
            outcome: { outcome: 'selected', optionId: 'paid-allow-always' },
          })
        return Promise.resolve({
          step: answer === 'ordinary' ? 'approved' : 'confirmed',
          previewId: answer === 'stale' ? 'old' : preview.previewId,
          request: {
            ...preview.request,
            ...(answer === 'changed' && { mode: 'full' }),
            ...(answer === 'hosted' && { destination: 'gist' }),
          },
        })
      })
      expect(
        await h.commands.execute(parseSharingArgs(['share', 'chat', 's1']), h.context),
      ).toMatchObject({ kind: 'cancelled' })
      expect(h.release).not.toHaveBeenCalled()
    },
  )
  it('keeps the exact preview private when the UI mutates its copy', async () => {
    const h = sharingHarness()
    h.ui.showPreview.mockImplementation((preview) => {
      Object.assign(preview, { content: 'UNSCRUBBED replacement', previewId: 'fake' })
      return Promise.resolve()
    })
    expect(
      await h.commands.execute(parseSharingArgs(['share', 'chat', 's1']), h.context),
    ).toMatchObject({ kind: 'shared' })
    expect(h.release.mock.calls[0]?.[0].content).toContain('[REDACTED]')
    expect(h.release.mock.calls[0]?.[0].content).not.toContain('UNSCRUBBED')
  })
  it('binds the final file path even if the command object changes while previewing', async () => {
    const h = sharingHarness()
    const command = parseSharingArgs(['share', 'chat', 's1', '--out', 'chosen.md'])
    h.ui.showPreview.mockImplementation(() => {
      Object.assign(command, { out: 'changed.md' })
      return Promise.resolve()
    })
    expect(await h.commands.execute(command, h.context)).toMatchObject({ kind: 'shared' })
    expect(h.release.mock.calls[0]?.[1]).toBe(path.join(SHARING_CWD, 'chosen.md'))
    expect(h.release.mock.calls[0]?.[2]).toBe(SHARING_CWD)
  })
  it('does not turn a mutated CLI command into final sharing confirmation', async () => {
    const h = sharingHarness()
    const command = parseSharingArgs(['share', 'chat', 's1', '--exported-at', SHARING_TIME])
    h.ui.showPreview.mockImplementation((preview) => {
      Object.assign(command, { confirmation: preview.previewId })
      return Promise.resolve()
    })
    expect(
      await h.commands.execute(command, { ...h.context, ui: { showPreview: h.ui.showPreview } }),
    ).toMatchObject({ kind: 'cancelled' })
    expect(h.release).not.toHaveBeenCalled()
  })
  it('keeps the requested mode isolated from renderer input mutation', async () => {
    const h = sharingHarness()
    const render = h.renderPreview.getMockImplementation()!
    h.renderPreview.mockImplementation((cwd, request, time) => {
      Object.assign(request, { mode: 'full' })
      return render(cwd, request, time)
    })
    await expect(
      h.commands.execute(parseSharingArgs(['share', 'chat', 's1']), h.context),
    ).rejects.toThrow(UI_TEXT.shareCancelled)
    expect(h.ui.showPreview).not.toHaveBeenCalled()
    expect(h.release).not.toHaveBeenCalled()
  })
  it('requires explicit confirmation for noninteractive use, bound to time/bytes/destination', async () => {
    const h = sharingHarness()
    const ui = { showPreview: h.ui.showPreview }
    const command = parseSharingArgs([
      'share',
      'chat',
      's1',
      '--exported-at',
      SHARING_TIME,
      '--out',
      'chat.md',
    ])
    const preview = await runSharingCommand(command, h.commands, { ...h.context, ui })
    expect(preview.kind).toBe('cancelled')
    expect(preview.exitCode).toBe(7)
    expect(h.release).not.toHaveBeenCalled()
    if (preview.kind !== 'cancelled' || preview.preview === undefined)
      throw new Error('preview absent')
    const confirmed = parseSharingArgs([
      'share',
      'chat',
      's1',
      '--destination',
      'file',
      '--exported-at',
      SHARING_TIME,
      '--out',
      'chat.md',
      '--confirm',
      preview.preview.previewId,
    ])
    expect(await runSharingCommand(confirmed, h.commands, { ...h.context, ui })).toMatchObject({
      kind: 'shared',
    })
    expect(
      await runSharingCommand(
        parseSharingArgs([
          'share',
          'chat',
          's1',
          '--destination',
          'file',
          '--exported-at',
          SHARING_TIME,
          '--out',
          'other.md',
          '--confirm',
          preview.preview.previewId,
        ]),
        h.commands,
        { ...h.context, ui },
      ),
    ).toMatchObject({ kind: 'cancelled' })
    expect(h.release).toHaveBeenCalledTimes(1)
    await expect(
      runSharingCommand(
        parseSharingArgs([
          'share',
          'chat',
          's1',
          '--destination',
          'copy',
          '--confirm',
          preview.preview.previewId,
        ]),
        h.commands,
        { ...h.context, ui },
      ),
    ).rejects.toThrow('--exported-at')
  })
  it.each(['render', 'preview', 'confirm'])(
    'invalidates a cancelled/replaced operation during %s',
    async (stage) => {
      const h = sharingHarness()
      const command = parseSharingArgs(['share', 'chat', 's1'])
      switch (stage) {
        case 'render': {
          h.renderPreview.mockImplementation(() => {
            h.setActive(false)
            return Promise.resolve({
              document: shareChatFixture,
              content: 'scrubbed',
              redactions: [],
            })
          })
          break
        }
        case 'preview': {
          h.ui.showPreview.mockImplementation(() => {
            h.setActive(false)
            return Promise.resolve()
          })
          break
        }
        case 'confirm': {
          {
            h.ui.confirmShare.mockImplementation((preview) => {
              h.setActive(false)
              return Promise.resolve({
                step: 'confirmed',
                previewId: preview.previewId,
                request: preview.request,
              })
            })
            // No default
          }
          break
        }
      }
      if (stage === 'render') {
        // A matching exportedAt isolates lifetime admission from renderer validation.
        expect(
          await h.commands.execute(
            parseSharingArgs(['share', 'chat', 's1', '--exported-at', shareChatFixture.createdAt]),
            h.context,
          ),
        ).toMatchObject({ kind: 'cancelled' })
      } else
        expect(await h.commands.execute(command, h.context)).toMatchObject({ kind: 'cancelled' })
      expect(h.release).not.toHaveBeenCalled()
      if (stage === 'render') expect(h.ui.showPreview).not.toHaveBeenCalled()
      else if (stage === 'preview') expect(h.ui.confirmShare).not.toHaveBeenCalled()
    },
  )
  it.each(['scrubbed', 'target', 'mode', 'options', 'time', 'range', 'redaction'])(
    'rejects a malformed/mismatched renderer result: %s',
    async (fault) => {
      const h = sharingHarness()
      h.renderPreview.mockResolvedValue({
        content: 'scrubbed',
        redactions: fault === 'redaction' ? [{ start: 0, end: 100 }] : [],
        document: {
          ...shareChatFixture,
          createdAt: SHARING_TIME,
          ...(fault === 'scrubbed' && { scrubbed: false }),
          ...(fault === 'target' && { target: 'prompt' }),
          ...(fault === 'mode' && { mode: 'full' }),
          ...(fault === 'options' && {
            options: { ...shareChatFixture.options, codeBlocks: false },
          }),
          ...(fault === 'time' && { createdAt: shareChatFixture.createdAt }),
          ...(fault === 'range' && { range: { from: 'u1', to: 'a1' } }),
        },
      })
      await expectRejectedPreview(h)
    },
  )
  it.each([
    { content: '', redactions: [] },
    { content: 'text', redactions: [{ start: -1, end: 1 }] },
    { content: 'text', redactions: [{ start: 0.5, end: 1 }] },
    { content: 'text', redactions: [{ start: 0, end: 0.5 }] },
    { content: 'text', redactions: [{ start: 0, end: 0 }] },
    { content: 'text', redactions: [{ start: 2, end: 1 }] },
    { content: 'text', redactions: [], remoteAsset: 'unexpected' },
  ])('rejects invalid preview text or redaction metadata: %j', async (output) => {
    const h = sharingHarness()
    h.renderPreview.mockResolvedValue({
      document: { ...shareChatFixture, createdAt: SHARING_TIME },
      ...output,
    })
    await expectRejectedPreview(h)
  })
})

describe('M118 portable prompts', () => {
  it.each([
    {
      platform: 'win32' as const,
      env: { LOCALAPPDATA: String.raw`C:\local` },
      homeDir: String.raw`C:\home`,
      cwd: String.raw`C:\work`,
      user: String.raw`C:\local\Muse Spark Code\prompts`,
      workspace: String.raw`C:\work\.muse\prompts`,
    },
    {
      platform: 'darwin' as const,
      env: {},
      homeDir: '/Users/user',
      cwd: '/work',
      user: '/Users/user/Library/Application Support/Muse Spark Code/prompts',
      workspace: '/work/.muse/prompts',
    },
    {
      platform: 'linux' as const,
      env: { XDG_DATA_HOME: '/data' },
      homeDir: '/home/user',
      cwd: '/work',
      user: '/data/muse-spark-code/prompts',
      workspace: '/work/.muse/prompts',
    },
  ])(
    'uses the shared portable paths for $platform',
    async ({ platform, env, homeDir, cwd, user, workspace }) => {
      const h = sharingHarness()
      const commands = new SharingCommands({ ...h.deps, folders: { platform, env, homeDir } })
      await commands.execute(parseSharingArgs(['prompts', 'list']), { ...h.context, cwd })
      expect(h.storageFor).toHaveBeenCalledWith({ user, workspace })
    },
  )
  it('does not list or load after the originating view closes during a store read', async () => {
    const h = sharingHarness()
    const storage = h.storageFor.getMockImplementation()!
    h.storageFor.mockImplementation((folders) => {
      const port = storage(folders)
      return {
        ...port,
        list: (scope) => {
          h.setActive(false)
          return port.list(scope)
        },
      }
    })
    expect(
      await h.commands.execute(parseSharingArgs(['prompts', 'list']), h.context),
    ).toMatchObject({ kind: 'cancelled' })
    expect(h.ui.insertPrompt).not.toHaveBeenCalled()
  })
  it('requires review of untrusted text even without variables, and honours a cancelled review', async () => {
    const h = sharingHarness()
    await h.commands.execute(parseSharingArgs(['prompts', 'list']), h.context)
    h.files.set(h.storageFor.mock.calls[0]![0].user, [
      { ...savedPromptFixture, body: 'Foreign text', variables: [], untrusted: true },
    ])
    await expect(useWithoutReviewer(h)).rejects.toThrow(UI_TEXT.promptUntrusted)
    h.ui.preparePrompt.mockResolvedValue(undefined)
    expect(await usePrompt(h)).toMatchObject({ kind: 'cancelled' })
    expect(h.ui.insertPrompt).not.toHaveBeenCalled()
  })
  it('saves exact stdin text and variables through P without execution', async () => {
    const h = sharingHarness()
    const result = await h.commands.execute(
      parseSharingArgs([
        'prompts',
        'save',
        '--title',
        'Review',
        '--scope',
        'workspace',
        '--tag',
        'review',
      ]),
      h.context,
    )
    expect(result.kind).toBe('saved')
    expect(h.write).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Review',
        scope: 'workspace',
        tags: ['review'],
        body: 'Review {{selection}} for {{audience}}.\r\n',
        variables: [
          { name: 'selection', source: 'selection' },
          { name: 'audience', source: 'input' },
        ],
      }),
    )
    expect(h.ui.insertPrompt).not.toHaveBeenCalled()
    expect(h.renderPreview).not.toHaveBeenCalled()
  })
  it('reports P store/cap failures without removing or pretending success', async () => {
    const h = sharingHarness()
    h.write.mockRejectedValue(new Error('P cap exceeded'))
    await expect(
      h.commands.execute(parseSharingArgs(['prompts', 'save', '--title', 'Review']), h.context),
    ).rejects.toThrow('P cap exceeded')
  })
  it('uses one personal folder across workspaces and preserves scope/title duplicates', async () => {
    const h = sharingHarness()
    await h.commands.execute(parseSharingArgs(['prompts', 'list']), h.context)
    const first = h.storageFor.mock.calls[0]![0]
    h.files.set(first.workspace, [{ ...savedPromptFixture, scope: 'workspace' }])
    const listed = await h.commands.execute(
      parseSharingArgs(['prompts', 'list', '--tag', 'review', '--search', 'selection']),
      h.context,
    )
    expect(listed.kind === 'listed' ? listed.prompts.map((p) => p.scope) : []).toEqual([
      'user',
      'workspace',
    ])
    const other = await runSharingCommand(
      parseSharingArgs(['prompts', 'list', '--cwd', path.resolve('/other')]),
      h.commands,
      h.context,
    )
    expect(other.kind === 'listed' ? other.prompts.map((p) => p.scope) : []).toEqual(['user'])
    expect(h.storageFor.mock.calls.at(-1)?.[0].user).toBe(first.user)
    expect(h.storageFor.mock.calls.at(-1)?.[0].workspace).not.toBe(first.workspace)
  })
  it('reviews untrusted text/variables and loads insert-only into the active/new composer', async () => {
    const h = sharingHarness()
    const result = await h.commands.execute(
      parseSharingArgs(['prompts', 'use', savedPromptFixture.id, '--chat', 'new']),
      h.context,
    )
    expect(result.kind).toBe('inserted')
    expect(h.ui.preparePrompt).toHaveBeenCalledWith(savedPromptFixture, h.context.signal)
    expect(h.ui.insertPrompt).toHaveBeenCalledWith(
      {
        promptId: savedPromptFixture.id,
        scope: 'user',
        chat: 'new',
        action: 'insert',
        send: false,
      },
      'Prepared text',
      h.context.signal,
    )
    const prepared = await h.commands.execute(
      parseSharingArgs(['prompts', 'use', savedPromptFixture.id]),
      { ...h.context, ui: { showPreview: h.ui.showPreview, preparePrompt: h.ui.preparePrompt } },
    )
    expect(prepared.kind).toBe('prepared')
    await expect(useWithoutReviewer(h)).rejects.toThrow(
      `${UI_TEXT.promptVariables}: selection, file, clipboard, audience`,
    )
  })
  it('refuses unknown ids and damaged/mismatched or duplicate same-scope stores', async () => {
    const h = sharingHarness()
    await expect(
      h.commands.execute(parseSharingArgs(['prompts', 'use', 'unknown']), h.context),
    ).rejects.toThrow(UI_TEXT.promptFileInvalid)
    const user = h.storageFor.mock.calls[0]![0].user
    const wrongVersion = structuredClone(savedPromptFixture)
    Object.assign(wrongVersion, { schemaVersion: 2 })
    for (const rows of [
      [{ ...savedPromptFixture, scope: 'workspace' as const }],
      [savedPromptFixture, savedPromptFixture],
      [wrongVersion],
    ]) {
      h.files.set(
        user,
        rows.map((p) => ({ ...savedPromptFixture, ...p })),
      )
      await expect(
        h.commands.execute(parseSharingArgs(['prompts', 'list']), h.context),
      ).rejects.toThrow()
    }
    expect(h.write).not.toHaveBeenCalled()
    expect(h.ui.insertPrompt).not.toHaveBeenCalled()
  })
  it('does not insert or write after cancellation during prompt review/stdin', async () => {
    const h = sharingHarness()
    h.ui.preparePrompt.mockImplementation(() => {
      h.setActive(false)
      return Promise.resolve('late')
    })
    expect(await usePrompt(h)).toMatchObject({ kind: 'cancelled' })
    expect(h.ui.insertPrompt).not.toHaveBeenCalled()
    h.setActive(true)
    const result = await h.commands.execute(
      parseSharingArgs(['prompts', 'save', '--title', 'Review']),
      {
        ...h.context,
        readBody: () => {
          h.setActive(false)
          return Promise.resolve('late')
        },
      },
    )
    expect(result.kind).toBe('cancelled')
    expect(h.write).not.toHaveBeenCalled()
  })
  it('validates the prepared-text reply before insertion', async () => {
    const h = sharingHarness()
    h.ui.preparePrompt.mockResolvedValue({ send: true, text: 'Unvalidated reply' })
    await expect(usePrompt(h)).rejects.toThrow()
    expect(h.ui.insertPrompt).not.toHaveBeenCalled()
  })
  it('routes saved-prompt sharing through the same preview/confidential flow', async () => {
    const h = sharingHarness()
    const result = await h.commands.execute(
      parseSharingArgs([
        'prompts',
        'share',
        savedPromptFixture.id,
        '--scope',
        'workspace',
        '--format',
        'json',
      ]),
      h.context,
    )
    expect(result.kind).toBe('shared')
    expect(h.renderPreview).toHaveBeenCalledWith(
      SHARING_CWD,
      expect.objectContaining({
        target: 'prompt',
        source: { kind: 'saved', promptId: savedPromptFixture.id, scope: 'workspace' },
      }),
      SHARING_TIME,
    )
    expect(h.ui.insertPrompt).not.toHaveBeenCalled()
  })
})
