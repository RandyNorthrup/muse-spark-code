import { mkdtemp, mkdir, rm, writeFile, stat, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import * as z from 'zod/mini'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  runtimeAcpSharing,
  runRuntimeSharing,
  type RuntimeSharingPorts,
  runtimeSharingConfidential,
} from '../../src/runtime/sharing/sharingEntry'
import { EN } from '../../src/shared/l10n/en'
import { buildPromptShare } from '../../src/core/sharing/promptShare'
import { createChatSharePrivacy } from '../../src/core/sharing/privacy'
import { shareJsonSchema, shareRequestSchema } from '../../src/shared/share'
import { parseSharingArgs } from '../../src/runtime/sharing/args'
import { savedPromptFixture } from './helpers/sharingFixtures'
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
describe('M118 production runtime bindings', () => {
  it('saves verbatim personal prompts, lists and prepares them in a new workspace without backend reads', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'm118-runtime-'))
    roots.push(root)
    const read = vi.fn(() => Promise.reject(new Error('backend must not start')))
    const port = runtimeAcpSharing(
      {
        folders: {
          platform: process.platform,
          homeDir: root,
          env: { XDG_DATA_HOME: root, LOCALAPPDATA: root },
        },
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
  it('refreshes registered values for previews and refuses a newly sensitive JSON document at release', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'm118-registered-'))
    roots.push(root)
    const known = vi.fn<NonNullable<RuntimeSharingPorts['registeredSecrets']>>(() =>
      Promise.resolve([]),
    )
    const read = vi.fn(() => Promise.reject(new Error('backend must not start')))
    const ports: RuntimeSharingPorts = {
      folders: {
        platform: process.platform,
        homeDir: root,
        env: { XDG_DATA_HOME: root, LOCALAPPDATA: root },
      },
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
      const scrubbed: unknown = JSON.parse(chunks.at(-1) ?? '')
      const scrubbedResult = z
        .object({ preview: z.object({ document: shareJsonSchema }) })
        .parse(scrubbed)
      expect(JSON.stringify(scrubbedResult.preview.document)).not.toContain('registered test value')
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
      await expect(stat(path.join(root, 'private.json'))).rejects.toMatchObject({ code: 'ENOENT' })
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
  })

  it('uses the same deterministic scrubbed saved-prompt document for Markdown, HTML and JSON', () => {
    const prompt = {
      ...savedPromptFixture,
      variables: [],
      title: 'Share registered-test-secret',
      body: 'Keep /workspace/src/main.ts; registered-test-secret',
    }
    const privacy = createChatSharePrivacy({
      workspaceRoots: ['/workspace'],
      home: '',
      userName: '',
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
      expect(first.content).not.toContain('registered-test-secret')
      expect(first.content).not.toContain('/workspace')
      expect(first.content).toContain('src/main.ts')
      expect(shareJsonSchema.parse(first.document).target).toBe('prompt')
      if (format === 'json')
        expect(shareJsonSchema.parse(JSON.parse(first.content))).toEqual(first.document)
    }
    expect(prompt.body).toContain('registered-test-secret')
  })
  it('refuses unknown confidential policy and respects explicit workspace settings', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'm118-policy-'))
    roots.push(root)
    expect(runtimeSharingConfidential(root)).toBe(false)
    await mkdir(path.join(root, '.vscode'))
    const file = path.join(root, '.vscode', 'settings.json')
    await writeFile(file, '{"museSpark.confidentialWorkspace":true}')
    expect(runtimeSharingConfidential(root)).toBe(true)
    await writeFile(file, '{broken')
    expect(runtimeSharingConfidential(root)).toBeUndefined()
  })
})
