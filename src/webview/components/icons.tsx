// Inline SVG icons (16px grid, currentColor). Kept inline so the webview needs
// no icon font and the CSP stays at `font-src` = bundle origin only.

import type { ReactNode } from 'react'

interface IconProps {
  readonly title?: string
}

function Svg({ title, children }: IconProps & { readonly children: ReactNode }) {
  const isDecorative = title === undefined
  return (
    <svg
      className="icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={isDecorative || undefined}
      role={isDecorative ? undefined : 'img'}
    >
      {isDecorative ? null : <title>{title}</title>}
      {children}
    </svg>
  )
}

/**
 * The product's own mark: the squiggled handwritten "m" of
 * media/marketplace-icon.svg (two humps and a flick, no loops), the same
 * geometry as media/icon.svg, drawn here as a stroke in the brand blue
 * (--ms-brand-mark, set by styles.css; currentColor keeps forced-colors honest).
 * The box matches the old logo's (24x16) so the empty state's layout does
 * not shift. Crop to the path bounds plus half the stroke on every side;
 * meet the existing box: fill it in the limiting dimension (the width) and
 * sit centred in the other, so the mark keeps the Marketplace proportions
 * without clipping the round caps. Decorative next to the product name:
 * no animation.
 */
export function ProductMark({ title }: IconProps) {
  const isDecorative = title === undefined
  return (
    <svg
      className="icon product-mark"
      viewBox="2 6.43 20 11.14"
      preserveAspectRatio="xMidYMid meet"
      width="24"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={isDecorative || undefined}
      role={isDecorative ? undefined : 'img'}
    >
      {isDecorative ? null : <title>{title}</title>}
      <path d="M3 16.57L3.25 16.48L3.52 16.27L3.84 15.95L4.18 15.52L4.55 15L4.95 14.39L5.37 13.74L5.79 13.02L6.23 12.29L6.67 11.55L7.11 10.83L7.53 10.14L7.94 9.49L8.33 8.91L8.7 8.42L9.04 8.01L9.35 7.71L9.62 7.52L9.86 7.43L10.07 7.47L10.24 7.62L10.39 7.86L10.5 8.22L10.58 8.66L10.64 9.17L10.69 9.74L10.72 10.37L10.74 11.02L10.76 11.68L10.78 12.35L10.81 12.98L10.84 13.57L10.9 14.12L10.97 14.59L11.07 14.99L11.19 15.3L11.35 15.51L11.53 15.62L11.75 15.63L11.99 15.53L12.26 15.35L12.56 15.07L12.89 14.71L13.24 14.27L13.6 13.78L13.98 13.24L14.37 12.68L14.76 12.09L15.16 11.5L15.54 10.93L15.92 10.38L16.29 9.88L16.64 9.44L16.97 9.06L17.27 8.76L17.56 8.54L17.82 8.41L18.05 8.37L18.25 8.41L18.42 8.54L18.58 8.76L18.71 9.05L18.82 9.41L18.92 9.82L18.99 10.27L19.06 10.77L19.13 11.27L19.19 11.79L19.26 12.29L19.33 12.78L19.41 13.23L19.5 13.63L19.62 13.98L19.75 14.27L19.89 14.49L20.07 14.64L20.27 14.7L20.49 14.69L20.74 14.6L21 14.45" />
    </svg>
  )
}

// --- permission-mode glyphs (the Claude Code Modes menu set) ---

export function HandIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5.5 8.5V3.75a1 1 0 0 1 2 0V7M7.5 7V2.75a1 1 0 0 1 2 0V7M9.5 7V3.75a1 1 0 0 1 2 0V8" />
      <path d="M11.5 8V6.25a1 1 0 0 1 2 0V10c0 2.5-1.8 4.5-4.25 4.5-2 0-3-.9-3.8-2.1L3.4 9.6a1 1 0 0 1 1.6-1.2l.5.6" />
    </Svg>
  )
}

export function PlanIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      <path d="M5 6h6M5 8.5h6M5 11h3.5" />
    </Svg>
  )
}

export function BoltIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 1.5 3.5 9h4l-.5 5.5L12.5 7h-4l.5-5.5Z" />
    </Svg>
  )
}

export function WarningIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 2.5 14 13H2L8 2.5Z" />
      <path d="M8 6.5v3M8 11.2v.3" />
    </Svg>
  )
}

// --- attach menu glyphs ---

export function UploadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 10.5V3M4.5 6.5 8 3l3.5 3.5" />
      <path d="M2.5 11.5v2h11v-2" />
    </Svg>
  )
}

export function AddContextIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 2.5h5l3 3v8H4v-11Z" />
      <path d="M9 2.5v3h3M8 7.5v4M6 9.5h4" />
    </Svg>
  )
}

export function HistoryIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </Svg>
  )
}

export function BoardIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
    </Svg>
  )
}

export function NewConversationIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 3.5h11v7h-6L4 13v-2.5H2.5v-7Z" />
      <path d="M8 5.5v4M6 7.5h4" />
    </Svg>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 3v10M3 8h10" />
    </Svg>
  )
}

export function SlashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M9.5 5 6.5 11" />
    </Svg>
  )
}

export function CodeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m5.5 5-3 3 3 3M10.5 5l3 3-3 3" />
    </Svg>
  )
}

/** The vault section's padlock (C-M109-1 P1). */
export function LockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
    </Svg>
  )
}

export function SendIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 13V3M4 7l4-4 4 4" />
    </Svg>
  )
}

export function StopIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function ImageIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <circle cx="6" cy="6.5" r="1" />
      <path d="m3 12 3.5-3.5 2 2 2-2L13 11" />
    </Svg>
  )
}

export function MicIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5.75" y="1.75" width="4.5" height="8" rx="2.25" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.25M5.75 14.25h4.5" />
    </Svg>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m4 4 8 8M12 4l-8 8" />
    </Svg>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m3 8.5 3 3 7-7" />
    </Svg>
  )
}

export function FolderIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 4.5h4l1.5 1.5h5.5v6.5h-11v-8Z" />
    </Svg>
  )
}

/** The composer's prompt menu (save, share, use a saved prompt). */
export function BookmarkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 2.5h7v11L8 10.5l-3.5 3v-11Z" />
    </Svg>
  )
}

export function FileIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 2.5h5l3 3v8H4v-11Z" />
      <path d="M9 2.5v3h3" />
    </Svg>
  )
}

/** The rewind arrow on user cards (fork / rewind menu). */
export function RewindIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 8a4.5 4.5 0 1 0 1.3-3.2" />
      <path d="M3.5 2.5v2.8h2.8" />
    </Svg>
  )
}

export function BackIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 3 5 8l5 5" />
    </Svg>
  )
}

/** The disclosure mark on a row that opens: pointing right closed, down open (M15). */
export function ExpandChevron({ isOpen }: { readonly isOpen: boolean }) {
  return (
    <span className={isOpen ? 'chevron chevron-open' : 'chevron'} aria-hidden="true">
      <Svg>
        <path d="m6 4 4 4-4 4" />
      </Svg>
    </span>
  )
}

export function CopyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </Svg>
  )
}

export function ReplyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.5 4.5 3 8l3.5 3.5" />
      <path d="M3 8h6a4 4 0 0 1 4 4v1" />
    </Svg>
  )
}

export function MoreIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="4" cy="8" r="0.9" />
      <circle cx="8" cy="8" r="0.9" />
      <circle cx="12" cy="8" r="0.9" />
    </Svg>
  )
}
