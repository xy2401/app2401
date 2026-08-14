# Fish command knowledge source

`fish-shell/` is a shallow submodule of the official Fish repository. The metadata builder reads
`share/completions/*.fish` as text and extracts static `complete` declarations.

The parser never invokes Fish, completion functions, command substitutions, or external commands.
Expressions containing variables or command substitutions are retained as source text and marked dynamic.
