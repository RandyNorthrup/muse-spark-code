import * as z from 'zod/mini'
import { MHP } from '../constants'
import { capabilitySchema, fallbackSchema } from './capabilities'
import { MHP_METHODS, type MhpMethod } from './methods'

// Adapter ids, not UI labels. Family members are separate qualification rows;
// Android Studio and Espressif also qualify independently of their platforms.
export const MHP_EDITORS = [
  'vscode',
  'cursor',
  'vscodium',
  'devin',
  'kiro',
  'positron',
  'theia',
  'code-server',
  'codespaces',
  'che',
  'firebase-studio',
  'antigravity',
  'jetbrains',
  'android-studio',
  'visual-studio',
  'eclipse',
  'espressif',
  'zed',
  'xcode',
  'qtcreator',
  'neovim',
  'emacs',
  'sublime',
  'arduino',
  'headless',
] as const
export const editorSchema = z.enum(MHP_EDITORS)
export const featureIdSchema = z.string().check(z.regex(/^F(?:[1-9]|[1-4]\d|5[0-6])$/u))
export const featureStatusSchema = z.strictObject({
  status: z.enum(['W', 'P', 'M', 'B']),
  evidence: z.array(z.string().check(z.minLength(1))),
  exception: z.optional(
    z.strictObject({
      reason: z.string(),
      equivalent: z.string(),
      approval: z.string(),
      upstream: z.string(),
    }),
  ),
})
export const featureSchema = z.strictObject({
  id: featureIdSchema,
  name: z.string(),
  methods: z.array(z.enum(Object.keys(MHP_METHODS))),
  capabilities: z.array(capabilitySchema),
  fallback: fallbackSchema,
  editors: z.record(editorSchema, featureStatusSchema),
})
export type MhpFeature = z.infer<typeof featureSchema>

function feature(id: string, name: string, methods: MhpMethod[] = []): MhpFeature {
  const definitions = methods.map((method) => MHP_METHODS[method])
  return featureSchema.parse({
    id,
    name,
    methods,
    capabilities: [...new Set(definitions.map((method) => method.capability))],
    fallback: definitions[0]?.fallback ?? 'shared-controller',
    // No new M104 adapter has conformance evidence yet. These M cells mean
    // qualification pending, not a claim about the shipped VS Code product.
    editors: Object.fromEntries(
      MHP_EDITORS.map((editor) => [editor, { status: 'M', evidence: [] }]),
    ),
  })
}

