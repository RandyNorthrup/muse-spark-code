// Canonical JSON for digests and keys (M98's judge entries, M110r Y3's
// step keys): sorted keys, recursive, so equal inputs digest equal. Only
// finite JSON values digest; anything else throws, so two different
// inputs never share a key. Pure and dependency-free.

/**
Byte-order string comparison: locale-independent, so equal inputs digest
equal on every machine.
*/
export function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1
  }
  return left > right ? 1 : 0
}

/**
Canonical JSON for `value`, described as `what` in refusal text. Key
order in objects does not matter; a changed value is different text.
Throws on undefined, non-finite numbers and non-JSON values.
*/
export function canonicalJson(value: unknown, what = 'value'): string {
  if (value === null) {
    return 'null'
  }
  switch (typeof value) {
    case 'number': {
      if (!Number.isFinite(value)) {
        throw new TypeError(`${what} must be finite JSON values`)
      }
      return JSON.stringify(value)
    }
    case 'boolean':
    case 'string': {
      return JSON.stringify(value)
    }
    case 'undefined': {
      throw new TypeError(`${what} must not contain undefined`)
    }
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item, what)).join(',')}]`
      }
      const entries = Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .toSorted(([left], [right]) => compareStrings(left, right))
      return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item, what)}`).join(',')}}`
    }
    default: {
      throw new TypeError(`${what} must be JSON values`)
    }
  }
}
