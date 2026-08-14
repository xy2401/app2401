#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DISTRO=""
OUTPUT=""
FIXTURE=""
GENERATED_AT="${GENERATED_AT:-$(date -u +%Y-%m-%dT%H:%M:%S.000Z)}"

while (($#)); do
  case "$1" in
    --distro) DISTRO="$2"; shift 2 ;;
    --output) OUTPUT="$2"; shift 2 ;;
    --fixture) FIXTURE="$2"; shift 2 ;;
    --strict) shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$DISTRO" || -z "$OUTPUT" ]]; then
  echo "Usage: collect-distro-catalog.sh --distro <id> --output <file> [--fixture <raw-directory>] [--strict]" >&2
  exit 2
fi

readarray -t SOURCE < <(node -e 'const c=require(process.argv[1]);const d=c.distributions.find(x=>x.id===process.argv[2]);if(!d)process.exit(2);console.log(d.image);console.log(d.family)' "$PROJECT_ROOT/data/distribution-sources.json" "$DISTRO")
if ((${#SOURCE[@]} != 2)); then echo "Unsupported distribution: $DISTRO" >&2; exit 2; fi
IMAGE="${SOURCE[0]}"
FAMILY="${SOURCE[1]}"

if [[ -n "$FIXTURE" ]]; then
  node "$SCRIPT_DIR/normalize-distro.mjs" --distro "$DISTRO" --raw-dir "$FIXTURE" --output "$OUTPUT" --generated-at "$GENERATED_AT"
  exit
fi

command -v docker >/dev/null || { echo "Docker is required" >&2; exit 1; }
RAW_DIR="$(mktemp -d)"
cleanup() { rm -rf -- "$RAW_DIR"; }
trap cleanup EXIT

docker pull --platform linux/amd64 "$IMAGE" >/dev/null
DIGEST="$(docker image inspect "$IMAGE" --format '{{index .RepoDigests 0}}' 2>/dev/null || true)"

case "$FAMILY:$DISTRO" in
  debian:*)
    mkdir -p "$RAW_DIR/export"
    docker run --rm --platform linux/amd64 -v "$RAW_DIR/export:/out" "$IMAGE" sh -lc '
      set -eu
      apt-get update -qq
      apt-cache dumpavail > /out/packages.txt
      apt-get indextargets --format "\$(IDENTIFIER)\t\$(SITE)\t\$(RELEASE)" | sort -u > /out/repositories.tsv
      cp /etc/os-release /out/os-release
      chmod -R a+rwx /out
    '
    cp -R "$RAW_DIR/export/." "$RAW_DIR/"
    ;;
  rpm:fedora|rpm:rocky-9)
    mkdir -p "$RAW_DIR/export"
    docker run --rm --platform linux/amd64 -v "$RAW_DIR/export:/out" "$IMAGE" bash -lc '
      set -euo pipefail
      dnf -q makecache --refresh
      dnf -q group list --hidden >/dev/null || true
      python3 - <<'"'"'PY'"'"' > /out/packages.jsonl
import dnf
import json

base = dnf.Base()
base.read_all_repos()
base.fill_sack(load_system_repo=False)

def values(value):
    return sorted({str(item) for item in (value or [])})

for package in base.sack.query().available():
    print(json.dumps({
        "name": package.name,
        "epoch": str(package.epoch or ""),
        "version": package.version or "",
        "release": package.release or "",
        "architecture": package.arch or "",
        "summary": package.summary or "",
        "description": package.description or "",
        "homepage": package.url or "",
        "license": package.license or "",
        "repository": package.reponame or "",
        "downloadSize": int(package.downloadsize or 0),
        "sourcePackage": package.sourcerpm or "",
        "requires": values(package.requires),
        "recommends": values(package.recommends),
        "suggests": values(package.suggests),
        "provides": values(package.provides),
        "conflicts": values(package.conflicts),
        "replaces": values(package.obsoletes),
    }, ensure_ascii=False, separators=(",", ":")))
PY
      dnf -q repolist -v | awk -F":" "/^Repo-id|^Repo-name|^Repo-baseurl/{sub(/^[[:space:]]+/, \"\", \$2); printf \"%s%s\", \$2, (++n % 3 ? \"\\t\" : \"\\n\")}" > /out/repositories.tsv || true
      cp /etc/os-release /out/os-release
      i=0
      while IFS= read -r file; do
        if [[ "$file" == *.gz ]]; then gzip -dc "$file" > "/out/comps-$i.xml"; elif [[ "$file" == *.xz ]]; then xz -dc "$file" > "/out/comps-$i.xml"; else cp "$file" "/out/comps-$i.xml"; fi
        i=$((i + 1))
      done < <(find /var/cache/dnf -type f \( -iname "*comps*.xml" -o -iname "*comps*.xml.gz" -o -iname "*comps*.xml.xz" \) 2>/dev/null)
      chmod -R a+rwx /out
    '
    cp -R "$RAW_DIR/export/." "$RAW_DIR/"
    ;;
  arch:arch)
    docker run --rm --platform linux/amd64 "$IMAGE" bash -lc 'pacman -Sy --noconfirm --needed expac >/dev/null; expac -S "%n\t%v\t%a\t%d\t%u\t%L\t%r\t%m\t%k\t%D\t%O\t%P\t%C\t%R"' > "$RAW_DIR/packages.tsv"
    docker run --rm --platform linux/amd64 "$IMAGE" sh -lc 'cat /etc/os-release' > "$RAW_DIR/os-release"
    printf 'official\tOfficial enabled repositories\n' > "$RAW_DIR/repositories.tsv"
    ;;
  alpine:alpine)
    mkdir -p "$RAW_DIR/export"
    docker run --rm --platform linux/amd64 -v "$RAW_DIR/export:/out" "$IMAGE" sh -lc '
      set -eu
      mkdir -p /tmp/apkcache
      apk update --cache-dir /tmp/apkcache >/dev/null
      for file in /tmp/apkcache/APKINDEX.*.tar.gz; do tar -xzOf "$file" APKINDEX; printf "\n"; done > /out/packages.txt
      awk '"'"'{print "repo-" NR "\t" $0 "\t" $0}'"'"' /etc/apk/repositories > /out/repositories.tsv
      cp /etc/os-release /out/os-release
      chmod -R a+rwx /out
    '
    cp -R "$RAW_DIR/export/." "$RAW_DIR/"
    ;;
  rpm:opensuse-leap)
    docker run --rm --platform linux/amd64 "$IMAGE" sh -lc 'zypper --gpg-auto-import-keys --non-interactive refresh >/dev/null; zypper --xmlout --non-interactive search -s -t package' > "$RAW_DIR/packages.xml"
    docker run --rm --platform linux/amd64 "$IMAGE" sh -lc 'cat /etc/os-release' > "$RAW_DIR/os-release"
    printf 'official\tOfficial enabled repositories\n' > "$RAW_DIR/repositories.tsv"
    ;;
  *) echo "No collector for $DISTRO" >&2; exit 2 ;;
esac

node -e 'const fs=require("fs");const path=process.argv[1];const value={generatedAt:process.argv[2],digest:process.argv[3]||"unknown"};fs.writeFileSync(path,JSON.stringify(value,null,2)+"\n",{encoding:"utf8"})' "$RAW_DIR/meta.json" "$GENERATED_AT" "$DIGEST"
node "$SCRIPT_DIR/normalize-distro.mjs" --distro "$DISTRO" --raw-dir "$RAW_DIR" --output "$OUTPUT" --generated-at "$GENERATED_AT"
