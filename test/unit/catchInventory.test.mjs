// The catch-inventory classifier: one example of each class plus the tricky
// shapes the gate must not misread.
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import {
  checkBaseline,
  classifyHandler,
  classifySource,
  countByArea,
  scanCatches,
} from '../../scripts/lib/catch-inventory.mjs'

const root = path.resolve('.')

function classesOf(text, file = 'src/fixture.ts') {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true)
  return classifySource(file, source).map((entry) => entry.class)
}

function parseBlock(text) {
  const source = ts.createSourceFile(
    'fixture.ts',
    `try { work() } catch (error: unknown) ${text}`,
    ts.ScriptTarget.ESNext,
    true,
  )
  let block
  const visit = (node) => {
    if (ts.isCatchClause(node)) block = node.block
    else ts.forEachChild(node, visit)
  }
  visit(source)
  if (block === undefined) throw new Error('fixture has no catch clause')
  return block
}

describe('catch-inventory classifier', () => {
  it('names NARROW when the handler tests a named condition and rethrows', () => {
    expect(
      classesOf(`try { a() } catch (error: unknown) {
        if (error instanceof URIError) return fallback
        throw error
      }`),
    ).toEqual(['NARROW'])
    expect(
      classesOf(`try { a() } catch (error: unknown) {
        if (error?.code === 'ENOENT') return fallback
        throw new Error('failed', { cause: error })
      }`),
    ).toEqual(['NARROW'])
    expect(
      classesOf(`try { a() } catch (error: unknown) {
        if (isInvalidProvidersFileError(error)) return 'providersInvalid'
        log.warn('accounts failed: ' + failureForLog(error))
        return 'unavailable'
      }`),
    ).toEqual(['NARROW'])
    expect(
      classesOf(`try { a() } catch (error: unknown) {
        if (signal.aborted) throw error
        throw new Error('failed', { cause: error })
      }`),
    ).toEqual(['NARROW'])
  })

  it('names REPORTED when every path rethrows, carries the cause or records', () => {
    expect(classesOf('try { a() } catch (error: unknown) { throw error }')).toEqual(['REPORTED'])
    expect(
      classesOf(`try { a() } catch (error: unknown) {
        throw new Error('failed', { cause: error })
      }`),
    ).toEqual(['REPORTED'])
    expect(
      classesOf(`try { a() } catch (error: unknown) {
        log.warn('update was not sent: ' + failureForLog(error))
      }`),
    ).toEqual(['REPORTED'])
    expect(classesOf(`try { a() } catch { log.warn('elicitation was already settled') }`)).toEqual([
      'REPORTED',
    ])
    expect(
      classesOf(`try { a() } catch (error: unknown) {
        report('hostMessage', error)
      }`),
    ).toEqual(['REPORTED'])
    expect(
      classesOf(`try { a() } catch {
        observeError(deps, 'updateNotSent')
        return fallback
      }`),
    ).toEqual(['REPORTED'])
    expect(
      classesOf(`try { a() } catch (error: unknown) {
        postMessage(webviewErrorReport('window', error))
        setError('failed')
      }`),
    ).toEqual(['REPORTED'])
    expect(
      classesOf(`try { a() } catch (error: unknown) {
        log.warn('ask failed: ' + failureForLog(error))
        throw new Error('unavailable')
      }`),
    ).toEqual(['REPORTED'])
    expect(
      classesOf(`try { a() } catch {
        this.deps.failed()
        return 'uncertain'
      }`),
    ).toEqual(['REPORTED'])
    expect(
      classesOf(`try { a() } catch {
        log.warn('ask failed')
        throw new Error('unavailable')
      }`),
    ).toEqual(['GENERIC'])
  })

  it('names SWALLOW when the handler neither uses the error nor reports', () => {
    expect(classesOf('try { a() } catch { }')).toEqual(['SWALLOW'])
    expect(classesOf('try { a() } catch { return undefined }')).toEqual(['SWALLOW'])
    expect(classesOf('doomed.catch(() => null)')).toEqual(['SWALLOW'])
    expect(classesOf('doomed.catch(() => {})')).toEqual(['SWALLOW'])
  })

  it('names GENERIC when a fixed sentence replaces every cause', () => {
    expect(classesOf('try { a() } catch { return fail() }')).toEqual(['GENERIC'])
    expect(classesOf(`try { a() } catch { throw new Error('unavailable') }`)).toEqual(['GENERIC'])
    expect(
      classesOf(`try { a() } catch {
        log.warn('accounts failed')
        return 'unavailable'
      }`),
    ).toEqual(['GENERIC'])
    expect(
      classesOf(`try { a() } catch (error: unknown) {
        log.warn('failed: ' + error)
      }`),
    ).toEqual(['GENERIC'])
  })

  it('names CLEANUP only with its reason comment on the catch line', () => {
    expect(classesOf('try { a() } catch { // the handle is already closing\n }')).toEqual([
      'CLEANUP',
    ])
    expect(classesOf('doomed.catch(() => null) // already failing; best effort')).toEqual([
      'CLEANUP',
    ])
    expect(classesOf('try { a() } catch {\n /* no comment on the catch line */ }')).toEqual([
      'SWALLOW',
    ])
    expect(classesOf('doomed.catch(() => null)')).toEqual(['SWALLOW'])
  })

  it('ignores a rethrow inside a nested function', () => {
    expect(
      classesOf(`try { a() } catch {
        schedule(() => {
          throw new Error('late')
        })
      }`),
    ).toEqual(['SWALLOW'])
  })

  it('names GENERIC when the error is used but its kind reaches nobody', () => {
    expect(
      classesOf(`try { a() } catch (error: unknown) {
        setStatus(error instanceof Error ? error.message : 'failed')
      }`),
    ).toEqual(['GENERIC'])
  })

  it('leaves console output out of the failure record', () => {
    expect(
      classesOf(`try { a() } catch (error: unknown) {
        console.error(error)
        report('hostMessage', error)
      }`),
    ).toEqual(['REPORTED'])
  })

  it('reports the handler snippet in the first 80 characters', () => {
    const source = ts.createSourceFile(
      'src/fixture.ts',
      'try { a() } catch {\n return undefined\n}',
      ts.ScriptTarget.ESNext,
      true,
    )
    const [entry] = classifySource('src/fixture.ts', source)
    expect(entry?.line).toBe(1)
    expect(entry?.snippet.length).toBeLessThanOrEqual(80)
  })

  it('classifies a bare handler body directly', () => {
    expect(
      classifyHandler(parseBlock('{ throw error }'), { binding: 'error', catchLine: '' }),
    ).toBe('REPORTED')
  })
})

