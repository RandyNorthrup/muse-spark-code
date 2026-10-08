// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  DeveloperModeBadge,
  DeveloperOptionsPage,
} from '../../src/webview/developer/DeveloperOptionsPage'
import { DEVELOPER_UI_BUDGET_BYTES, UI_TEXT } from '../../src/shared/constants'
import type { DeveloperSnapshot } from '../../src/shared/developerOptions'

const locked: DeveloperSnapshot = {
  type: 'developer/state',
  isUnlocked: false,
  isMultipleAccountsOn: false,
  expiresAt: null,
  profiles: [],
}
const unlocked: DeveloperSnapshot = {
  type: 'developer/state',
  isUnlocked: true,
  isMultipleAccountsOn: true,
  expiresAt: Date.parse('2026-10-07T12:00:00Z'),
  profiles: [{ id: 'profile-one', provider: 'meta', account: 'work' }],
}

describe('Developer options page and badge', () => {
  it('badges a surface only while developer mode is unlocked', () => {
    const { unmount } = render(<DeveloperModeBadge snapshot={locked} />)
    expect(screen.queryByRole('status')).toBeNull()
    unmount()
    render(<DeveloperModeBadge snapshot={unlocked} />)
    expect(screen.getByRole('status')).toHaveTextContent(UI_TEXT.developer.badge)
  })

  it('locks the visible setting until unlock and never badges it', () => {
    render(<DeveloperOptionsPage message={locked} post={vi.fn()} />)
    expect(screen.getByRole('heading', { name: UI_TEXT.developer.title })).toBeDefined()
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('posts the setting, profile and reset requests from the unlocked page', () => {
    const post = vi.fn()
    render(<DeveloperOptionsPage message={unlocked} post={post} />)
    expect(screen.getByRole('status')).toBeDefined()
    expect(screen.getByText(/expires/i)).toBeDefined()
    expect(screen.getByText(/meta · work/)).toBeDefined()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(post).toHaveBeenCalledWith({ type: 'developer/setMultiple', enabled: false })
    fireEvent.change(screen.getByLabelText(UI_TEXT.developer.provider), {
      target: { value: 'meta' },
    })
    fireEvent.change(screen.getByLabelText(UI_TEXT.developer.account), {
      target: { value: 'personal' },
    })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.developer.addProfile }))
    expect(post).toHaveBeenCalledWith({
      type: 'developer/addProfile',
      provider: 'meta',
      account: 'personal',
    })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.accounts.remove }))
    expect(post).toHaveBeenCalledWith({ type: 'developer/removeProfile', id: 'profile-one' })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.developer.reset }))
    expect(post).toHaveBeenCalledWith({ type: 'developer/reset' })
  })

  it('shows fixed error text without echoing the rejected payload', () => {
    const post = vi.fn()
    const canary = 'never-return-this'
    const { unmount } = render(
      <DeveloperOptionsPage
        message={{ type: 'developer/addProfile', provider: 'meta', account: 'work', canary }}
        post={post}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.developer.invalidRequest)
    expect(screen.queryByText(canary)).toBeNull()
    expect(post).not.toHaveBeenCalled()
    unmount()
    render(
      <DeveloperOptionsPage message={{ type: 'developer/error', code: 'locked' }} post={post} />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.developer.locked)
  })

  it('keeps the lazy UI under its own budget on the shared runtime', () => {
    const root = path.join(process.cwd(), 'src/webview/developer')
    const page = readFileSync(path.join(root, 'DeveloperOptionsPage.tsx'), 'utf8')
    const css = readFileSync(path.join(root, 'developerOptions.css'), 'utf8')
    expect(Buffer.byteLength(`${page}${css}`, 'utf8')).toBeLessThan(DEVELOPER_UI_BUDGET_BYTES)
    expect(page).not.toContain('react-dom')
    expect(page).not.toContain('l10n/en')
  })
})
