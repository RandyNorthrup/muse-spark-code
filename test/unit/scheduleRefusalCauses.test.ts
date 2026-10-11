import { expect, it, vi } from 'vitest'
import { unattendedRun } from './helpers/schedules/unattended'
import { fakeRunContext, fakeSchedule } from './helpers/schedules/fixtures'

it.each(['paused', 'generation retired', 'aborted'])(
  'names %s ordinary-file refusal as inactive across all read paths',
  async () => {
    const { run } = unattendedRun({ isActive: () => false })
    expect(run.canReadFile('src/app.ts', String.raw`src\app.ts`)).toBe(false)
    expect(run.refusedActions.at(-1)?.reason).toBe(run.modelText.inactiveRefused)
    expect(
      await run.decide(
        {
          id: 'file',
          class: 'mcp',
          tool: 'file',
          paths: ['src/app.ts'],
          requiresAsking: false,
          protectedPath: false,
        },
        false,
      ),
    ).toEqual({ allowed: false, reason: run.modelText.inactiveRefused })
    expect(
      run.refusedActions.every((action) => action.reason === run.modelText.inactiveRefused),
    ).toBe(true)
  },
)
it('distinguishes grant audit failure and an unverifiable ordinary path from protected files', async () => {
  const context = fakeRunContext(
    fakeSchedule({
      grant: {
        rules: [{ id: 'read', kind: 'tool', name: 'read' }],
        destinationIds: [],
        paidCapUsd: fakeSchedule().paidCapUsd,
      },
    }),
  )
  const audit = vi.fn(() => Promise.reject(new Error('audit storage unavailable')))
  const { run } = unattendedRun({ context, audit })
  expect(
    await run.decide({
      id: 'read',
      class: 'mcp',
      tool: 'read',
      paths: [],
      requiresAsking: false,
      protectedPath: false,
    }),
  ).toEqual({ allowed: false, reason: run.modelText.auditRefused })
  const broken = unattendedRun({
    io: { realPath: () => Promise.reject(new Error('file unavailable')) },
  }).run
  expect(
    await broken.decide(
      {
        id: 'file',
        class: 'mcp',
        tool: 'file',
        paths: ['src/app.ts'],
        requiresAsking: false,
        protectedPath: false,
      },
      false,
    ),
  ).toEqual({ allowed: false, reason: broken.modelText.pathUnverified })
})
