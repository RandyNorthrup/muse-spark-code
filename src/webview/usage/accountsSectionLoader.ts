// M102's UsageApp supplies this factory to React.lazy inside its usage surface.
export async function loadAccountsSection() {
  return await import('./AccountsSection')
}
