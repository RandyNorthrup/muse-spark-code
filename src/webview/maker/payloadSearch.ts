/** Self-contained: its compiled source runs in a disposable Web Worker. */
export function findPayloadMatch(rows: readonly string[], query: string, after: number) {
  if (query === '') return { match: -1, jump: -1 }
  const prefix = new Uint32Array(query.length)
  let matched = 0
  for (let index = 1; index < query.length; index += 1) {
    while (matched > 0 && query[index] !== query[matched]) matched = prefix[matched - 1] ?? 0
    if (query[index] === query[matched]) matched += 1
    prefix[index] = matched
  }
  matched = 0
  let offset = 0
  const ends: number[] = []
  for (const [index, row] of rows.entries()) {
    ends.push(offset + row.length)
    for (const character of row.split('')) {
      while (matched > 0 && character !== query[matched]) matched = prefix[matched - 1] ?? 0
      if (character === query[matched]) matched += 1
      offset += 1
      if (matched !== query.length) {
        continue
      }

      if (index > after) {
        let low = 0
        let high = ends.length
        const start = offset - query.length + 1
        while (low < high) {
          const mid = Math.floor((low + high) / 2)
          if ((ends[mid] ?? 0) < start) low = mid + 1
          else high = mid
        }
        return { match: index, jump: low }
      }
      matched = prefix[matched - 1] ?? 0
    }
  }
  return { match: -1, jump: -1 }
}
