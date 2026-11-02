// The window's maker engine as dist/makerEngine.js sees it (RLF-M103WIRE):
// the latch, registry, device log, serial and machine operations, required
// by the maker host assembly on its first use. Reads display text, so it
// installs the caller's table before creating the engine.
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { MakerEngine, type MakerEngineDeps } from './makerEngine'

export async function createMakerEngine(
  deps: MakerEngineDeps,
  table: UiText,
  locale: string,
): Promise<MakerEngine> {
  setUiText(table, locale)
  return await MakerEngine.create(deps)
}
