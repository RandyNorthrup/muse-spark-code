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
import { openRouterRoutingSchema } from '../../shared/providerRouting'
import { isProviderId, parseModelRef } from './modelRef'
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

/** User-supplied custom-server limits; both are finite positive token counts. */
const modelLimitsSchema = z
  .object({
    contextTokens: z.int().check(z.positive()),
    outputTokens: z.int().check(z.positive()),
  })
  .check(
    z.refine((limits) => limits.outputTokens <= limits.contextTokens, {
      error: () => UI_TEXT.providerText.schema.outputCap,
    }),
  )

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
    // The chosen models (`<modelId>` as the provider lists them).
    models: z.array(z.string()),
    // Required for every chosen custom model; retained across save/reload.
    modelLimits: z.optional(z.record(z.string(), modelLimitsSchema)),
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
    // Set once the user answers the private-network question for this entry.
    privateNetwork: z.optional(z.boolean()),
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
    z.union([
      providerEntrySchema.check(z.refine((entry) => entry.auth !== 'subscription')),
      z
        .strictObject(providerEntrySchema.shape)
        .check(
          z.refine(
            (entry) =>
              entry.auth === 'subscription' && providerEntrySchema.safeParse(entry).success,
          ),
        ),
    ]),
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
  return parsed.success
    ? { ok: true, file: parsed.data }
    : { ok: false, reason: 'invalid', detail: parsed.error.message }
}

export type ProvidersFileWrite =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'invalid' | 'io-error'; readonly detail: string }

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
    return { ok: false, reason: 'invalid', detail: parsed.error.message }
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
        if (
          !['EPERM', 'EACCES', 'EBUSY'].includes(errorCode(error) ?? '') ||
          attempt >= ATOMIC_RENAME_ATTEMPTS
        )
          throw error
        await pause(ATOMIC_RENAME_DELAY_MS * 2 ** (attempt - 1))
      }
    }
    return { ok: true }
  } catch (error) {
    // Cleanup is best-effort; preserve the write/rename failure for the caller.
    try {
      await rm(temporary, { force: true })
    } catch {
      // An inaccessible directory may also prevent cleanup; report the original IO failure.
    }
    return { ok: false, reason: 'io-error', detail: String(error) }
  }
}

export { openRouterRoutingSchema } from '../../shared/providerRouting'
