import { promptDraftSchema, type PromptDraft } from './promptTypes'
import * as z from 'zod/mini'
import { PROMPT_LIMITS, PROMPT_SCHEMA_VERSION, UI_TEXT } from '../../shared/constants'
import {
  savedPromptSchema,
  promptVariableNames,
  mergePromptScopes,
  type PromptStoragePort,
  type SavedPrompt,
} from '../../shared/prompts'
import { validatePrompt } from './promptStore'

function isBuiltIn(name: string): name is 'selection' | 'file' | 'clipboard' {
  return ['selection', 'file', 'clipboard'].includes(name)
}

export interface PromptVariablesPort {
  /** Invoked only after the user's Use/Run click; each source is reviewed. */
  valueFor(variable: SavedPrompt['variables'][number]): Promise<string | undefined>
  review(text: string, prompt: SavedPrompt): Promise<boolean>
  insert(text: string): Promise<void>
}

/** Files remain the authority; a sync provider is an opt-in mirror, user scope only. */
export interface PromptSyncPort {
  isOn(): boolean
  read(): unknown
  write(prompts: readonly SavedPrompt[]): Promise<void>
}

const syncSchema = z.array(savedPromptSchema).check(z.maxLength(PROMPT_LIMITS.perScope))

export class PromptLibrary {
  public constructor(
    private readonly store: PromptStoragePort,
    private readonly identity: { id(): string; now(): string },
    private readonly sync?: PromptSyncPort,
  ) {}

  private async mirror(removedId?: string): Promise<void> {
    await this.synchronise(removedId)
  }

  public async list(hasWorkspace = true): Promise<{
    prompts: SavedPrompt[]
    scopes: { scope: SavedPrompt['scope']; prompts: readonly SavedPrompt[]; damaged: boolean }[]
  }> {
    const scopes: {
      scope: SavedPrompt['scope']
      prompts: readonly SavedPrompt[]
      damaged: boolean
    }[] = []
    const scopesToRead: readonly SavedPrompt['scope'][] = hasWorkspace
      ? ['user', 'workspace']
      : ['user']
    for (const scope of scopesToRead) {
      try {
        scopes.push({ scope, prompts: await this.store.list(scope), damaged: false })
      } catch {
        scopes.push({ scope, prompts: [], damaged: true })
      }
    }
    return {
      prompts: mergePromptScopes(
        scopes.find((result) => result.scope === 'user')?.prompts ?? [],
        scopes.find((result) => result.scope === 'workspace')?.prompts ?? [],
      ),
      scopes,
    }
  }

  /** Prepare ephemeral shares without storing the message or composer text. */
  public prepare(input: PromptDraft, existing?: SavedPrompt): SavedPrompt {
    const draft = promptDraftSchema.parse(input)
    const now = this.identity.now()
    const names = promptVariableNames(draft.body)
    const prompt = validatePrompt({
      schemaVersion: PROMPT_SCHEMA_VERSION,
      id: existing?.id ?? this.identity.id(),
      title: draft.title,
      body: draft.body,
      tags: [...draft.tags],
      variables: names.map((name) => ({
        name,
        source: isBuiltIn(name) ? name : 'input',
      })),
      scope: draft.scope,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      untrusted: existing?.untrusted ?? false,
    })
    if (existing !== undefined && existing.scope !== prompt.scope)
      throw new Error(UI_TEXT.promptFileInvalid)
    return prompt
  }

  public async save(draft: PromptDraft, existing?: SavedPrompt): Promise<SavedPrompt> {
    const prompt = this.prepare(draft, existing)
    await this.store.write(prompt)
    if (prompt.scope === 'user') await this.mirror()
    return prompt
  }

  /** A copy always gets a fresh id and preserves imported status and the original. */
  public async duplicate(prompt: SavedPrompt, scope = prompt.scope): Promise<SavedPrompt> {
    const copy = validatePrompt({
      ...prompt,
      id: this.identity.id(),
      scope,
      createdAt: this.identity.now(),
      updatedAt: this.identity.now(),
    })
    await this.store.write(copy)
    if (copy.scope === 'user') await this.mirror()
    return copy
  }

  public async remove(prompt: SavedPrompt): Promise<void> {
    await this.store.remove(prompt.scope, prompt.id)
    if (prompt.scope === 'user') await this.mirror(prompt.id)
  }

  public async import(prompt: SavedPrompt): Promise<SavedPrompt> {
    // Imported ids must not overwrite an existing library entry, even across origins.
    const imported = validatePrompt({ ...prompt, id: this.identity.id(), untrusted: true })
    await this.store.write(imported)
    if (imported.scope === 'user') await this.mirror()
    return imported
  }

  /** Validate the entire mirror before modifying any file; newest per id wins. */
  public async synchronise(removedId?: string): Promise<void> {
    if (this.sync?.isOn() !== true) return
    const parsed = syncSchema.safeParse(this.sync.read())
    if (!parsed.success) throw new Error(UI_TEXT.promptStoreDamaged)
    const remote = parsed.data
    const seen = new Set<string>()
    for (const prompt of remote) {
      validatePrompt(prompt)
      if (prompt.scope !== 'user' || seen.has(prompt.id))
        throw new Error(UI_TEXT.promptStoreDamaged)
      seen.add(prompt.id)
    }
    const local = await this.store.list('user')
    const merged = new Map(local.map((entry) => [entry.id, entry]))
    for (const prompt of remote) {
      // An explicit local deletion excludes only that id; all other remote edits merge.
      if (prompt.id === removedId && !merged.has(prompt.id)) continue
      const previous = merged.get(prompt.id)
      const winner =
        previous === undefined || Date.parse(prompt.updatedAt) > Date.parse(previous.updatedAt)
          ? prompt
          : previous
      merged.set(prompt.id, {
        ...winner,
        untrusted: prompt.untrusted || previous?.untrusted === true,
      })
    }
    if (merged.size > PROMPT_LIMITS.perScope) throw new Error(UI_TEXT.promptLimits)
    for (const prompt of merged.values()) await this.store.write(prompt, true)
    // Read back any revision another window saved before our lock was acquired.
    if (this.sync.isOn()) await this.sync.write(await this.store.list('user'))
  }
}

/** Literal replacement: input containing another placeholder is never expanded again. */
export async function usePrompt(
  prompt: SavedPrompt,
  port: PromptVariablesPort,
): Promise<'inserted' | 'cancelled'> {
  validatePrompt(prompt)
  const values = new Map<string, string>()
  for (const variable of prompt.variables) {
    const value = await port.valueFor(variable)
    if (value === undefined) return 'cancelled'
    values.set(variable.name, value)
  }
  const text = prompt.body.replaceAll(
    /\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g,
    (_match: string, name: string) => values.get(name) ?? '',
  )
  if (text.length > PROMPT_LIMITS.body) throw new Error(UI_TEXT.promptLimits)
  if (!(await port.review(text, prompt))) return 'cancelled'
  await port.insert(text)
  return 'inserted'
}
