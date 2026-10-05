import { describe, expect, it } from 'vitest'
import { formatMergedJsonTable, mergeJsonTable } from '../../src/core/team/merge/jsonTable'

function merged(base: string, ours: string, theirs: string): string {
  const result = mergeJsonTable(base, ours, theirs)
  expect(result.kind).toBe('merged')
  if (result.kind !== 'merged') throw new Error(JSON.stringify(result))
  return result.text
}

describe('team JSON table merge', () => {
  it('merges ten parallel changes in all thirty table paths, nested and flat', async () => {
    const paths = Array.from({ length: 15 }, (_, index) => [
      `l10n/ui.${String(index)}.json`,
      `package.nls.${String(index)}.json`,
    ]).flat()
    const base = '{\n  "10": "ten",\n  "2": "two",\n  "nested": {"kept": true}\n}\n'
    for (const path of paths) {
      let ours = base
      for (let task = 0; task < 10; task++) {
        const theirs = base
          .replace('"10": "ten",', () => `"10": "ten",\n  "task${String(task)}": ${String(task)},`)
          .replace('"kept": true', () => `"kept": true, "child${String(task)}": ${String(task)}`)
        const text = merged(base, ours, theirs)
        const formatted = await formatMergedJsonTable(
          { path, base, ours, theirs, text },
          (_path, value) => Promise.resolve(value.replace('{"', '{ "')),
        )
        expect(formatted.kind).toBe('merged')
        if (formatted.kind !== 'merged') throw new Error(JSON.stringify(formatted))
        ours = formatted.text
      }
      expect(ours.indexOf('"10"')).toBeLessThan(ours.indexOf('"2"'))
      for (let task = 0; task < 10; task++) {
        expect(ours.match(new RegExp(`"task${String(task)}"`, 'g'))).toHaveLength(1)
        expect(ours).toContain(`"child${String(task)}": ${String(task)}`)
      }
    }
  })

  it.each([
    ['same key', '{"a":0}', '{"a":1}', '{"a":2}'],
    ['delete/change', '{"a":0}', '{}', '{"a":2}'],
    ['arrays are atomic', '{"a":[0]}', '{"a":[1]}', '{"a":[2]}'],
    ['different type changes', '{"a":0}', '{"a":"x"}', '{"a":false}'],
    ['precise large integers', '{"a":0}', '{"a":9007199254740992}', '{"a":9007199254740993}'],
  ])('refuses %s with a key, never markers or a silent pick', (_name, base, ours, theirs) => {
    expect(mergeJsonTable(base, ours, theirs)).toEqual({
      kind: 'conflict',
      reason: 'value',
      key: ['a'],
    })
  })

  it.each([
    '{',
    '{"a":1}junk',
    '{"a":1,"a":2}',
    String.raw`{"nested":{"a":1,"\u0061":2}}`,
    '{"array":[{"a":1,"a":2}]}',
    '[]',
    'null',
  ])('refuses invalid, duplicate or nonobject side %s', (bad) => {
    for (const sides of [
      [bad, '{}', '{}'],
      ['{}', bad, '{}'],
      ['{}', '{}', bad],
    ]) {
      expect(mergeJsonTable(sides[0]!, sides[1]!, sides[2]!).kind).toBe('conflict')
    }
  })

  it('accepts identical changes, removals and one-sided type changes', () => {
    expect(mergeJsonTable('{}', '{\n"a": }', '{}')).toMatchObject({
      kind: 'conflict',
      reason: 'parse',
      line: 2,
    })
    expect(merged('{"a":0}', '{"a":1}', '{"a":1}')).toBe('{"a":1}')
    expect(merged('{"a":0,"b":0}', '{"a":0,"b":1}', '{"a":false,"b":0}')).toBe('{"a":false,"b":1}')
    expect(merged('{"a":1}', '{"a":1.0}', '{"a":1e0}')).toBe('{"a":1.0}')
    expect(merged('{"a":0}', '{"a":0}', '{"a":1e400}')).toBe('{"a":1e400}')
  })

  it('keeps raw integer key order, branch predecessor placement and removed neighbours', () => {
    expect(merged('{"b":0,"a":0}', '{"b":0,"a":0}', '{"b":0,"c":1,"a":0}')).toBe(
      '{"b":0,"c":1,"a":0}',
    )
    expect(merged('{"10":0,"2":0}', '{"10":0,"2":0}', '{"2":2,"10":0,"new":1}')).toBe(
      '{"10":0,"new":1,"2":2}',
    )
    expect(merged('{"a": 0, "b": 0}', '{"a": 0, "b": 0}', '{"a":1,"b":0}')).toBe('{"a": 1, "b": 0}')
    expect(merged('{"10":0,"2":0}', '{"10":1,"2":0}', '{"10":0,"new":1,"2":0}')).toBe(
      '{"10":1,"new":1,"2":0}',
    )
    expect(merged('{"a":0,"b":0}', '{"b":0}', '{"a":0,"new":1,"b":0}')).toBe('{"b":0,"new":1}')
  })

  it('preserves BOM, CRLF, indentation, escaped strings and final newline', () => {
    expect(merged('{"a":"b"}', String.raw`{"\u0061":"\u0062"}`, '{"a":"b","c":"d"}')).toBe(
      String.raw`{"\u0061":"\u0062","c":"d"}`,
    )
    const ours = '\u{FEFF}{\r\n\t"a": "\\u00e9\\/"\r\n}\r\n'
    const text = merged('{"a":"é/"}', ours, '{"a":"é/","b":"ß/"}')
    expect(text).toBe('\u{FEFF}{\r\n\t"a": "\\u00e9\\/",\r\n\t"b": "\\u00df\\/"\r\n}\r\n')
  })

  it('checks both intents after the formatter, including missing branch additions and removals', async () => {
    const input = {
      path: '/stage/l10n.json',
      base: '{"a":0,"remove":0}',
      ours: '{"a":1,"remove":0,"ours":1}',
      theirs: '{"a":0,"branch":1}',
      text: '{"a":1,"ours":1,"branch":1}',
    }
    for (const corrupt of [
      '{"a":1,"branch":1}',
      '{"a":1,"ours":1}',
      '{"a":1,"ours":1,"branch":1,"remove":0}',
      '{"a":2,"ours":1,"branch":1}',
      '{"a":1,"ours":1,"branch":2}',
      '{"a":1,"ours":1,"branch":1,"branch":2}',
    ]) {
      const result = await formatMergedJsonTable(input, () => Promise.resolve(corrupt))
      expect(result.kind).toBe('conflict')
    }
    const formatted = input.text + '\n'
    expect(await formatMergedJsonTable(input, () => Promise.resolve(formatted))).toEqual({
      kind: 'merged',
      text: formatted,
    })
    expect(await formatMergedJsonTable(input, () => Promise.resolve(undefined))).toEqual({
      kind: 'merged',
      text: input.text,
    })
    const sorted = await formatMergedJsonTable(input, () =>
      Promise.resolve('{"ours":1,"branch":1,"a":1}'),
    )
    expect(sorted.kind).toBe('conflict')
    const styled = {
      path: '/stage/style.json',
      base: '{}',
      ours: '\u{FEFF}{\r\n}',
      theirs: '{"a":1}',
      text: '\u{FEFF}{\r\n  "a":1\r\n}',
    }
    const noBom = await formatMergedJsonTable(styled, () => Promise.resolve(styled.text.slice(1)))
    expect(noBom.kind).toBe('conflict')
    const noCrLf = await formatMergedJsonTable(styled, () =>
      Promise.resolve(styled.text.replaceAll('\r\n', '\n')),
    )
    expect(noCrLf.kind).toBe('conflict')
  })
})
