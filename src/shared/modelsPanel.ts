// The Models & Agents panel's wire contract (M95, PLAN.md D74): the
// host-owned state slices lane K serves and the messages the panel and the
// host exchange. Both sides validate with these schemas, as protocol.ts
// does for the chat panel; anything that fails validation is logged and
// dropped.
//
// - The webview only renders and asks; the host validates, saves and owns
//   every credential. No schema here carries key material: `enterKey` asks
//   the host to open VS Code's password box, and a key never crosses
//   postMessage (acceptance 5 and 17; the schema test pins it). Every
//   message object is strict, so a key smuggled into one fails validation
//   instead of riding along.
// - Shapes mirror lane P's core field for field so lane K maps without
//   translating: the model row mirrors `ModelRow` in
//   src/core/providers/modelFilters.ts, the wizard step mirrors
//   `WizardStep` in src/core/providers/wizardFlow.ts, the privacy values
//   mirror `OpenRouterPrivacy` in src/core/providers/presets.ts, and the
//   provider entry fields mirror `providerEntrySchema` in
//   src/core/providers/providersFile.ts. The webview never imports those
//   modules (its project must not import src/core); it codes against these
//   schemas instead.
// - M96 adds the `roles` and `agents` slices and their `roles/*` and
//   `agents/*` messages beside these.
//
// Shared by the host and the panel's browser bundle, so this file must not
// import from `vscode`, Node, or the DOM.

import * as z from 'zod/mini'

/** The panel's sections; M96 registers `roles` and `agents` beside these. */
export const modelsPanelSectionSchema = z.enum(['providers', 'models'])
export type ModelsPanelSection = z.infer<typeof modelsPanelSectionSchema>

/** The add-provider wizard's steps, in order (mirrors lane P's `WizardStep`). */
export const wizardStepSchema = z.enum([
  'pick-provider',
  'configure',
  'credential',
  'test',
  'models',
  'privacy',
  'suggestions',
  'confirm',
  'done',
])
export type ModelsWizardStep = z.infer<typeof wizardStepSchema>

/** The wire formats a custom server may speak (lane P's presets fix their own). */
export const customFormatSchema = z.enum(['chat', 'responses', 'anthropic'])
export type ModelsCustomFormat = z.infer<typeof customFormatSchema>

/** OpenRouter's privacy routing (mirrors lane P's `OpenRouterPrivacy`). */
export const openRouterPrivacySchema = z.enum(['zdr', 'no-training', 'any'])
export type ModelsPrivacy = z.infer<typeof openRouterPrivacySchema>

/**
 * One preset as the panel shows it: display fields only. The key's shape
 * stays host-side (the password box checks it as it is typed); the key
 * itself never crosses this boundary.
 */
export const presetCardSchema = z.strictObject({
  id: z.string(),
  /** The provider's own label, always shown beside its models. */
  label: z.string(),
  /** One line for the searchable provider dropdown. */
  description: z.string(),
  category: z.enum(['cloud', 'local', 'aggregator', 'custom']),
  format: z.enum(['responses', 'chat', 'anthropic', 'gemini', 'ollama']),
  /** Where the endpoint comes from; `fixed` names it in `originDisplay`. */
  originKind: z.enum(['fixed', 'azure-resource', 'loopback', 'custom']),
  originDisplay: z.string(),
  auth: z.enum(['apiKey', 'none']),
  /** True where the account connects over OAuth instead of a pasted key. */
  connectOAuth: z.boolean(),
  /** The key's shape as a hint beside the key field (never a key). */
  keyHint: z.string(),
  /** The provider's key page (`Get a key`); absent where none is known. */
  keyPage: z.optional(z.string()),
  docsUrl: z.optional(z.string()),
  dataUseUrl: z.optional(z.string()),
  privacyNote: z.optional(z.string()),
})
export type PresetCard = z.infer<typeof presetCardSchema>

/** The free check's state, or the one-token request's stated cost. */
export const providerTestSchema = z.strictObject({
  status: z.enum(['untested', 'testing', 'ok', 'failed', 'needs-cost']),
  /** The models the free check listed. */
  modelCount: z.optional(z.number()),
  /** The one-token request's USD cost, stated and asked before it is sent. */
  costUsd: z.optional(z.number()),
  /** What the provider answered, in its words. */
  detail: z.optional(z.string()),
})
export type ProviderTest = z.infer<typeof providerTestSchema>

/** A stored credential names only the origin it was entered for, never the key. */
export const providerKeySchema = z.strictObject({
  state: z.enum(['missing', 'stored', 'needs-again']),
  /** The origin the credential was entered for. */
  origin: z.optional(z.string()),
  /** Where the providers file points now (only with `needs-again`). */
  actualOrigin: z.optional(z.string()),
})
export type ProviderKey = z.infer<typeof providerKeySchema>

