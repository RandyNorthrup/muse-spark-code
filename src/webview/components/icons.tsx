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
 * The Meta logo (the brand mark the owner supplied for the panel), in its
 * own colours: it is not a stroke icon, so it does not go through `Svg`.
 * Gradient ids are prefixed to stay unique should the mark ever render twice.
 */
export function MetaLogo({ title }: IconProps) {
  const isDecorative = title === undefined
  return (
    <svg
      className="icon brand-logo"
      viewBox="0 0 256 171"
      width="24"
      height="16"
      aria-hidden={isDecorative || undefined}
      role={isDecorative ? undefined : 'img'}
    >
      {isDecorative ? null : <title>{title}</title>}
      <defs>
        <linearGradient id="meta-logo-a" x1="13.878%" x2="89.144%" y1="55.934%" y2="58.694%">
          <stop offset="0%" stopColor="#0064E1" />
          <stop offset="40%" stopColor="#0064E1" />
          <stop offset="83%" stopColor="#0073EE" />
          <stop offset="100%" stopColor="#0082FB" />
        </linearGradient>
        <linearGradient id="meta-logo-b" x1="54.315%" x2="54.315%" y1="82.782%" y2="39.307%">
          <stop offset="0%" stopColor="#0082FB" />
          <stop offset="100%" stopColor="#0064E0" />
        </linearGradient>
      </defs>
      <path
        fill="#0081FB"
        d="M27.651 112.136c0 9.775 2.146 17.28 4.95 21.82 3.677 5.947 9.16 8.466 14.751 8.466 7.211 0 13.808-1.79 26.52-19.372 10.185-14.092 22.186-33.874 30.26-46.275l13.675-21.01c9.499-14.591 20.493-30.811 33.1-41.806C161.196 4.985 172.298 0 183.47 0c18.758 0 36.625 10.87 50.3 31.257C248.735 53.584 256 81.707 256 110.729c0 17.253-3.4 29.93-9.187 39.946-5.591 9.686-16.488 19.363-34.818 19.363v-27.616c15.695 0 19.612-14.422 19.612-30.927 0-23.52-5.484-49.623-17.564-68.273-8.574-13.23-19.684-21.313-31.907-21.313-13.22 0-23.859 9.97-35.815 27.75-6.356 9.445-12.882 20.956-20.208 33.944l-8.066 14.289c-16.203 28.728-20.307 35.271-28.408 46.07-14.2 18.91-26.324 26.076-42.287 26.076-18.935 0-30.91-8.2-38.325-20.556C2.973 139.413 0 126.202 0 111.148l27.651.988Z"
      />
      <path
        fill="url(#meta-logo-a)"
        d="M21.802 33.206C34.48 13.666 52.774 0 73.757 0 85.91 0 97.99 3.597 110.605 13.897c13.798 11.261 28.505 29.805 46.853 60.368l6.58 10.967c15.881 26.459 24.917 40.07 30.205 46.49 6.802 8.243 11.565 10.7 17.752 10.7 15.695 0 19.612-14.422 19.612-30.927l24.393-.766c0 17.253-3.4 29.93-9.187 39.946-5.591 9.686-16.488 19.363-34.818 19.363-11.395 0-21.49-2.475-32.654-13.007-8.582-8.083-18.615-22.443-26.334-35.352l-22.96-38.352C118.528 64.08 107.96 49.73 101.845 43.23c-6.578-6.988-15.036-15.428-28.532-15.428-10.923 0-20.2 7.666-27.963 19.39L21.802 33.206Z"
      />
      <path
        fill="url(#meta-logo-b)"
        d="M73.312 27.802c-10.923 0-20.2 7.666-27.963 19.39-10.976 16.568-17.698 41.245-17.698 64.944 0 9.775 2.146 17.28 4.95 21.82L9.027 149.482C2.973 139.413 0 126.202 0 111.148 0 83.772 7.514 55.24 21.802 33.206 34.48 13.666 52.774 0 73.757 0l-.445 27.802Z"
      />
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

export function FileIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 2.5h5l3 3v8H4v-11Z" />
      <path d="M9 2.5v3h3" />
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
