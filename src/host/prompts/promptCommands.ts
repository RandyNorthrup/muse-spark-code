import type { PromptDraft } from '../../core/prompts/promptTypes'
import type { PromptLibrary, PromptVariablesPort } from '../../core/prompts/promptLibrary'
import { usePrompt } from '../../core/prompts/promptLibrary'
import type {
  PromptImporter,
  PromptImportSource,
  PromptSharer,
} from '../../core/prompts/promptImport'
import { PROMPT_LIMITS, UI_TEXT } from '../../shared/constants'
import type { SavedPrompt } from '../../shared/prompts'
import * as z from 'zod/mini'
import { fill } from '../../shared/l10n/text'

/** Also implemented by shared React/native hosts over their validated bridge. */
export interface PromptUiPort {
  pick<T extends string>(
    title: string,
    items: readonly { readonly id: T; readonly label: string; readonly detail?: string }[],
  ): Promise<T | undefined>
  edit(draft: PromptDraft, isNew: boolean): Promise<PromptDraft | undefined>
  preview(title: string, text: string, accept: string): Promise<boolean>
  confirm(title: string): Promise<boolean>
  input(title: string, value?: string): Promise<string | undefined>
  chooseScope(): Promise<SavedPrompt['scope'] | undefined>
  report(message: string): Promise<void>
}

const sourceSchema = z.object({
  'museSpark.promptSource': z.enum(['composer', 'userMessage']),
  'museSpark.promptText': z.string(),
  'museSpark.transcriptRole': z.optional(z.literal('user')),
  'museSpark.messageIsOwn': z.optional(z.literal(true)),
})

/** Validate native context arguments too; assistant/system/tool messages cannot save. */
export function promptContextText(input: unknown): string | undefined {
  const result = sourceSchema.safeParse(input)
  if (!result.success) return undefined
  const source = result.data
  return source['museSpark.promptSource'] === 'userMessage' &&
    (source['museSpark.transcriptRole'] !== 'user' || source['museSpark.messageIsOwn'] !== true)
    ? undefined
    : source['museSpark.promptText']
}

export interface PromptCommandDeps {
  readonly library: PromptLibrary
  readonly importer: PromptImporter
  readonly sharer: PromptSharer
  readonly ui: PromptUiPort
  readonly variables: PromptVariablesPort
  readonly hasWorkspace: () => boolean
  readonly editorSelection: () => string | undefined
  readonly beforeShare: () => Promise<void>
  readonly afterShare: () => void
  /** Bind to the window's raw pinned fetch or GitHub client when it lands. */
  readonly canImportLinks: boolean
}

/** One implementation for all menu entry points; no implicit sends or network reads. */
export class PromptCommands {
  public constructor(private readonly deps: PromptCommandDeps) {}

  private async pickPrompt(): Promise<SavedPrompt | undefined> {
    const { prompts, scopes } = await this.deps.library.list(this.deps.hasWorkspace())
    for (const result of scopes) {
      if (result.damaged)
        await this.deps.ui.report(
          fill(UI_TEXT.promptScopeDamaged, {
            scope: result.scope === 'user' ? UI_TEXT.promptScopeUser : UI_TEXT.promptScopeWorkspace,
          }),
        )
    }
    const selected = await this.deps.ui.pick(
      UI_TEXT.promptSearch,
      prompts.map((prompt, index) => ({
        id: String(index),
        label: prompt.title,
        detail: `${prompt.scope === 'user' ? UI_TEXT.promptScopeUser : UI_TEXT.promptScopeWorkspace} · ${prompt.tags.join(', ')}`,
      })),
    )
    return selected === undefined ? undefined : prompts[Number(selected)]
  }

  private async sharePrompt(prompt: SavedPrompt): Promise<void> {
    const format = await this.deps.ui.pick(UI_TEXT.sharePrompt, [
      { id: 'text', label: UI_TEXT.shareCopy },
      { id: 'md', label: `${UI_TEXT.shareCopy} (Markdown)` },
      { id: 'file', label: UI_TEXT.shareFile },
    ])
    if (format === undefined) return
    try {
      await this.deps.beforeShare()
      const preview = this.deps.sharer.preview(prompt, format, format === 'file' ? 'file' : 'copy')
      if (
        await this.deps.ui.preview(
          UI_TEXT.shareReviewPrivacy,
          preview.text,
          format === 'file' ? UI_TEXT.shareFile : UI_TEXT.shareCopy,
        )
      ) {
        await this.deps.beforeShare()
        await this.deps.sharer.confirm(preview.id)
      }
    } finally {
      this.deps.sharer.cancel()
      this.deps.afterShare()
    }
  }

