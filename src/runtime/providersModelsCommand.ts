// `providers models <entry>`: list an entry's models, or change the list
// with `--add`/`--remove` (D108). A module of its own so the headless
// preflight, which imports providersCommands lazily, never carries it. The
// write goes through the same validated atomic commit as every other
// provider command; the stored key is read only when the provider's own
// list is consulted, never for a forced add.
import type { ProviderEntry, ProvidersFile } from '../core/providers/providersFile'
import { presets, providersFile } from '../host/backend/providersEntry'

const { presetById } = presets
import { ACP_AGENT_NAME, UI_TEXT } from '../shared/constants'
import { fill } from '../shared/l10n/text'
import type { ProvidersModelsOptions } from './cliArgs'
import { optionDistance } from './editDistance'
import { resolveProvider } from './exec/providerExec'
import {
  commandFile,
  commitProviderChange,
  failed,
  listProviderModels,
  storedProviderKey,
  type ProvidersDeps,
} from './providersCommands'

const { providerEntrySchema } = providersFile

const EXIT_OK = 0
const EXIT_FAILED = 1

/** How many ids a refusal suggests, and how far a typo may be. */
const CLOSE_MATCH_COUNT = 3
const CLOSE_MATCH_DISTANCE = 3

/** The closest known ids to a mistyped one, or the fallback when none is close. */
function closestIds(wanted: string, candidates: readonly string[]): string {
  const ranked = [...candidates].toSorted(
    (first, second) => optionDistance(wanted, first) - optionDistance(wanted, second),
  )
  const close = ranked
    .filter((candidate) => optionDistance(wanted, candidate) <= CLOSE_MATCH_DISTANCE)
    .slice(0, CLOSE_MATCH_COUNT)
  const shown = close.length > 0 ? close : ranked.slice(0, CLOSE_MATCH_COUNT)
  return shown.length > 0 ? shown.join(', ') : '—'
}

/** One entry's model list, with each forced model's reason shown on the entry. */
function printModelsList(deps: ProvidersDeps, entry: ProviderEntry): void {
  const forced = entry.forcedModels ?? {}
  const models =
    entry.models.length === 0
      ? '—'
      : entry.models
          .map((model) =>
            forced[model] === undefined
              ? model
              : `${model} (${fill(UI_TEXT.cliHelp.modelsForced, { reason: forced[model] })})`,
          )
          .join(', ')
  deps.print(fill(UI_TEXT.cliHelp.modelsList, { entry: entry.id }))
  deps.print(models)
}

/**
 * The provider's own model list, or undefined where it cannot be read with
 * the stored key. Reads the stored key only to consult the provider's list.
 */
async function readProviderModelList(
  deps: ProvidersDeps,
  file: ProvidersFile,
  entry: ProviderEntry,
  isQuiet = true,
): Promise<readonly string[] | undefined> {
  const resolved = await resolveProvider(file, entry.id, presetById, deps.resolveHost)
  if (!resolved.ok) return undefined
  const stored = await storedProviderKey(deps, resolved.provider, isQuiet)
  return stored.ok
    ? await listProviderModels(deps.fetch, resolved.provider, stored.key, deps.resolveHost)
    : undefined
}

/**
 * List the entry's models (and, where the provider's own list reads with
 * the stored key, which listed models the entry does not offer), or change
 * the list with `--add`/`--remove`. A model the provider does not list is
 * refused with the closest ids unless `--force` carries a reason, which is
 * stored on the entry.
 */
