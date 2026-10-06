// One sorted leaf layout for lossless packaged translation tables.
export function tableLayout(reference, prefix = []) {
  return typeof reference !== 'object' ||
    reference === null ||
    ('other' in reference &&
      Object.keys(reference).every((key) =>
        ['zero', 'one', 'two', 'few', 'many', 'other'].includes(key),
      ))
    ? [prefix]
    : Object.entries(reference)
        .toSorted(([a], [b]) => a.localeCompare(b, 'en'))
        .flatMap(([key, value]) => tableLayout(value, [...prefix, key]))
}
export function packTable(layout, table) {
  return {
    format: 1,
    values: layout.map((keys) => {
      let value = table
      for (const key of keys) value = value[key]
      return value
    }),
  }
}
