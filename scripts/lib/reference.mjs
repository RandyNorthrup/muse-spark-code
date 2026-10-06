// HELPREF: code/manifest-derived reference and freshness gate. No model calls.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import * as esbuild from 'esbuild'
import { format, resolveConfig } from 'prettier'

const MODULE = 'src/shared/reference/reference.generated.ts'
const DOC = 'docs/reference.md'
const JSON_MODEL = 'src/shared/reference/reference.generated.json'

export async function referenceSources(root) {
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'src/shared/reference/referenceSource.ts')],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  })
  return await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`
  )
}

function keyOf(text) {
  return /^%[^%]+%$/.test(text ?? '') ? text.slice(1, -1) : undefined
}
function translated(text, nls) {
  return keyOf(text) === undefined ? text : nls[keyOf(text)]
}

export function buildReference(manifest, nls, source, runtimeSource, readme) {
  const anchors = new Set(
    readme
      .split('\n')
      .filter((line) => /^#+ /.test(line))
      .map((line) =>
        line
          .replace(/^#+ /, '')
          .toLowerCase()
          .replaceAll(/[^\p{L}\p{N}_\- ]/gu, '')
          .replaceAll(' ', '-'),
      ),
  )
  const errors = []
  const properties = manifest.contributes.configuration.properties
  const features = source.featureCatalog()
  const descriptionFor = (ref) => {
    if ('ui' in ref) return source.EN[ref.ui]
    if ('tip' in ref) return source.EN.paletteTips[ref.tip]
    if ('command' in ref)
      return translated(
        manifest.contributes.commands.find((c) => c.command === ref.command)?.title,
        nls,
      )
    const setting = properties[`museSpark.${ref.setting}`]
    return translated(setting?.markdownDescription ?? setting?.description, nls)
  }
  const settings = Object.entries(properties).map(([id, s]) => ({
    id,
    name: translated(s.title, nls) ?? id,
    nameKey: keyOf(s.title),
    description: translated(s.markdownDescription ?? s.description, nls),
    descriptionKey: keyOf(s.markdownDescription ?? s.description),
    type: s.type,
    default: s.default,
    enum: s.enum,
    enumDescriptions: (s.markdownEnumDescriptions ?? s.enumDescriptions)?.map((d) =>
      translated(d, nls),
    ),
    enumDescriptionKeys: (s.markdownEnumDescriptions ?? s.enumDescriptions)?.map((description) =>
      keyOf(description),
    ),
    scope: s.scope ?? 'window',
  }))
  const commands = manifest.contributes.commands.map((c) => {
    const key = Object.keys(source.COMMAND_IDS).find((k) => source.COMMAND_IDS[k] === c.command)
    const entry = source.COMMAND_REFERENCE[key]
    if (entry === undefined) errors.push(`Command lacks catalogue entry: ${c.command}`)
    return {
      id: c.command,
      name: translated(c.title, nls),
      nameKey: keyOf(c.title),
      category: translated(c.category, nls) ?? '',
      categoryKey: keyOf(c.category),
      description: entry === undefined ? '' : descriptionFor(entry.description),
      text: entry?.description,
      enablement: c.enablement,
      canRun: entry?.canRun === true,
    }
  })
  const slashText = (description) => {
    const ui = Object.entries(source.EN).find(
      ([, text]) => typeof text === 'string' && text === description,
    )?.[0]
    if (ui !== undefined) return { ui }
    const tip = Object.entries(source.EN.paletteTips).find(([, text]) => text === description)?.[0]
    if (tip !== undefined) return { tip }
    errors.push(`Missing localized slash description: ${description}`)
    return { ui: 'referenceIntro' }
  }
  const slash = new Map()
  for (const backend of ['museCode', 'modelApi']) {
    const groups = source.buildPalette({
      currentModel: undefined,
      models: [],
      effort: 'medium',
      isThinkingEnabled: true,
      permissionMode: 'manual',
      isFocusView: false,
      useCtrlEnterToSend: false,
      usage: undefined,
      skills: [],
      backend,
      paidFeatures: [],
      isKeyStored: true,
    })
    for (const c of source.slashCommandsOf(groups)) {
      const old = slash.get(c.name)
      slash.set(c.name, {
        name: c.name,
        description: c.detail ?? c.tip,
        descriptions: { ...old?.descriptions, [backend]: slashText(c.detail ?? c.tip) },
        backends: [...(old?.backends ?? []), backend],
      })
    }
  }
  const cli = source.cliCommands()
  // RuntimeCommand is the parser's closed command inventory; new routes must
  // appear in the public command table as well as being documented.
  const runtimeNames = runtimeSource
    .matchAll(/readonly command: ([^}\n]+)/g)
    .flatMap((m) =>
      m[1]
        .matchAll(/'([^']+)'/g)
        .map((v) => v[1])
        .toArray(),
    )
    .toArray()
  const names = new Set(cli.map((c) => c.route))
  for (const name of runtimeNames) {
    if (name !== 'invalid' && !names.has(name)) errors.push(`CLI command lacks entry: ${name}`)
  }
  const shortcuts = manifest.contributes.keybindings ?? []
  for (const k of shortcuts)
    if (k.command.startsWith('museSpark.') && commands.every((c) => c.id !== k.command))
      errors.push(`Unknown shortcut command: ${k.command}`)
  const ids = new Set()
  for (const f of features) {
    if (ids.has(f.id)) errors.push(`Duplicate feature: ${f.id}`)
    ids.add(f.id)
    for (const text of [f.name, f.summary, f.description]) {
      if (!descriptionFor(text)?.trim()) errors.push(`Feature lacks text: ${f.id}`)
    }
    for (const id of f.commands)
      if (commands.every((c) => c.id !== id)) errors.push(`Unknown feature command: ${f.id}: ${id}`)
    for (const id of f.settings)
      if (!Object.hasOwn(properties, id)) errors.push(`Unknown feature setting: ${f.id}: ${id}`)
    if (
      !f.docs.startsWith('https://github.com/RandyNorthrup/muse-spark-code#') ||
      !anchors.has(f.docs.split('#', 2)[1])
    )
      errors.push(`Invalid docs link: ${f.id}`)
  }
  for (const entry of [...commands, ...settings, ...slash.values(), ...cli]) {
    if (!entry.description?.trim()) errors.push(`Missing description: ${entry.id ?? entry.name}`)
  }
  for (const entry of [...commands, ...settings]) {
    const group = 'canRun' in entry ? 'commands' : 'settings'
    if (features.every((f) => !f[group].includes(entry.id)))
      errors.push(`No feature covers ${entry.id}`)
  }
  for (const [key, entry] of Object.entries(source.COMMAND_REFERENCE)) {
    if (commands.every((c) => c.id !== source.COMMAND_IDS[key]))
      errors.push(`Orphan command entry: ${key}`)
    if (!descriptionFor(entry.description)?.trim())
      errors.push(`Missing command description: ${key}`)
  }
  if (errors.length > 0) throw new Error(errors.join('\n'))
  return {
    features,
    commands,
    settings,
    slash: slash.values().toArray(),
    cli,
    shortcuts: manifest.contributes.keybindings ?? [],
  }
}

export function referenceMarkdown(model, source, nls, manifest) {
  const text = (ref) => {
    if ('ui' in ref) return source.EN[ref.ui]
    if ('tip' in ref) return source.EN.paletteTips[ref.tip]
    if ('command' in ref) return model.commands.find((c) => c.id === ref.command)?.name
    const s = manifest.contributes.configuration.properties[`museSpark.${ref.setting}`]
    return translated(s.markdownDescription ?? s.description, nls)
  }
  const lines = [
    '<!-- Generated by scripts/gen-reference.mjs. Edit the source catalogue/registries. -->',
    '# Help & Reference — Muse Spark Code (Unofficial)',
    '',
    'Open `/help` in the panel or **Muse Spark: Open Help & Reference**. Search the reference and open a setting directly. ACP editors: `/help`; terminal: `muse-spark-code-acp help --all`.',
    '',
    '## Features',
    '',
  ]
  for (const f of model.features)
    lines.push(
      `### ${'setting' in f.name ? `museSpark.${f.name.setting}` : text(f.name)}`,
      '',
      text(f.summary),
      '',
      ...(text(f.description) === text(f.summary) ? [] : [text(f.description), '']),
      `Editors: ${f.editors.join(', ')}. Backends: ${f.backends.join(', ')}. Paid: ${f.paid ? 'yes; requires consent and a budget' : 'no extra feature charge; model usage still applies'}.`,
      '',
      `Commands: ${f.commands.map((id) => `\`${id}\``).join(', ') || '—'}. Settings: ${f.settings.map((id) => `\`${id}\``).join(', ') || '—'}. [Documentation](${f.docs})`,
      '',
    )
  lines.push(
    '## Slash commands',
    '',
    'Availability depends on the backend. Installed skills also add their own slash commands.',
    '',
  )
  for (const c of model.slash)
    lines.push(
      `- **/${c.name}**: ${Object.entries(c.descriptions)
        .map(([backend, ref]) => `${backend}: ${text(ref)}`)
        .join('; ')}`,
    )
  lines.push('', '## Commands', '')
  for (const c of model.commands)
    lines.push(
      `### ${c.category}: ${c.name}`,
      '',
      `\`${c.id}\` — ${c.description}`,
      '',
      ...(c.enablement ? [`Available when: \`${c.enablement}\`.`, ''] : []),
    )
  lines.push('## Settings', '')
  for (const s of model.settings)
    lines.push(
      `### ${s.id}`,
      '',
      s.description,
      '',
      `Type: \`${JSON.stringify(s.type)}\`. Default: \`${JSON.stringify(s.default)}\`. Scope: \`${s.scope}\`.`,
      '',
      ...(s.enum === undefined
        ? []
        : s.enum.map((v, i) => `- \`${JSON.stringify(v)}\`: ${s.enumDescriptions?.[i] ?? ''}`)),
      '',
    )
  lines.push(
    '## Keyboard shortcuts',
    '',
    'These are defaults; editor customizations take precedence.',
    '',
  )
  for (const k of model.shortcuts)
    lines.push(
      `- \`${k.command}\`: \`${k.key}\`${k.mac ? ` (macOS: \`${k.mac}\`)` : ''}${k.win ? ` (Windows: \`${k.win}\`)` : ''}${k.linux ? ` (Linux: \`${k.linux}\`)` : ''}${k.when ? `; when \`${k.when}\`` : ''}`,
    )
  lines.push('', '## ACP / CLI commands', '')
  for (const c of model.cli) lines.push(`- \`${c.name}\`: ${c.description}`)
  lines.push(
    '',
    'For the full argument syntax, run `muse-spark-code-acp --help`, or see [the ACP guide](acp.md) and [headless/CI contract](ci.md).',
    '',
  )
  return lines.join('\n')
}

