// JSONC as the workspace's settings files use it (M118, Codex on
// PR #227): line and block comments and trailing commas, stripped before
// parsing so a commented settings file still reads. Strings are honored,
// so a comment-looking value survives. Pure; the sharing policy and
// headless `playbook run` read their settings through it.
export function stripJsonc(text: string): string {
  let out = ''
  let i = 0
  let isInString = false
  while (i < text.length) {
    const ch = text[i] ?? ''
    if (isInString) {
      out += ch
      if (ch === '\\') {
        out += text[i + 1] ?? ''
        i += 2
        continue
      }
      if (ch === '"') isInString = false
      i += 1
      continue
    }
    if (ch === '"') {
      isInString = true
      out += ch
      i += 1
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 2
      continue
    }
    if (ch === ',') {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j] ?? '')) j += 1
      const next = text[j] ?? ''
      if (next === '}' || next === ']') {
        i += 1
        continue
      }
    } else if (ch === '}' || ch === ']') {
      // A trailing comma can hide before a comment (`false, // note\n}`):
      // drop it when the brace lands.
      out = out.replace(/,\s*$/, '')
    }
    out += ch
    i += 1
  }
  return out
}
