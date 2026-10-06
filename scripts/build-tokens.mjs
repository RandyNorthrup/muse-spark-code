// D94: this generator is also TH/TD's input contract. It never reads a host's
// settings, downloads a theme or introduces JavaScript into a shipped surface.
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as z from 'zod'
import prettier from 'prettier'
import stylelint from 'stylelint'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

export const TOKEN_SOURCE = 'design/tokens/muse.tokens.json'
export const TOKEN_EXTENSION = 'org.muse-spark-code'
export const TOKEN_OUTPUTS = [
  'src/webview/tokens.css',
  'design/tokens/generated/host-roles.css',
  'design/tokens/generated/muse.css',
  'design/tokens/generated/consumers.json',
]
const MODES = ['light', 'dark', 'hc-light', 'hc-dark']
const dimension = z
  .object({ value: z.number().nonnegative(), unit: z.enum(['px', 'rem']) })
  .strict()
const reference = z.string().regex(/^\{[\w-]+\.[\w-]+\}$/)
const colour = z
  .object({
    colorSpace: z.enum(['srgb', 'oklch']),
    components: z.tuple([z.number(), z.number(), z.number()]),
    alpha: z.number().min(0).max(1),
  })
  .strict()
  .refine(({ colorSpace, components }) => {
    const [l, c, h] = components
    return colorSpace === 'srgb'
      ? components.every((n) => n >= 0 && n <= 1)
      : l >= 0 && l <= 1 && c >= 0 && h >= 0 && h <= 360
  })
const shadow = z.array(
  z
    .object({
      color: z.union([colour, reference]),
      offsetX: dimension,
      offsetY: dimension,
      blur: dimension,
      spread: dimension,
    })
    .strict(),
)
const values = {
  color: colour,
  dimension,
  number: z.number(),
  fontWeight: z.number().int().min(1).max(1000),
  fontFamily: z.array(z.string().min(1)).min(1),
  duration: z.object({ value: z.number().nonnegative(), unit: z.enum(['ms', 's']) }).strict(),
  cubicBezier: z.tuple([
    z.number().min(0).max(1),
    z.number(),
    z.number().min(0).max(1),
    z.number(),
  ]),
  shadow,
}
const token = z.discriminatedUnion(
  '$type',
  Object.entries(values).map(([$type, value]) =>
    z
      .object({
        $type: z.literal($type),
        $description: z.string().optional(),
        $value: z.union([value, reference]),
        $extensions: z
          .object({
            [TOKEN_EXTENSION]: z
              .object({
                css: z.string().regex(/^--ms-[a-z][a-z\d-]*$/),
                vscode: z
                  .array(z.string().regex(/^--vscode-[a-zA-Z][a-zA-Z\d-]*$/))
                  .min(1)
                  .optional(),
                modes: z.partialRecord(z.enum(MODES), z.union([value, reference])).optional(),
                cssValue: z.string().optional(),
                web: z.literal('extended').optional(),
              })
              .strict(),
          })
          .strict(),
      })
      .strict(),
  ),
)
const pair = z
  .object({
    foreground: z.string(),
    background: z.string(),
    canvas: z.string().optional(),
    usage: z.enum(['text', 'large-text', 'ui']),
  })
  .strict()
