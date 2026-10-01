"""Read-only diagnostics for the one stopped engineering staging backup."""
import json
from pathlib import Path
import socket
import sys

if socket.gethostname() != "crm-staging":
    sys.exit("HOST_MISMATCH")
root = Path("/var/lib/pero-engineering-qa/4e9bb6ea-3b58-43a1-a573-fda7710f5c0b")
if root.is_symlink() or root.resolve() != root:
    sys.exit("PATH_MISMATCH")
for file in sorted(root.glob("psql-*-diagnostic.json")):
    print(file.name, file.read_text())
for file in sorted(root.glob("psql-*-stderr.bin")):
    text = file.read_text(errors="replace")
    print(json.dumps({"file": file.name, "stderr": text[:2000]}))
print(json.dumps({"files": [{"name": f.name, "bytes": f.stat().st_size} for f in root.iterdir() if f.is_file()]}))
