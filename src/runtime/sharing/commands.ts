// P owns checked storage; C owns the portable history projection and scrubbed renderers.
// This adapter owns local command admission and exact-preview final confirmation.
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import * as z from 'zod/mini'
import { confineWorkspacePath, type RealPathIo } from '../../core/workspacePath'
import {
  UI_TEXT,
  EXEC_EXIT,
  PROMPT_SCHEMA_VERSION,
  PROMPT_USER_FOLDER,
  PROMPT_WORKSPACE_FOLDER,
} from '../../shared/constants'
import {
  mergePromptScopes,
  promptLoadSchema,
  promptVariableNames,
  savedPromptSchema,
  type PromptStoragePort,
  type SavedPrompt,
} from '../../shared/prompts'
import {
  admitShareRelease,
  confirmedShareSchema,
  shareJsonSchema,
  shareRequestSchema,
  type ShareJson,
  type ShareRequest,
} from '../../shared/share'
import { agentDataFolder, type DataFolderInput } from '../dataFolder'
import { localArgumentError, type SharingCommand } from './args'

const previewSchema = z
  .strictObject({
    document: shareJsonSchema,
    content: z.string().check(z.minLength(1)),
    redactions: z.array(
      z.strictObject({
        start: z.number().check(z.int(), z.nonnegative()),
        end: z.number().check(z.int(), z.positive()),
      }),
    ),
  })
  .check(z.refine((p) => p.redactions.every((r) => r.start < r.end && r.end <= p.content.length)))

export interface SharePreview {
  readonly previewId: string
  readonly request: ShareRequest
  readonly document: ShareJson
  /** Exact scrubbed bytes displayed and then released. */
  readonly content: string
  readonly redactions: readonly { readonly start: number; readonly end: number }[]
}

export interface SharingUi {
  readonly showPreview: (preview: SharePreview) => Promise<void>
  /** The host's final button only; absent means a noninteractive preview cannot release. */
  readonly confirmShare?: (preview: SharePreview) => Promise<unknown>
  /** Review untrusted text/declared variables before resolving built-ins or named inputs. */
  readonly preparePrompt?: (prompt: SavedPrompt) => Promise<unknown>
  /** Active/new chat in this workspace; no model submission method belongs on this port. */
  readonly insertPrompt?: (request: z.infer<typeof promptLoadSchema>, text: string) => Promise<void>
}

export interface SharingDeps {
  readonly folders: DataFolderInput
  readonly now: () => string
  /** P's same store factory on every surface; no workspace-keyed personal library. */
  readonly storageFor: (folders: { user: string; workspace: string }) => PromptStoragePort
  /** C validates ranges, projects portable fields, scrubs and renders without a destination write. */
  readonly renderPreview: (
    cwd: string,
    request: ShareRequest,
    exportedAt: string,
  ) => Promise<unknown>
  readonly isConfidentialWorkspace: (cwd: string) => boolean | undefined
  /** Canonical paths through existing parents, including symlinks/junctions. */
  readonly io: RealPathIo
  /** Trusted configured share folder; absent confines output to the workspace. */
  readonly shareFolder?: (cwd: string) => string
  /** Starts the destination operation synchronously after admission; no deferred policy gap. */
  readonly release: (
    preview: SharePreview,
    out: string | undefined,
    allowedRoot: string,
  ) => Promise<void>
}

export interface SharingContext {
  readonly cwd: string
  readonly isActive: () => boolean
  readonly ui: SharingUi
  /** CLI save reads stdin; ACP save reads the command's exact text after ` -- `. */
  readonly readBody: () => Promise<string>
}

export type SharingResult =
  | { readonly kind: 'saved'; readonly prompt: SavedPrompt }
  | { readonly kind: 'listed'; readonly prompts: readonly SavedPrompt[] }
  | { readonly kind: 'inserted' | 'prepared'; readonly prompt: SavedPrompt; readonly text: string }
  | { readonly kind: 'shared'; readonly preview: SharePreview }
  | { readonly kind: 'cancelled'; readonly preview?: SharePreview; readonly message?: string }

