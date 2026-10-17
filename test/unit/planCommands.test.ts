import { describe, expect, it, vi } from 'vitest'
import type { PlanSummary } from '../../src/core/plans/planStore'
import { choosePlan } from '../../src/host/commands/planCommands'
import type { PickItem, PickOne } from '../../src/host/commands/pickItem'
import { UI_TEXT } from '../../src/shared/constants'
import { plural } from '../../src/shared/l10n/text'

const plans: readonly PlanSummary[] = [
  { fileName: '2026-09-27-b.md', relativePath: '.agents/plans/2026-09-27-b.md', title: 'B' },
  { fileName: '2026-09-01-a.md', relativePath: '.agents/plans/2026-09-01-a.md', title: 'A' },
]

/** A pick that answers each call in turn and records what it was shown. */
function scriptedPick(...answers: (string | undefined)[]) {
  const shown: { items: readonly PickItem[]; title: string; placeholder: string }[] = []
  const pick = vi.fn<PickOne>((items, title, placeholder) => {
    shown.push({ items, title, placeholder })
    return Promise.resolve(answers.shift())
  })
  return { pick, shown }
}

describe('Plans… (M79)', () => {
  it('lists the plans by title and file, then offers Open and Implement', async () => {
    const { pick, shown } = scriptedPick('plan:1', 'open')
    await expect(choosePlan(plans, pick)).resolves.toEqual({ plan: plans[1], action: 'open' })
    expect(shown[0]).toEqual({
      items: [
        { id: 'plan:0', label: 'B', description: '2026-09-27-b.md' },
        { id: 'plan:1', label: 'A', description: '2026-09-01-a.md' },
      ],
      title: UI_TEXT.plansTitle,
      placeholder: plural(UI_TEXT.plansCount, 2),
    })
    expect(shown[1]?.items.map((item) => item.label)).toEqual([
      UI_TEXT.planOpen,
      UI_TEXT.implementPlan,
    ])
    expect(shown[1]?.title).toBe('A')
  })

  it('answers Implement, and nothing when either pick is dismissed', async () => {
    await expect(choosePlan(plans, scriptedPick('plan:0', 'implement').pick)).resolves.toEqual({
      plan: plans[0],
      action: 'implement',
    })
    await expect(choosePlan(plans, scriptedPick(undefined).pick)).resolves.toBeUndefined()
    await expect(choosePlan(plans, scriptedPick('plan:0', undefined).pick)).resolves.toBeUndefined()
    await expect(choosePlan(plans, scriptedPick('plan:9').pick)).resolves.toBeUndefined()
  })
})
