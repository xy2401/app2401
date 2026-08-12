# Chocolatey source

`community-packages` is a shallow submodule of the packages maintained by the
Chocolatey Community Maintainers team:

`https://github.com/chocolatey-community/chocolatey-packages`

This is intentionally treated as a curated source rather than a complete mirror of the
Chocolatey Community Repository. Package metadata is primarily stored in `.nuspec`
files, while installation behavior is commonly implemented in PowerShell scripts under
each package's `tools` directory.

The submodule commit is the snapshot identifier. Monthly synchronization uses the same
`git submodule update --remote --depth 1` command as the Scoop buckets.
