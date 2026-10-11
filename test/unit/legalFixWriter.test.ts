import { describe, expect, it, vi } from 'vitest'
import { fingerprint } from '../../src/core/verify/fingerprint'
import { legalFixFileEdits, type LegalFixEditsDeps } from '../../src/host/legalFixApplier'
import { LEGAL_FIX_FILE_READ_MAX_BYTES } from '../../src/shared/constants'

function setup() {
  const realPath = vi
    .fn<LegalFixEditsDeps['io']['realPath']>()
    .mockImplementation((path) => Promise.resolve(path))
  const readBytes = vi
    .fn<LegalFixEditsDeps['io']['readBytes']>()
    .mockResolvedValue(new TextEncoder().encode('before'))
  const writeFileIfUnchanged = vi
    .fn<LegalFixEditsDeps['io']['writeFileIfUnchanged']>()
    .mockImplementation((_path, _hash, _content, options) => {
      options.assertCanWrite?.()
      return Promise.resolve('written')
    })
  const withAdmission = vi
    .fn<LegalFixEditsDeps['withAdmission']>()
    .mockImplementation((check, work) => work(check))
  const io = { realPath, readBytes, writeFileIfUnchanged }
  return {
    io,
    withAdmission,
    edits: legalFixFileEdits({ workspaceRoot: '/ws', platform: 'linux', io, withAdmission }),
  }
}

describe('production legal conditional writes', () => {
  it('bounds evidence reads and uses the existing admission and fingerprint write', async () => {
    const { edits, io, withAdmission } = setup()
    expect(await edits.readHash('src/a.py')).toBe(fingerprint('before'))
    expect(io.readBytes).toHaveBeenCalledWith(
      '/ws/src/a.py',
      LEGAL_FIX_FILE_READ_MAX_BYTES,
      '/ws/src/a.py',
    )
    expect(await edits.write('src/a.py', 'before', 'after', () => true)).toBe(true)
    expect(withAdmission).toHaveBeenCalledOnce()
    expect(io.writeFileIfUnchanged).toHaveBeenCalledWith(
      '/ws/src/a.py',
      fingerprint('before'),
      'after',
      expect.objectContaining({
        expectedCanonicalPath: '/ws/src/a.py',
        unsavedAt: ['/ws/src/a.py', '/ws/src/a.py'],
      }),
    )
  })
  it.each(['../outside.py', '.agents/hooks/check.py', '.git/hooks/check.py'])(
    'denies unauthorized path %s',
    async (path) => {
      const { edits, io } = setup()
      expect(await edits.readHash(path)).toBeUndefined()
      expect(await edits.write(path, 'before', 'after', () => true)).toBe(false)
      expect(io.writeFileIfUnchanged).not.toHaveBeenCalled()
    },
  )
  it('denies internal aliases and escapes even when their bytes could match', async () => {
    for (const target of ['/ws/src/other.py', '/outside/a.py']) {
      const { edits, io } = setup()
      io.realPath.mockImplementation((path) => Promise.resolve(path === '/ws' ? path : target))
      expect(await edits.write('src/a.py', 'before', 'after', () => true)).toBe(false)
      expect(io.writeFileIfUnchanged).not.toHaveBeenCalled()
    }
  })
  it('rechecks admission during publication and reports a changed conditional write', async () => {
    const { edits, io, withAdmission } = setup()
    let isCurrent = true
    withAdmission.mockImplementation((check, work) => {
      isCurrent = false
      return work(check)
    })
    await expect(edits.write('src/a.py', 'before', 'after', () => isCurrent)).rejects.toThrow()
    io.writeFileIfUnchanged.mockResolvedValue('changed')
    withAdmission.mockImplementation((check, work) => work(check))
    expect(await edits.write('src/a.py', 'before', 'after', () => true)).toBe(false)
  })
})
