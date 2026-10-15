// Types for scripts/lib/noticesInput.mjs, the notices input parser the
// ChatGPT package test reads metafiles through (RVTESTCUT2 F6). The
// implementation stays the single .mjs beside this file.
export function noticePackageDir(input: string): string | undefined
export function contributedPackageDirs(
  metafiles: Iterable<string>,
  read?: (file: string, encoding: string) => string,
  // Named for the lint rule; the .mjs calls it `includesOutput`.
  isIncluded?: (output: string) => boolean,
): Set<string>
