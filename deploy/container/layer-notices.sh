#!/bin/sh
set -eu
notices=/opt/muse/image-notices
mkdir -p "$notices/debian"
# Debian's machine-readable inventory identifies the exact source package
# versions for operators obtaining GPL sources from Debian's snapshot archive.
dpkg-query -W -f='${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\n' > "$notices/debian-packages.tsv"
while IFS="$(printf '\t')" read -r package _version _source _source_version; do
  package=${package%:*}
  test -s "/usr/share/doc/$package/copyright"
  cp -L "/usr/share/doc/$package/copyright" "$notices/debian/$package.copyright"
done < "$notices/debian-packages.tsv"
cp /opt/muse/THIRD_PARTY_NOTICES.txt "$notices/runtime.txt"
cp /usr/local/LICENSE "$notices/node.txt"
