// M97 lane S: NuGet evidence. Coordinates resolve through central
// versions, lockfiles and asset files; licenses come from present
// nuspec expressions only, never from content hashes.

import { describe, expect, it } from 'vitest'
import { readNuGet } from '../../src/core/legal/ecosystems/nuget'
import { snapshotFrom } from './legal/helpers'

const project = {
  'app/app.csproj': `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    <PackageReference Include="Serilog" />
  </ItemGroup>
</Project>
`,
  'Directory.Packages.props': `<Project>
  <ItemGroup>
    <PackageVersion Include="Serilog" Version="3.1.1" />
  </ItemGroup>
</Project>
`,
}

const nuspec = {
  'packages/newtonsoft.json/13.0.3/newtonsoft.json.nuspec': `<?xml version="1.0"?>
<package><metadata>
<id>Newtonsoft.Json</id>
<version>13.0.3</version>
<license type="expression">MIT</license>
</metadata></package>
`,
}

describe('readNuGet', () => {
  it('resolves central versions and present nuspec licenses', () => {
    const result = readNuGet(snapshotFrom({ ...project, ...nuspec }))
    const names = new Map(result.dependencies.map((dep) => [dep.name, dep]))
    expect(names.get('Newtonsoft.Json')).toMatchObject({ version: '13.0.3', licenseRaw: 'MIT' })
    expect(names.get('Serilog')).toMatchObject({ version: '3.1.1', licenseRaw: undefined })
    expect(result.incomplete.some((entry) => entry.includes('present .nuspec'))).toBe(true)
  })

  it('reads lockfiles and treats test projects as development', () => {
    const result = readNuGet(
      snapshotFrom({
        'app.tests/app.tests.csproj': `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><IsTestProject>true</IsTestProject></PropertyGroup>
  <ItemGroup><PackageReference Include="xunit" /></ItemGroup>
</Project>
`,
        'packages.lock.json': JSON.stringify({
          version: 1,
          dependencies: {
            'net8.0': { xunit: { type: 'Direct', requested: '2.9.0', resolved: '2.9.2' } },
          },
        }),
      }),
    )
    expect(result.dependencies.find((dep) => dep.name === 'xunit')).toMatchObject({
      version: '2.9.2',
      scope: 'development',
    })
  })

  it('reads the project nuspec as a project declaration', () => {
    const result = readNuGet(
      snapshotFrom({
        'own.nuspec': `<?xml version="1.0"?>\n<package><metadata>\n<id>Own</id>\n<version>1.0.0</version>\n<license type="expression">MIT</license>\n</metadata></package>\n`,
      }),
    )
    expect(result.projectLicenses).toEqual([{ raw: 'MIT', file: 'own.nuspec' }])
  })

  it('reports an empty workspace as not checked', () => {
    const result = readNuGet(snapshotFrom({ 'src/ok.ts': 'export const value = 1\n' }))
    expect(result.incomplete).toEqual([
      'not checked: no NuGet declarations, locks or asset files found',
    ])
  })
})
