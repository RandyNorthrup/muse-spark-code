// M104g's conformance runners as they behave for a shim: each is excepted from the MHP scenarios,
// so it refuses with exit 3 and its need, and the orchestrator keeps that need on the pending
// outcome. Runs the real runners (node hosts/<host>/run.mjs), which refuse in milliseconds; no
// harness starts.
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { rowFor } from '../../scripts/lib/editor-matrix.mjs'
import { runConformance } from '../hostApi/run.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))

describe('M104g shim runners refuse with their need', () => {
  for (const host of ['neovim', 'emacs', 'sublime', 'zed', 'qtcreator']) {
    it(`${host} is pending with a need that names the exception`, () => {
      const [outcome] = runConformance(root, [host])
      expect(outcome?.host).toBe(host)
      expect(outcome?.outcome).toBe('pending')
      if (outcome?.outcome !== 'pending') throw new Error(`${host} was not pending`)
      expect(outcome.need.startsWith('MHP_CONFORMANCE_PENDING:')).toBe(true)
      expect(outcome.need.length).toBeGreaterThan('MHP_CONFORMANCE_PENDING: '.length)
    })
  }
})

describe('M104g matrix rows from live pending outcomes', () => {
  for (const host of ['neovim', 'emacs']) {
    it(`${host} renders a Pending row carrying the live need`, () => {
      const [outcome] = runConformance(root, [host])
      if (outcome?.outcome !== 'pending') throw new Error(`${host} was not pending`)
      const row = rowFor(host, {
        host,
        outcome: 'pending',
        editorVersion: '',
        need: outcome.need,
      })
      expect(row.status).toBe('Pending')
      expect(row.waits).toBe(outcome.need)
      expect(row.evidence).toBe(`[m104-${host}](../certification/m104-${host}.md)`)
    })
  }
})
