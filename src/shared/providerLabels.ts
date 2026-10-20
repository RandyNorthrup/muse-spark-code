// One provider list a person can tell apart: two providers made from one
// preset share its label (two Anthropic keys), so each such label gains the
// provider's own id. The Models panel and `auth status` both use it.

/**
Each label shared by more than one provider gains `(id)`; a label no
other provider shares, or one that is the id already, stays as it is.
*/
export function distinctProviderLabels<T extends { readonly id: string; readonly label: string }>(
  rows: readonly T[],
): T[] {
  const sharing = new Map<string, number>()
  for (const row of rows) sharing.set(row.label, (sharing.get(row.label) ?? 0) + 1)
  return rows.map((row) =>
    row.label !== row.id && (sharing.get(row.label) ?? 0) > 1
      ? { ...row, label: `${row.label} (${row.id})` }
      : row,
  )
}
