// D121 (NOLIMITS1 A22): a plan saves and reads back at any size — the
// removed 256 KiB ceiling refused this plan, and the removed 50-step slice
// dropped its later steps. The real store over the real file system in a
// scratch folder: no mocks, no stand-ins.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { type PlanMarkdown, planSteps as planStepsWith } from '../../src/core/plans/planDocument'
import { PLAN_MARKDOWN } from '../../src/core/plans/planMarkdown'
import { PlanStore } from '../../src/core/plans/planStore'
import { createPlanIo } from '../../src/host/planFeatures'
import type { Logger } from '../../src/host/logger'

const quiet = () => undefined
const silent: Logger = { trace: quiet, info: quiet, warn: quiet, error: quiet }

const planSteps = (markdown: PlanMarkdown, body: string) => planStepsWith(markdown, body)

describe('plan file size (D121 A22)', () => {
  it('saves and reads back a 300 KiB plan whole, with all 55 steps', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nolimits-plan-'))
    try {
      const store = new PlanStore({
        workspaceRoot: root,
        platform: process.platform,
        io: createPlanIo({ log: silent, now: () => Date.now() }),
        markdown: () => PLAN_MARKDOWN,
      })
      const steps = Array.from(
        { length: 55 },
        (_, index) => `${String(index + 1)}. Step ${'x'.repeat(5000)}`,
      )
      const text = `# Plan\n\n${steps.join('\n')}\n`
      expect(new TextEncoder().encode(text).byteLength).toBeGreaterThan(256 * 1024)
      const saved = await store.save({ title: 'Big plan', savedAt: new Date(0), text })
      expect(saved.isNew).toBe(true)
      const back = await store.read(saved.fileName)
      expect(back.bytes.byteLength).toBe(new TextEncoder().encode(text).byteLength)
      expect(new TextDecoder().decode(back.bytes)).toBe(text)
      expect(planSteps(PLAN_MARKDOWN, text)).toHaveLength(55)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
