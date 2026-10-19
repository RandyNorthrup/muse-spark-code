// `providers.json` (M95, PLAN.md D74): the zod schema of the user's own
// providers file, its read and its atomic write. The file holds ids,
// presets, addresses, chosen models, user-entered prices, OpenRouter's
// routing choices and the default model; never a credential. Written only
// by the Models & Agents panel, the quick pick and
// `muse-spark-code-acp providers`; read by the extension and the ACP agent.

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { setTimeout as pause } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  ATOMIC_RENAME_ATTEMPTS,
  ATOMIC_RENAME_DELAY_MS,
  PROVIDERS_FILE_VERSION,
} from '../../shared/constants'
import { UI_TEXT } from '../../shared/l10n/text'
import { isStoreErrorCode } from '../../host/backend/storeErrors'
import {
  customCompatSchema,
  modelLimitsSchema,
  outputTokenMinimumMessage,
  providerOutputMinimum,
  openRouterRoutingSchema,
  pruneModelLimits,
} from '../../shared/providerRouting'
import { isProviderId, isStorableModelId, parseModelRef } from './modelRef'
import type { PriceCard } from './priceCard'
import { capabilityOverridesSchema, userCapabilityOverrides } from './capabilityRecord'

/** The wire formats a provider speaks (one codec each, lanes R/H/A/G/O). */
export const providerFormatSchema = z.enum(['responses', 'chat', 'anthropic', 'gemini', 'ollama'])
export type ProviderFormat = z.infer<typeof providerFormatSchema>

/** How a provider authenticates in M95 (`subscription` arrives in M95b). */
export const providerAuthSchema = z.enum(['apiKey', 'none', 'subscription'])
export type ProviderAuth = z.infer<typeof providerAuthSchema>

/** A user-entered price card for one model (numbers are USD per token). */
export const userPriceCardSchema = z.object({
  input: z.number(),
  cachedInput: z.optional(z.number()),
  cacheWrite: z.optional(z.number()),
  cacheWrite1h: z.optional(z.number()),
  output: z.number(),
  request: z.optional(z.number()),
  image: z.optional(z.number()),
})
export type UserPriceCard = z.infer<typeof userPriceCardSchema>

/** OpenRouter's routing choices for one provider entry (D74). */

export type OpenRouterRouting = z.infer<typeof openRouterRoutingSchema>

export type CustomCompat = z.infer<typeof customCompatSchema>

