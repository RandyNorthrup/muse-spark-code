// `auth set` provider routing (M95, PLAN.md D74): a non-Meta key set reaches
// the provider's own key shape, whether the arguments name `--account` or
// not (the ACP paste-key method omits it). Meta and named accounts stay on
// their own handlers.
import { describe, expect, it } from 'vitest'
import { authSetProviderId, parseCommandLine } from '../../src/runtime/cliArgs'

function routed(argv: readonly string[]): string | undefined {
  const command = parseCommandLine(argv)
  if (command.command !== 'authSet') throw new Error(`parsed as ${command.command}`)
  return authSetProviderId(command)
}

describe('auth set provider routing', () => {
  it('sends every non-Meta default-slot set to the provider handler', () => {
    expect(routed(['auth', 'set', '--provider', 'openrouter'])).toBe('openrouter')
    expect(routed(['auth', 'set', '--provider', 'openrouter', '--account', 'default'])).toBe(
      'openrouter',
    )
    expect(routed(['auth', 'set', '--provider', 'groq'])).toBe('groq')
    expect(routed(['auth', 'set'])).toBeUndefined()
    expect(routed(['auth', 'set', '--account', 'work'])).toBeUndefined()
    expect(routed(['auth', 'set', '--provider', 'openrouter', '--account', 'work'])).toBeUndefined()
    expect(authSetProviderId({ command: 'authSet' })).toBeUndefined()
    expect(authSetProviderId({ command: 'authSet', provider: 'meta' })).toBeUndefined()
  })
})