describe('catch-inventory baseline', () => {
  it('counts per top-level area and class', () => {
    const counts = countByArea([
      { file: 'src/acp/agent.ts', line: 1, class: 'SWALLOW', snippet: '' },
      { file: 'src/webview/links.ts', line: 2, class: 'NARROW', snippet: '' },
      { file: 'src/extension.ts', line: 3, class: 'GENERIC', snippet: '' },
    ])
    expect(counts['acp']).toMatchObject({ SWALLOW: 1 })
    expect(counts['webview']).toMatchObject({ NARROW: 1 })
    expect(counts['root']).toMatchObject({ GENERIC: 1 })
  })

  it('fails a rise and fails a fall without a lowered baseline', () => {
    const baseline = { version: 1, counts: { acp: { SWALLOW: 0, GENERIC: 0 } } }
    expect(checkBaseline({ acp: { SWALLOW: 1, GENERIC: 0 } }, baseline)).toHaveLength(1)
    expect(checkBaseline({ acp: { SWALLOW: 0, GENERIC: 0 } }, baseline)).toEqual([])
    const stale = { version: 1, counts: { acp: { SWALLOW: 2, GENERIC: 0 } } }
    expect(checkBaseline({ acp: { SWALLOW: 1, GENERIC: 0 } }, stale)[0]).toMatch(/lowering/)
  })

  it('holds src/acp and src/webview at zero SWALLOW and GENERIC', () => {
    const entries = scanCatches(root).filter(
      (entry) =>
        (entry.file.startsWith('src/acp/') || entry.file.startsWith('src/webview/')) &&
        (entry.class === 'SWALLOW' || entry.class === 'GENERIC'),
    )
    expect(entries.map((entry) => `${entry.file}:${String(entry.line)}`)).toEqual([])
  })
})
