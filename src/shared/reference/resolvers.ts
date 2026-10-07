// Pure resolvers for the contributed schema. Enum values retain their meaning;
// object, numeric and boolean defaults never pass through an enabled heuristic.
interface SettingDefinition {
  readonly type: string | readonly string[]
  readonly default: unknown
  readonly enum?: readonly unknown[]
  readonly markdownEnumDescriptions?: readonly string[]
  readonly enumDescriptions?: readonly string[]
}

export function resolveSettingDefault(
  schema: SettingDefinition,
  nls: Readonly<Record<string, string>>,
) {
  if (schema.enum === undefined) return { type: schema.type, value: schema.default }
  const description = (schema.markdownEnumDescriptions ?? schema.enumDescriptions)?.[
    schema.enum.indexOf(schema.default)
  ]
  const key =
    description?.startsWith('%') === true && description.endsWith('%')
      ? description.slice(1, -1)
      : undefined
  return {
    type: 'enum',
    value: schema.default,
    meaning: key === undefined ? description : nls[key],
    meaningKey: key,
  }
}

export function resolveCommandCondition(
  command: { readonly command: string; readonly enablement?: string },
  menus: readonly { readonly command: string; readonly when?: string }[],
): string | undefined {
  const entries = menus.filter((menu) => menu.command === command.command)
  const clauses = entries.flatMap((menu) => (menu.when === undefined ? [] : [menu.when]))
  const isUnconditional = entries.some((menu) => menu.when === undefined)
  let palette: string | undefined
  if (!isUnconditional && clauses.length === 1) palette = clauses[0]
  else if (!isUnconditional && clauses.length > 1) palette = `((${clauses.join(') || (')}))`
  return (
    [command.enablement, palette].filter((clause) => clause !== undefined).join(' && ') || undefined
  )
}
