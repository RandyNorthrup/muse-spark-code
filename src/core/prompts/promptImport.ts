import type { PromptImportPreview } from './promptTypes'
import { randomUUID } from 'node:crypto'
import * as z from 'zod/mini'
import { PROMPT_LIMITS, UI_TEXT } from '../../shared/constants'
import { importPromptFile, serialisePromptFile, type SavedPrompt } from '../../shared/prompts'
import { scrubShareText, type SharePrivacyPort } from '../../shared/share'
import { validatePrompt } from './promptStore'

export interface PromptImportPort {
  /** A bounded local-file reader or the host's pinned public HTTPS transport. */
  read(source: {
    readonly kind: 'file' | 'link' | 'gist'
    readonly location: string
  }): Promise<string>
  isConfidentialWorkspace(): boolean | undefined
}

const sourceSchema = z.strictObject({
  kind: z.enum(['file', 'link', 'gist']),
  location: z.string().check(z.minLength(1)),
})
export type PromptImportSource = z.infer<typeof sourceSchema>
/** A preview lives in memory; only its exact host-owned prompt can be accepted. */
export class PromptImporter {
  private pending: PromptImportPreview | undefined
  private generation = 0
  public constructor(private readonly port: PromptImportPort) {}

  public async preview(input: unknown, scope: SavedPrompt['scope']): Promise<PromptImportPreview> {
    this.pending = undefined
    const generation = ++this.generation
    const source = sourceSchema.parse(input)
    if (source.kind !== 'file' && this.port.isConfidentialWorkspace() !== false)
      throw new Error(UI_TEXT.shareConfidential)
    const file = await this.port.read(source)
    if (generation !== this.generation) throw new Error(UI_TEXT.promptFileInvalid)
    if (Buffer.byteLength(file, 'utf8') > PROMPT_LIMITS.fileBytes)
      throw new Error(UI_TEXT.promptLimits)
    const { prompt } = importPromptFile(file, scope)
    validatePrompt(prompt)
    const preview = { id: randomUUID(), prompt, variables: prompt.variables }
    this.pending = preview
    return structuredClone(preview)
  }

  public accept(id: string): SavedPrompt {
    const preview = this.pending
    if (preview?.id !== id) throw new Error(UI_TEXT.promptFileInvalid)
    this.pending = undefined
    this.generation++
    return structuredClone(preview.prompt)
  }

  public cancel(): void {
    this.pending = undefined
    this.generation++
  }
}

export interface PromptSharePort extends SharePrivacyPort {
  isConfidentialWorkspace(): boolean | undefined
  release(
    destination: 'copy' | 'file',
    text: string,
    title: string,
    admit: () => void,
  ): Promise<void>
}

/** Prompt copy/export uses the same scrub and final-click policy as chat sharing. */
export class PromptSharer {
  private pending:
    { id: string; text: string; title: string; destination: 'copy' | 'file' } | undefined
  private generation = 0
  public constructor(private readonly port: PromptSharePort) {}

  private checkPolicy(): void {
    if (this.port.isConfidentialWorkspace() !== false) throw new Error(UI_TEXT.shareConfidential)
  }

  public preview(
    prompt: SavedPrompt,
    format: 'text' | 'md' | 'file',
    destination: 'copy' | 'file',
  ) {
    this.pending = undefined
    this.generation++
    this.checkPolicy()
    const clean = validatePrompt({
      ...prompt,
      title: scrubShareText(prompt.title, this.port),
      body: scrubShareText(prompt.body, this.port),
      tags: prompt.tags.map((tag) => scrubShareText(tag, this.port)),
      id: scrubShareText(prompt.id, this.port),
    })
    const content = format === 'md' ? `# ${clean.title}\n\n${clean.body}` : clean.body
    const text = format === 'file' ? serialisePromptFile(clean) : content
    const preview = { id: randomUUID(), text, title: clean.title, destination }
    this.pending = preview
    return { ...preview }
  }

  public async confirm(id: string): Promise<void> {
    const preview = this.pending
    if (preview?.id !== id) throw new Error(UI_TEXT.promptFileInvalid)
    const generation = this.generation
    this.pending = undefined
    this.checkPolicy()
    // Registered secrets can change while the preview is open; require a fresh preview then.
    if (scrubShareText(preview.text, this.port) !== preview.text)
      throw new Error(UI_TEXT.promptFileInvalid)
    await this.port.release(preview.destination, preview.text, preview.title, () => {
      if (generation !== this.generation) throw new Error(UI_TEXT.shareCancelled)
    })
  }

  public cancel(): void {
    this.pending = undefined
    this.generation++
  }
}
