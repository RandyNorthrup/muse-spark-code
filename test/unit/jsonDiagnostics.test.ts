import { describe, expect, it } from 'vitest'
import { jsonDiagnostics } from '../../src/core/verify/jsonDiagnostics'

describe('positioned local JSON diagnostics', () => {
  it.each([
    ['{\n  "a": 1\n  "b": 2\n}\n', 13],
    ['[1 2]', 3],
    ['{\r\n  "a": 1\r\n  "b": 2\r\n}', 15],
  ])('finds the missing comma offset for %s', (text, offset) => {
    expect(jsonDiagnostics(text, 'a.json', false)).toEqual([{ offset, message: 'Expected comma' }])
  })
  it('accepts JSONC without erasing strings or changing error offsets', () => {
    expect(
      jsonDiagnostics('{ /* x */ "url": "https://x//", "text": ",}", }', 'a.jsonc', true),
    ).toEqual([])
    const text = '{ /* x */ "a": 1 "b": 2 }'
    expect(jsonDiagnostics(text, 'a.jsonc', true)[0]?.offset).toBe(text.indexOf('"b"'))
    expect(jsonDiagnostics('// line\r\n{ "a": 1, }', 'a.jsonc', true)).toEqual([])
  })
  it('rejects comments and trailing commas in strict JSON', () => {
    expect(jsonDiagnostics('{ /* x */ }', 'a.json', false)).toHaveLength(1)
    expect(jsonDiagnostics('{"a": 1,}', 'a.json', false)).toHaveLength(1)
  })
  it.each(['{,}', '[,]', '{ /* no member */ , }', '[ /* no item */ , ]'])(
    'rejects an empty JSONC member or element in %s',
    (text) => {
      expect(jsonDiagnostics(text, 'a.jsonc', true)).toHaveLength(1)
    },
  )
  it.each([
    '["text",]',
    '[true, false, null,]',
    '[1, -2.5e+3,]',
    '{"a": [], "b": {},}',
    '[ /* comment */ {"a": 1,}, ["b",],]',
  ])('accepts JSONC trailing commas after complete values in %s', (text) => {
    expect(jsonDiagnostics(text, 'a.jsonc', true)).toEqual([])
  })
  it('uses shipped permission schemas only in editor settings', () => {
    const text =
      '{"museSpark.modelApiCommandRules": [{"pattern": []}], "museSpark.modelApiPermissionProfiles": {"bad": {"extraRoots": 1}}, "museSpark.modelApiRepositoryRules": {"denyRead": 1}}'
    expect(jsonDiagnostics(text, '.vscode/settings.json', true)).toHaveLength(3)
    expect(jsonDiagnostics(text, 'data.json', false)).toEqual([])
    expect(jsonDiagnostics(`{"settings": ${text}}`, 'project.code-workspace', true)).toHaveLength(3)
    expect(
      jsonDiagnostics('{"museSpark.modelApiCommandRules": []}', '.vscode/settings.json', true),
    ).toEqual([])
  })
  it('reports malformed JSON without quoting document content', () => {
    expect(jsonDiagnostics('{"b": bad}', 'a.json', false)).toEqual([
      { offset: 6, message: 'Invalid JSON syntax' },
    ])
    expect(jsonDiagnostics('{', 'a.json', false)).toEqual([
      { offset: 1, message: 'Invalid JSON syntax' },
    ])
    expect(jsonDiagnostics('\u{FEFF}{}', 'a.json', false)).toEqual([])
  })
})
