"""Compact UI JSON whitespace and recompress every VSIX member atomically.

Every compressible member is rewritten with Zopfli's strongest deflate
(the standard deflate stream every unzip and VS Code's installer read,
about 1.2% smaller than zlib level 9 here), written with correct CRC and
sizes; members that are already brotli (``*.br``) gain nothing from
deflate and are stored instead. The Python ``zipfile`` module cannot take
a pre-compressed stream, so entries are written directly (local headers,
central directory, end record), preserving each entry's order, name
bytes, times, permissions, extras, comments and the archive comment.
``test/unit/vsixCompression.test.mjs`` asserts that metadata, the CRC of
the result and the stored-vs-deflated split.
"""
import binascii
import json
import os
import struct
import sys
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile

try:
    import zopfli.zlib
except ImportError:
    sys.stderr.write(
        "VSIX compression requires the pinned zopfli package "
        "(.github/vsix-compress/requirements.txt): pip install -r "
        ".github/vsix-compress/requirements.txt; refusing to fall back "
        "to zlib level 9.\n"
    )
    raise SystemExit(2)

# The lead's measured setting: zopfli's strongest iteration count.
ZOPFLI_NUMITERATIONS = 15
# Already-compressed members: recompressing them as deflate only costs a
# few hundred bytes, so they are stored.
STORED_SUFFIXES = (".br",)

source = Path(sys.argv[1])
layout = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))


def raw_deflate(content):
    """Zopfli's deflate stream for content, without the zlib wrapper."""
    return zopfli.zlib.compress(content, numiterations=ZOPFLI_NUMITERATIONS)[2:-4]


def dos_datetime(entry):
    year, month, day, hour, minute, second = entry.date_time
    return ((hour << 11) | (minute << 5) | (second // 2), ((year - 1980) << 9) | (month << 5) | day)


def pack_member(entry, content):
    """The member's (method, payload): stored brotli, else Zopfli deflate."""
    if entry.filename.endswith("/"):
        return ZIP_STORED, b""
    if entry.filename.endswith(STORED_SUFFIXES):
        return ZIP_STORED, content
    return ZIP_DEFLATED, raw_deflate(content)


with tempfile.NamedTemporaryFile(dir=source.parent, suffix=".vsix", delete=False) as held:
    destination = Path(held.name)
try:
    with ZipFile(source) as original, open(destination, "wb") as out:
        comment = original.comment
        records = []
        for entry in original.infolist():
            if entry.flag_bits & 0x01:
                raise ValueError(f"Encrypted VSIX member is not supported: {entry.filename}")
            if entry.flag_bits & 0x08:
                raise ValueError(f"VSIX member with a data descriptor is not supported: {entry.filename}")
            content = original.read(entry)
            is_ui_json = (
                entry.filename.startswith("extension/l10n/ui.")
                or entry.filename.startswith("extension/package.nls.")
            ) and entry.filename.endswith(".json")
            if is_ui_json:
                table = json.loads(content)
                if entry.filename.startswith("extension/l10n/ui.") and table.get("format") != 1:
                    values = []
                    for keys in layout:
                        value = table
                        for key in keys:
                            value = value[key]
                        values.append(value)
                    table = {"format": 1, "values": values}
                content = (json.dumps(table, ensure_ascii=False, separators=(",", ":")) + "\n").encode(
                    "utf-8"
                )
            method, payload = pack_member(entry, content)
            crc = binascii.crc32(content) & 0xFFFFFFFF
            if len(content) > 0xFFFFFFFF or len(payload) > 0xFFFFFFFF:
                raise ValueError(f"VSIX member is too large for a plain entry: {entry.filename}")
            name = entry.filename.encode("utf-8" if entry.flag_bits & 0x800 else "cp437")
            extra = entry.extra
            time, date = dos_datetime(entry)
            version = 20 if method == ZIP_DEFLATED else entry.extract_version
            header_offset = out.tell()
            out.write(
                struct.pack(
                    "<4sHHHHHIIIHH",
                    b"PK\x03\x04",
                    version,
                    entry.flag_bits,
                    method,
                    time,
                    date,
                    crc,
                    len(payload),
                    len(content),
                    len(name),
                    len(extra),
                )
            )
            out.write(name)
            out.write(extra)
            out.write(payload)
            records.append(
                (
                    entry,
                    method,
                    crc,
                    len(payload),
                    len(content),
                    name,
                    extra,
                    header_offset,
                )
            )
        central_offset = out.tell()
        central_size = 0
        for entry, method, crc, compressed, uncompressed, name, extra, header_offset in records:
            time, date = dos_datetime(entry)
            version = 20 if method == ZIP_DEFLATED else entry.extract_version
            record = struct.pack(
                "<4sHHHHHHIIIHHHHHII",
                b"PK\x01\x02",
                (entry.create_system << 8) | entry.create_version,
                version,
                entry.flag_bits,
                method,
                time,
                date,
                crc,
                compressed,
                uncompressed,
                len(name),
                len(extra),
                len(entry.comment),
                0,
                entry.internal_attr,
                entry.external_attr,
                header_offset,
            )
            out.write(record)
            out.write(name)
            out.write(extra)
            out.write(entry.comment)
            central_size += len(record) + len(name) + len(extra) + len(entry.comment)
        out.write(
            struct.pack(
                "<4sHHHHIIH",
                b"PK\x05\x06",
                0,
                0,
                len(records),
                len(records),
                central_size,
                central_offset,
                len(comment),
            )
        )
        out.write(comment)
    with ZipFile(destination) as checked:
        if checked.testzip() is not None:
            raise ValueError("Recompressed VSIX failed its CRC check")
    os.replace(destination, source)
    print(f"VSIX maximum compression: {source.stat().st_size} bytes")
finally:
    destination.unlink(missing_ok=True)
