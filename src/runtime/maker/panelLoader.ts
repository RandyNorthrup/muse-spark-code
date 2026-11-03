import type * as MakerPanel from './runtimeMakerPanelEntry'

/** D6: the companion page and Thonny bridge, loaded as dist/runtimeMakerPanel.js on first use. */
export async function loadMakerPanel(): Promise<typeof MakerPanel> {
  try {
    return await import('./runtimeMakerPanelEntry.js')
  } catch (error: unknown) {
    throw new Error(
      'the runtimeMakerPanel.js bundle could not be loaded; the maker panel is unavailable',
      { cause: error },
    )
  }
}
