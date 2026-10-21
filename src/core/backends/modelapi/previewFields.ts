// The declared preview fields of an offered external (IDE/MCP) tool live
// here, not in argumentPreview.ts: the request path snapshots them for
// every send (previewFieldsOfOfferedTool in ModelApiHost.ts), so they stay
// in dist/modelApi.js while the display-only accumulator loads deferred
// with the other per-call helpers (dist/modelApiTools.js, D6).
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
Declared top-level string fields of an offered external (IDE/MCP) tool,
for the same declared-fields-only preview text host tools get: only a
completed string under one of these names enters text. Anything else
(unknown shapes, no string fields, tool absent) renders no text, as
before. String-typed array members (`['string', 'null']`) count.
*/
export function declaredPreviewFields(
  tool: { readonly parameters: Record<string, unknown> } | undefined,
): readonly string[] | undefined {
  if (tool === undefined || !isRecord(tool.parameters)) return undefined
  const properties = tool.parameters['properties']
  if (!isRecord(properties)) return []
  const fields: string[] = []
  for (const [name, schema] of Object.entries(properties)) {
    if (!isRecord(schema)) continue
    const type = schema['type']
    if (type === 'string' || (Array.isArray(type) && type.includes('string'))) fields.push(name)
  }
  return fields
}
