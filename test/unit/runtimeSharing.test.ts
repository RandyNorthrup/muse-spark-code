import { realpath, mkdtemp, mkdir, rm, writeFile, stat, readFile, symlink } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import os from 'node:os'
import type * as Os from 'node:os'
import * as z from 'zod/mini'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  runtimeAcpSharing,
  runRuntimeSharing,
  type RuntimeSharingPorts,
  runtimeSharingConfidential,
} from '../../src/runtime/sharing/sharingEntry'
import { runtimeSharingLoader } from '../../src/runtime/sharing/sharingBundle'
import { EN } from '../../src/shared/l10n/en'
import { buildPromptShare } from '../../src/core/sharing/promptShare'
import { createChatSharePrivacy } from '../../src/core/sharing/privacy'
import { shareJsonSchema, shareRequestSchema } from '../../src/shared/share'
import { parseSharingArgs } from '../../src/runtime/sharing/args'
import { savedPromptFixture } from './helpers/sharingFixtures'
const terminal = vi.hoisted(() => ({ answers: [] as string[] }))
vi.mock('node:readline/promises', () => ({
  createInterface: () => ({
    question: () => Promise.resolve(terminal.answers.shift()),
    close: () => undefined,
  }),
}))
// Sandboxes without a passwd entry (and CI workers generally) must not decide
// the share author: the tests pin their own user name.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof Os>()
  return {
    ...actual,
    userInfo: () => ({
      uid: 501,
      gid: 20,
      username: 'fixture',
      homedir: '/home/fixture',
      shell: '/bin/sh',
    }),
  }
})
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
function sharingFolders(root: string): RuntimeSharingPorts['folders'] {
  return {
    platform: process.platform,
    homeDir: root,
    env: { XDG_DATA_HOME: root, LOCALAPPDATA: root },
  }
}

async function refusalRig(read: RuntimeSharingPorts['read']) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'm118-refusal-')))
  roots.push(root)
  const ports: RuntimeSharingPorts = { folders: sharingFolders(root), read }
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const errors: string[] = []
  const errorOutput = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    errors.push(String(chunk))
    return true
  })
  return { root, ports, log, errors, errorOutput }
}

function defaultShare(rig: Awaited<ReturnType<typeof refusalRig>>): Promise<number> {
  return runRuntimeSharing(
    parseSharingArgs(
      ['share', 'chat', '--cwd', rig.root, '--exported-at', '2026-10-06T12:00:00Z'],
      's1',
    ),
    rig.ports,
    EN,
    'en',
    rig.log,
  )
}

