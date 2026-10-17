// Fence labels and aliases are small enough to resolve before the optional
// highlighting engine loads. Unknown/open fences render plain escaped text.

const LANGUAGES = new Set([
  'bash',
  'c',
  'cpp',
  'csharp',
  'css',
  'diff',
  'go',
  'java',
  'javascript',
  'json',
  'markdown',
  'powershell',
  'python',
  'rust',
  'sql',
  'typescript',
  'xml',
  'yaml',
])

const ALIASES: Readonly<Record<string, string>> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  ps1: 'powershell',
  pwsh: 'powershell',
  py: 'python',
  rs: 'rust',
  'c++': 'cpp',
  cs: 'csharp',
  html: 'xml',
  svg: 'xml',
  md: 'markdown',
  yml: 'yaml',
  jsonc: 'json',
}

/** The registered grammar for a fence tag, or undefined for plain text. */
export function resolveLanguage(tag: string | undefined): string | undefined {
  if (tag === undefined) {
    return undefined
  }
  const lower = tag.toLowerCase()
  return LANGUAGES.has(lower) ? lower : ALIASES[lower]
}