/** All outbound actions are parameters; a command never starts an agent or resolves a key. */
export class SharingCommands {
  public constructor(private readonly deps: SharingDeps) {}

  private storage(cwd: string): PromptStoragePort {
    const paths = this.deps.folders.platform === 'win32' ? path.win32 : path.posix
    return this.deps.storageFor({
      user: paths.join(agentDataFolder(this.deps.folders), PROMPT_USER_FOLDER),
      workspace: paths.join(cwd, PROMPT_WORKSPACE_FOLDER),
    })
  }

  private async list(cwd: string): Promise<SavedPrompt[]> {
    const storage = this.storage(cwd)
    const scopes = ['user', 'workspace'] as const
    const entries = await Promise.all(
      scopes.map(async (scope) => {
        const stored = await storage.list(scope)
        const prompts = stored.map((prompt) => savedPromptSchema.parse(prompt))
        if (
          prompts.some((prompt) => prompt.scope !== scope) ||
          new Set(prompts.map((p) => p.id)).size !== prompts.length
        ) {
          throw new Error(UI_TEXT.promptFileInvalid)
        }
        return prompts
      }),
    )
    return mergePromptScopes(entries[0] ?? [], entries[1] ?? [])
  }

  private async share(
    command: Extract<SharingCommand, { command: 'share' }>,
    context: SharingContext,
  ): Promise<SharingResult> {
    const cwd = context.cwd
    const out = command.out
    const paths = this.deps.folders.platform === 'win32' ? path.win32 : path.posix
    const allowedRoot = paths.resolve(cwd, this.deps.shareFolder?.(cwd) ?? cwd)
    const confirmationId = command.confirmation
    const policy = () => this.deps.isConfidentialWorkspace(cwd)
    if (policy() !== false) throw new Error(UI_TEXT.shareConfidential)
    if (confirmationId !== undefined && command.exportedAt === undefined)
      throw localArgumentError('--exported-at')
    const request = shareRequestSchema.parse(command.request)
    if (confirmationId !== undefined) {
      let missing = command.destinationExplicit ? undefined : '--destination'
      if (out === undefined && command.destinationExplicit && request.destination === 'file')
        missing = '--out'
      if (missing !== undefined) {
        return { kind: 'cancelled', message: localArgumentError(missing).message }
      }
    }
    const exportedAt = z.iso.datetime({ offset: true }).parse(command.exportedAt ?? this.deps.now())
    const rendered = previewSchema.parse(
      await this.deps.renderPreview(cwd, structuredClone(request), exportedAt),
    )
    const { document } = rendered
    if (
      document.target !== request.target ||
      document.mode !== request.mode ||
      document.createdAt !== exportedAt ||
      JSON.stringify(document.options) !== JSON.stringify(request.options) ||
      (document.target === 'chat' &&
        request.target === 'chat' &&
        JSON.stringify(document.range) !== JSON.stringify(request.range))
    ) {
      throw new Error(UI_TEXT.shareCancelled)
    }
    if (!context.isActive()) return { kind: 'cancelled' }
    if (policy() !== false) throw new Error(UI_TEXT.shareConfidential)
    const preview: SharePreview = {
      ...rendered,
      request,
      previewId: createHash('sha256')
        .update(
          JSON.stringify({
            cwd,
            allowedRoot,
            out,
            request,
            exportedAt,
            content: rendered.content,
          }),
        )
        .digest('hex'),
    }
    // Keep the trusted association private even if a bridge mutates the object it receives.
    const trusted = structuredClone(preview)
    await context.ui.showPreview(structuredClone(trusted))
    if (!context.isActive()) return { kind: 'cancelled', preview: trusted }
    const answer: unknown =
      confirmationId === undefined
        ? await context.ui.confirmShare?.(structuredClone(trusted))
        : { step: 'confirmed', previewId: confirmationId, request: trusted.request }
    if (!context.isActive()) return { kind: 'cancelled', preview: trusted }
    const confirmation = confirmedShareSchema.safeParse(answer)
    if (
      !confirmation.success ||
      confirmation.data.previewId !== trusted.previewId ||
      JSON.stringify(confirmation.data.request) !== JSON.stringify(trusted.request)
    ) {
      return { kind: 'cancelled', preview: trusted }
    }
    let resolvedOut = out
    if (out !== undefined) {
      const confined = await confineWorkspacePath(
        allowedRoot,
        out,
        this.deps.folders.platform,
        this.deps.io,
      )
      if (!confined.ok) {
        return {
          kind: 'cancelled',
          preview: trusted,
          message: `${UI_TEXT.shareCancelled}: --out (${confined.reason})`,
        }
      }
      resolvedOut = confined.absolute
    }
    if (!context.isActive()) return { kind: 'cancelled', preview: trusted }
    admitShareRelease(confirmation.data, policy)
    await this.deps.release(trusted, resolvedOut, allowedRoot)
    return { kind: 'shared', preview: trusted }
  }