/** OpenRouter's key usage, limit and remainder, in USD. */
export const providerKeyUsageSchema = z.strictObject({
  dayUsd: z.optional(z.number()),
  monthUsd: z.optional(z.number()),
  limitUsd: z.optional(z.number()),
  remainingUsd: z.optional(z.number()),
})
export type ProviderKeyUsage = z.infer<typeof providerKeyUsageSchema>

/** One configured provider as the Providers section lists it. */
export const providerStateSchema = z.strictObject({
  id: z.string(),
  /** The preset it was added from (or `custom`). */
  presetId: z.string(),
  label: z.string(),
  address: z.optional(z.string()),
  format: z.enum(['responses', 'chat', 'anthropic', 'gemini', 'ollama']),
  auth: z.enum(['apiKey', 'none']),
  key: providerKeySchema,
  test: providerTestSchema,
  /** The chosen models (`<modelId>` as the provider lists them). */
  models: z.array(z.string()),
  /** Pinned favourites, first in the composer's picker. */
  pinned: z.array(z.string()),
  keyUsage: z.optional(providerKeyUsageSchema),
  lastScannedAtMs: z.optional(z.number()),
})
export type ProviderState = z.infer<typeof providerStateSchema>

/** How the row's price is marked when it has no dollar card. */
export const modelPriceNoteSchema = z.enum(['priced', 'unpriced', 'local', 'plan', 'free'])
export type ModelPriceNote = z.infer<typeof modelPriceNoteSchema>

/**
 * One Models-table row: the host's filtered, sorted rows with their badges
 * (lane P's `filterModels`, `sortModels` and `badgesFor` run host-side).
 */
export const modelRowSchema = z.strictObject({
  /** The qualified reference (`<providerId>/<modelId>`). */
  ref: z.string(),
  providerId: z.string(),
  modelId: z.string(),
  label: z.optional(z.string()),
  description: z.optional(z.string()),
  toolCalling: z.boolean(),
  vision: z.boolean(),
  reasoning: z.boolean(),
  contextTokens: z.optional(z.number()),
  /** USD per million tokens; absent means unpriced. */
  inputPerMillion: z.optional(z.number()),
  outputPerMillion: z.optional(z.number()),
  cachedPerMillion: z.optional(z.number()),
  freeOrLocal: z.boolean(),
  recommended: z.optional(z.boolean()),
  serverless: z.optional(z.boolean()),
  /** New since the last scan (from the scan diff). */
  isNew: z.optional(z.boolean()),
  /** Offered in the composer's picker. */
  ticked: z.boolean(),
  pinned: z.boolean(),
  /** The context an Ollama model runs with, where the provider sets one. */
  numCtx: z.optional(z.number()),
  priceNote: modelPriceNoteSchema,
  badges: z.strictObject({
    recommended: z.boolean(),
    cheapestCapable: z.boolean(),
    largestContext: z.boolean(),
    isNew: z.boolean(),
  }),
})
export type ModelRow = z.infer<typeof modelRowSchema>

/** Every filter the table offers, each alone or combined (mirrors lane P's `ModelFilter`). */
export const modelFilterSchema = z.strictObject({
  search: z.optional(z.string()),
  toolCalling: z.optional(z.boolean()),
  vision: z.optional(z.boolean()),
  reasoning: z.optional(z.boolean()),
  contextMin: z.optional(z.number()),
  contextMax: z.optional(z.number()),
  maxInputPerMillion: z.optional(z.number()),
  maxOutputPerMillion: z.optional(z.number()),
  maxCachedPerMillion: z.optional(z.number()),
  freeOrLocal: z.optional(z.boolean()),
  providerId: z.optional(z.string()),
  family: z.optional(z.string()),
})
export type ModelFilter = z.infer<typeof modelFilterSchema>

/** The table's sort (ties keep their relative order; lane P sorts stably). */
export const modelSortSchema = z.strictObject({
  key: z.enum(['name', 'context', 'input-price', 'output-price']),
  direction: z.enum(['asc', 'desc']),
})
export type ModelSort = z.infer<typeof modelSortSchema>

/** One provider's scan: its status and its diff against the last scan. */
export const scanStateSchema = z.strictObject({
  providerId: z.string(),
  status: z.enum(['idle', 'scanning', 'done', 'failed']),
  scannedAtMs: z.optional(z.number()),
  /** A cached scan older than `PROVIDER_SCAN_STALE_MS` (lane P's rule). */
  stale: z.optional(z.boolean()),
  newCount: z.optional(z.number()),
  removedCount: z.optional(z.number()),
  repricedCount: z.optional(z.number()),
  detail: z.optional(z.string()),
})
export type ScanState = z.infer<typeof scanStateSchema>

