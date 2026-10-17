import { describe, expect, it, vi } from 'vitest'
import {
  developerBadge,
  developerConfirmation,
  developerHelpRows,
  developerStatusText,
  handleDeveloperRequest,
  setDeveloperMachineSetting,
} from '../../src/core/developer/surfaces'
import {
  parseDeveloperCommand,
  runDeveloperCommand,
} from '../../src/runtime/developer/developerCommand'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { developerFixture, enabledDeveloper } from './helpers/developer'

const page = { id: 'local-page', isLocal: true, kind: 'page' } as const

describe('Developer options on every surface', () => {
  it.each(['create', 'remove', 'reset'] as const)(
    'audits a terminal %s with the actual caller source',
    async (action) => {
      const h = await enabledDeveloper()
      if (action !== 'create') await h.owner.addProfile('meta', 'work')
      const commands = {
        create: ['developer', 'add', 'meta', 'work'],
        remove: ['developer', 'remove', 'profile-1'],
        reset: ['developer', 'reset'],
      }
      const args = commands[action]
      expect(await runDeveloperCommand(h.owner, args, 'terminal-client')).toMatchObject({
        type: 'developer/state',
      })
      expect(h.audits.at(-1)).toMatchObject({ action, source: 'terminal' })
    },
  )

  it.each(['page', 'palette', 'terminal', 'setting'] as const)(
    'audits enable and disable from the real %s source',
    async (source) => {
      const h = developerFixture()
      const owner = await h.open()
      await owner.unlock('palette')
      for (const isEnabled of [true, false]) {
        if (source === 'setting') await setDeveloperMachineSetting(owner, isEnabled)
        else
          await handleDeveloperRequest(
            owner,
            { id: source, isLocal: true, kind: source },
            { type: 'developer/setMultiple', enabled: isEnabled },
          )
      }
      expect(h.audits.slice(-2)).toMatchObject([
        { action: 'enable', source },
        { action: 'disable', source },
      ])
    },
  )

  it.each([
    'VS Code',
    'JetBrains',
    'Visual Studio',
    'Eclipse',
    'Zed',
    'Xcode',
    'Neovim',
    'Emacs',
    'Sublime',
    'ACP',
    'terminal',
  ])('uses the shared owner and badge for %s', async (name) => {
    const h = developerFixture()
    const owner = await h.open()
    const surface = { id: name, isLocal: true, kind: 'palette' } as const
    expect(developerBadge(owner.snapshot())).toBeUndefined()
    const response = await handleDeveloperRequest(owner, surface, { type: 'developer/unlock' })
    expect(response).toMatchObject({ isUnlocked: true, isMultipleAccountsOn: false })
    expect(developerBadge(owner.snapshot())).toBe(UI_TEXT.developer.badge)
    expect(developerStatusText(owner.snapshot())).toContain('expires')
    await handleDeveloperRequest(owner, surface, { type: 'developer/reset' })
    expect(developerBadge(owner.snapshot())).toBeUndefined()
  })

  it('lets a companion display state but refuses every authority-changing request', async () => {
    const h = await enabledDeveloper()
    const companion = { id: 'companion', isLocal: false, kind: 'page' } as const
    expect(
      await handleDeveloperRequest(h.owner, companion, { type: 'developer/read' }),
    ).toMatchObject({ isUnlocked: true })
    for (const message of [
      { type: 'developer/unlock' },
      { type: 'developer/versionClick' },
      { type: 'developer/setMultiple', enabled: false },
      { type: 'developer/addProfile', provider: 'meta', account: 'work' },
      { type: 'developer/removeProfile', id: 'profile-one' },
      { type: 'developer/reset' },
    ])
      expect(await handleDeveloperRequest(h.owner, companion, message)).toEqual({
        type: 'developer/error',
        code: 'locked',
      })
    expect(h.owner.isMultipleAccountsOn()).toBe(true)
  })

  it('refuses direct page unlock and spoofed confirmations or credentials', async () => {
    const h = developerFixture()
    const owner = await h.open()
    expect(await handleDeveloperRequest(owner, page, { type: 'developer/unlock' })).toEqual({
      type: 'developer/error',
      code: 'locked',
    })
    expect(
      await handleDeveloperRequest(owner, page, {
        type: 'developer/setMultiple',
        enabled: true,
        confirmed: true,
      }),
    ).toEqual({ type: 'developer/error', code: 'invalidRequest' })
    const reply = await handleDeveloperRequest(owner, page, {
      type: 'developer/addProfile',
      provider: 'meta',
      account: 'work',
      secret: 'never-return-this',
    })
    expect(JSON.stringify(reply)).not.toContain('never-return-this')
    expect(h.deps.confirm).not.toHaveBeenCalled()
  })

  it('redacts raw adapter failures to fixed errors', async () => {
    const h = await enabledDeveloper()
    vi.mocked(h.deps.checkAccount).mockRejectedValueOnce(
      new Error('canary-credential /home/private owner@example.com'),
    )
    expect(
      await handleDeveloperRequest(h.owner, page, {
        type: 'developer/addProfile',
        provider: 'meta',
        account: 'work',
      }),
    ).toEqual({ type: 'developer/error', code: 'unavailable' })
    expect(JSON.stringify(h.audits)).not.toContain('canary')
  })

  it('routes the visible setting through unlock and its own confirmation and leaves denied changes off', async () => {
    const h = developerFixture()
    const owner = await h.open()
    vi.mocked(h.deps.confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const denied = await setDeveloperMachineSetting(owner, true)
    expect(denied.isMultipleAccountsOn).toBe(false)
    expect(vi.mocked(h.deps.confirm).mock.calls.map(([question]) => question)).toEqual([
      'unlock',
      'multiple',
    ])
    await setDeveloperMachineSetting(owner, true)
    await setDeveloperMachineSetting(owner, false)
    expect(owner.isMultipleAccountsOn()).toBe(false)
  })

  it('has strict terminal commands without a credential or authority argument', async () => {
    expect(parseDeveloperCommand(['other'])).toBeUndefined()
    expect(parseDeveloperCommand(['developer'])).toEqual({ type: 'developer/unlock' })
    expect(parseDeveloperCommand(['developer', 'status'])).toEqual({ type: 'developer/read' })
    expect(parseDeveloperCommand(['developer', 'enable'])).toEqual({
      type: 'developer/setMultiple',
      enabled: true,
    })
    expect(parseDeveloperCommand(['developer', 'disable'])).toEqual({
      type: 'developer/setMultiple',
      enabled: false,
    })
    expect(parseDeveloperCommand(['developer', 'reset'])).toEqual({ type: 'developer/reset' })
    expect(parseDeveloperCommand(['developer', 'add', 'meta', 'work'])).toEqual({
      type: 'developer/addProfile',
      provider: 'meta',
      account: 'work',
    })
    expect(parseDeveloperCommand(['developer', 'remove', 'profile-one'])).toEqual({
      type: 'developer/removeProfile',
      id: 'profile-one',
    })
    for (const args of [
      ['developer', '--key', 'canary'],
      ['developer', 'enable', '--yes'],
      ['developer', 'add', 'meta', 'work', 'canary'],
      ['developer', 'remove', '../outside'],
    ])
      expect(() => parseDeveloperCommand(args)).toThrow()
    const h = developerFixture()
    const owner = await h.open()
    expect(await runDeveloperCommand(owner, ['developer'], 'terminal-one')).toMatchObject({
      isUnlocked: true,
    })
    expect(await runDeveloperCommand(owner, ['other'], 'terminal-one')).toEqual({
      type: 'developer/error',
      code: 'invalidRequest',
    })
  })

  it('reads installed localization at operation time for help, confirmation and badges', async () => {
    const h = await enabledDeveloper()
    setUiText(
      {
        ...EN,
        developer: {
          ...EN.developer,
          title: 'Test title',
          badge: 'Test badge',
          resetWarning: 'Test reset',
          foreignResetWarning: 'Test foreign reset',
        },
      },
      'en',
    )
    try {
      expect(developerHelpRows()[0]?.title).toBe('Test title')
      expect(developerConfirmation('reset')).toMatchObject({
        title: 'Test title',
        message: 'Test reset',
      })
      expect(developerConfirmation('resetForeign')).toMatchObject({
        title: 'Test title',
        message: 'Test foreign reset',
      })
      expect(developerConfirmation('unlock').message).toBe(UI_TEXT.developer.unlockWarning)
      expect(developerConfirmation('multiple').message).toBe(UI_TEXT.developer.multipleWarning)
      expect(developerBadge(h.owner.snapshot())).toBe('Test badge')
      expect(developerStatusText({ ...h.owner.snapshot(), isUnlocked: false })).toBe(
        UI_TEXT.developer.locked,
      )
    } finally {
      setUiText(EN, 'en')
    }
  })
})