export async function providersModels(
  deps: ProvidersDeps,
  options: ProvidersModelsOptions,
): Promise<number> {
  const file = await commandFile(deps)
  if (file === undefined) return EXIT_FAILED
  const entry = file.providers.find((candidate) => candidate.id === options.entry)
  if (entry === undefined) {
    return failed(
      deps,
      fill(UI_TEXT.cliHelp.modelsUnknownEntry, {
        entry: options.entry,
        closest: closestIds(
          options.entry,
          file.providers.map((candidate) => candidate.id),
        ),
      }),
    )
  }
  const clean = (models: readonly string[]): readonly string[] | undefined => {
    const cleaned = models.map((model) => model.trim()).filter((model) => model !== '')
    // A repeated flag names the model once; the file never carries it twice.
    return cleaned.some((model) => /\s/.test(model)) ? undefined : [...new Set(cleaned)]
  }
  const add = clean(options.add)
  const remove = clean(options.remove)
  if (add === undefined || remove === undefined) {
    return failed(deps, fill(UI_TEXT.cliHelp.modelsUsage, { command: ACP_AGENT_NAME }))
  }
  if (add.length === 0 && remove.length === 0) {
    if (options.force !== undefined) {
      return failed(deps, UI_TEXT.cliHelp.modelsForceNeedsAdd)
    }
    printModelsList(deps, entry)
    const listed = await readProviderModelList(deps, file, entry)
    if (listed === undefined) {
      deps.print(UI_TEXT.cliHelp.modelsUnreadable)
      return EXIT_OK
    }
    const extra = listed.filter((model) => !entry.models.includes(model))
    if (extra.length > 0) {
      deps.print(UI_TEXT.cliHelp.modelsExtra)
      deps.print(extra.join(', '))
    }
    return EXIT_OK
  }
  // Custom limits are explicit per model; this CLI has no limit inputs.
  // Keep listing available, but send edits to the Models panel instead.
  if (entry.preset === 'custom') return failed(deps, UI_TEXT.cliHelp.modelsCustomReadOnly)
  for (const model of remove) {
    if (!entry.models.includes(model)) {
      deps.printError(
        fill(UI_TEXT.cliHelp.modelsUnknown, {
          model,
          entry: entry.id,
          closest: closestIds(model, entry.models),
        }),
      )
      return EXIT_FAILED
    }
  }
  const added = add.filter((model) => !entry.models.includes(model))
  if (options.force === undefined && added.length > 0) {
    const listed = await readProviderModelList(deps, file, entry, false)
    if (listed === undefined) {
      return failed(deps, UI_TEXT.cliHelp.modelsNeedsForce)
    }
    for (const model of added) {
      if (!listed.includes(model)) {
        deps.printError(
          fill(UI_TEXT.cliHelp.modelsUnknown, {
            model,
            entry: entry.id,
            closest: closestIds(model, listed),
          }),
        )
        deps.printError(UI_TEXT.cliHelp.modelsNeedsForce)
        return EXIT_FAILED
      }
    }
  }
  // The shape this command writes, from the entry it read. The commit
  // re-reads the file, so the change is recomputed from that current
  // entry there: a panel edit between the two reads is kept, not lost.
  const entryWith = (base: ProviderEntry): ProviderEntry => {
    const fresh = add.filter((model) => !base.models.includes(model))
    const forced: Record<string, string> = Object.fromEntries(
      Object.entries(base.forcedModels ?? {}).filter(
        ([model]) => !remove.includes(model) && !fresh.includes(model),
      ),
    )
    if (options.force !== undefined) {
      for (const model of fresh) forced[model] = options.force
    }
    return {
      ...base,
      models: [...base.models.filter((model) => !remove.includes(model)), ...fresh],
      forcedModels: Object.keys(forced).length > 0 ? forced : undefined,
    }
  }
  const validated = providerEntrySchema.safeParse(entryWith(entry))
  if (!validated.success) {
    return failed(deps, validated.error.issues[0]?.message ?? UI_TEXT.actionFailed)
  }
  const removedRefs = new Set(remove.map((model) => `${entry.id}/${model}`))
  let written: ProviderEntry = validated.data
  const committed = await commitProviderChange(
    deps,
    entry.id,
    (current) => {
      const currentEntry = current.providers.find((candidate) => candidate.id === entry.id)
      if (currentEntry === undefined) return
      written = entryWith(currentEntry)
      return {
        ...current,
        ...(current.defaultModel !== undefined &&
          removedRefs.has(current.defaultModel) && { defaultModel: undefined }),
        providers: current.providers.map((candidate) =>
          candidate.id === entry.id ? written : candidate,
        ),
      }
    },
    false,
  )
  if (committed !== EXIT_OK) return committed
  if (added.length > 0) {
    deps.print(fill(UI_TEXT.cliHelp.modelsAdded, { models: added.join(', '), entry: entry.id }))
  }
  const removed = remove.filter((model) => entry.models.includes(model))
  if (removed.length > 0) {
    deps.print(fill(UI_TEXT.cliHelp.modelsRemoved, { models: removed.join(', '), entry: entry.id }))
  }
  if (added.length === 0 && removed.length === 0) printModelsList(deps, written)
  return EXIT_OK
}
