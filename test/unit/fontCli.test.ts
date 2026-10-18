import { afterEach, describe, expect, it } from 'vitest'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, fill, setUiText } from '../../src/shared/l10n/text'
import { ACP_AGENT_NAME, UI_TEXT } from '../../src/shared/constants'
import french from '../../l10n/ui.fr.json'

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

describe('font CLI usage localization', () => {
  it.each([
    ['fonts', 'remove'],
    ['fonts', 'install', 'extra'],
  ])('formats %j in the language installed after argument parsing', (...argv) => {
    const command = parseCommandLine(argv)
    expect(command.command).toBe('invalid')
    setUiText({ ...EN, acpFontsUsage: french.acpFontsUsage }, 'fr')
    if (command.command !== 'invalid') throw new Error('Expected font usage failure')
    expect(command.reason).toBe(fill(UI_TEXT.acpFontsUsage, { command: ACP_AGENT_NAME }))
    expect(command.reason).not.toBe(fill(EN.acpFontsUsage, { command: ACP_AGENT_NAME }))
  })

  it('names a wrong fonts option in the language installed after argument parsing', () => {
    const command = parseCommandLine(['fonts', 'install', '--bad'])
    expect(command).toMatchObject({ command: 'invalid', exitCode: 2 })
    setUiText({ ...EN, cliHelp: french.cliHelp, acpFontsUsage: french.acpFontsUsage }, 'fr')
    if (command.command !== 'invalid') throw new Error('Expected font usage failure')
    expect(command.reason).toContain(
      fill(french.cliHelp.unknownOption, {
        option: '--bad',
        cmd: 'fonts',
        accepted: '--from, --help',
      }),
    )
    expect(command.reason).toContain(
      fill(french.cliHelp.seeHelp, { command: ACP_AGENT_NAME, topic: 'fonts' }),
    )
  })
})