/** One configured provider. */
export const providerEntrySchema = z
  .object({
    // `<providerId>`: `^[a-z][a-z0-9-]{0,31}$`, never `meta`.
    id: z.string().check(z.refine(isProviderId, { error: () => UI_TEXT.providerText.schema.id })),
    // The preset it was added from (or `custom`).
    preset: z.string(),
    // The endpoint address the user gave or confirmed (a preset's fixed
    // origin, an Azure resource URL, a loopback address or a custom server).
    address: z.optional(z.string()),
    // The wire format (a custom server's choice; presets fix their own).
    format: z.optional(providerFormatSchema),
    auth: providerAuthSchema,
    // The chosen models (`<modelId>` as the provider lists them). A stored
    // id is printed back by later lists, so control and format characters
    // never validate: no stored value can steer a terminal (Codex on PR
    // #227, like the `--force` reasons below).
    models: z.array(
      z.string().check(z.refine(isStorableModelId, { error: () => UI_TEXT.actionFailed })),
    ),
    // Required for every chosen custom model; retained across save/reload.
    modelLimits: z.optional(z.record(z.string(), modelLimitsSchema)),
    // Compatibility overrides for a custom server's wire shape (BYO 14).
    compat: z.optional(customCompatSchema),
    // Explicit per-model evidence; resolver stamps source.kind = user.
    modelCapabilities: z.optional(
      z.record(z.string(), z.pipe(capabilityOverridesSchema, z.transform(userCapabilityOverrides))),
    ),
    // Pinned favourites, first in the composer's picker.
    pinned: z.optional(z.array(z.string())),
    // User-entered prices by model id (`source: 'user'` when read).
    prices: z.optional(z.record(z.string(), userPriceCardSchema)),
    // OpenRouter's routing choices (only on an `openrouter` entry).
    routing: z.optional(openRouterRoutingSchema),
    // The context each Ollama model runs with (only on an `ollama` entry).
    numCtx: z.optional(z.record(z.string(), z.number())),
    // EXECPROV round 6: exact input counts are on by default where the
    // provider documents a same-body count call; false keeps the byte bound.
    exactInputCount: z.optional(z.boolean()),
    // The deployment name Azure sends as `model` (only on an `azure`
    // entry); capability records resolve by the model family in `models`.
    // Optional in the file: entries saved before the wizard persisted it
    // (and terminal adds, which have no deployment option) must still
    // load; `wireModelFor` requires it at send.
    deployment: z.optional(z.string()),
    // Set once the user answers the private-network question for this entry.
    privateNetwork: z.optional(z.boolean()),
    // Models added despite the provider not listing them (D119): each maps
    // to the `--force` reason shown on the entry. Never a credential.
    forcedModels: z.optional(
      z.record(
        z.string(),
        z.string().check(
          z.refine((reason) => reason.trim() !== '' && !/\p{Cc}|\p{Zl}|\p{Zp}/u.test(reason), {
            error: () => UI_TEXT.actionFailed,
          }),
        ),
      ),
    ),
  })
  .check(
    z.refine(
      (entry) =>
        entry.auth !== 'subscription' ||
        (entry.models.length > 0 &&
          entry.models.every((id) => id !== '') &&
          ((entry.id === 'chatgpt' &&
            entry.preset === 'chatgpt' &&
            entry.address === 'https://api.openai.com' &&
            entry.format === 'responses') ||
            (entry.id === 'copilot' &&
              entry.preset === 'copilot' &&
              entry.address === 'https://github.com/copilot' &&
              entry.format === 'chat'))),
      { error: () => UI_TEXT.actionFailed },
    ),
    z.refine(
      (entry) =>
        entry.preset !== 'custom' ||
        entry.models.every(
          (modelId) => entry.modelLimits !== undefined && Object.hasOwn(entry.modelLimits, modelId),
        ),
      { error: () => UI_TEXT.providerText.schema.customLimits },
    ),
  )
  .check(
    (payload) => {
      const entry = payload.value
      const models = new Set([
        ...Object.keys(entry.modelLimits ?? {}),
        ...Object.keys(entry.modelCapabilities ?? {}),
      ])
      for (const model of models) {
        const limits = entry.modelLimits?.[model]
        const output = entry.modelCapabilities?.[model]?.output
        const minimum = providerOutputMinimum(
          entry.address,
          model,
          output?.minTokens ?? 1,
          entry.format,
        )
        if (limits !== undefined && limits.outputTokens < minimum)
          payload.issues.push({
            code: 'custom',
            input: entry,
            path: ['modelLimits', model, 'outputTokens'],
            message: outputTokenMinimumMessage(minimum),
          })
        if (output?.maxTokens !== undefined && output.maxTokens < minimum)
          payload.issues.push({
            code: 'custom',
            input: entry,
            path: ['modelCapabilities', model, 'output', 'maxTokens'],
            message: outputTokenMinimumMessage(minimum),
          })
      }
    },
    z.refine((entry) => entry.compat === undefined || entry.preset === 'custom', {
      error: () => UI_TEXT.providerText.schema.compat,
    }),
  )
export type ProviderEntry = z.infer<typeof providerEntrySchema>

export const providersFileSchema = z.object({
  v: z.literal(PROVIDERS_FILE_VERSION),
  // The composer's model and M96's default (`<providerId>/<modelId>`).
  defaultModel: z.optional(
    z.string().check(
      z.refine((ref) => parseModelRef(ref) !== undefined, {
        error: () => UI_TEXT.providerText.schema.modelRef,
      }),
    ),
  ),
  providers: z.array(
    z.pipe(
      z.unknown(),
      z.transform((input, payload) => {
        const parsed = providerEntrySchema.safeParse(input)
        if (!parsed.success) {
          for (const issue of parsed.error.issues.toReversed())
            payload.issues.push({ code: 'custom', input, path: issue.path, message: issue.message })
          return z.NEVER
        }
        if (parsed.data.auth === 'subscription') {
          const strict = z.strictObject(providerEntrySchema.shape).safeParse(input)
          if (!strict.success) {
            for (const issue of strict.error.issues)
              payload.issues.push({
                code: 'custom',
                input,
                path: issue.path,
                message: issue.message,
              })
            return z.NEVER
          }
        }
        return parsed.data
      }),
    ),
  ),
})
export type ProvidersFile = z.infer<typeof providersFileSchema>

/** An empty file: no provider, no default (the first-run state). */
export function emptyProvidersFile(): ProvidersFile {
  return { v: PROVIDERS_FILE_VERSION, providers: [] }
}

/** A user-entered card as a sourced price card. */
export function userPriceCard(
  prices: Record<string, UserPriceCard>,
  modelId: string,
): PriceCard | undefined {
  const found = prices[modelId]
  return found === undefined ? undefined : { ...found, source: 'user' }
}

