import { describe, expect, it } from 'vitest'
import { vaultProvenance } from '../../../src/core/vault/taint'
import { createHeadlessVaultTaintSource } from '../../../src/runtime/vault/vaultExecHost'

// RLF-M109H item 4: a headless run's vault taint is what the engine
// noted during the run, accumulated in the one source the vault
// service authorizes against. Before this wiring the headless host
// presented a clean session it had built itself and nothing ever
// observed into it (docs/certification/rvm109.md section 2). The
// broker-level refusal for a noted taint is the delegated suite's
// case; this file pins the source's own accumulation.

describe('headless vault taint source (RLF-M109H)', () => {
  it('starts clean, accumulates a noted provenance, and never clears it', () => {
    const source = createHeadlessVaultTaintSource()
    expect(source.current()).toEqual({ tainted: false, reasons: [] })
    source.note('run-session', { tainted: false, reasons: [] })
    expect(source.current().tainted).toBe(false)
    source.note('run-session', vaultProvenance('search', 'web_search_call'))
    const noted = source.current()
    expect(noted.tainted).toBe(true)
    expect(noted.reasons).toEqual([{ source: 'search', label: 'web_search_call' }])
    // A later clean snapshot from the engine cannot untaint the run.
    source.note('run-session', { tainted: false, reasons: [] })
    expect(source.current().tainted).toBe(true)
  })

  it('keeps every noted reason and stays per-source', () => {
    const first = createHeadlessVaultTaintSource()
    const second = createHeadlessVaultTaintSource()
    first.note('a', vaultProvenance('web', 'example page'))
    first.note('a', vaultProvenance('search', 'web_search_call'))
    expect(first.current().reasons.map((reason) => reason.source)).toEqual(['web', 'search'])
    expect(second.current()).toEqual({ tainted: false, reasons: [] })
  })
})
