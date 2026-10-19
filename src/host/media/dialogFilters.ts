// The attach picker's media filters as the native dialog takes them (M105
// lane W, E1-picker-filter-binding). Dependency-free so activation carries
// only this: the attach port, the registry and contributor consent load
// lazily with dist/media.js and dist/mediaHost.js. Mutable copies because
// the dialog owns its options; undefined stays undefined so the no-filter
// call keeps its shape.
export function dialogFiltersOption(
  filters: Readonly<Record<string, readonly string[]>> | undefined,
): Readonly<Record<string, string[]>> | undefined {
  return filters === undefined
    ? undefined
    : Object.fromEntries(
        Object.entries(filters).map(([name, extensions]) => [name, [...extensions]]),
      )
}
