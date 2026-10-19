// Workspace identity for the stores report source (M113 lane C-M113-6).
//
// The local `version` from the workspace package.json is the channel-lag
// reference: a channel serving an older version is behind this workspace.
// Anything the manifest does not declare stays undeclared: without a name or
// a version there is nothing to compare, so the stores source stays unbound
// (its honest `unbound` row), exactly as before this lane. No registry,
// Marketplace or Open VSX shape is read here — only the workspace's own
// manifest, through the report's confined file reader at the call site.
import * as z from 'zod/mini'

const manifestSchema = z.looseObject({
  name: z.optional(z.string()),
  version: z.optional(z.string()),
  publisher: z.optional(z.string()),
  private: z.optional(z.boolean()),
  engines: z.optional(z.looseObject({ vscode: z.optional(z.string()) })),
})

export interface ReportStoreProject {
  readonly name: string
  readonly publisher?: string
  readonly engines?: { readonly vscode?: string }
  readonly private?: boolean
  readonly releaseVersion: string
}

/**
The manifest read, tolerant by contract: a missing, unreadable or
unparsable package.json leaves the stores source unbound rather than
failing the report. The file read itself stays at the call site (the
report's confined reader); only the failure policy lives here so it is
unit-testable without a built lazy bundle.
*/
export async function readStoreProject(
  read: () => Promise<string>,
): Promise<ReportStoreProject | undefined> {
  try {
    return reportStoreProject(JSON.parse(await read()))
  } catch {
    return undefined
  }
}

/** Declared workspace identity, or undefined when the manifest says too little. */
export function reportStoreProject(manifest: unknown): ReportStoreProject | undefined {
  const parsed = manifestSchema.safeParse(manifest)
  if (!parsed.success) return undefined
  const name = parsed.data.name?.trim() ?? ''
  const releaseVersion = parsed.data.version?.trim() ?? ''
  if (name === '' || releaseVersion === '') return undefined
  const publisher = parsed.data.publisher?.trim() ?? ''
  const vscode = parsed.data.engines?.vscode?.trim() ?? ''
  return {
    name,
    ...(publisher !== '' && { publisher }),
    ...(vscode !== '' && { engines: { vscode } }),
    ...(parsed.data.private !== undefined && { private: parsed.data.private }),
    releaseVersion,
  }
}
