import { describe, expect, it } from 'vitest'
import { fixedMessageLog } from '../../src/host/lazyBundle'
import { FakeLogOutputChannel } from './helpers/fakes'

describe('fixedMessageLog', () => {
  it('forwards trace, info and warn unchanged', () => {
    const inner = new FakeLogOutputChannel()
    const log = fixedMessageLog({
      log: inner,
      loadFailed: 'load failed',
      wrongShape: 'wrong shape',
    })
    log.trace('t')
    log.info('i')
    log.warn('w')
    expect(inner.trace).toHaveBeenCalledWith('t')
    expect(inner.info).toHaveBeenCalledWith('i')
    expect(inner.warn).toHaveBeenCalledWith('w')
    expect(inner.error).not.toHaveBeenCalled()
  })

  it('keeps the shape words for a missing export and the load words otherwise', () => {
    const inner = new FakeLogOutputChannel()
    const log = fixedMessageLog({
      log: inner,
      loadFailed: 'load failed',
      wrongShape: 'wrong shape',
    })
    log.error('/home/private/vault.js does not export the vault bundle')
    log.error('The /home/private/vault.js could not be loaded: boom in /home/private')
    expect(inner.error).toHaveBeenNthCalledWith(1, 'wrong shape')
    expect(inner.error).toHaveBeenNthCalledWith(2, 'load failed')
  })
})
