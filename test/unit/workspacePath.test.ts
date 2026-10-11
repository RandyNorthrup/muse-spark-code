import { describe, expect, it } from 'vitest'
import { resolveWorkspacePath } from '../../src/core/workspacePath'
import { isProtectedPath } from '../../src/core/protectedPaths'

describe('workspace path policy after shared identity extraction', () => {
  it.each(['a./child', 'a../child', 'a. /child', 'name. .', 'NUL', 'NUL.txt'])(
    'retains the current Windows identity rule for %s',
    (given) => {
      // 0.17.1 judges extension-bearing names by identity; bare devices and
      // trailing-dot/space aliases stay refused.
      expect(resolveWorkspacePath('C:/repo', given, 'win32').ok).toBe(given === 'NUL.txt')
      expect(resolveWorkspacePath('/repo', given, 'linux').ok).toBe(true)
    },
  )
  it.each(['linux', 'darwin'] as const)(
    'protects only resolved path segments on %s',
    (platform) => {
      const literal = resolveWorkspacePath('/repo', String.raw`.Claude\settings.json`, platform)
      expect(literal).toMatchObject({ ok: true, canonical: String.raw`.Claude\settings.json` })
      expect(literal.ok && isProtectedPath(literal.canonical)).toBe(false)
      const nested = resolveWorkspacePath('/repo', '.Claude/settings.json', platform)
      expect(nested.ok && isProtectedPath(nested.canonical)).toBe(true)
    },
  )
})
