import { describe, expect, it } from 'vitest'
import { globToRegExp, isGlobMatch } from '../../src/core/backends/modelapi/glob'

describe('isGlobMatch', () => {
  it('matches a bare file pattern at any depth and a rooted one only where written', () => {
    expect(isGlobMatch('src/a/b.ts', '*.ts')).toBe(true)
    expect(isGlobMatch('b.ts', '*.ts')).toBe(true)
    expect(isGlobMatch('src/a/b.tsx', '*.ts')).toBe(false)
    expect(isGlobMatch('src/b.ts', 'src/*.ts')).toBe(true)
    expect(isGlobMatch('src/a/b.ts', 'src/*.ts')).toBe(false)
  })

  it('spans directories with ** and keeps * and ? inside one segment', () => {
    expect(isGlobMatch('src/a/b/c.ts', 'src/**/*.ts')).toBe(true)
    expect(isGlobMatch('src/c.ts', 'src/**/*.ts')).toBe(true)
    expect(isGlobMatch('lib/c.ts', 'src/**/*.ts')).toBe(false)
    expect(isGlobMatch('src/anything/at/all', 'src/**')).toBe(true)
    expect(isGlobMatch('a1.md', 'a?.md')).toBe(true)
    expect(isGlobMatch('a/1.md', 'a?.md')).toBe(false)
  })

  it('alternates with braces and classes with brackets, escaping regex characters', () => {
    expect(isGlobMatch('x.ts', '*.{ts,tsx}')).toBe(true)
    expect(isGlobMatch('x.tsx', '*.{ts,tsx}')).toBe(true)
    expect(isGlobMatch('x.js', '*.{ts,tsx}')).toBe(false)
    expect(isGlobMatch('test1.ts', 'test[0-9].ts')).toBe(true)
    expect(isGlobMatch('testa.ts', 'test[0-9].ts')).toBe(false)
    expect(isGlobMatch('a.b.ts', 'a.b.ts')).toBe(true)
    expect(isGlobMatch('axb.ts', 'a.b.ts')).toBe(false)
    expect(isGlobMatch('f(1).ts', 'f(1).ts')).toBe(true)
  })

  it('treats an unclosed brace or bracket as literal text', () => {
    expect(isGlobMatch('a{b', 'a{b')).toBe(true)
    expect(isGlobMatch('a[b', 'a[b')).toBe(true)
    expect(globToRegExp('a[b').source).toContain(String.raw`a\[b$`)
  })
})
