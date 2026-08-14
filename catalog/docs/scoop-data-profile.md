# Scoop data profile

Snapshot date: 2026-08-12

## Coverage

| Bucket | Manifests |
| --- | ---: |
| extras | 2,364 |
| main | 1,627 |
| versions | 595 |
| games | 417 |
| php | 391 |
| nerd-fonts | 367 |
| java | 336 |
| nirsoft | 291 |
| nonportable | 132 |
| sysinternals | 75 |
| **Total** | **6,595** |

All 6,595 manifest files parsed as valid JSON. They represent 6,590 unique package
names; five names occur in two buckets.

## Top-level field coverage

| Field | Count | Coverage |
| --- | ---: | ---: |
| `version`, `homepage`, `license` | 6,595 | 100.0% |
| `description` | 6,180 | 93.7% |
| `autoupdate` | 5,690 | 86.3% |
| `checkver` | 5,667 | 85.9% |
| `architecture` | 4,524 | 68.6% |
| `bin` | 4,230 | 64.1% |
| `shortcuts` | 2,791 | 42.3% |
| `persist` | 1,979 | 30.0% |
| `notes` | 1,118 | 17.0% |
| `pre_install` | 1,093 | 16.6% |
| `env_set` | 981 | 14.9% |
| `post_install` | 902 | 13.7% |
| `installer` | 865 | 13.1% |
| `uninstaller` | 709 | 10.8% |
| `env_add_path` | 566 | 8.6% |
| `depends` | 161 | 2.4% |

Downloads and hashes may be defined at the top level or inside an architecture branch.
After resolving both locations, all 6,595 manifests have a download URL and 6,543
have a hash. Architecture branches found in the snapshot are `64bit` (4,520), `32bit`
(2,027), and `arm64` (977).

## Parser implications

- Preserve the source bucket and manifest path as package identity and provenance.
- Treat package name as non-unique across buckets. Five current collisions are `steam`,
  `dolphin`, `mednafen`, `nircmd`, and `flux`.
- Resolve architecture overrides on top of common fields instead of flattening the raw
  manifest destructively.
- Accept Scoop's scalar-or-array forms for fields such as `url`, `hash`, `bin`,
  `persist`, `notes`, `depends`, and install scripts.
- Keep executable commands (`bin`) separate from GUI shortcuts (`shortcuts`). Together,
  they occur in 5,206 manifests.
- Store scripts and installer/uninstaller declarations explicitly. Some form of custom
  install or uninstall logic occurs in 2,621 manifests and cannot be represented as
  simple file metadata.
- Preserve `checkver` and `autoupdate` as raw source metadata even if version freshness
  is not a product goal; these fields often reveal upstream release and download rules.