// Research §1.2 is the id authority. Slugs are machine identifiers; UI labels
// belong in the installed language table, owned by lane D.
export const MHP_FEATURES: readonly MhpFeature[] = [
  feature('F1', 'streaming-chat'),
  feature('F2', 'tool-rows-and-output', ['documents/read', 'editor/open']),
  feature('F3', 'approval-cards'),
  feature('F4', 'question-cards'),
  feature('F5', 'permission-modes', ['workspace/didChangeTrust']),
  feature('F6', 'auto-reviewer'),
  feature('F7', 'inline-diffs', ['diff/open']),
  feature('F8', 'hunk-review', ['diff/review', 'diff/didDecide', 'diff/decide']),
  feature('F9', 'verify-loop', ['diagnostics/get', 'diagnostics/didChange', 'diagnostics/settled']),
  feature('F10', 'turn-checkpoints', [
    'documents/list',
    'documents/applyEdits',
    'documents/save',
    'documents/saveAll',
    'documents/didChange',
    'documents/didSave',
    'documents/didClose',
  ]),
  feature('F11', 'rewind'),
  feature('F12', 'history', [
    'storage/global.get',
    'storage/global.set',
    'storage/workspace.get',
    'storage/workspace.set',
  ]),
  feature('F13', 'fork-and-side-chat'),
  feature('F14', 'slash-palette'),
  feature('F15', 'mentions-and-selection', [
    'workspace/folders',
    'workspace/findFiles',
    'editor/active',
    'editor/didChangeSelection',
  ]),
  feature('F16', 'attachments'),
  feature('F17', 'subagents-and-map'),
  feature('F18', 'workflows'),
  feature('F19', 'tasks', ['surfaces/open', 'surfaces/close', 'surfaces/focus', 'surfaces/state']),
  feature('F20', 'goals'),
  feature('F21', 'plan-files'),
  feature('F22', 'compaction-and-handoff'),
  feature('F23', 'background-and-shell', ['terminal/create', 'terminal/show', 'terminal/sendText']),
  feature('F24', 'best-of-n'),
  feature('F25', 'scheduled-and-saved-prompts'),
  feature('F26', 'replies-and-quotes'),
  feature('F27', 'rules-skills-memory-agents', [
    'workspace/trust',
    'workspace/didGrantTrust',
    'ui/pick',
    'ui/input',
  ]),
  feature('F28', 'mcp-servers'),
  feature('F29', 'hooks'),
  feature('F30', 'code-intelligence', [
    'codeIntel/definition',
    'codeIntel/references',
    'codeIntel/documentSymbols',
    'codeIntel/workspaceSymbols',
    'codeIntel/hover',
    'codeIntel/prepareRename',
    'codeIntel/rename',
    'codeIntel/callHierarchy',
    'codeIntel/format',
  ]),
  feature('F31', 'web-fetch'),
  feature('F32', 'paid-search-and-images'),
  feature('F33', 'browser-check'),
  feature('F34', 'session-import-export-share', ['ui/openFile', 'ui/saveText']),
  feature('F35', 'worktrees', ['workspace/openFolder']),
  feature('F36', 'git-and-pull-requests', ['auth/github', 'auth/githubLease', 'github/request']),
  feature('F37', 'cli-install-and-login', ['auth/keySignIn']),
  feature('F38', 'account-and-usage'),
  feature('F39', 'paid-use-consent', ['ui/confirm']),
  feature('F40', 'daily-paid-budget'),
  feature('F41', 'voice', ['voice/capture']),
  feature('F42', 'tab-completions', [
    'tab/register',
    'tab/complete',
    'tab/accepted',
    'tab/rejected',
    'editor/insertAtCursor',
    'editor/replaceSelection',
  ]),
  feature('F43', 'settings', [
    'settings/get',
    'settings/update',
    'settings/didChange',
    'ui/showSetting',
  ]),
  feature('F44', 'walkthrough'),
  feature('F45', 'whats-new', ['surfaces/presentHtml']),
  feature('F46', 'display-languages', ['initialize', 'shutdown', '$/cancelRequest']),
  feature('F47', 'accessibility'),
  feature('F48', 'logs-and-diagnostics', [
    'ui/notify',
    'ui/status',
    'ui/progress',
    'ui/openExternal',
    'ui/clipboard',
    'window/state',
    'window/attention',
  ]),
  feature('F49', 'commands-and-keybindings', [
    'commands/register',
    'commands/execute',
    'commands/run',
  ]),
  feature('F50', 'problem-report'),
  feature('F51', 'models-and-providers'),
  feature('F52', 'roles-and-traffic'),
  feature('F53', 'legal-scan'),
  feature('F54', 'judge'),
  feature('F55', 'paired-devices'),
  feature('F56', 'remote-control'),
]

export function mhpRegistryProblems(features: readonly MhpFeature[]): string[] {
  const problems: string[] = []
  if (features.length !== MHP.featureCount) problems.push('MHP_FEATURE_COUNT')
  const ids = new Set(features.map((item) => item.id))
  if (ids.size !== features.length) problems.push('MHP_DUPLICATE_FEATURE')
  for (const item of features) {
    if (!featureSchema.safeParse(item).success) problems.push(`MHP_FEATURE_SHAPE:${item.id}`)
    for (const [editor, cell] of Object.entries(item.editors)) {
      if (cell.status === 'W' && cell.evidence.length === 0)
        problems.push(`MHP_MISSING_EVIDENCE:${item.id}:${editor}`)
    }
  }
  const mapped = new Set(features.flatMap((item) => item.methods))
  for (const method of Object.keys(MHP_METHODS)) {
    if (!mapped.has(method)) problems.push(`MHP_UNMAPPED_METHOD:${method}`)
  }
  return problems
}
