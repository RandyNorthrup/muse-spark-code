/** One capability-gated `<option>` list shared by the schedule editors: kinds,
 * targets, sources and every other choice the host marks available or not. */
export interface CapabilityOptionItem {
  readonly id: string
  readonly label: string
  readonly capability:
    | { readonly available: true; readonly reason?: string }
    | { readonly available: false; readonly reason: string }
}

export function CapabilityOptions({ items }: { readonly items: readonly CapabilityOptionItem[] }) {
  return (
    <>
      {items.map((item) => (
        <option key={item.id} value={item.id} disabled={!item.capability.available}>
          {item.label}
          {item.capability.available ? '' : `: ${item.capability.reason}`}
        </option>
      ))}
    </>
  )
}
