// What a plan shows (M79, PLAN.md D49; PR #53's third review). A plan is
// Markdown, and Markdown can carry text a rendered view leaves out: a link's
// destination and title, a picture's source, a definition, a footnote
// nobody cites, a code fence's info string. So a plan is shown, and briefed,
// from one rewritten tree: this transform turns each such part into text
// that the panel renders (a link's destination follows its text as
// `<https://…>`, a picture is its alt text and `<source>`, a definition is a
// paragraph, a footnote is `[^label]` and its text in place, a code block
// keeps its whole info string as its label). The panel renders a plan reply
// through it (MarkdownView's `isPlan`), and the brief the model gets is the
// same rewritten tree written back as Markdown (core/plans/planMarkdown.ts),
// so every character the model reads is one the user saw. Raw HTML is left
// as it is: the panel never renders it, and a plan holding it is not started.
//
// Pure: no parser, no React. It mutates the mdast tree it is given.

/** An mdast node, as far as this transform reads and rewrites it. */
export interface PlanNode {
  type: string
  value?: string | undefined
  url?: string | undefined
  title?: string | null | undefined
  alt?: string | null | undefined
  label?: string | null | undefined
  referenceType?: string | undefined
  lang?: string | null | undefined
  meta?: string | null | undefined
  children?: PlanNode[] | undefined
  data?: object | undefined
}

/** The `data-info` attribute a plan's code block carries: its whole info string. */
export const PLAN_CODE_INFO_ATTRIBUTE = 'data-info'
const CODE_INFO_PROPERTY = 'dataInfo'
// What GFM puts before an address or a `www.` domain it finds in text.
const BARE_PREFIXES = ['', 'mailto:', 'http://']
const FULL_REFERENCE = 'full'

function text(value: string): PlanNode {
  return { type: 'text', value }
}

function paragraph(children: PlanNode[]): PlanNode {
  return { type: 'paragraph', children }
}

/** ` "title"`, or nothing without one. */
function titled(title: string | null | undefined): string {
  return title === undefined || title === null || title.length === 0 ? '' : ` "${title}"`
}

/** The text a node's children spell, as written. */
function spelled(node: PlanNode): string {
  return node.value ?? (node.children ?? []).map((child) => spelled(child)).join('')
}

/** A reference's own label when it names one that its text does not (`[text][label]`). */
function namedLabel(node: PlanNode): string {
  return node.referenceType === FULL_REFERENCE ? ` [${node.label ?? ''}]` : ''
}

/** The node as the plan shows it: itself, or the text that stands for it. */
function shown(node: PlanNode): PlanNode[] {
  const children = (node.children ?? []).flatMap((child) => shown(child))
  if (node.children !== undefined) {
    node.children = children
  }
  switch (node.type) {
    case 'link': {
      const url = node.url ?? ''
      const written = spelled(node)
      // An autolink (`<https://…>`, `www.…`, an address) already shows itself.
      const isBare = BARE_PREFIXES.some((prefix) => `${prefix}${written}` === url)
      return isBare && titled(node.title) === ''
        ? children
        : [...children, text(` <${url}>${titled(node.title)}`)]
    }
    case 'image': {
      return [text(`${node.alt ?? ''} <${node.url ?? ''}>${titled(node.title)}`.trim())]
    }
    case 'linkReference': {
      return [...children, ...(namedLabel(node) === '' ? [] : [text(namedLabel(node))])]
    }
    case 'imageReference': {
      return [text(`${node.alt ?? ''}${namedLabel(node)}`)]
    }
    case 'definition': {
      return [paragraph([text(`[${node.label ?? ''}]: <${node.url ?? ''}>${titled(node.title)}`)])]
    }
    case 'footnoteReference': {
      return [text(`[^${node.label ?? ''}]`)]
    }
    case 'footnoteDefinition': {
      return [paragraph([text(`[^${node.label ?? ''}]:`)]), ...children]
    }
    case 'code': {
      const info = [node.lang, node.meta]
        .filter((part) => part !== undefined && part !== null && part !== '')
        .join(' ')
      if (info !== '') {
        const properties = { [CODE_INFO_PROPERTY]: info }
        node.data = { ...node.data, hProperties: properties }
      }
      return [node]
    }
    default: {
      return [node]
    }
  }
}

/** Rewrites a parsed plan in place so that every part of it is text the panel renders. */
export function showPlanParts(tree: PlanNode): void {
  tree.children = (tree.children ?? []).flatMap((child) => shown(child))
}
