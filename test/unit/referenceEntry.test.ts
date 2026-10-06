import { describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { createReference, type ReferenceHost } from '../../src/shared/reference/referenceEntry'
import { parseReferenceModel, referenceModel } from '../../src/shared/reference/reference.generated'
import { parseHostToWebviewMessage, parseWebviewToHostMessage } from '../../src/shared/protocol'
import { parseCommandLine } from '../../src/runtime/cliArgs'

function host(): ReferenceHost {
  return {
    readNls: vi.fn().mockResolvedValue({ 'command.openHelp.title': 'Open Help & Reference' }),
    currentValue: vi.fn().mockReturnValue(false),
    openSetting: vi.fn().mockResolvedValue(undefined),
    runCommand: vi.fn().mockResolvedValue(undefined),
    post: vi.fn(),
  }
}
describe('reference host actions and command line', () => {
  it('reads every current value, keeps sensitive variables off the bridge and sends a valid model', async () => {
    const bridge = host()
    await createReference(EN, 'en').handle({ type: 'readReference' }, bridge)
    expect(bridge.currentValue).not.toHaveBeenCalledWith('museSpark.environmentVariables')
    expect(bridge.post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'referenceValues',
        values: expect.objectContaining({
          'museSpark.environmentVariables': EN.referenceHidden,
          'museSpark.modelApiTab': 'false',
        }),
      }),
    )
    expect(parseReferenceModel(referenceModel()).settings.length).toBeGreaterThan(0)
  })
  it('opens an exact known setting key, including native-host dotted anchors', async () => {
    const bridge = host()
    await createReference(EN, 'en').handle(
      { type: 'openReferenceSetting', key: 'museSpark.judge.engine' },
      bridge,
    )
    expect(bridge.openSetting).toHaveBeenCalledWith('museSpark.judge.engine')
    await expect(
      createReference(EN, 'en').handle(
        { type: 'openReferenceSetting', key: 'editor.password' },
        bridge,
      ),
    ).rejects.toThrow()
    expect(bridge.openSetting).toHaveBeenCalledTimes(1)
  })
  it('allows only reviewed context-free commands and rejects destructive or foreign commands', async () => {
    const bridge = host()
    const reference = createReference(EN, 'en')
    await reference.handle({ type: 'runReferenceCommand', command: 'museSpark.showLogs' }, bridge)
    expect(bridge.runCommand).toHaveBeenCalledWith('museSpark.showLogs')
    for (const command of [
      'museSpark.signOut',
      'museSpark.removeWorktree',
      'workbench.action.closeWindow',
    ])
      await expect(
        reference.handle({ type: 'runReferenceCommand', command }, bridge),
      ).rejects.toThrow()
    expect(bridge.runCommand).toHaveBeenCalledTimes(1)
  })
  it('validates messages, translated dictionaries and the nested reference model', async () => {
    expect(parseWebviewToHostMessage({ type: 'openReferenceSetting', key: 1 }).ok).toBe(false)
    expect(
      parseHostToWebviewMessage({
        type: 'referenceValues',
        model: '{}',
        values: {},
        nls: { key: 1 },
      }).ok,
    ).toBe(false)
    expect(() => parseReferenceModel({ commands: [] })).toThrow()
    const bridge = host()
    bridge.readNls = vi.fn().mockResolvedValue({ key: 1 })
    await expect(
      createReference(EN, 'en').handle({ type: 'readReference' }, bridge),
    ).rejects.toThrow()
    expect(bridge.post).not.toHaveBeenCalled()
  })
  it('prints every category without starting a backend and parses full help strictly', () => {
    const text = createReference(EN, 'en').all()
    for (const marker of [
      'museSpark.openHelp',
      'museSpark.judge.engine',
      '/help',
      'scan-secrets',
      EN.referenceShortcuts,
    ])
      expect(text).toContain(marker)
    expect(parseCommandLine(['help', '--all'])).toEqual({ command: 'help', all: true })
    expect(parseCommandLine(['help'])).toEqual({ command: 'help', all: false })
    expect(parseCommandLine(['help', '--unknown'])).toMatchObject({ command: 'invalid' })
    expect(parseCommandLine(['exec', '--help'])).toEqual({ command: 'help' })
  })
})
