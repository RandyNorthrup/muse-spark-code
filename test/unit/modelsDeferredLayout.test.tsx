// @vitest-environment jsdom
// Hold both real section imports: keep the visible document through a
// transition and reserve the remembered box on the next document.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelsPanelState } from '../../src/shared/modelsPanel'
import { Usd } from '../../src/shared/usd'
import type { HostBridge } from '../../src/webview/hostBridge'

const chunks = {
  providers: Promise.withResolvers<undefined>(),
  models: Promise.withResolvers<undefined>(),
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  chunks.providers = Promise.withResolvers<undefined>()
  chunks.models = Promise.withResolvers<undefined>()
  vi.resetModules()
  vi.doMock('../../src/webview/models/ProvidersSection', async (importOriginal) => {
    await chunks.providers.promise
    return await importOriginal()
  })
  vi.doMock('../../src/webview/models/ModelsSection', async (importOriginal) => {
    await chunks.models.promise
    return await importOriginal()
  })
})

function refresh(next: ModelsPanelState) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'modelsPanel/state', state: next } }),
    )
  })
}

async function mountProviders(saved?: unknown) {
  const [{ ModelsApp }, { UI_TEXT }, fixtures] = await Promise.all([
    import('../../src/webview/models/panel'),
    import('../../src/shared/constants'),
    import('./modelsPanelFixtures'),
  ])
  const state = fixtures.makeState({
    providers: [fixtures.makeProvider()],
    models: [fixtures.makeRow()],
    totalModels: 1,
  })

  const host: HostBridge = {
    messages: window,
    savedState: () => {
      if (saved instanceof Error) throw saved
      return saved
    },
    saveState: vi.fn(),
    post: vi.fn<HostBridge['post']>((message) => {
      if (message.type === 'modelsPanel/ready')
        window.dispatchEvent(
          new MessageEvent('message', { data: { type: 'modelsPanel/state', state } }),
        )
    }),
  }
  const view = render(<ModelsApp host={host} report={vi.fn()} />)
  return { view, UI_TEXT, state, refresh, host }
}

async function release(section: keyof typeof chunks) {
  await act(async () => {
    chunks[section].resolve(undefined)
    await chunks[section].promise
  })
}

