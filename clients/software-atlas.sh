#!/usr/bin/env bash
set -euo pipefail

command_name="inventory"
output="inventory.json"
site_url="${SOFTWARE_ATLAS_URL:-http://127.0.0.1:4173}"
max_url_length=16000
no_open=0
fixture=""

if [[ $# -gt 0 && "$1" != --* ]]; then command_name="$1"; shift; fi
if [[ "$command_name" != "inventory" ]]; then echo "仅支持 inventory 命令。" >&2; exit 2; fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    --site-url) site_url="$2"; shift 2 ;;
    --max-url-length) max_url_length="$2"; shift 2 ;;
    --no-open) no_open=1; shift ;;
    --fixture) fixture="$2"; shift 2 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

json_escape() {
  local value="$1"
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//$'\n'/\\n}
  value=${value//$'\r'/\\r}
  value=${value//$'\t'/\\t}
  printf '%s' "$value"
}

normalize_arch() {
  case "$(uname -m 2>/dev/null || printf unknown)" in
    x86_64|amd64) printf amd64 ;;
    arm64|aarch64) printf arm64 ;;
    i386|i686) printf x86 ;;
    *) uname -m 2>/dev/null || printf unknown ;;
  esac
}

packages=()
add_brew_packages() {
  local collection="$1" line name version escaped_name escaped_version
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    name=${line%% *}
    version=${line#"$name"}
    version=${version# }
    escaped_name=$(json_escape "$name")
    escaped_version=$(json_escape "$version")
    packages+=("homebrew|$collection|$escaped_name|$escaped_version")
  done < <(brew list "--$collection" --versions 2>/dev/null | LC_ALL=C sort || true)
}

target_dir=$(dirname "$output")
mkdir -p "$target_dir"
if [[ -n "$fixture" ]]; then
  cp "$fixture" "$output"
  compact=$(tr -d '\r\n' < "$output")
  package_count=$(grep -c '"manager"' "$output" || true)
else
  if command -v brew >/dev/null 2>&1; then
    add_brew_packages formula
    add_brew_packages cask
  else
    echo "警告：没有找到 Homebrew，将生成空清单。" >&2
  fi
  case "$(uname -s 2>/dev/null || true)" in
    Darwin) system_os=macos ;;
    Linux) system_os=linux ;;
    *) system_os=unknown ;;
  esac
  system_arch=$(normalize_arch)
  generated_at=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
  {
    printf '{\n  "schemaVersion": "1.0.0",\n  "generatedAt": "%s",\n' "$generated_at"
    printf '  "system": {\n    "os": "%s",\n    "arch": "%s"\n  },\n' "$system_os" "$system_arch"
    printf '  "packages": ['
    if [[ ${#packages[@]} -gt 0 ]]; then printf '\n'; fi
    index=0
    for record in "${packages[@]}"; do
      IFS='|' read -r manager collection name version <<< "$record"
      [[ $index -gt 0 ]] && printf ',\n'
      printf '    {\n      "manager": "%s",\n      "collection": "%s",\n      "name": "%s",\n      "version": "%s",\n      "scope": "user"\n    }' "$manager" "$collection" "$name" "$version"
      index=$((index + 1))
    done
    if [[ ${#packages[@]} -gt 0 ]]; then printf '\n  ]\n}\n'; else printf ']\n}\n'; fi
  } > "$output"
  compact='{"schemaVersion":"1.0.0","generatedAt":"'"$generated_at"'","system":{"os":"'"$system_os"'","arch":"'"$system_arch"'"},"packages":['
  index=0
  for record in "${packages[@]}"; do
    IFS='|' read -r manager collection name version <<< "$record"
    [[ $index -gt 0 ]] && compact+=','
    compact+='{'
    compact+='"manager":"'"$manager"'","collection":"'"$collection"'","name":"'"$name"'","version":"'"$version"'","scope":"user"}'
    index=$((index + 1))
  done
  compact+=']}'
  package_count=${#packages[@]}
fi

payload=$(printf '%s' "$compact" | base64 | tr -d '\r\n=' | tr '+/' '-_')
fragment="#inventory=v1.base64.$payload"
site_url=${site_url%/}
inventory_url="$site_url/inventory$fragment"
open_url="$inventory_url"
if [[ ${#inventory_url} -gt $max_url_length ]]; then
  open_url="$site_url/inventory"
  echo "警告：清单 URL 为 ${#inventory_url} 个字符，超过 $max_url_length；已回退到文件导入页面。" >&2
else
  echo "清单已放入本地 URL Fragment（${#inventory_url} 个字符）。"
fi

if command -v realpath >/dev/null 2>&1; then absolute_output=$(realpath "$output"); else absolute_output="$(cd "$(dirname "$output")" && pwd)/$(basename "$output")"; fi
echo "已生成清单：$absolute_output"
echo "共发现 $package_count 个软件包。"
echo "也可以打开网站后选择或拖入该 JSON 文件。"
if [[ $no_open -eq 0 ]]; then
  if command -v open >/dev/null 2>&1; then open "$open_url"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$open_url"
  else echo "无法自动打开浏览器：$open_url" >&2
  fi
fi
