"""Katalogeintrag (TypeScript) aus einem geladenen Hugging-Face-Snapshot erzeugen: alle Dateien mit Größe und SHA-256,
große Dateien (LFS) gegen die Prüfsumme der Hugging-Face-API abgeglichen. Aufruf:
  python3 -I scripts/catalog-entry.py <ordner> <repo> <revision>
Gibt die `files: [...]`-Zeilen aus; Abweichungen zur API → Abbruch."""
import hashlib
import json
import os
import sys
import urllib.request

folder, repo, rev = sys.argv[1:4]
api = json.load(urllib.request.urlopen(f"https://huggingface.co/api/models/{repo}/tree/{rev}?recursive=true"))
lfs = {e["path"]: e["lfs"]["oid"] for e in api if e.get("type") == "file" and e.get("lfs")}
remote = {e["path"]: e["size"] for e in api if e.get("type") == "file"}
rows = []
for root, dirs, files in os.walk(folder):
    dirs[:] = [d for d in dirs if not d.startswith(".")]
    for f in sorted(files):
        if f.startswith("."):
            continue
        p = os.path.join(root, f)
        rel = os.path.relpath(p, folder)
        if rel not in remote:
            continue
        h = hashlib.sha256()
        with open(p, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 22), b""):
                h.update(chunk)
        sha, size = h.hexdigest(), os.path.getsize(p)
        if size != remote[rel] or (rel in lfs and lfs[rel] != sha):
            sys.exit(f"ABWEICHUNG {rel}: lokal {size}/{sha[:12]} remote {remote[rel]}/{lfs.get(rel, '-')[:12]}")
        rows.append((rel, size, sha))
missing = sorted(set(remote) - {r[0] for r in rows} - {".gitattributes"})
if missing:
    sys.exit(f"FEHLT lokal: {missing}")
for rel, size, sha in sorted(rows):
    print(f"      {{ url: `${{HF}}/{repo}/resolve/{rev}/{rel}`, name: '{rel}', size: {size}, sha256: '{sha}' }},")
print(f"// {len(rows)} Dateien, {sum(r[1] for r in rows) / 1e9:.2f} GB, LFS-Prüfsummen: {sum(1 for r in rows if r[0] in lfs)} abgeglichen", file=sys.stderr)
