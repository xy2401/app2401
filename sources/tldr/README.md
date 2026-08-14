# TLDR command examples source

`tldr/` is a shallow submodule of the TLDR Pages repository. The metadata builder reads the English
`pages/` tree and every `pages.<locale>/` translation tree as complete page variants.

Commands are retained as text with TLDR placeholders such as `{{path/to/file}}`. The builder never
executes examples. This checkout uses Git sparse checkout so command pages are materialized while
unrelated project assets are not.

After a fresh submodule initialization, materialize all command page trees with:

```sh
git -C sources/tldr/tldr sparse-checkout set --no-cone /pages/ /pages.*/
```
