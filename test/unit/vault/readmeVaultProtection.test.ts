import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// RVCM1091B2 P3 (docs): the README must state the macOS key protection the
// composed broker actually wires (the login Keychain through PosixVaultSlots),
// never the Secure Enclave slot, which only tests construct.
describe('vault key-protection docs', () => {
  it('names only the protection the composed broker wires', () => {
    const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8')
    expect(readme).toContain('login Keychain')
    expect(readme).toContain('it does not use the Secure Enclave')
    expect(readme).not.toContain('also uses the Secure Enclave')
  })
})
