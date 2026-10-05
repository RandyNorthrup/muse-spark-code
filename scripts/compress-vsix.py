"""Recompress the locally produced VSIX without changing its entries."""
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
            compressed.writestr(
                entry, original.read(entry), compress_type=ZIP_DEFLATED, compresslevel=9
            )
    with ZipFile(destination) as checked:
        if checked.testzip() is not None:
            raise ValueError("Recompressed VSIX failed its CRC check")
    os.replace(destination, source)
    print(f"VSIX maximum compression: {source.stat().st_size} bytes")
finally:
    destination.unlink(missing_ok=True)
