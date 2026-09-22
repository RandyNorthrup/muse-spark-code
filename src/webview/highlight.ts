// Syntax highlighting for code blocks: highlight.js core with a fixed set of
// grammars (PLAN.md Q5: shiki's grammars plus engine would cost more than the
// whole webview budget). Output is highlight.js' escaped HTML; the classes are
// themed in styles.css from VS Code colour variables.

import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import powershell from 'highlight.js/lib/languages/powershell'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

const LANGUAGES = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  go,
  java,
  javascript,
  json,
  markdown,
  powershell,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
} as const

const ALIASES: Readonly<Record<string, keyof typeof LANGUAGES>> = {
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

for (const [name, grammar] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, grammar)
}

/** The registered grammar for a fence tag, or undefined for plain text. */
export function resolveLanguage(tag: string | undefined): string | undefined {
  if (tag === undefined) {
    return undefined
  }
  const lower = tag.toLowerCase()
  return Object.hasOwn(LANGUAGES, lower) ? lower : ALIASES[lower]
}

/** Escaped, class-annotated HTML for `code`; plain escaped text when unknown. */
export function highlight(code: string, tag: string | undefined): string {
  const language = resolveLanguage(tag)
  return language === undefined
    ? escapeHtml(code)
    : hljs.highlight(code, { language, ignoreIllegals: true }).value
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(text: string): string {
  return text.replaceAll(/["&'<>]/g, (char) => HTML_ESCAPES[char] ?? char)
}
