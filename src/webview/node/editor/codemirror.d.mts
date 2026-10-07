export function mountEditor(
  parent: HTMLElement,
  text: string,
  label: string,
  onChange: (text: string) => void,
  phrases: Readonly<Record<string, string>>,
): { focus(): void; destroy(): void }
export function mountDiff(
  parent: HTMLElement,
  original: string,
  modified: string,
  labels: { original: string; modified: string },
): { destroy(): void }
