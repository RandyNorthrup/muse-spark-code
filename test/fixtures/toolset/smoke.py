"""Runs inside the toolset image only, as its default unprivileged UID."""
import hashlib
import json
import os
import pathlib
import subprocess
import tempfile

assert os.getuid() == 10001
root = pathlib.Path('/usr/local/share/muse-toolset')
manifest = json.loads((root / 'base.json').read_text())
versions = {}
for tool in manifest['tools']:
    result = subprocess.run([tool['command'], *tool['args']], capture_output=True, text=True, check=True)
    versions[tool['name']] = (result.stdout or result.stderr).splitlines()[0]
for file in [pathlib.Path('/usr/local/bin/node'), pathlib.Path('/usr/local/bin/uv'), pathlib.Path('/usr/local/bin/gitleaks'), root / 'base.json', root / 'first-party-skills/muse_gadgets/SKILL.md']:
    assert file.stat().st_uid == 0, file
    assert file.stat().st_mode & 0o022 == 0, file
    assert not os.access(file, os.W_OK), file
vendor = root / 'vendor/high-quality-projects-skill'
record = json.loads((vendor / 'VENDOR.json').read_text())
for file in record['files']:
    assert hashlib.sha256((vendor / file['path']).read_bytes()).hexdigest() == file['sha256']
assert (root / 'first-party-skills/muse_gadgets/SKILL.md').is_file()
with tempfile.TemporaryDirectory(prefix='b0-toolset-') as name:
    scratch = pathlib.Path(name)
    source = scratch / 'main.c'
    source.write_text('int main(void) { return 0; }\n')
    for compiler in ['gcc', 'clang']:
        binary = scratch / compiler
        subprocess.run([compiler, '-Wall', '-Werror', str(source), '-o', str(binary)], check=True)
        subprocess.run([str(binary)], check=True)
    (scratch / 'CMakeLists.txt').write_text('cmake_minimum_required(VERSION 3.25)\nproject(B0 C)\nadd_executable(smoke main.c)\n')
    subprocess.run(['cmake', '-S', name, '-B', str(scratch / 'build')], capture_output=True, check=True)
    subprocess.run(['cmake', '--build', str(scratch / 'build')], capture_output=True, check=True)
    subprocess.run([str(scratch / 'build/smoke')], check=True)
    subprocess.run(['uv', '--cache-dir', str(scratch / 'uv-cache'), 'venv', '--no-python-downloads', '--python', '/usr/bin/python3', str(scratch / 'venv')], capture_output=True, check=True)
    subprocess.run([str(scratch / 'venv/bin/python'), '-c', 'import json; assert json.loads("[1]") == [1]'], check=True)
    repository = scratch / 'repo'
    subprocess.run(['git', 'init', str(repository)], capture_output=True, check=True)
    subprocess.run(['git', '-C', str(repository), 'status', '--porcelain'], capture_output=True, check=True)
print(json.dumps({'uid': os.getuid(), 'versions': versions, 'vendorTag': record['tag'], 'vendorFiles': len(record['files']), 'compilers': ['gcc', 'clang', 'cmake'], 'uvVenv': True, 'gitLocal': True, 'protectedInstalledFiles': True}, indent=2))