describe('M118 production runtime bindings', () => {
  it.each([
    { body: 'Hello {{ audience }}', answers: ['readers'], expected: 'Hello readers' },
    {
      body: '{{first}} then {{second}}',
      answers: ['{{second}}', 'end'],
      expected: '{{second}} then end',
    },
  ])('uses the shared literal terminal resolver for $body', async ({ body, answers, expected }) => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'm118-terminal-')))
    roots.push(root)
    const ports: RuntimeSharingPorts = {
      folders: sharingFolders(root),
      read: () => Promise.reject(new Error('Prompt use must not read a backend')),
    }
    const saved = await runtimeAcpSharing(ports, EN, 'en').execute(
      `/prompt save --title Variables -- ${body}`,
      {
        cwd: root,
        sessionId: 's1',
        isActive: () => true,
        signal: new AbortController().signal,
      },
    )
    const id = /\(([^()]*)\)$/.exec(saved)?.[1]
    if (id === undefined) throw new Error('Missing saved terminal fixture')
    terminal.answers = ['y', ...answers, 'y']
    const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
    const chunks: string[] = []
    const output = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      return true
    })
    try {
      expect(
        await runRuntimeSharing(
          parseSharingArgs(['prompts', 'use', id, '--cwd', root]),
          ports,
          EN,
          'en',
        ),
      ).toBe(0)
      const result = z
        .object({ kind: z.literal('prepared'), text: z.string() })
        .parse(JSON.parse(chunks.at(-1) ?? ''))
      expect(result.text).toBe(expected)
      expect(terminal.answers).toEqual([])
    } finally {
      output.mockRestore()
      if (tty === undefined) Reflect.deleteProperty(process.stdin, 'isTTY')
      else Object.defineProperty(process.stdin, 'isTTY', tty)
      terminal.answers = []
    }
  })
  it('saves verbatim personal prompts, lists and prepares them in a new workspace without backend reads', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'm118-runtime-')))
    roots.push(root)
    const read = vi.fn(() => Promise.reject(new Error('backend must not start')))
    const port = runtimeAcpSharing(
      {
        folders: sharingFolders(root),
        read,
      },
      EN,
      'en',
    )
    const context = {
      cwd: path.join(root, 'first'),
      sessionId: 's1',
      isActive: () => true,
      signal: new AbortController().signal,
    }
    const saved = await port.execute(
      '/prompt save --title Example --scope user --   Exact\r\nbody  ',
      context,
    )
    const id = /\(([^()]*)\)$/.exec(saved)?.[1]
    expect(id).toBeDefined()
    const fresh = { ...context, cwd: path.join(root, 'empty') }
    expect(await port.execute('/prompt list', fresh)).toContain('Example')
    expect(await port.execute(`/prompt use ${id ?? ''}`, fresh)).toContain('  Exact\r\nbody  ')
    expect(await port.execute('/help', fresh)).toContain('/share chat')
    expect(read).not.toHaveBeenCalled()
  })
  it.each([false, true])(
    'refreshes registered values and releases through an aliased workspace: %s',
    async (isAliased) => {
      const realRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'm118-registered-')))
      roots.push(realRoot)
      const root = isAliased ? `${realRoot}-alias` : realRoot
      if (isAliased) {
        roots.push(root)
        await symlink(realRoot, root, 'junction')
      }
      const known = vi.fn<NonNullable<RuntimeSharingPorts['registeredSecrets']>>(() =>
        Promise.resolve([]),
      )
      const read = vi.fn(() => Promise.reject(new Error('backend must not start')))
      const ports: RuntimeSharingPorts = {
        folders: sharingFolders(root),
        registeredSecrets: known,
        read,
      }
      const acp = runtimeAcpSharing(ports, EN, 'en')
      const signal = new AbortController().signal
      const value = 'registered test value "quoted"'
      const saved = await acp.execute(`/prompt save --title Registered -- ${value}`, {
        cwd: root,
        sessionId: 's1',
        isActive: () => true,
        signal,
      })
      expect(known).not.toHaveBeenCalled()
      const id = /\(([^()]*)\)$/.exec(saved)?.[1]
      if (id === undefined) throw new Error('Missing saved fixture')
      const args = [
        'prompts',
        'share',
        id,
        '--cwd',
        root,
        '--format',
        'json',
        '--destination',
        'file',
        '--out',
        'private.json',
        '--exported-at',
        '2026-10-06T12:00:00Z',
      ]
      const chunks: string[] = []
      const output = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        chunks.push(String(chunk))
        return true
      })
      const errors: string[] = []
      const errorOutput = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        errors.push(String(chunk))
        return true
      })
      try {
        known.mockResolvedValue([value])
        expect(await runRuntimeSharing(parseSharingArgs(args), ports, EN, 'en')).toBe(7)
        expect(errors).toEqual([])
        const scrubbed: unknown = JSON.parse(chunks.at(-1) ?? '')
        const scrubbedResult = z
          .object({ preview: z.object({ document: shareJsonSchema }) })
          .parse(scrubbed)
        expect(JSON.stringify(scrubbedResult.preview.document)).not.toContain(
          'registered test value',
        )
        chunks.length = 0
        known.mockResolvedValue([])
        expect(await runRuntimeSharing(parseSharingArgs(args), ports, EN, 'en')).toBe(7)
        const preview = z
          .object({ preview: z.object({ previewId: z.string() }) })
          .parse(JSON.parse(chunks.at(-1) ?? ''))
        known.mockResolvedValueOnce([]).mockResolvedValueOnce([value])
        expect(
          await runRuntimeSharing(
            parseSharingArgs([...args, '--confirm', preview.preview.previewId]),
            ports,
            EN,
            'en',
          ),
        ).toBe(7)
        expect(errors.join('')).toContain(EN.sharePreviewExpired)
        await expect(stat(path.join(root, 'private.json'))).rejects.toMatchObject({
          code: 'ENOENT',
        })
        known.mockResolvedValue([])
        expect(
          await runRuntimeSharing(
            parseSharingArgs([...args, '--confirm', preview.preview.previewId]),
            ports,
            EN,
            'en',
          ),
        ).toBe(0)
        expect(await readFile(path.join(root, 'private.json'), 'utf8')).toContain(
          'registered test value',
        )
        expect(read).not.toHaveBeenCalled()
      } finally {
        output.mockRestore()
        errorOutput.mockRestore()
      }
    },
  )

  it('uses the same deterministic scrubbed saved-prompt document for Markdown, HTML and JSON', () => {
    const prompt = {
      ...savedPromptFixture,
      variables: [],
      title: 'Share registered-test-secret',
      body: 'Keep /workspace/src/main.ts; registered-test-secret; owner user',
    }
    const privacy = createChatSharePrivacy({
      workspaceRoots: ['/workspace'],
      home: '',
      userName: 'user',
      redactRegisteredSecrets: (text) => text.replaceAll('registered-test-secret', '[redacted]'),
    })
    for (const format of ['md', 'html', 'json'] as const) {
      const request = shareRequestSchema.parse({
        target: 'prompt',
        source: { kind: 'saved', scope: 'user', promptId: prompt.id },
        mode: 'conversation',
        format,
        destination: 'copy',
      })
      const first = buildPromptShare(prompt, request, '2026-10-06T12:00:00Z', privacy)
      expect(buildPromptShare(prompt, request, '2026-10-06T12:00:00Z', privacy)).toEqual(first)
      expect(first.document).toMatchObject({ prompt: { scope: 'user' } })
      expect(first.content).not.toContain('owner user')
      expect(first.content).not.toContain('registered-test-secret')
      expect(first.content).not.toContain('/workspace')
      expect(first.content).toContain('src/main.ts')
      expect(shareJsonSchema.parse(first.document).target).toBe('prompt')
      if (format === 'json')
        expect(shareJsonSchema.parse(JSON.parse(first.content))).toEqual(first.document)
    }
    expect(prompt.body).toContain('registered-test-secret')
  })
  it('reports an unloadable sharing bundle as internal, not a prompt-file error', () => {
    const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const load = runtimeSharingLoader(path.join(os.tmpdir(), 'm118-no-such-bundle.js'), log)
    // The loader already logged the cause; the user reads the fixed reason.
    expect(() => load()).toThrow(EN.actionFailed)
    expect(log.error).toHaveBeenCalled()
  })
  it('refuses unknown confidential policy and respects explicit workspace settings', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'm118-policy-')))
    roots.push(root)
    expect(runtimeSharingConfidential(root)).toBe(false)
    await mkdir(path.join(root, '.vscode'))
    const file = path.join(root, '.vscode', 'settings.json')
    await writeFile(file, '{"museSpark.confidentialWorkspace":true}')
    expect(runtimeSharingConfidential(root)).toBe(true)
    await writeFile(file, '{broken')
    expect(runtimeSharingConfidential(root)).toBeUndefined()
  })
  it('keeps a defined empty-chat refusal instead of a prompt-file error', async () => {
    const rig = await refusalRig(() =>
      Promise.resolve({
        sessionId: 's1',
        title: 'Empty',
        exportedAt: '2026-10-06T12:00:00Z',
        items: [],
      }),
    )
    const { log, errors, errorOutput } = rig
    try {
      expect(await defaultShare(rig)).toBe(7)
      expect(errors.join('')).toContain(EN.exportNothing)
      expect(errors.join('')).not.toContain(EN.promptFileInvalid)
      expect(errors.join('')).not.toContain(EN.actionFailed)
      expect(log.warn).not.toHaveBeenCalled()
    } finally {
      errorOutput.mockRestore()
    }
  })
  it('keeps malformed UTF-8 stdin as a defined invalid-file refusal', async () => {
    const read = vi.fn(() => Promise.reject(new Error('backend must not start')))
    const { root, ports, log, errors, errorOutput } = await refusalRig(read)
    const input = vi
      .spyOn(process.stdin, Symbol.asyncIterator)
      .mockImplementation(() => Readable.from([Buffer.from([0x80])])[Symbol.asyncIterator]())
    try {
      expect(
        await runRuntimeSharing(
          parseSharingArgs(['prompts', 'save', '--title', 'Public', '--cwd', root]),
          ports,
          EN,
          'en',
          log,
        ),
      ).toBe(7)
      expect(errors.join('')).toBe(`${EN.promptFileInvalid}\n`)
      expect(log.warn).not.toHaveBeenCalled()
      expect(read).not.toHaveBeenCalled()
    } finally {
      input.mockRestore()
      errorOutput.mockRestore()
    }
  })
  it.each([
    ['--exported-at', 'not-a-date'],
    ['--attachment-content', ''],
  ])(
    'keeps the localized typed argument refusal for %s in headless sharing',
    async (flag, value) => {
      const read = vi.fn(() => Promise.reject(new Error('backend must not start')))
      const { root, ports, log, errors, errorOutput } = await refusalRig(read)
      const table = { ...EN, acpUnknownArgument: 'Argument invalide : {argument}' }
      try {
        expect(
          await runRuntimeSharing(
            parseSharingArgs(['share', 'chat', 's1', '--cwd', root, flag, value]),
            ports,
            table,
            'fr',
            log,
          ),
        ).toBe(7)
        expect(errors.join('')).toBe(`Argument invalide : ${flag}\n`)
        expect(read).not.toHaveBeenCalled()
        expect(log.warn).not.toHaveBeenCalled()
      } finally {
        errorOutput.mockRestore()
      }
    },
  )
  it('reports an unexpected headless fault as internal with the fault named in the log', async () => {
    const rig = await refusalRig(() =>
      Promise.reject(
        new TypeError('backend read failed under /home/someone/private for sentinel-share-read'),
      ),
    )
    const { log, errors, errorOutput } = rig
    try {
      expect(await defaultShare(rig)).toBe(7)
      const stderr = errors.join('')
      expect(stderr).toContain(EN.actionFailed)
      expect(stderr).not.toContain(EN.promptFileInvalid)
      expect(stderr).not.toContain('/home/someone')
      expect(stderr).not.toContain('sentinel-share-read')
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('sharing command failed'))
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('TypeError'))
      expect(JSON.stringify(log.warn.mock.calls)).not.toContain('/home/someone')
      expect(JSON.stringify(log.warn.mock.calls)).not.toContain('sentinel-share-read')
    } finally {
      errorOutput.mockRestore()
    }
  })
})
