import path from 'node:path'
import { vi } from 'vitest'
import {
  SharingCommands,
  type SharingDeps,
  type SharingContext,
  type SharingUi,
} from '../../../src/runtime/sharing/commands'
import type { PromptStoragePort, SavedPrompt } from '../../../src/shared/prompts'
import { agentDataFolder } from '../../../src/runtime/dataFolder'
import { shareChatFixture, savedPromptFixture } from './sharingFixtures'

export const SHARING_CWD = path.resolve('/work/app')
export const SHARING_TIME = '2026-10-06T10:00:00Z'

export function sharingHarness() {
  const files = new Map<string, SavedPrompt[]>()
  let isActive = true
  const abort = new AbortController()
  let confidential: boolean | undefined = false
  const write = vi.fn<PromptStoragePort['write']>(() => Promise.resolve())
  const storageFor = vi.fn<SharingDeps['storageFor']>((folders) => ({
    list: (scope) =>
      Promise.resolve(files.get(scope === 'user' ? folders.user : folders.workspace) ?? []),
    write,
    remove: () => Promise.reject(new Error('unused remove in fake')),
  }))
  const release = vi.fn<SharingDeps['release']>(() => Promise.resolve())
  const renderPreview = vi.fn<SharingDeps['renderPreview']>((_cwd, request, createdAt) =>
    Promise.resolve({
      content: '# Scrubbed preview\n\n[user] [home] relative/file.ts [REDACTED]\n',
      redactions: [{ start: 44, end: 60 }],
      document:
        request.target === 'chat'
          ? {
              ...shareChatFixture,
              createdAt,
              mode: request.mode,
              options: request.options,
              ...(request.range !== undefined && { range: request.range }),
            }
          : {
              schemaVersion: 1,
              target: 'prompt',
              title: 'Prompt',
              createdAt,
              mode: request.mode,
              options: request.options,
              scrubbed: true,
              prompt: savedPromptFixture,
            },
    }),
  )
  const ui = {
    showPreview: vi.fn<SharingUi['showPreview']>(() => Promise.resolve()),
    confirmShare: vi.fn<NonNullable<SharingUi['confirmShare']>>((preview) =>
      Promise.resolve({
        step: 'confirmed',
        previewId: preview.previewId,
        request: preview.request,
      }),
    ),
    preparePrompt: vi.fn<NonNullable<SharingUi['preparePrompt']>>(() =>
      Promise.resolve('Prepared text'),
    ),
    insertPrompt: vi.fn<NonNullable<SharingUi['insertPrompt']>>(() => Promise.resolve()),
  }
  const deps: SharingDeps = {
    folders: { platform: process.platform, env: {}, homeDir: path.resolve('/user') },
    now: () => SHARING_TIME,
    storageFor,
    renderPreview,
    isConfidentialWorkspace: () => confidential,
    io: { realPath: (absolute) => Promise.resolve(absolute) },
    release,
  }
  const commands = new SharingCommands(deps)
  const context: SharingContext = {
    cwd: SHARING_CWD,
    isActive: () => isActive,
    signal: abort.signal,
    ui,
    readBody: () => Promise.resolve('Review {{selection}} for {{audience}}.\r\n'),
  }
  // Seed using the shared root; the owning tests assert explicit paths independently.
  const paths = process.platform === 'win32' ? path.win32 : path.posix
  const userRoot = agentDataFolder(deps.folders)
  files.set(paths.join(userRoot, 'prompts'), [structuredClone(savedPromptFixture)])
  return {
    commands,
    context,
    deps,
    ui,
    files,
    write,
    release,
    renderPreview,
    storageFor,
    setActive: (isCurrent: boolean) => {
      isActive = isCurrent
    },
    abort: () => {
      abort.abort()
    },
    setConfidential: (value: boolean | undefined) => {
      confidential = value
    },
  }
}
