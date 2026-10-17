// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SetupBanner } from '../../src/webview/components/SetupBanner'

describe('SetupBanner', () => {
  it('confirms the provider and model, manages providers, and dismisses', () => {
    const onManageProviders = vi.fn()
    const onDismiss = vi.fn()
    render(
      <SetupBanner
        provider="OpenRouter"
        model="openrouter/deepseek/deepseek-v3"
        onManageProviders={onManageProviders}
        onDismiss={onDismiss}
      />,
    )
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('OpenRouter')
    expect(banner).toHaveTextContent('openrouter/deepseek/deepseek-v3')
    fireEvent.click(screen.getByRole('button', { name: 'Manage providers' }))
    expect(onManageProviders).toHaveBeenCalledOnce()
    expect(onDismiss).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