describe('Models sections retain their document across chunk loading', () => {
  it('reserves host rows on first paint and mounts real content before wizard actions', async () => {
    const { view, UI_TEXT } = await mountProviders()
    expect(view.container.querySelector(':scope section')).toBeNull()
    expect(view.container.querySelector(':scope div.palette')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(UI_TEXT.loadingOutput)
    expect(view.container.querySelector(':scope .models-section-skeleton')).toHaveStyle({
      height: '246px',
    })
    await release('providers')
    expect(await screen.findByText('Ollama')).toBeInTheDocument()
    expect(view.container.querySelector(':scope [data-deferred-loading]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.wizardPickProvider }))
    expect(view.container.querySelector(':scope .models-select input')).not.toBeNull()
  })

  it('keeps Providers visible throughout a held Models transition and announces its pending tab', async () => {
    const { view, UI_TEXT } = await mountProviders()
    await release('providers')
    await screen.findByText('Ollama')
    const section = view.container.querySelector(':scope section')
    const models = screen.getByRole('button', { name: UI_TEXT.modelsSectionTitle })
    fireEvent.click(models)
    expect(section).toBeVisible()
    expect(view.container.querySelector(':scope section')).toBe(section)
    expect(view.container.querySelector(':scope .models-section-skeleton')).toBeNull()
    await waitFor(() => {
      expect(models).toHaveAttribute('aria-busy', 'true')
    })
    expect(section).toBeVisible()
    await release('models')
    expect(await screen.findByRole('row', { name: 'ollama/qwen3:8b' })).toBeInTheDocument()
    expect(view.container.querySelector(':scope section')).not.toBe(section)
    expect(models).not.toHaveAttribute('aria-busy')
  })

  it('keeps Models visible when navigating back to the still-held Providers preload', async () => {
    const { view, UI_TEXT } = await mountProviders()
    await release('models')
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.modelsSectionTitle }))
    await screen.findByRole('row', { name: 'ollama/qwen3:8b' })
    const section = view.container.querySelector(':scope section')
    const providers = screen.getByRole('button', {
      name: UI_TEXT.providersSectionTitle,
    })
    fireEvent.click(providers)
    expect(section).toBeVisible()
    expect(view.container.querySelector(':scope section')).toBe(section)
    expect(view.container.querySelector(':scope .models-section-skeleton')).toBeNull()
    await waitFor(() => {
      expect(providers).toHaveAttribute('aria-busy', 'true')
    })
    await release('providers')
    expect(await screen.findByText('Ollama')).toBeInTheDocument()
  })

  it('applies changed provider, scan and usage content before checking section identity', async () => {
    const { view, state, refresh, UI_TEXT } = await mountProviders()
    await release('providers')
    await screen.findByText('Ollama')
    const section = view.container.querySelector(':scope section')
    const provider = state.providers[0]
    if (provider === undefined) throw new Error('fixture provider missing')
    refresh({
      ...state,
      providers: [
        {
          ...provider,
          label: 'Refreshed provider',
          keyUsage: { dayUsd: Usd.from('1.2').toAmount() },
        },
      ],
      scans: { ollama: { providerId: 'ollama', status: 'scanning' } },
    })
    expect(await screen.findByText('Refreshed provider')).toBeInTheDocument()
    expect(await screen.findByText('$1.20')).toBeInTheDocument()
    expect(screen.getByText(UI_TEXT.providersScanning)).toBeInTheDocument()
    expect(view.container.querySelector(':scope section')).toBe(section)
    expect(section).toBeVisible()
  })

  it('remembers the settled section box after its deferred content commits', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 666, 538),
    )
    const { host } = await mountProviders()
    await release('providers')
    expect(await screen.findByText('Ollama')).toBeInTheDocument()
    await waitFor(() => {
      expect(host.saveState).toHaveBeenCalledWith({
        snapshot: { modelsSectionHeights: { providers: 538 } },
      })
    })
  })

  it('uses the saved measured height while Providers is held on reload', async () => {
    const { view } = await mountProviders({
      snapshot: { modelsSectionHeights: { providers: 538 } },
    })
    expect(view.container.querySelector(':scope .models-section-skeleton')).toHaveStyle({
      height: '538px',
    })
    await release('providers')
    expect(await screen.findByText('Ollama')).toBeInTheDocument()
  })

  it('keeps a failed section from feeding its own larger box into the reserve', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const measurement = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    measurement.mockReturnValue(new DOMRect(0, 0, 666, 538))
    const { view, UI_TEXT } = await mountProviders()
    await release('providers')
    await screen.findByText('Ollama')
    const slot = view.container.querySelector(':scope .models-section-slot')
    expect(slot).toHaveStyle({ '--ms-models-section-height': '538px' })
    measurement.mockReturnValue(new DOMRect(0, 0, 666, 700))
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.modelsSectionTitle }))
    await act(async () => {
      chunks.models.reject(new Error('section transport failed'))
      await expect(chunks.models.promise).rejects.toThrow('section transport failed')
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(UI_TEXT.surfaceLoadFailed)
    expect(slot).toHaveStyle({ '--ms-models-section-height': '538px' })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.providersSectionTitle }))
    expect(await screen.findByText('Ollama')).toBeInTheDocument()
  })

  it.each([-1, 0])('ignores an invalid remembered height of %s', async (height) => {
    const { view } = await mountProviders({
      snapshot: { modelsSectionHeights: { providers: height } },
    })
    expect(view.container.querySelector(':scope .models-section-skeleton')).toHaveStyle({
      height: '246px',
    })
    await release('providers')
    expect(await screen.findByText('Ollama')).toBeInTheDocument()
  })
})

it('renders when the native host refuses webview storage', async () => {
  const { view } = await mountProviders(new Error('storage unavailable'))
  expect(view.container.querySelector(':scope .models-section-skeleton')).toHaveStyle({
    height: '246px',
  })
  await release('providers')
  expect(await screen.findByText('Ollama')).toBeInTheDocument()
})
