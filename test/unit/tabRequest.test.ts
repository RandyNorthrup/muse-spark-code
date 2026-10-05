import { describe, expect, it } from 'vitest'

import {
  TAB_FAST_MAX_OUTPUT_TOKENS,
  TAB_HOLE_MARKER,
  TAB_MODEL_TEXT,
  TAB_MULTILINE_MAX_OUTPUT_TOKENS,
  TAB_PROMPT_CACHE_KEY_PREFIX,
} from '../../src/shared/constants'
import {
  isMissingApiKeyError,
  isModelApiError,
  MissingApiKeyError,
  ModelApiError,
} from '../../src/core/backends/modelapi/client'
import { promptCacheKey } from '../../src/core/backends/modelapi/promptCache'
import {
  buildTabRequest,
  tabPromptCacheKey,
  tabUserText,
  type TabRequestInput,
} from '../../src/core/tab/tabRequest'

const INPUT: TabRequestInput = {
  model: 'muse-spark-1.3',
  path: 'src/example.ts',
  languageId: 'typescript',
  prefix: 'export function add(a: number, b: number) {\n  return ',
  suffix: '\n}\n',
  snippets: '',
  mode: 'fast',
}

describe('buildTabRequest', () => {
  it('has the Tab shape: streamed, unstored, no tools, minimal effort, no summary', () => {
    const body = buildTabRequest(INPUT)
    expect(body.model).toBe(INPUT.model)
    expect(body.stream).toBe(true)
    expect(body.store).toBe(false)
    expect(body.tools).toEqual([])
    expect(body.tool_choice).toBe('auto')
    expect(body.reasoning).toEqual({ effort: 'minimal' })
    expect('summary' in body.reasoning).toBe(false)
    expect('previous_response_id' in body).toBe(false)
    expect(body.include).toEqual([])
    expect(body.instructions).toBe(TAB_MODEL_TEXT.tabSystem)
    expect(body.max_output_tokens).toBe(TAB_FAST_MAX_OUTPUT_TOKENS)
  })

  it('uses the multi-line output cap in multi-line mode', () => {
    expect(buildTabRequest({ ...INPUT, mode: 'multiline' }).max_output_tokens).toBe(
      TAB_MULTILINE_MAX_OUTPUT_TOKENS,
    )
  })

  it('fences the path, the prefix, the hole and the suffix as data', () => {
    const body = buildTabRequest(INPUT)
    const item = body.input[0]
    if (item?.type !== 'message') {
      throw new Error('expected the one user message')
    }
    const part = item.content[0]
    if (part?.type !== 'input_text') {
      throw new Error('expected the one text part')
    }
    expect(part.text).toContain(INPUT.prefix)
    expect(part.text).toContain(INPUT.suffix)
    expect(part.text).toContain(TAB_HOLE_MARKER)
    expect(part.text.indexOf(INPUT.prefix)).toBeLessThan(part.text.indexOf(TAB_HOLE_MARKER))
    expect(part.text.indexOf(TAB_HOLE_MARKER)).toBeLessThan(part.text.indexOf(INPUT.suffix))
  })

  it('passes code holding braces through literally', () => {
    const text = tabUserText({ ...INPUT, prefix: 'const template = "{path}";' })
    expect(text).toContain('const template = "{path}";')
  })

  it('never reads an inserted value for slots: later slot names stay literal', () => {
    const prefix = 'const template = "{suffix} {holeMarker}";'
    const text = tabUserText({ ...INPUT, prefix })
    expect(text).toContain(prefix)
    expect(text.split(TAB_HOLE_MARKER)).toHaveLength(2)
    expect(text.split(INPUT.suffix)).toHaveLength(2)
  })

  it('never reads a snippet for slots, so the request head stays stable', () => {
    const snippets = '```src/other.ts\nconst head = "{prefix}"\n```'
    const earlier = tabUserText({ ...INPUT, snippets, prefix: 'const x = ' })
    const later = tabUserText({ ...INPUT, snippets, prefix: 'const x = fo' })
    expect(earlier).toContain(snippets)
    expect(later).toContain(snippets)
    const head = earlier.slice(0, earlier.indexOf(snippets) + snippets.length)
    expect(later.startsWith(head)).toBe(true)
  })
})

describe('tabPromptCacheKey', () => {
  it('carries Tab’s own prefix and is stable across keystrokes', () => {
    const first = tabPromptCacheKey(INPUT.model)
    expect(first.startsWith(TAB_PROMPT_CACHE_KEY_PREFIX)).toBe(true)
    expect(tabPromptCacheKey(INPUT.model)).toBe(first)
  })

  it('changes with the model but never equals a conversation key', () => {
    expect(tabPromptCacheKey('muse-spark-1.3-contributor')).not.toBe(tabPromptCacheKey(INPUT.model))
    const conversation = promptCacheKey({
      model: INPUT.model,
      instructions: TAB_MODEL_TEXT.tabSystem,
      tools: [],
    })
    expect(conversation.startsWith(TAB_PROMPT_CACHE_KEY_PREFIX)).toBe(false)
    expect(conversation).not.toBe(tabPromptCacheKey(INPUT.model))
  })

  it('stays byte-identical up to the earlier cursor while typing forward', () => {
    const earlier = tabUserText({ ...INPUT, prefix: 'const x = ' })
    const later = tabUserText({ ...INPUT, prefix: 'const x = fo' })
    const hole = earlier.indexOf(TAB_HOLE_MARKER)
    const fence = '\n```\n'
    const head = earlier.slice(0, hole - fence.length)
    expect(head.endsWith('const x = ')).toBe(true)
    expect(later.startsWith(head)).toBe(true)
  })
})

describe('isModelApiError', () => {
  it('tells a ModelApiError apart by name and fields, not instanceof', () => {
    expect(isModelApiError(new ModelApiError('nope', 429, 'rate_limit_error', undefined))).toBe(
      true,
    )
    // The Tab bundle's copy of the class: the same shape, another identity.
    expect(
      isModelApiError({ name: 'ModelApiError', status: 500, message: 'boom', kind: 'x' }),
    ).toBe(true)
  })

  it('refuses anything else', () => {
    expect(isModelApiError(new MissingApiKeyError())).toBe(false)
    expect(isModelApiError({ name: 'ModelApiError', message: 'no status' })).toBe(false)
    expect(isModelApiError({ name: 'ModelApiError', status: '500', message: 'wrong type' })).toBe(
      false,
    )
    expect(isModelApiError(new Error('plain'))).toBe(false)
    expect(isModelApiError(undefined)).toBe(false)
    expect(isModelApiError('ModelApiError')).toBe(false)
  })
})

describe('isMissingApiKeyError', () => {
  it('tells a MissingApiKeyError apart by name, not instanceof', () => {
    expect(isMissingApiKeyError(new MissingApiKeyError())).toBe(true)
    expect(isMissingApiKeyError({ name: 'MissingApiKeyError', message: 'gone' })).toBe(true)
  })

  it('refuses anything else', () => {
    expect(isMissingApiKeyError(new ModelApiError('nope', 0, undefined, undefined))).toBe(false)
    expect(isMissingApiKeyError({ name: 'MissingApiKeyError' })).toBe(false)
    expect(isMissingApiKeyError(undefined)).toBe(false)
  })
})
