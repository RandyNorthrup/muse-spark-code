// M97 lane S: Maven and Gradle evidence. POM license names are free
// text mapped where the mapping is exact; Gradle coordinates resolve
// through lockfiles and catalogs; executable build logic never runs.

import { describe, expect, it } from 'vitest'
import { mavenLicenseName, readJvm } from '../../src/core/legal/ecosystems/jvm'
import { snapshotFrom } from './legal/helpers'

const pom = {
  'pom.xml': `<?xml version="1.0"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>hello</artifactId>
  <version>1.0.0</version>
  <licenses>
    <license>
      <name>Apache License, Version 2.0</name>
    </license>
  </licenses>
  <dependencies>
    <dependency>
      <groupId>org.apache.commons</groupId>
      <artifactId>commons-lang3</artifactId>
      <version>3.14.0</version>
    </dependency>
    <dependency>
      <groupId>junit</groupId>
      <artifactId>junit</artifactId>
      <version>4.13.2</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
</project>
`,
}

const presentPom = {
  'repo/commons-lang3-3.14.0.pom': `<?xml version="1.0"?>
<project>
  <groupId>org.apache.commons</groupId>
  <artifactId>commons-lang3</artifactId>
  <version>3.14.0</version>
  <licenses>
    <license><name>Apache License, Version 2.0</name></license>
  </licenses>
</project>
`,
}

describe('mavenLicenseName', () => {
  it('maps exact spellings and keeps SPDX expressions', () => {
    expect(mavenLicenseName('Apache License, Version 2.0')).toBe('Apache-2.0')
    expect(mavenLicenseName('MIT')).toBe('MIT')
    expect(mavenLicenseName('MIT OR Apache-2.0')).toBe('MIT OR Apache-2.0')
  })

  it('keeps unmapped names raw for a human read', () => {
    expect(mavenLicenseName('Example License 1.0')).toBe('Example License 1.0')
  })
})

describe('readJvm', () => {
  it('reads POM licenses, scopes and present artifact metadata', () => {
    const result = readJvm(snapshotFrom({ ...pom, ...presentPom }))
    expect(result.projectLicenses).toEqual([{ raw: 'Apache-2.0', file: 'pom.xml' }])
    const names = new Map(result.dependencies.map((dep) => [dep.name, dep]))
    expect(names.get('org.apache.commons/commons-lang3')).toMatchObject({
      version: '3.14.0',
      scope: 'production',
      licenseRaw: 'Apache-2.0',
    })
    expect(names.get('junit/junit')).toMatchObject({ version: '4.13.2', scope: 'development' })
  })

  it('reads Gradle declarations resolved by locks', () => {
    const result = readJvm(
      snapshotFrom({
        'build.gradle': `dependencies {\n  implementation 'org.slf4j:slf4j-api:2.0.0'\n  testImplementation("junit:junit:4.13.2")\n}\n`,
        'gradle.lockfile': '# lock\norg.slf4j:slf4j-api:2.0.0=runtimeClasspath\n',
      }),
    )
    const names = new Map(result.dependencies.map((dep) => [dep.name, dep]))
    expect(names.get('org.slf4j/slf4j-api')).toMatchObject({
      version: '2.0.0',
      scope: 'production',
    })
    expect(names.get('junit/junit')).toMatchObject({ version: '4.13.2', scope: 'development' })
  })

  it('reports an empty workspace as not checked', () => {
    const result = readJvm(snapshotFrom({ 'src/ok.ts': 'export const value = 1\n' }))
    expect(result.incomplete).toEqual([
      'not checked: no POMs, Gradle declarations, locks or catalogs found',
    ])
  })
})
