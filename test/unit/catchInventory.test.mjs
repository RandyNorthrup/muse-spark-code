// The catch-inventory classifier: one example of each class plus the tricky
// shapes the gate must not misread.
import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import {
  checkBaseline,
  classifyHandler,
  classifySource,
  countByArea,
} from '../../scripts/lib/catch-inventory.mjs'

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
    expect(classesOf('try { a() } catch { this.questionStateNotSaved() }')).toEqual(['REPORTED'])
    expect(classesOf('try { a() } catch { this.questionFailed() }')).toEqual(['REPORTED'])
    expect(classesOf('try { a() } catch { worker.failed() }')).toEqual(['SWALLOW'])
    expect(
      classesOf(`try { a() } catch (error: unknown) {
        if (!(error instanceof Error)) throw error
        if (!isSteerRefusedError(error)) return 'uncertain'
      }`),
    ).toEqual(['GENERIC'])
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

  it('names CLEANUP only with its reason comment at the catch', () => {
    expect(classesOf('try { a() } catch { // the handle is already closing\n }')).toEqual([
      'CLEANUP',
    ])
    expect(classesOf('doomed.catch(() => null) // already failing; best effort')).toEqual([
      'CLEANUP',
    ])
    // Prettier expands an empty block's trailing comment onto its own lines:
    // the leading comment is the stable CLEANUP mark.
    expect(classesOf('try { a() } catch {\n /* the handle is already closing */ }')).toEqual([
      'CLEANUP',
    ])
    expect(classesOf('try { a() } catch {\n }')).toEqual(['SWALLOW'])
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

  it('rejects handlers with an unreported branch, including broad Error fallbacks', () => {
    for (const handler of [
      'if (error instanceof Error) throw error',
      'if (!(error instanceof Error)) throw error; return fallback',
      'if (ready) report("failed", error)',
      'if (error.code === "ENOENT") return; if (ready) throw error',
      'return ready ? error : fallback',
      'ready && report("failed", error)',
      'while (ready) { report("failed", error); break }',
    ]) {
      expect(classesOf(`try { a() } catch (error) { ${handler} }`)).toEqual(['GENERIC'])
    }
    expect(
      classesOf(`try { a() } catch (error) {
      if (!(error instanceof URIError)) throw error
      return fallback
    }`),
    ).toEqual(['NARROW'])
    expect(
      classesOf(`try { a() } catch (error) {
      if (ready) report('failed', error)
      else throw error
    }`),
    ).toEqual(['REPORTED'])
  })
})
