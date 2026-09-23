import { describe, expect, it } from 'vitest'
import { linkHref, linkTarget } from '../../src/webview/links'

// M25: a relative link in a reply was sent to the host as a URL and refused
// ("Only http, https and mailto links can be opened").

describe('linkTarget', () => {
  it('sends a URL with a scheme to the host, which vets the scheme', () => {
    expect(linkTarget('https://dev.meta.ai/')).toEqual({
      kind: 'external',
      url: 'https://dev.meta.ai/',
    })
    expect(linkTarget('mailto:a@b.c')).toMatchObject({ kind: 'external' })
    expect(linkTarget('vscode:extension/x')).toMatchObject({ kind: 'external' })
  })

  it('opens a relative link as a workspace file, at the lines it names', () => {
    expect(linkTarget('src/parser.ts')).toEqual({
      kind: 'file',
      path: 'src/parser.ts',
      range: undefined,
    })
    expect(linkTarget('./src/parser.ts#L12')).toEqual({
      kind: 'file',
      path: 'src/parser.ts',
      range: { startLine: 12, endLine: 12 },
    })
    expect(linkTarget('src/parser.ts#L12-L20')).toMatchObject({
      range: { startLine: 12, endLine: 20 },
    })
    expect(linkTarget('notes.md:5-3')).toEqual({
      kind: 'file',
      path: 'notes.md',
      range: { startLine: 5, endLine: 5 },
    })
    expect(linkTarget(String.raw`docs\guide%20one.md`)).toMatchObject({ path: 'docs/guide one.md' })
    expect(linkTarget('bad%zzname.md')).toMatchObject({ path: 'bad%zzname.md' })
    expect(linkTarget('src/a.ts#section')).toMatchObject({ path: 'src/a.ts', range: undefined })
    expect(linkTarget('a.ts#L0')).toMatchObject({ range: undefined })
  })

  it('refuses a path that climbs out of the workspace or starts at a root', () => {
    expect(linkTarget('../secrets.txt')).toEqual({ kind: 'refused' })
    expect(linkTarget('src/%2E%2E/%2E%2E/x')).toEqual({ kind: 'refused' })
    expect(linkTarget('/etc/passwd')).toEqual({ kind: 'refused' })
    expect(linkTarget(String.raw`\\server\share`)).toEqual({ kind: 'refused' })
  })

  it('does nothing for an anchor or an empty path', () => {
    expect(linkTarget('#usage')).toEqual({ kind: 'anchor' })
    expect(linkTarget('./')).toEqual({ kind: 'anchor' })
  })
})

describe('linkHref', () => {
  it("lets a name:line file link through react-markdown's filter and blanks script URLs", () => {
    expect(linkHref('notes.md:12')).toBe('notes.md:12')
    expect(linkHref('src/a.ts#L3')).toBe('src/a.ts#L3')
    expect(linkHref('https://dev.meta.ai/')).toBe('https://dev.meta.ai/')
    expect(linkHref('javascript:alert(1)')).toBe('')
    expect(linkHref('javascript:1')).toBe('')
    expect(linkTarget('javascript:1')).toMatchObject({ kind: 'external' })
  })
})