export async function generateReference(root, isCheck = false) {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const nls = JSON.parse(readFileSync(path.join(root, 'package.nls.json'), 'utf8'))
  const source = await referenceSources(root)
  const model = buildReference(
    manifest,
    nls,
    source,
    readFileSync(path.join(root, 'src/runtime/cliArgs.ts'), 'utf8'),
    readFileSync(path.join(root, 'README.md'), 'utf8'),
  )
  const uiKeys = [
    ...new Set(
      [
        ...model.features.flatMap((f) => [f.name, f.summary, f.description]),
        ...model.commands.map((c) => c.text),
        ...model.slash.flatMap((c) => Object.values(c.descriptions)),
      ]
        .filter((t) => 'ui' in t)
        .map((t) => t.ui),
    ),
  ]
  const tipKeys = [
    ...new Set(
      [
        ...model.features.flatMap((f) => [f.name, f.summary, f.description]),
        ...model.commands.map((c) => c.text),
        ...model.slash.flatMap((c) => Object.values(c.descriptions)),
      ]
        .filter((t) => 'tip' in t)
        .map((t) => t.tip),
    ),
  ]
  const schema = `
    const textSchema = z.union([z.object({ ui: z.enum(${JSON.stringify(uiKeys)}) }), z.object({ tip: z.enum(${JSON.stringify(tipKeys)}) }), z.object({ setting: z.string() }), z.object({ command: z.string() })])
    const strings = z.array(z.string())
    const schema = z.object({
      features: z.array(z.object({ id: z.string(), name: textSchema, summary: textSchema, description: textSchema, commands: strings, settings: strings, docs: z.string(), editors: z.array(z.enum(['vscode', 'acp'])), backends: z.array(z.enum(['museCode', 'modelApi'])), paid: z.boolean() })),
      commands: z.array(z.object({ id: z.string(), name: z.string(), nameKey: z.optional(z.string()), category: z.string(), categoryKey: z.optional(z.string()), description: z.string(), text: textSchema, enablement: z.optional(z.string()), canRun: z.boolean() })),
      settings: z.array(z.object({ id: z.string(), name: z.string(), nameKey: z.optional(z.string()), description: z.string(), descriptionKey: z.optional(z.string()), type: z.union([z.string(), strings]), default: z.unknown(), enum: z.optional(z.array(z.unknown())), enumDescriptions: z.optional(strings), enumDescriptionKeys: z.optional(z.array(z.nullable(z.string()))), scope: z.string() })),
      slash: z.array(z.object({ name: z.string(), description: z.string(), descriptions: z.record(z.string(), textSchema), backends: strings })),
      cli: z.array(z.object({ route: z.string(), name: z.string(), description: z.string() })),
      shortcuts: z.array(z.object({ command: z.string(), key: z.string(), mac: z.optional(z.string()), win: z.optional(z.string()), linux: z.optional(z.string()), when: z.optional(z.string()) }))
    })
    export function parseReferenceModel(value: unknown): ReferenceModel { return schema.parse(value) }
  `
  const formatting = await resolveConfig(path.join(root, MODULE))
  const module = await format(
    `// Generated by scripts/gen-reference.mjs; do not edit.\nimport * as z from 'zod/mini'\nimport type { ReferenceModel } from './types'\nexport function referenceModel(): ReferenceModel { return parseReferenceModel(JSON.parse(${JSON.stringify(JSON.stringify(model))})) }\n${schema}\n`,
    { ...formatting, filepath: MODULE },
  )
  const markdown = await format(referenceMarkdown(model, source, nls, manifest), {
    ...formatting,
    filepath: DOC,
    proseWrap: 'preserve',
  })
  const json = await format(JSON.stringify(model), { ...formatting, filepath: JSON_MODEL })
  for (const [file, content] of [
    [MODULE, module],
    [DOC, markdown],
    [JSON_MODEL, json],
  ]) {
    if (isCheck) {
      if (readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n') !== content)
        throw new Error(`Stale reference: ${file}; run npm run reference:generate`)
    } else writeFileSync(path.join(root, file), content)
  }
  return model
}