const metadata = z
  .object({
    $description: z.string(),
    $extensions: z
      .object({
        [TOKEN_EXTENSION]: z
          .object({
            version: z.literal(1),
            modes: z.array(z.enum(MODES)).length(MODES.length),
            contrastPairs: z.array(pair).min(1),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()

export function parseTokens(input) {
  const { $description, $extensions, ...groups } = input
  const meta = metadata.parse({ $description, $extensions })
  if (new Set(meta.$extensions[TOKEN_EXTENSION].modes).size !== MODES.length) {
    throw new Error('Every palette mode must be present exactly once')
  }
  const parsed = z
    .record(z.string().regex(/^[a-z][\w-]*$/), z.record(z.string(), token))
    .parse(groups)
  const tokens = Object.fromEntries(
    Object.entries(parsed).flatMap(([group, entries]) =>
      Object.entries(entries).map(([key, value]) => [`${group}.${key}`, value]),
    ),
  )
  const names = Object.values(tokens).map((t) => t.$extensions[TOKEN_EXTENSION].css)
  if (new Set(names).size !== names.length) throw new Error('Duplicate CSS token name')
  return { meta: meta.$extensions[TOKEN_EXTENSION], tokens }
}

export function resolveToken(tokens, name, mode) {
  let current = name
  const seen = new Set()
  for (;;) {
    const item = tokens[current]
    if (item === undefined) throw new Error(`Unknown token: ${current}`)
    if (seen.has(current)) throw new Error(`Cyclic token: ${[...seen, current].join(' -> ')}`)
    seen.add(current)
    const ext = item.$extensions[TOKEN_EXTENSION]
    const value = ext.modes?.[mode] ?? item.$value
    if (typeof value !== 'string') return value
    const target = value.slice(1, -1)
    if (tokens[target] !== undefined && tokens[target].$type !== item.$type) {
      throw new Error(`Alias type mismatch: ${current} -> ${target}`)
    }
    current = target
  }
}

function colourCss(value) {
  const { colorSpace, components, alpha } = value
  if (colorSpace === 'oklch') {
    return `oklch(${Number((components[0] * 100).toFixed(4))}% ${components[1]} ${components[2]}deg / ${alpha * 100}%)`
  }
  const hex = [...components, ...(alpha === 1 ? [] : [alpha])]
    .map((n) =>
      Math.round(n * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
  return `#${hex}`
}

function valueCss(tokens, type, value, mode) {
  switch (type) {
    case 'color': {
      return colourCss(value)
    }
    case 'dimension':
    case 'duration': {
      return `${value.value}${value.unit}`
    }
    case 'number':
    case 'fontWeight': {
      return String(value)
    }
    case 'fontFamily': {
      return value.map((family) => (/\s/.test(family) ? `"${family}"` : family)).join(', ')
    }
    case 'cubicBezier': {
      return `cubic-bezier(${value.join(', ')})`
    }
    case 'shadow': {
      return value.length === 0
        ? 'none'
        : value
            .map((s) => {
              const c =
                typeof s.color === 'string'
                  ? resolveToken(tokens, s.color.slice(1, -1), mode)
                  : s.color
              return `${s.offsetX.value}px ${s.offsetY.value}px ${s.blur.value}px ${s.spread.value}px ${colourCss(c)}`
            })
            .join(', ')
    }
    default: {
      throw new Error(`Unsupported token type: ${type}`)
    }
  }
}

function webValue(tokens, item, mode, host) {
  const ext = item.$extensions[TOKEN_EXTENSION]
  const value = ext.modes?.[mode] ?? item.$value
  // Mode-specific values override formulas too (notably the opaque HC scrim).
  const formula = ext.modes?.[mode] === undefined ? ext.cssValue : undefined
  let css =
    formula ??
    (typeof value === 'string'
      ? `var(${tokens[value.slice(1, -1)].$extensions[TOKEN_EXTENSION].css})`
      : valueCss(tokens, item.$type, value, mode))
  if (typeof value !== 'string' && host && item.$type === 'shadow' && value.length > 0) {
    const s = value[0]
    css = `${s.offsetX.value}px ${s.offsetY.value}px ${s.blur.value}px var(--ms-shadow)`
  }
  if (host) {
    const variables = (ext.vscode ?? []).toReversed()
    for (const variable of variables) css = `var(${variable}, ${css})`
  }
  return css
}

async function formatOutput(file, content) {
  if (file.endsWith('.css')) {
    const result = await stylelint.lint({
      code: content,
      codeFilename: path.join(REPO_ROOT, file),
      configFile: path.join(REPO_ROOT, '.stylelintrc.json'),
      fix: true,
    })
    if (result.errored)
      throw new Error(
        `Invalid generated CSS: ${JSON.stringify(result.results.map((r) => r.warnings))}`,
      )
    content = result.code
  }
  return await prettier.format(content, {
    ...(await prettier.resolveConfig(path.join(REPO_ROOT, file))),
    filepath: file,
  })
}

export async function renderTokens(input) {
  const { meta, tokens } = parseTokens(input)
  const entries = Object.entries(tokens)
  // Resolve everything, including aliases not present in a registered contrast pair.
  for (const mode of MODES) for (const [name] of entries) resolveToken(tokens, name, mode)
  const declarations = (mode, host, selected = entries) =>
    selected
      .map(
        ([, item]) =>
          `${item.$extensions[TOKEN_EXTENSION].css}: ${webValue(tokens, item, mode, host)};`,
      )
      .join('\n')
  const highContrast = entries
    .filter(([name]) => name.startsWith('elevation.') || name.startsWith('translucency.'))
    .map(
      ([, item]) =>
        `${item.$extensions[TOKEN_EXTENSION].css}: ${webValue(tokens, item, 'hc-dark', true)};`,
    )
    .join('\n')
  const scrim = (mode) =>
    `--ms-modal-scrim: ${webValue(tokens, tokens['colour.modal-scrim'], mode, true)};`
  const noTransparency =
    entries
      .filter(([name]) => name.startsWith('translucency.'))
      .map(
        ([, item]) =>
          `${item.$extensions[TOKEN_EXTENSION].css}: ${item.$type === 'number' ? '1' : '0px'};`,
      )
      .join('\n') + '\n--ms-modal-scrim: var(--ms-surface);'
  const banner =
    '/* Generated by scripts/build-tokens.mjs from design/tokens/muse.tokens.json. */\n'
  const core = entries.filter(([, item]) => item.$extensions[TOKEN_EXTENSION].web !== 'extended')
  const extended = entries.filter(
    ([, item]) => item.$extensions[TOKEN_EXTENSION].web === 'extended',
  )
  const hostRoles = `${banner}:root {${declarations('dark', true, extended)}}\n`
  const web = `${banner}:root {${declarations('dark', true, core)}}\n.vscode-high-contrast, .vscode-high-contrast-light {${highContrast}}\n.vscode-high-contrast {${scrim('hc-dark')}}\n.vscode-high-contrast-light {${scrim('hc-light')}}\n@media (prefers-reduced-transparency: reduce) {:root {${noTransparency}}}\n`
  const palettes = `${banner}${MODES.map((mode) => `[data-ms-theme="${mode}"] {${declarations(mode, false)}}`).join('\n')}\n@media (prefers-reduced-transparency: reduce) {:root {${noTransparency}}}\n`
  const consumers = {
    version: meta.version,
    modes: Object.fromEntries(
      MODES.map((mode) => [
        mode,
        Object.fromEntries(
          entries.map(([name, item]) => [
            name,
            {
              type: item.$type,
              value: resolveToken(tokens, name, mode),
              css: webValue(tokens, item, mode, false),
              variable: item.$extensions[TOKEN_EXTENSION].css,
            },
          ]),
        ),
      ]),
    ),
    hostRoles: Object.fromEntries(
      entries
        .filter(([, item]) => item.$extensions[TOKEN_EXTENSION].vscode !== undefined)
        .map(([name, item]) => [
          name,
          {
            variable: item.$extensions[TOKEN_EXTENSION].css,
            vscode: item.$extensions[TOKEN_EXTENSION].vscode,
          },
        ]),
    ),
    contrastPairs: meta.contrastPairs,
  }
  const outputs = [web, hostRoles, palettes, JSON.stringify(consumers)]
  return Object.fromEntries(
    await Promise.all(
      TOKEN_OUTPUTS.map(async (file, index) => [file, await formatOutput(file, outputs[index])]),
    ),
  )
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const outputs = await renderTokens(JSON.parse(await readFile(TOKEN_SOURCE, 'utf8')))
  for (const [file, content] of Object.entries(outputs)) await writeFile(file, content)
  console.log(`tokens: generated ${TOKEN_OUTPUTS.length} outputs`)
}
