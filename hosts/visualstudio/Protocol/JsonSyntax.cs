using System;
using System.Text.RegularExpressions;

namespace MuseSpark.VisualStudio.Protocol
{
  // Json.NET accepts comments, single quotes and trailing commas. MHP uses JSON.
  internal sealed class JsonSyntax
  {
    private static readonly Regex Number = new Regex(@"\G-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?", RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1));
    private readonly string source;
    private int offset;
    private JsonSyntax(string source) { this.source = source; }
    internal static void Validate(string source)
    {
      var reader = new JsonSyntax(source);
      reader.Value(0); reader.Space();
      if (reader.offset != source.Length) throw Invalid();
    }
    private void Value(int depth)
    {
      if (depth > SchemaContract.MaximumJsonDepth) throw Invalid();
      Space();
      if (offset >= source.Length) throw Invalid();
      var character = source[offset];
      if (character == '{') Object(depth + 1);
      else if (character == '[') Array(depth + 1);
      else if (character == '"') String();
      else if (character == 't') Literal("true");
      else if (character == 'f') Literal("false");
      else if (character == 'n') Literal("null");
      else
      {
        var match = Number.Match(source, offset);
        if (!match.Success || match.Index != offset) throw Invalid();
        offset += match.Length;
      }
    }
    private void Object(int depth)
    {
      offset++; Space(); if (Take('}')) return;
      do
      {
        Space(); String(); Space(); if (!Take(':')) throw Invalid();
        Value(depth); Space(); if (Take('}')) return;
        if (!Take(',')) throw Invalid();
      } while (offset < source.Length);
      throw Invalid();
    }
    private void Array(int depth)
    {
      offset++; Space(); if (Take(']')) return;
      do
      {
        Value(depth); Space(); if (Take(']')) return;
        if (!Take(',')) throw Invalid();
      } while (offset < source.Length);
      throw Invalid();
    }
    private void String()
    {
      if (!Take('"')) throw Invalid();
      while (offset < source.Length)
      {
        var character = source[offset++];
        if (character == '"') return;
        if (character < ' ') throw Invalid();
        if (char.IsHighSurrogate(character)) { if (offset >= source.Length || !char.IsLowSurrogate(source[offset++])) throw Invalid(); }
        else if (char.IsLowSurrogate(character)) throw Invalid();
        if (character != '\\') continue;
        if (offset >= source.Length) throw Invalid();
        var escape = source[offset++];
        if (escape == 'u')
        {
          var unicode = UnicodeEscape();
          if (char.IsHighSurrogate(unicode))
          {
            if (!Take('\\') || !Take('u') || !char.IsLowSurrogate(UnicodeEscape())) throw Invalid();
          }
          else if (char.IsLowSurrogate(unicode)) throw Invalid();
        }
        else if ("\"\\/bfnrt".IndexOf(escape) < 0) throw Invalid();
      }
      throw Invalid();
    }
    private char UnicodeEscape()
    {
      const int HexDigits = 4;
      const int HexRadix = 16;
      var value = 0;
      for (var digit = 0; digit < HexDigits; digit++)
      {
        if (offset >= source.Length || !Uri.IsHexDigit(source[offset])) throw Invalid();
        value = value * HexRadix + Uri.FromHex(source[offset++]);
      }
      return Convert.ToChar(value);
    }
    private bool Take(char expected)
    {
      if (offset >= source.Length || source[offset] != expected) return false;
      offset++; return true;
    }
    private void Literal(string value)
    {
      if (source.Length - offset < value.Length || string.CompareOrdinal(source, offset, value, 0, value.Length) != 0) throw Invalid();
      offset += value.Length;
    }
    private void Space() { while (offset < source.Length && " \t\r\n".IndexOf(source[offset]) >= 0) offset++; }
    private static MhpException Invalid() => new MhpException("parseError", "MHP_PARSE_ERROR");
  }
}