  private async importPrompt(): Promise<void> {
    const choices: { id: PromptImportSource['kind']; label: string }[] = [
      { id: 'file', label: UI_TEXT.promptFromFile },
    ]
    if (this.deps.canImportLinks) choices.push({ id: 'link', label: UI_TEXT.promptLink })
    const kind = await this.deps.ui.pick(UI_TEXT.promptImport, choices)
    if (kind === undefined) return
    const location = kind === 'file' ? '' : await this.deps.ui.input(UI_TEXT.promptLink)
    if (location === undefined) return
    // The file adapter opens its chooser on this explicit Import click.
    const source = { kind, location: location === '' ? 'picker' : location }
    const scope = await this.deps.ui.chooseScope()
    if (scope === undefined) return
    const scopeLabel = scope === 'user' ? UI_TEXT.promptScopeUser : UI_TEXT.promptScopeWorkspace
    const preview = await this.deps.importer.preview(source, scope)
    try {
      const text = `${UI_TEXT.promptUntrusted}\n\n${preview.prompt.title}\n\n${preview.prompt.body}\n\n${UI_TEXT.promptVariables}: ${preview.variables.map((variable) => variable.name).join(', ')}`
      if (
        await this.deps.ui.preview(
          UI_TEXT.sharePreview,
          `${scopeLabel}\n\n${text}`,
          fill(UI_TEXT.promptImportConfirmScope, { scope: scopeLabel }),
        )
      ) {
        await this.deps.library.import(this.deps.importer.accept(preview.id))
      }
    } finally {
      this.deps.importer.cancel()
    }
  }

  public async save(input?: unknown): Promise<void> {
    const text = input === undefined ? this.deps.editorSelection() : promptContextText(input)
    if (text === undefined || text.trim() === '') throw new Error(UI_TEXT.promptFileInvalid)
    const draft = await this.deps.ui.edit({ title: '', body: text, tags: [], scope: 'user' }, true)
    if (draft !== undefined) await this.deps.library.save(draft)
  }

  public async use(): Promise<void> {
    const prompt = await this.pickPrompt()
    if (prompt !== undefined) await usePrompt(prompt, this.deps.variables)
  }

  public async copyToUser(): Promise<void> {
    const prompt = await this.pickPrompt()
    if (prompt?.scope === 'workspace') {
      const scope = await this.deps.ui.chooseScope()
      if (scope !== undefined) await this.deps.library.duplicate(prompt, scope)
    } else if (prompt !== undefined) throw new Error(UI_TEXT.promptFileInvalid)
  }

  public async share(input?: unknown): Promise<void> {
    let prompt: SavedPrompt | undefined
    if (input === undefined) prompt = await this.pickPrompt()
    else {
      const body = promptContextText(input)
      if (body === undefined || body.trim() === '') throw new Error(UI_TEXT.promptFileInvalid)
      const firstLine = body.split('\n', 1)[0]?.trim().slice(0, PROMPT_LIMITS.title) ?? ''
      const title = firstLine === '' ? UI_TEXT.sharePrompt : firstLine
      prompt = this.deps.library.prepare({ title, body, tags: [], scope: 'user' })
    }
    if (prompt !== undefined) await this.sharePrompt(prompt)
  }

  public async library(): Promise<void> {
    const choice = await this.deps.ui.pick(UI_TEXT.promptLibrary, [
      { id: 'use', label: UI_TEXT.promptUseSaved },
      { id: 'new', label: UI_TEXT.promptSave },
      { id: 'import', label: UI_TEXT.promptImport },
      { id: 'manage', label: UI_TEXT.promptEdit },
    ])
    if (choice === 'use') {
      await this.use()
      return
    }
    if (choice === 'import') {
      await this.importPrompt()
      return
    }
    if (choice === 'new') {
      const draft = await this.deps.ui.edit({ title: '', body: '', tags: [], scope: 'user' }, true)
      if (draft !== undefined) await this.deps.library.save(draft)
      return
    }
    if (choice !== 'manage') return
    const prompt = await this.pickPrompt()
    if (prompt === undefined) return
    const actions = [
      { id: 'edit', label: UI_TEXT.promptEdit },
      { id: 'delete', label: UI_TEXT.promptDelete },
      { id: 'duplicate', label: UI_TEXT.promptDuplicate },
      { id: 'insert', label: UI_TEXT.promptInsert },
      { id: 'run', label: UI_TEXT.promptRun },
      { id: 'share', label: UI_TEXT.sharePrompt },
      ...(prompt.scope === 'workspace' ? [{ id: 'copy', label: UI_TEXT.promptCopyToUser }] : []),
    ]
    const action = await this.deps.ui.pick(prompt.title, actions)
    switch (action) {
      case 'edit': {
        const draft = await this.deps.ui.edit(prompt, false)
        if (draft !== undefined) await this.deps.library.save(draft, prompt)
        break
      }
      case 'delete': {
        if (await this.deps.ui.confirm(UI_TEXT.promptDeleteConfirm))
          await this.deps.library.remove(prompt)
        break
      }
      case 'duplicate':
      case 'copy': {
        const scope = action === 'copy' ? await this.deps.ui.chooseScope() : prompt.scope
        if (scope !== undefined) await this.deps.library.duplicate(prompt, scope)
        break
      }
      case 'insert':
      case 'run': {
        await usePrompt(prompt, this.deps.variables)
        break
      }
      case 'share': {
        await this.sharePrompt(prompt)
        break
      }
      default: {
        break
      }
    }
  }

  public synchronise(): Promise<void> {
    return this.deps.library.synchronise()
  }
}
