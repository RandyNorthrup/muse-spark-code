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
        `${pathPattern(root)}(?:[\\\\/]+([^\\s"'\u{60}<>]*))?(?=$|[\\s"'\u{60}<>])`,
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
    if (input.user !== '')
      result = result.replaceAll(
        // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- escapePattern quotes all username metacharacters; word boundaries and flags are fixed (PLAN.md §8).
        new RegExp(String.raw`\b${escapePattern(input.user)}\b`, 'gi'),
        () => '[user]',
      )
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
