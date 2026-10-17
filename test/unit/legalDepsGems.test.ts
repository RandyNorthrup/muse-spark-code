// M97 lane S: Ruby gem evidence. Gemfiles and lock specs resolve
// versions; gemspecs are read statically and never executed, and
// executable content is reported instead of run.

import { describe, expect, it } from 'vitest'
import { readGems } from '../../src/core/legal/ecosystems/gems'
import { snapshotFrom } from './legal/helpers'

const gemfile = {
  Gemfile: `source "https://rubygems.org"

gem "rails", "= 7.1.0"
gem "rspec"

group :development do
  gem "rubocop", "= 1.0.0"
end
`,
}

const lock = {
  'Gemfile.lock': `GEM
  remote: https://rubygems.org/
  specs:
    rails (7.1.0)
    rspec (3.13.0)
    rubocop (1.0.0)

PLATFORMS
  ruby

DEPENDENCIES
  rails (= 7.1.0)
`,
}

const gemspec = {
  'example.gemspec': `Gem::Specification.new do |s|
  s.name = "example"
  s.version = "1.0.0"
  s.license = "MIT"
  s.add_dependency "rails", ">= 7.0"
  s.add_development_dependency "rspec"
end
`,
}

describe('readGems', () => {
  it('resolves the lock and keeps scopes', () => {
    const result = readGems(snapshotFrom({ ...gemfile, ...lock, ...gemspec }))
    expect(result.projectLicenses).toEqual([{ raw: 'MIT', file: 'example.gemspec' }])
    const names = new Map(result.dependencies.map((dep) => [dep.name, dep]))
    expect(names.get('rails')).toMatchObject({ version: '7.1.0', scope: 'production' })
    expect(names.get('rubocop')).toMatchObject({ version: '1.0.0', scope: 'development' })
    expect(names.get('rspec')).toMatchObject({ version: '3.13.0', scope: 'production' })
  })

  it('never executes a gemspec and reports executable content', () => {
    const before = 'evil-marker.txt'
    const result = readGems(
      snapshotFrom({
        Gemfile: 'gem "example"\n',
        'example.gemspec':
          'Gem::Specification.new do |s|\n  s.name = "example"\n  system("touch ' +
          before +
          '")\nend\n',
      }),
    )
    expect(
      result.incomplete.some(
        (entry) => entry.includes('executable code') && entry.includes('never runs'),
      ),
    ).toBe(true)
    expect(result.dependencies.find((dep) => dep.name === 'example')?.licenseRaw).toBeUndefined()
  })

  it('reads present gem specifications as installed licenses', () => {
    const result = readGems(
      snapshotFrom({
        ...lock,
        'vendor/bundle/ruby/3.3.0/specifications/rails-7.1.0.gemspec':
          'Gem::Specification.new do |s|\n  s.name = "rails"\n  s.license = "MIT"\nend\n',
      }),
    )
    expect(result.dependencies.find((dep) => dep.name === 'rails')?.licenseRaw).toBe('MIT')
  })

  it('reports an empty workspace as not checked', () => {
    const result = readGems(snapshotFrom({ 'src/ok.ts': 'export const value = 1\n' }))
    expect(result.incomplete).toEqual([
      'not checked: no Gemfile, Gemfile.lock or gemspec files found',
    ])
  })
})
