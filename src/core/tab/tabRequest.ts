// A Tab request's body and cache key (M94, PLAN.md D73): its own
// `POST /responses` through the key client, never a conversation's. Pure:
// no `vscode` import. The request is ordered for prefix caching —
// instructions, snippets, header, prefix, marker, suffix — and the key
// names only the model and the instructions, so it is stable across
// keystrokes while the body shares a byte-identical head.

import { createHash } from 'node:crypto'

import {
  MODEL_API_EFFORT_OFF,
  PROMPT_CACHE_KEY_DIGEST_CHARS,
  PROMPT_CACHE_KEY_HASH,
  TAB_FAST_MAX_OUTPUT_TOKENS,
  TAB_HOLE_MARKER,
  TAB_MODEL_TEXT,
  TAB_MULTILINE_MAX_OUTPUT_TOKENS,
  TAB_PROMPT_CACHE_KEY_PREFIX,
} from '../../shared/constants'
import type { CreateResponseBody } from '../backends/modelapi/schemas'
import type { TabMode } from './tabContext'

export interface TabRequestInput {
  readonly model: string
  /** Workspace-relative path, the only file identity the model sees. */
  readonly path: string
  readonly languageId: string
  readonly prefix: string
  readonly suffix: string
  /** Rendered by `orderSnippets`: sorted by path, bounded, fenced. */
  readonly snippets: string
  readonly mode: TabMode
}

export type TabUserInput = Omit<TabRequestInput, 'model' | 'mode'>

/**
 * The one user message: the file's path and language, the prefix, the fixed
 * hole marker, the suffix and any context snippets, each fenced as data.
 * Slots are replaced literally, so code holding braces passes through.
 */
export function tabUserText(input: TabUserInput): string {
  const slots: Readonly<Record<string, string>> = {
    path: input.path,
    languageId: input.languageId,
    snippets: input.snippets,
    prefix: input.prefix,
    holeMarker: TAB_HOLE_MARKER,
    suffix: input.suffix,
  }
  let text: string = TAB_MODEL_TEXT.tabUserTemplate
  for (const [slot, value] of Object.entries(slots)) {
    text = text.split(`{${slot}}`).join(value)
  }
  return text
}

/**
 * Tab's own cache key: its prefix is never a conversation's (SoL-Pi), and
 * the digest names only the model and the Tab instructions, so consecutive
 * requests while typing share it.
 */
export function tabPromptCacheKey(model: string): string {
  const digest = createHash(PROMPT_CACHE_KEY_HASH)
    .update(JSON.stringify([model, TAB_MODEL_TEXT.tabSystem]))
    .digest('hex')
    .slice(0, PROMPT_CACHE_KEY_DIGEST_CHARS)
  return `${TAB_PROMPT_CACHE_KEY_PREFIX}${digest}`
}

/**
 * The body: streamed, unstored, no tools, no `previous_response_id`,
 * `minimal` effort (`none` is a 400, A3; `MODEL_API_EFFORT_OFF` is that
 * floor) with no reasoning summary, and the mode's output cap. The
 * retention stays Meta's default: Tab bursts are sub-minute typing.
 */
export function buildTabRequest(input: TabRequestInput): CreateResponseBody {
  return {
    model: input.model,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: tabUserText(input) }],
      },
    ],
    instructions: TAB_MODEL_TEXT.tabSystem,
    tools: [],
    tool_choice: 'auto',
    reasoning: { effort: MODEL_API_EFFORT_OFF },
    stream: true,
    store: false,
    include: [],
    max_output_tokens:
      input.mode === 'fast' ? TAB_FAST_MAX_OUTPUT_TOKENS : TAB_MULTILINE_MAX_OUTPUT_TOKENS,
    prompt_cache_key: tabPromptCacheKey(input.model),
    prompt_cache_retention: 'in_memory',
  }
}
