// Test-only interleavings inside the real Windows helper; Node spies cannot
// interpose on a retained native handle in another process.
const FIXTURE = `
  static string FixtureBase, FixtureName, FixtureTrash;
  static bool FixtureCreated;
  static ulong FixtureMounted;
  static bool Enabled(string name) { return File.Exists(Path.Combine(FixtureBase, ".race-" + name)); }
  static void SwapFixture(string name, string saved, bool populated) {
    string file = Path.Combine(FixtureBase, name);
    Directory.Move(file, Path.Combine(FixtureBase, saved));
    Directory.CreateDirectory(file);
    if (populated) File.WriteAllText(Path.Combine(file, "keep"), "personal");
  }
`

function replace(source: string, before: string, after: string): string {
  if (!source.includes(before)) throw new Error(`Missing Windows native fixture seam: ${before}`)
  return source.replace(before, () => after)
}

export function windowsCreatedVariant(source: string, variant: string): string {
  let result = replace(
    source,
    'public static class MuseSparkCreated {',
    `public static class MuseSparkCreated {${FIXTURE}`,
  )
  result = replace(
    result,
    'if (args.Length != 7) Refuse();',
    'if (args.Length != 7) Refuse(); FixtureBase = args[1]; FixtureName = args[3]; FixtureCreated = false;',
  )
  if (variant.endsWith('createdNativeDevice.c')) {
    result = replace(
      result,
      'return result;\n    } finally { if (security.IsAllocated)',
      'if (name == "mounted") { Info mounted; if (!GetFileInformationByHandle(result, out mounted)) Refuse(); FixtureMounted = Id(mounted); } return result;\n    } finally { if (security.IsAllocated)',
    )
    return replace(
      result,
      'return s; }\n  static ulong Id',
      'if (FixtureMounted != 0 && Id(s) == FixtureMounted) s.Volume++; return s; }\n  static ulong Id',
    )
  }
  if (!variant.endsWith('createdNativeRace.c'))
    throw new Error('Unsupported Windows native fixture')
  result = replace(
    result,
    'new SecurityIdentifier(owner).Value != current.User.Value',
    '(FixtureCreated && Enabled("owner") ? "foreign-owner" : new SecurityIdentifier(owner).Value) != current.User.Value',
  )
  result = replace(
    result,
    'return result;\n    } finally { if (security.IsAllocated)',
    `
      if (create && directory && name.StartsWith("muse-tree-")) {
        FixtureCreated = true;
        if (Enabled("create")) {
          Directory.Move(Path.Combine(FixtureBase, name), Path.Combine(FixtureBase, "saved-root"));
          Directory.Move(Path.Combine(FixtureBase, "personal"), Path.Combine(FixtureBase, name));
        }
      }
      return result;
    } finally { if (security.IsAllocated)`,
  )
  result = replace(
    result,
    'int rootOffset = IntPtr.Size, lengthOffset',
    `
    if (trash.StartsWith(".muse-trash-")) {
      FixtureTrash = trash;
      if (Enabled("rename")) Directory.CreateDirectory(Path.Combine(FixtureBase, trash));
    }
    int rootOffset = IntPtr.Size, lengthOffset`,
  )
  result = replace(
    result,
    'foreach (Entry entry in Entries(root)) using',
    `
    var fixtureEntries = Entries(root);
    if (Enabled("nested") && fixtureEntries.Exists(entry => entry.Name == "nested"))
      SwapFixture(Path.Combine(FixtureTrash, "nested"), Path.Combine(FixtureTrash, "saved-nested"), Enabled("nested-personal"));
    foreach (Entry entry in fixtureEntries) using`,
  )
  result = replace(
    result,
    'using (SafeFileHandle final = Open(parent, trash, true, false))',
    `
    if (Enabled("root")) {
      SwapFixture(trash, "saved-root", Enabled("root-personal"));
      if (Enabled("restore")) {
        Directory.CreateDirectory(Path.Combine(FixtureBase, FixtureName));
        File.WriteAllText(Path.Combine(FixtureBase, FixtureName, "keep"), "personal");
      }
    }
    using (SafeFileHandle final = Open(parent, trash, true, false))`,
  )
  return replace(
    result,
    'Match(Sample(final), args[6]); DisposeEntry(final);',
    `
    Match(Sample(final), args[6]);
    if (Enabled("final")) SwapFixture(trash, "saved-final", Enabled("final-populated"));
    DisposeEntry(final);`,
  )
}
