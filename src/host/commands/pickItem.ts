// One row of a single-choice pick in the host's command flows (M31, M32):
// the pick resolves to the row's `id`, so a flow never compares labels.

export interface PickItem {
  readonly id: string
  readonly label: string
  readonly description?: string
  readonly detail?: string
}

/** A single pick: the chosen row's id, or undefined when dismissed. */
export type PickOne = (
  items: readonly PickItem[],
  title: string,
  placeholder: string,
) => Promise<string | undefined>
