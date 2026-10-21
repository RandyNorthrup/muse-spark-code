// Budget arithmetic uses real price and parser modules, with input data only.
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Usd } from '../../src/shared/usd'
import { EXEC_MIN_OUTPUT_TOKENS } from '../../src/shared/constants'
import { createRunLedger } from '../../src/runtime/exec/runLedger'
import { parseExec } from '../../src/runtime/exec/execArgs'
import { budgetRefusalDetails } from '../../src/runtime/runtimeAccountingEntry'
import { reserveRequestAmount, type PriceCard } from '../../src/core/providers/priceCard'
import { encodeAnthropicRequest } from '../../src/core/backends/modelapi/codecs/anthropic'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'

const card: PriceCard = { source: 'user', input: 0.000005, output: 0.00009 }
function body(maxOutputTokens: number): CreateResponseBody {
  return {
    model: 'anthropic/claude-haiku-4-5',
    instructions: `Workspace: ${path.resolve('.')}`,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Explain this repository.' }],
      },
    ],
    tools: [],
    tool_choice: 'auto',
    reasoning: { effort: 'none' },
    stream: true,
    store: false,
    include: [],
    prompt_cache_key: '',
    prompt_cache_retention: 'in_memory',
    max_output_tokens: maxOutputTokens,
  }
}
function quote(
  inputTokens: number,
  outputTokens: number,
  cap = '1',
  minimum = EXEC_MIN_OUTPUT_TOKENS,
) {
  const reserveForOutput = (outputTokens: number) =>
    reserveRequestAmount(card, { inputTokens, outputTokens })
  const ledger = createRunLedger({ capUsd: Usd.from(cap).toAmount(), maxRequests: 1 })
  return {
    reserveForOutput,
    details: budgetRefusalDetails(
      {
        inputTokens,
        inputCost: reserveForOutput(0),
        outputTokens,
        reserveUsd: reserveForOutput(outputTokens),
        totals: ledger.totals(),
      },
      reserveForOutput,
      minimum,
    ),
  }
}

describe('accepted remedies and sent output caps', () => {
  it('a $1 budget offers the largest fitting cap for a $23 model limit', () => {
    const request = body(262_144)
    const inputTokens = Buffer.byteLength(JSON.stringify(request))
    const { details, reserveForOutput } = quote(inputTokens, request.max_output_tokens)
    expect(
      Usd.from(reserveForOutput(request.max_output_tokens)).compare(Usd.from(23)),
    ).toBeGreaterThan(0)
    // D208: any cap the person sets admits, so the raise remedy always names
    // the admitting cap; the fitting output cap below is the smaller remedy.
    expect(details.admitCapUsd).toBe(
      Usd.from(reserveForOutput(request.max_output_tokens)).ceiling(2).toAmount(),
    )
    const output = details.maxOutputTokens
    if (output === null) throw new Error('missing fitting output remedy')
    expect(Usd.from(reserveForOutput(output)).ceiling(6).compare(Usd.from(1))).toBeLessThanOrEqual(
      0,
    )
    expect(
      Usd.from(reserveForOutput(output + 1))
        .ceiling(6)
        .compare(Usd.from(1)),
    ).toBeGreaterThan(0)
    const parsed = parseExec(
      { backend: 'modelApi', 'max-budget-usd': '1', 'max-output-tokens': String(output) },
      ['Explain this repository.'],
    )
    if (!parsed.ok) throw new Error(parsed.reason)
    expect(parsed.options.maxOutputTokens).toBe(output)
    const sent = body(output)
    const encoded = encodeAnthropicRequest(sent, {
      model: 'claude-haiku-4-5',
      maxTokens: sent.max_output_tokens,
      effort: 'none',
    })
    expect(encoded.body.max_tokens).toBe(output)
    const l = createRunLedger({
      capUsd: Usd.from(1).toAmount(),
      maxRequests: 1,
      outputCap: () => output,
    })
    const ticket = l.admitResponse({
      model: sent.model,
      maxOutputTokens: output,
      reserveUsd: reserveRequestAmount(card, {
        inputTokens: Buffer.byteLength(JSON.stringify(sent)),
        outputTokens: output,
      }),
      price: {
        input: Usd.from(5).toAmount(),
        cachedInput: Usd.from(5).toAmount(),
        output: Usd.from(90).toAmount(),
      },
    })
    expect(ticket).not.toHaveProperty('refused')
    if ('refused' in ticket) throw new Error(ticket.refused)
    expect(ticket.maxOutputTokens).toBe(encoded.body.max_tokens)
  })
  it('never recommends an output cap below the parser or provider minimum', () => {
    expect(quote(1, 100, '0.00001').details.maxOutputTokens).toBeNull()
    expect(quote(1, 2048, '0.05', 1024).details.maxOutputTokens).toBeNull()
  })
  it('the checkout path affects bytes, and the quote follows those actual bytes', () => {
    const inputTokens = Buffer.byteLength(JSON.stringify(body(32_768)))
    const { details, reserveForOutput } = quote(inputTokens, 32_768, '0.1')
    expect(details.inputCostUsd).toBe(Usd.from(reserveForOutput(0)).ceiling(6).toAmount())
    expect(details.maxOutputTokens).not.toBeNull()
  })
  it('an input too large for the budget still names the admitting cap', () => {
    const { details, reserveForOutput } = quote(5_000_000, 32_768)
    // D208: no spend cap of ours makes any input unadmittable — the remedy
    // names the cap that admits, even past the model's own output limit.
    expect(details).toMatchObject({
      inputAloneExceeds: true,
      admitCapUsd: Usd.from(reserveForOutput(32_768)).ceiling(2).toAmount(),
      maxOutputTokens: null,
    })
  })
})
