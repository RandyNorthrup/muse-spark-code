import { expect, it, vi } from 'vitest'

vi.mock('vscode', () => {
  throw new Error('A native MHP host cannot load VS Code')
})

vi.mock('react', () => {
  throw new Error('A native status widget cannot load React')
})

it('loads and drives the native status adapter without loading VS Code or React', async () => {
  const { createResourceStatus } = await import('../../src/host/resources/resourceStatus')
  const { resourceSettingsSchema } = await import('../../src/shared/resources')
  const item = { update: vi.fn(), show: vi.fn(), hide: vi.fn(), dispose: vi.fn() }
  const handle = createResourceStatus({
    createItem: () => item,
    conversationId: () => undefined,
    notice: vi.fn(),
    invalidStatus: vi.fn(),
    registerShow: () => ({ dispose: vi.fn() }),
    port: {
      getSnapshot: () => ({
        level: 'throttle',
        settings: resourceSettingsSchema.parse({}),
        sample: null,
        queued: [],
        overrideUntilMs: null,
      }),
      subscribe: () => vi.fn(),
      resume: vi.fn(),
      settings: vi.fn(),
      show: vi.fn(),
    },
  })
  expect(item.show).toHaveBeenCalledOnce()
  expect(item.update).toHaveBeenCalledWith('Resources: Throttling', false)
  handle.dispose()
  expect(item.dispose).toHaveBeenCalledOnce()
})
