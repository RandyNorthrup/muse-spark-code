import { Clipped } from './ToolBlocks'

/** Escaped text only: a preview has no file opener, approval or tool action. */
export function ToolArgumentPreview({ text }: { readonly text: string }) {
  return <Clipped text={text} className="tool-output" />
}
