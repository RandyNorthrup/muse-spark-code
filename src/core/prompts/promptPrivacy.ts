import type { SharePrivacyPort } from '../../shared/share'

function escapePattern(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

function pathPattern(root: string): string {
  return root
    .replace(/[\\/]+$/, '')
    .split(/[\\/]+/)
    .map((part) => escapePattern(part))
    .join(String.raw`[\\/]+`)
}

/** Account names are private in paths and identity fields, never as ordinary words. */
export function scrubUserIdentity(text: string, user: string): string {
  if (user === '') return text
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- escapePattern quotes username metacharacters; fixed Unicode boundaries and the callback limit replacement to path segments (PLAN.md §8).
  const name = new RegExp(
    String.raw`(?<![\p{L}\p{N}_])${escapePattern(user)}(?![\p{L}\p{N}_])`,
    'giu',
  )
  const paths = text.replaceAll(name, (match: string, offset: number, input: string) => {
    const before = input[offset - 1] ?? ''
    const after = input[offset + match.length] ?? ''
    const isSegment =
      (before === '' || /[\\/\s"'`<>()[\]{},;:=]/.test(before)) &&
      (after === '' || /[\\/\s"'`<>()[\]{},;:=]/.test(after))
    return isSegment && /[\\/]/.test(`${before}${after}`) ? '[user]' : match
  })
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- escapePattern quotes username metacharacters; identity labels, delimiters and boundaries are fixed (PLAN.md §8).
  const identity = new RegExp(
    String.raw`((?<![\p{L}\p{N}_])(?:(?:user(?:name)?|owner|author|account|login)["']?\s*[:=]\s*|(?:owner|author|account|login)\s+)["']?)${escapePattern(user)}(?![\p{L}\p{N}_])`,
    'giu',
  )
  return paths.replaceAll(identity, (_match: string, label: string) => `${label}[user]`)
}

/** In-memory values only. Hosts refresh them immediately before preview and release. */
export function promptPrivacy(input: {
  readonly workspaceRoots: readonly string[]
  readonly home: string
  readonly user: string
  readonly registeredSecrets: () => readonly string[]
}): SharePrivacyPort {
  function normalisePaths(text: string): string {
    let result = text
    const roots = [...input.workspaceRoots].toSorted((a, b) => b.length - a.length)
    for (const root of roots) {
      if (root === '') continue
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- pathPattern escapes every root segment; only fixed separator/tail syntax is added (PLAN.md §8).
      const pattern = new RegExp(
        `${pathPattern(root)}(?:[\\\\/]+([^\\s"'\`<>]*))?(?=$|[\\s"'\`<>])`,
        'gi',
      )
      result = result.replaceAll(pattern, (_match: string, tail: string | undefined) =>
        tail === undefined ? '[workspace]' : tail.replaceAll(/\\+/g, '/'),
      )
    }
    if (input.home !== '')
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- pathPattern escapes every home segment; the caller cannot supply regex syntax (PLAN.md §8).
      result = result.replaceAll(new RegExp(pathPattern(input.home), 'gi'), () => '[home]')
    // Known roots were handled with spaces/escaped separators before generic absolute paths.
    result = result.replaceAll(
      /file:\/\/[^\s<>"'`]+|(?:(?<!\w)[A-Za-z]:[\\/]|\\\\)[^\s<>"'`]+|(?<![\w:/\]])\/(?!\/)[^\s<>"'`]+/g,
      () => '[path]',
    )
    result = scrubUserIdentity(result, input.user)
    return result
  }
  return {
    normalisePaths,
    redactRegisteredSecrets: (text) => {
      let result = text
      const secrets = input
        .registeredSecrets()
        .filter((value) => value !== '')
        .toSorted((a, b) => b.length - a.length)
      for (const secret of secrets) result = result.replaceAll(secret, () => '[redacted]')
      return result
    },
  }
}