  public async execute(command: SharingCommand, context: SharingContext): Promise<SharingResult> {
    if (!context.isActive()) return { kind: 'cancelled' }
    if (command.command === 'share') return await this.share(command, context)
    if (command.action === 'save') {
      const body = await context.readBody()
      if (!context.isActive()) return { kind: 'cancelled' }
      const now = this.deps.now()
      const prompt = savedPromptSchema.parse({
        schemaVersion: PROMPT_SCHEMA_VERSION,
        id: randomUUID(),
        title: command.title,
        body,
        tags: command.tags,
        scope: command.scope,
        createdAt: now,
        updatedAt: now,
        untrusted: false,
        variables: promptVariableNames(body).map((name) => ({
          name,
          source: ['selection', 'file', 'clipboard'].includes(name) ? name : 'input',
        })),
      })
      // P's write enforces the title/body/per-scope caps and atomic-file rules.
      await this.storage(context.cwd).write(prompt)
      return { kind: 'saved', prompt }
    }
    const prompts = await this.list(context.cwd)
    if (!context.isActive()) return { kind: 'cancelled' }
    if (command.action === 'list') {
      const search = command.search.toLocaleLowerCase()
      return {
        kind: 'listed',
        prompts: prompts.filter(
          (p) =>
            `${p.title}\n${p.body}\n${p.tags.join('\n')}`.toLocaleLowerCase().includes(search) &&
            (command.tag === undefined || p.tags.includes(command.tag)),
        ),
      }
    }
    const prompt = prompts.find((p) => p.id === command.promptId && p.scope === command.scope)
    if (prompt === undefined) throw new Error(UI_TEXT.promptFileInvalid)
    const load = promptLoadSchema.parse({
      promptId: prompt.id,
      scope: prompt.scope,
      chat: command.chat,
      action: 'insert',
      send: false,
    })
    let text: string | undefined = prompt.body
    if (prompt.untrusted || prompt.variables.length > 0) {
      if (context.ui.preparePrompt === undefined) {
        throw new Error(
          prompt.untrusted
            ? UI_TEXT.promptUntrusted
            : `${UI_TEXT.promptVariables}: ${prompt.variables.map((variable) => variable.name).join(', ')}`,
        )
      }
      text = z.optional(z.string()).parse(await context.ui.preparePrompt(prompt))
    }
    if (text === undefined || !context.isActive()) return { kind: 'cancelled' }
    if (context.ui.insertPrompt === undefined) return { kind: 'prepared', prompt, text }
    await context.ui.insertPrompt(load, text)
    return { kind: 'inserted', prompt, text }
  }
}

/** CLI integration entry: stdin/save and destinations are supplied by the trusted launcher. */
export async function runSharingCommand(
  command: SharingCommand,
  commands: SharingCommands,
  context: SharingContext,
): Promise<SharingResult & { readonly exitCode: typeof EXEC_EXIT.ok | typeof EXEC_EXIT.denied }> {
  const paths = process.platform === 'win32' ? path.win32 : path.posix
  const cwd = command.cwd === undefined ? context.cwd : paths.resolve(command.cwd)
  const result = await commands.execute(command, { ...context, cwd })
  return { ...result, exitCode: result.kind === 'cancelled' ? EXEC_EXIT.denied : EXEC_EXIT.ok }
}
