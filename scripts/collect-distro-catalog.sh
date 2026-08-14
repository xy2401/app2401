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

readarray -t SOURCE < <(node -e 'const c=require(process.argv[1]);const d=c.distributions.find(x=>x.slug===process.argv[2]||x.id===process.argv[2]);if(!d)process.exit(2);console.log(d.id);console.log(d.image);console.log(d.family)' "$PROJECT_ROOT/data/distribution-sources.json" "$DISTRO")
if ((${#SOURCE[@]} != 3)); then echo "Unsupported distribution: $DISTRO" >&2; exit 2; fi
SOURCE_ID="${SOURCE[0]}"
IMAGE="${SOURCE[1]}"
FAMILY="${SOURCE[2]}"

if [[ -n "$FIXTURE" ]]; then
  node "$SCRIPT_DIR/normalize-distro.mjs" --distro "$SOURCE_ID" --raw-dir "$FIXTURE" --output "$OUTPUT" --generated-at "$GENERATED_AT"
  exit
fi

command -v docker >/dev/null || { echo "Docker is required" >&2; exit 1; }
RAW_DIR="$(mktemp -d)"
cleanup() { rm -rf -- "$RAW_DIR"; }
trap cleanup EXIT

docker pull --platform linux/amd64 "$IMAGE" >/dev/null
DIGEST="$(docker image inspect "$IMAGE" --format '{{index .RepoDigests 0}}' 2>/dev/null || true)"

case "$FAMILY:$SOURCE_ID" in
  debian:*)
    mkdir -p "$RAW_DIR/export"
    docker run --rm --platform linux/amd64 -v "$RAW_DIR/export:/out" "$IMAGE" sh -lc '
      set -eu
      apt-get update -qq
      apt-cache dumpavail > /out/packages.txt
      apt-get indextargets --format "\$(IDENTIFIER)\t\$(SITE)\t\$(RELEASE)" | sort -u > /out/repositories.tsv
      if apt-get install -y -qq --no-install-recommends tasksel >/dev/null 2>&1; then
        tasksel --list-tasks 2>/dev/null | while read -r state id description; do
          [ -n "$id" ] || continue
          packages="$(tasksel --task-packages "$id" 2>/dev/null | paste -sd, - || true)"
          description="$(printf "%s" "$description" | tr "\t" " ")"
          printf "%s\t%s\t%s\n" "$id" "$description" "$packages"
        done > /out/tasks.tsv
      else
        : > /out/tasks.tsv
      fi
      cp /etc/os-release /out/os-release
      chmod -R a+rwx /out
    '
    cp -R "$RAW_DIR/export/." "$RAW_DIR/"
    ;;
  rpm:fedora|rpm:rocky-9)
    mkdir -p "$RAW_DIR/export"
    docker run --rm --platform linux/amd64 -v "$RAW_DIR/export:/out" "$IMAGE" bash -lc '
      set -euo pipefail
      if command -v dnf5 >/dev/null; then DNF=dnf5; elif command -v dnf >/dev/null; then DNF=dnf; else echo "Neither dnf5 nor dnf is installed" >&2; exit 127; fi
      echo "Using $DNF for repository metadata" >&2
      if [[ "$DNF" == dnf ]] && ! "$DNF" -q repoquery --help >/dev/null 2>&1; then "$DNF" -y install dnf-plugins-core >/dev/null; fi
      "$DNF" -q makecache --refresh
      "$DNF" -q group list --hidden >/dev/null || true
      if ! command -v zstd >/dev/null && ! command -v unzstd >/dev/null; then "$DNF" -y install zstd >/dev/null 2>&1 || true; fi
      unit_separator=$'"'"'\x1f'"'"'
      record_separator=$'"'"'\x1e'"'"'
      query_format="%{name}${unit_separator}%{epoch}${unit_separator}%{version}${unit_separator}%{release}${unit_separator}%{arch}${unit_separator}%{summary}${unit_separator}%{description}${unit_separator}%{url}${unit_separator}%{license}${unit_separator}%{repoid}${unit_separator}%{downloadsize}${unit_separator}%{installsize}${unit_separator}%{sourcerpm}${unit_separator}%{requires}${unit_separator}%{recommends}${unit_separator}%{suggests}${unit_separator}%{provides}${unit_separator}%{conflicts}${unit_separator}%{obsoletes}${record_separator}"
      "$DNF" -q repoquery --available --queryformat "$query_format" > /out/packages.records
      if [[ "$DNF" == dnf5 ]]; then
        "$DNF" repo info --json > /out/repositories.json
      else
        "$DNF" -q repolist -v | awk -F":" "/^Repo-id|^Repo-name|^Repo-baseurl/{sub(/^[[:space:]]+/, \"\", \$2); printf \"%s%s\", \$2, (++n % 3 ? \"\\t\" : \"\\n\")}" > /out/repositories.tsv || true
      fi
      cp /etc/os-release /out/os-release
      i=0
      while IFS= read -r file; do
        if [[ "$file" == *.gz ]]; then gzip -dc "$file" > "/out/comps-$i.xml"; elif [[ "$file" == *.xz ]]; then xz -dc "$file" > "/out/comps-$i.xml"; elif [[ "$file" == *.zst ]]; then if command -v zstd >/dev/null; then zstd -qdc "$file" > "/out/comps-$i.xml"; elif command -v unzstd >/dev/null; then unzstd -c "$file" > "/out/comps-$i.xml"; else continue; fi; elif [[ "$file" == *.zck ]]; then if command -v unzck >/dev/null; then unzck -c "$file" > "/out/comps-$i.xml"; else continue; fi; else cp "$file" "/out/comps-$i.xml"; fi
        i=$((i + 1))
      done < <(find /var/cache -type f \( -iname "*comps*.xml" -o -iname "*comps*.xml.gz" -o -iname "*comps*.xml.xz" -o -iname "*comps*.xml.zst" -o -iname "*comps*.xml.zck" \) 2>/dev/null)
      chmod -R a+rwx /out
    '
    cp -R "$RAW_DIR/export/." "$RAW_DIR/"
    ;;
  arch:arch)
    docker run --rm --platform linux/amd64 "$IMAGE" bash -lc 'pacman -Sy --noconfirm --needed expac >/dev/null; expac -S "%n\t%v\t%a\t%d\t%u\t%L\t%r\t%m\t%k\t%D\t%O\t%P\t%C\t%R"' > "$RAW_DIR/packages.tsv"
    docker run --rm --platform linux/amd64 "$IMAGE" bash -lc 'pacman -Sy >/dev/null; pacman -Sg | awk "{print \$1 \"\\t\" \$2}" | sort -u' > "$RAW_DIR/groups.tsv"
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
    docker run --rm --platform linux/amd64 "$IMAGE" sh -lc 'zypper --gpg-auto-import-keys --non-interactive refresh >/dev/null; zypper --xmlout --non-interactive search -s -t pattern' > "$RAW_DIR/patterns.xml"
    docker run --rm --platform linux/amd64 "$IMAGE" sh -lc 'cat /etc/os-release' > "$RAW_DIR/os-release"
    printf 'official\tOfficial enabled repositories\n' > "$RAW_DIR/repositories.tsv"
    ;;
  *) echo "No collector for $DISTRO" >&2; exit 2 ;;
esac

node -e 'const fs=require("fs");const path=process.argv[1];const value={generatedAt:process.argv[2],digest:process.argv[3]||"unknown"};fs.writeFileSync(path,JSON.stringify(value,null,2)+"\n",{encoding:"utf8"})' "$RAW_DIR/meta.json" "$GENERATED_AT" "$DIGEST"
node "$SCRIPT_DIR/normalize-distro.mjs" --distro "$SOURCE_ID" --raw-dir "$RAW_DIR" --output "$OUTPUT" --generated-at "$GENERATED_AT"
