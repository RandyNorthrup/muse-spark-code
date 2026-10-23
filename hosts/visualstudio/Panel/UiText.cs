using System;
using System.Globalization;
using System.IO;
using Newtonsoft.Json.Linq;
using MuseSpark.VisualStudio.Protocol;

namespace MuseSpark.VisualStudio.Panel
{
  public sealed class UiText
  {
    public string Locale { get; }
    private readonly JObject manifest;
    private readonly JObject table;
    public string this[string key] => table.Value<string>(key) ?? throw new InvalidOperationException("MHP_UI_TEXT_MISSING");
    public string Manifest(string key) => manifest.Value<string>(key) ?? throw new InvalidOperationException("MHP_MANIFEST_TEXT_MISSING");

    public UiText(string assetRoot)
    {
      var language = CultureInfo.CurrentUICulture.Name;
      var locale = language.ToLowerInvariant();
      if (!File.Exists(Path.Combine(assetRoot, "l10n", "ui." + locale + ".json"))) locale = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName;
      if (!File.Exists(Path.Combine(assetRoot, "l10n", "ui." + locale + ".json"))) locale = "en";
      Locale = locale;
      table = SchemaContract.ParseObject(File.ReadAllText(Path.Combine(assetRoot, "l10n", "ui." + locale + ".json")));
      manifest = SchemaContract.ParseObject(File.ReadAllText(Path.Combine(assetRoot, "l10n", "package.nls." + locale + ".json")));
    }
  }
}
