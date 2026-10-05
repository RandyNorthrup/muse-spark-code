"""Compact UI JSON whitespace and recompress every VSIX asset atomically."""
import json
import os
import sys
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

source = Path(sys.argv[1])
with tempfile.NamedTemporaryFile(dir=source.parent, suffix=".vsix", delete=False) as held:
    destination = Path(held.name)
try:
    with ZipFile(source) as original, ZipFile(
        destination, "w", compression=ZIP_DEFLATED, compresslevel=9
    ) as compressed:
        compressed.comment = original.comment
        for entry in original.infolist():
            content = original.read(entry)
            is_ui_json = (
                entry.filename.startswith("extension/l10n/ui.")
                or entry.filename.startswith("extension/package.nls.")
            ) and entry.filename.endswith(".json")
            if is_ui_json:
                content = (json.dumps(
                    json.loads(content), ensure_ascii=False, separators=(",", ":")
                ) + "\n").encode("utf-8")
            compressed.writestr(
                entry, content, compress_type=ZIP_DEFLATED, compresslevel=9
            )
    with ZipFile(destination) as checked:
        if checked.testzip() is not None:
            raise ValueError("Recompressed VSIX failed its CRC check")
    os.replace(destination, source)
    print(f"VSIX maximum compression: {source.stat().st_size} bytes")
finally:
    destination.unlink(missing_ok=True)