export type ProvidersFileRead =
  | { readonly ok: true; readonly file: ProvidersFile }
  | {
      readonly ok: false
      readonly reason: 'missing' | 'unparseable' | 'invalid'
      readonly detail: string
    }

/**
 * Read and validate the file. A missing file is the first-run state, not
 * an error. An invalid file is reported, never repaired or defaulted: the
 * panel shows the failure and the user's providers stay untouched.
 */
/** The `code` of a filesystem error, or undefined for anything else. */
function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}

export async function readProvidersFile(
  filePath: string,
  read: (path: string) => Promise<string> = (path) => readFile(path, 'utf8'),
): Promise<ProvidersFileRead> {
  let text: string
  try {
    text = await read(filePath)
  } catch (error) {
    return errorCode(error) === 'ENOENT'
      ? { ok: false, reason: 'missing', detail: filePath }
      : { ok: false, reason: 'unparseable', detail: String(error) }
  }
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    return { ok: false, reason: 'unparseable', detail: filePath }
  }
  const parsed = z.safeParse(providersFileSchema, value)
  if (!parsed.success)
    return {
      ok: false,
      reason: 'invalid',
      detail: parsed.error.issues[0]?.message ?? UI_TEXT.actionFailed,
    }
  // C-M95-4 R5: a load prunes limits for models that are not listed,
  // for every reader of this file: the panel, the wizard, the CLI, ACP,
  // the registry.
  return {
    ok: true,
    file: {
      ...parsed.data,
      providers: parsed.data.providers.map((entry) => ({
        ...entry,
        modelLimits: pruneModelLimits(entry.models, entry.modelLimits),
      })),
    },
  }
}

export type ProvidersFileWrite =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'invalid'; readonly detail: string }
  | {
      readonly ok: false
      readonly reason: 'io-error'
      readonly detail: string
      readonly cause: unknown
    }

/**
 * A rename the platform briefly denies (Windows readers hold the
 * destination): worth another attempt after a pause. Anything else keeps
 * its kind at once. One named test so the retry condition reads as the
 * single expected case it is.
 */
function isRenameRetryCode(error: unknown): boolean {
  return (
    isStoreErrorCode(error, 'EPERM') ||
    isStoreErrorCode(error, 'EACCES') ||
    isStoreErrorCode(error, 'EBUSY')
  )
}

/** Best-effort removal of the temporary beside the destination. */
async function dropTemporaryFile(temporary: string): Promise<void> {
  try {
    await rm(temporary, { force: true })
  } catch {
    // An inaccessible directory may also prevent cleanup; the caller keeps
    // and reports the original write or rename failure.
  }
}

/**
 * Validate and write the file atomically: encoded once, written to a
 * unique temporary file beside the destination, then renamed over the
 * target, so a crash never leaves half a file. An invalid value is refused
 * before anything is written.
 */
export async function writeProvidersFileAtomic(
  filePath: string,
  file: unknown,
  renameFile: typeof rename = rename,
): Promise<ProvidersFileWrite> {
  const parsed = z.safeParse(providersFileSchema, file)
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid',
      detail: parsed.error.issues[0]?.message ?? UI_TEXT.actionFailed,
    }
  }
  const text = `${JSON.stringify(parsed.data, undefined, 2)}\n`
  const temporary = `${filePath}.${randomUUID()}.tmp`
  try {
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx' })
    // Windows readers briefly deny replacement; retry the same complete file.
    // Never delete the old destination to make a rename succeed.
    for (let attempt = 1; ; attempt += 1) {
      try {
        await renameFile(temporary, filePath)
        break
      } catch (error) {
        // Windows readers briefly deny replacement; retry the same complete
        // file a bounded number of times, then keep the failure's kind.
        if (attempt >= ATOMIC_RENAME_ATTEMPTS) throw error
        if (!isRenameRetryCode(error)) throw error
        await pause(ATOMIC_RENAME_DELAY_MS * 2 ** (attempt - 1))
      }
    }
    return { ok: true }
  } catch (error) {
    // Cleanup is best-effort; the caller keeps the write or rename failure
    // with its cause.
    await dropTemporaryFile(temporary)
    return { ok: false, reason: 'io-error', detail: String(error), cause: error }
  }
}

export { openRouterRoutingSchema } from '../../shared/providerRouting'
// Only M108's accounts field. M95 owns the providers-file envelope and I/O.
export { accountPoolSchema as providersAccountsSchema } from '../../shared/accounts'
