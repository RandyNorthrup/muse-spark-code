// Muse Desktop (M111): every desktop app's entry follows the system colour
// scheme into data-ms-theme (M114), until the settings app owns the
// override. Shared by the workbench (WB) and settings (ST1) entries.

export function followSystemScheme(): void {
  const scheme = window.matchMedia('(prefers-color-scheme: dark)')
  const applyScheme = (): void => {
    document.documentElement.dataset['msTheme'] = scheme.matches ? 'dark' : 'light'
  }
  applyScheme()
  scheme.addEventListener('change', applyScheme)
}