/** The suggestion kinds M95 implements (M96 adds role kinds beside them). */
export const suggestionKindSchema = z.enum(['defaultModel', 'sessionBudget'])
export type SuggestionKind = z.infer<typeof suggestionKindSchema>

/** One suggestion with its reason; the panel shows Accept or Change. */
export const suggestionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('defaultModel'),
    modelRef: z.string(),
    reason: z.string(),
    accepted: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('sessionBudget'),
    usd: z.number(),
    reason: z.string(),
    accepted: z.boolean(),
  }),
])
export type PanelSuggestion = z.infer<typeof suggestionSchema>

/**
 * The unsaved form: the wizard's in-memory draft or one provider's edit.
 * The host holds it; the panel renders its fields, errors and blockers.
 * `errors` and `blockers` arrive in plain words (**Save** stays disabled
 * while `blockers` is non-empty).
 */
export const panelDraftSchema = z.strictObject({
  presetId: z.optional(z.string()),
  step: wizardStepSchema,
  address: z.optional(z.string()),
  azureResource: z.optional(z.string()),
  deployment: z.optional(z.string()),
  loopbackPort: z.optional(z.number()),
  customFormat: z.optional(customFormatSchema),
  auth: z.enum(['apiKey', 'none']),
  /** A key was entered (the host holds it; never the webview, never here). */
  keyPresent: z.boolean(),
  keyShapeOk: z.boolean(),
  /** OpenRouter's OAuth connect completed (the key arrived with no paste). */
  connected: z.boolean(),
  costAccepted: z.boolean(),
  test: z.optional(providerTestSchema),
  models: z.array(z.string()),
  privacy: openRouterPrivacySchema,
  providerOrder: z.array(z.string()),
  allowFallbacks: z.boolean(),
  privateConfirmed: z.boolean(),
  /** The private-network question was asked for this address. */
  privateAsked: z.boolean(),
  defaultModel: z.optional(z.string()),
  sessionBudgetUsd: z.optional(z.number()),
  /** The confirm step's summary: what is saved, and who receives the code. */
  summary: z.optional(
    z.strictObject({ origin: z.string(), lines: z.array(z.string()) }),
  ),
  errors: z.array(z.string()),
  blockers: z.array(z.string()),
})
export type PanelDraft = z.infer<typeof panelDraftSchema>

/** A removal waiting behind Undo before its secret is deleted. */
export const pendingRemovalSchema = z.strictObject({
  providerId: z.string(),
  label: z.string(),
})
export type PendingRemoval = z.infer<typeof pendingRemovalSchema>

/** An import previewed as a diff: every provider marked as needing a key. */
export const importPreviewSchema = z.strictObject({
  providers: z.array(
    z.strictObject({
      id: z.string(),
      label: z.optional(z.string()),
      address: z.string(),
    }),
  ),
  errors: z.array(z.string()),
})
export type ImportPreview = z.infer<typeof importPreviewSchema>

/** The host-owned state the panel renders. */
export const modelsPanelStateSchema = z.strictObject({
  presets: z.array(presetCardSchema),
  providers: z.array(providerStateSchema),
  /** The Models rows after the host applied `filter` and `sort`. */
  models: z.array(modelRowSchema),
  /** The row count before filtering (`{shown} of {count}`). */
  totalModels: z.number(),
  filter: modelFilterSchema,
  sort: modelSortSchema,
  scans: z.record(z.string(), scanStateSchema),
  suggestions: z.array(suggestionSchema),
  /** The last choices made (a stated assumption with no history). */
  lastChoices: z.strictObject({
    defaultModelRef: z.optional(z.string()),
    sessionBudgetUsd: z.optional(z.number()),
  }),
  drafts: z.strictObject({
    wizard: z.optional(panelDraftSchema),
    edits: z.record(z.string(), panelDraftSchema),
  }),
  pendingRemovals: z.array(pendingRemovalSchema),
  importPreview: z.optional(importPreviewSchema),
  /** A transient host confirmation (an export done, a save applied). */
  notice: z.optional(z.string()),
})
export type ModelsPanelState = z.infer<typeof modelsPanelStateSchema>

/** The wizard's editable fields (every key optional; absent leaves it). */
export const prefillFieldsSchema = z.strictObject({
  presetId: z.optional(z.string()),
  address: z.optional(z.string()),
  azureResource: z.optional(z.string()),
  deployment: z.optional(z.string()),
  loopbackPort: z.optional(z.number()),
  customFormat: z.optional(customFormatSchema),
  privacy: z.optional(openRouterPrivacySchema),
  providerOrder: z.optional(z.array(z.string())),
  allowFallbacks: z.optional(z.boolean()),
  privateConfirmed: z.optional(z.boolean()),
  defaultModel: z.optional(z.string()),
  sessionBudgetUsd: z.optional(z.number()),
})
export type PrefillFields = z.infer<typeof prefillFieldsSchema>

