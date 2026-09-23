import { describe, expect, it } from 'vitest'
import { compileGlob, isGlobMatch } from '../../src/core/backends/modelapi/glob'

describe('isGlobMatch', () => {
  it('matches a bare file pattern at any depth and a rooted one only where written', () => {
    expect(isGlobMatch('src/a/b.ts', '*.ts')).toBe(true)
    expect(isGlobMatch('b.ts', '*.ts')).toBe(true)
    expect(isGlobMatch('src/a/b.tsx', '*.ts')).toBe(false)
    expect(isGlobMatch('src/b.ts', 'src/*.ts')).toBe(true)
    expect(isGlobMatch('src/a/b.ts', 'src/*.ts')).toBe(false)
    expect(isGlobMatch('src/b.ts', './src/*.ts')).toBe(true)
  })

  it('spans directories with ** and keeps * and ? inside one segment', () => {
    expect(isGlobMatch('src/a/b/c.ts', 'src/**/*.ts')).toBe(true)
    expect(isGlobMatch('src/c.ts', 'src/**/*.ts')).toBe(true)
    expect(isGlobMatch('lib/c.ts', 'src/**/*.ts')).toBe(false)
    expect(isGlobMatch('src/anything/at/all', 'src/**')).toBe(true)
    expect(isGlobMatch('a1.md', 'a?.md')).toBe(true)
    expect(isGlobMatch('a/1.md', 'a?.md')).toBe(false)
    expect(isGlobMatch('x/a/b/y', 'x/**b/y')).toBe(true)
    expect(isGlobMatch('x/y', 'x/**/y')).toBe(true)
    expect(isGlobMatch('xy', 'x/**/y')).toBe(false)
  })

  it('alternates with braces, nested too, and classes with brackets', () => {
    expect(isGlobMatch('x.ts', '*.{ts,tsx}')).toBe(true)
    expect(isGlobMatch('x.tsx', '*.{ts,tsx}')).toBe(true)
    expect(isGlobMatch('x.js', '*.{ts,tsx}')).toBe(false)
    expect(isGlobMatch('a/x.mjs', '**/*.{ts,{c,m}js}')).toBe(true)
    expect(isGlobMatch('a/x.js', '**/*.{ts,{c,m}js}')).toBe(false)
    expect(isGlobMatch('test1.ts', 'test[0-9].ts')).toBe(true)
    expect(isGlobMatch('testa.ts', 'test[0-9].ts')).toBe(false)
    expect(isGlobMatch('testa.ts', 'test[!0-9].ts')).toBe(true)
    expect(isGlobMatch('test1.ts', 'test[^0-9].ts')).toBe(false)
    expect(isGlobMatch('a]b', 'a[]]b')).toBe(true)
    expect(isGlobMatch('a/b', 'a[/]b')).toBe(false)
    expect(isGlobMatch('a.b.ts', 'a.b.ts')).toBe(true)
    expect(isGlobMatch('axb.ts', 'a.b.ts')).toBe(false)
    expect(isGlobMatch('f(1).ts', 'f(1).ts')).toBe(true)
  })

  it('treats an unclosed brace or bracket, and a one-option brace, as literal text', () => {
    expect(isGlobMatch('a{b', 'a{b')).toBe(true)
    expect(isGlobMatch('a[b', 'a[b')).toBe(true)
    expect(isGlobMatch('a{b}', 'a{b}')).toBe(true)
    expect(isGlobMatch('ab', 'a{b}')).toBe(false)
  })

  it('refuses an over-long glob and one whose braces expand too far', () => {
    expect(() => compileGlob('a'.repeat(257))).toThrow(/longer than 256/)
    expect(() => compileGlob('{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}')).toThrow(
      /more than 256 alternatives/,
    )
  })

  it('matches a pathological pattern in linear time (the regular expression hung for 25 s, D24)', () => {
    const pattern = `${'**a'.repeat(12)}b`
    const path = `${'a/'.repeat(60)}${'a'.repeat(200)}`
    const started = performance.now()
    expect(isGlobMatch(path, pattern)).toBe(false)
    expect(performance.now() - started).toBeLessThan(1000)
  })
})
