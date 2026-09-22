import { describe, expect, it } from 'vitest'
import { fuzzyScore, rankMatches } from '../../src/core/fuzzy'

describe('fuzzyScore', () => {
  it('matches every candidate with an empty query', () => {
    expect(fuzzyScore('', 'anything')).toBe(0)
  })

  it('rejects a query that is not a subsequence', () => {
    expect(fuzzyScore('xyz', 'src/app.ts')).toBeUndefined()
    expect(fuzzyScore('tsa', 'app.ts')).toBeUndefined()
  })

  it('is case-insensitive', () => {
    expect(fuzzyScore('APP', 'src/app.ts')).toBe(fuzzyScore('app', 'src/app.ts'))
  })

  it('prefers consecutive matches over scattered ones', () => {
    const consecutive = fuzzyScore('app', 'src/app.ts') ?? -Infinity
    const scattered = fuzzyScore('app', 'a/pack/p.ts') ?? -Infinity
    expect(consecutive).toBeGreaterThan(scattered)
  })

  it('prefers matches in the file name over matches in folders', () => {
    const inName = fuzzyScore('cfg', 'src/config.ts') ?? -Infinity
    const inFolder = fuzzyScore('cfg', 'config/src.ts') ?? -Infinity
    expect(inName).toBeGreaterThan(inFolder)
  })
})

describe('rankMatches', () => {
  const paths = ['src/webview/App.tsx', 'src/host/settings.ts', 'README.md', 'src/app.ts']

  it('returns only matches, best first, capped at the limit', () => {
    expect(rankMatches('app', paths, (path) => path, 10)).toEqual([
      'src/app.ts',
      'src/webview/App.tsx',
    ])
    expect(rankMatches('app', paths, (path) => path, 1)).toEqual(['src/app.ts'])
  })

  it('breaks score ties by shorter key', () => {
    expect(rankMatches('s', ['src/a.ts', 'src/ab.ts'], (path) => path, 10)).toEqual([
      'src/a.ts',
      'src/ab.ts',
    ])
  })

  it('returns everything for an empty query, in the original order', () => {
    expect(rankMatches('', paths, (path) => path, 10)).toEqual(paths)
  })
})