/** Which ticked set a `models/tick` updates: the wizard's draft or a saved provider. */
export const tickScopeSchema = z.strictObject({
  scope: z.enum(['wizard', 'provider']),
  providerId: z.optional(z.string()),
})
export type TickScope = z.infer<typeof tickScopeSchema>

/** What the panel posts to the host. */
export const panelToHostMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('modelsPanel/ready') }),
  // The shared shape with protocol.ts: http(s) opens in the browser
  // through the host, anything else is refused there.
  z.strictObject({ type: z.literal('openExternal'), url: z.string() }),
  z.strictObject({ type: z.literal('providers/select'), presetId: z.string() }),
  z.strictObject({ type: z.literal('providers/prefill'), fields: prefillFieldsSchema }),
  z.strictObject({
    type: z.literal('providers/enterKey'),
    mode: z.enum(['new', 'change']),
    providerId: z.optional(z.string()),
  }),
  z.strictObject({ type: z.literal('providers/connect') }),
  z.strictObject({ type: z.literal('providers/test'), acceptCost: z.boolean() }),
  // `next` and `back` walk the wizard; `cancel` discards the draft with
  // nothing saved. Confirming is `providers/save`.
  z.strictObject({ type: z.literal('providers/wizard'), event: z.enum(['next', 'back', 'cancel']) }),
  z.strictObject({ type: z.literal('providers/save'), useNow: z.boolean() }),
  z.strictObject({ type: z.literal('providers/remove'), providerId: z.string() }),
  z.strictObject({ type: z.literal('providers/undoRemove'), providerId: z.string() }),
  z.strictObject({ type: z.literal('providers/scanLocal') }),
  z.strictObject({ type: z.literal('providers/export'), providerId: z.optional(z.string()) }),
  z.strictObject({
    type: z.literal('providers/import'),
    json: z.string(),
    confirmed: z.boolean(),
  }),
  z.strictObject({ type: z.literal('models/scan'), providerId: z.string() }),
  z.strictObject({ type: z.literal('models/cancelScan'), providerId: z.string() }),
  z.strictObject({
    type: z.literal('models/tick'),
    scope: tickScopeSchema,
    refs: z.array(z.string()),
  }),
  z.strictObject({
    type: z.literal('models/pin'),
    providerId: z.string(),
    ref: z.string(),
    pinned: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('models/filter'),
    filter: modelFilterSchema,
    sort: modelSortSchema,
  }),
  z.strictObject({ type: z.literal('suggestions/accept'), kind: suggestionKindSchema }),
  z.strictObject({
    type: z.literal('suggestions/change'),
    kind: suggestionKindSchema,
    modelRef: z.optional(z.string()),
    usd: z.optional(z.number()),
  }),
])
export type PanelToHostMessage = z.infer<typeof panelToHostMessageSchema>

/** What the host posts to the panel. */
export const hostToPanelMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('modelsPanel/state'), state: modelsPanelStateSchema }),
  // A deep link (`museSpark.modelsAndAgents` with a section and an item).
  z.strictObject({
    type: z.literal('modelsPanel/navigate'),
    section: modelsPanelSectionSchema,
    itemId: z.optional(z.string()),
  }),
])
export type HostToPanelMessage = z.infer<typeof hostToPanelMessageSchema>

export type ModelsPanelParseResult<T> =
  | { readonly ok: true; readonly message: T }
  | { readonly ok: false; readonly error: string }

function parseWith<T>(schema: z.ZodMiniType<T>, input: unknown): ModelsPanelParseResult<T> {
  const result = schema.safeParse(input)
  return result.success
    ? { ok: true, message: result.data }
    : { ok: false, error: z.prettifyError(result.error) }
}

/** Validates a panel-to-host message; a smuggled credential field fails it. */
export function parsePanelToHostMessage(input: unknown): ModelsPanelParseResult<PanelToHostMessage> {
  return parseWith(panelToHostMessageSchema, input)
}

/** Validates the host-owned state (or a deep link) before the panel renders it. */
export function parseHostToPanelMessage(input: unknown): ModelsPanelParseResult<HostToPanelMessage> {
  return parseWith(hostToPanelMessageSchema, input)
}

/** Validates a full panel state on its own (the harness and the tests). */
export function parseModelsPanelState(input: unknown): ModelsPanelParseResult<ModelsPanelState> {
  return parseWith(modelsPanelStateSchema, input)
}
