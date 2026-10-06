/** Stored dates follow the recording host's local calendar, including DST. */
export function usageLocalDay(at: number): string {
  const date = new Date(at)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}
