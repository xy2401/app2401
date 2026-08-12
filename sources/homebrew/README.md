# Homebrew source

This source uses Homebrew's official JSON API rather than cloning the large formula and
cask Git repositories.

| Dataset | URL | Local cache |
| --- | --- | --- |
| Formulae | `https://formulae.brew.sh/api/formula.json` | `api/formula.json` |
| Casks | `https://formulae.brew.sh/api/cask.json` | `api/cask.json` |

Run `scripts/sync-homebrew.ps1` from any directory to refresh both files. The raw JSON
cache is ignored by Git because it can be downloaded again. `snapshot.json` is tracked
and records provenance, counts, sizes, and hashes for the current local snapshot.
