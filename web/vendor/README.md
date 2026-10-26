# Vendored libraries

The web notebook ships its editor with it, so the page needs no network
and runs no script from another host.

## Vditor 4.0.1

- Source: the `vditor@4.0.1` package on npm (`npm pack vditor@4.0.1`), MIT
  licensed (`vditor/LICENSE`).
- Only what the notebook uses is kept from `dist/`: `index.min.js`,
  `index.css`, the Lute parser (`js/lute`), the English strings
  (`js/i18n/en_US.js`), the Ant icons (`js/icons/ant.js`), highlight.js
  for code blocks, KaTeX for math (woff2 fonts only), mermaid for
  diagrams, the content themes and the emoji images. Other diagram kinds
  (echarts, graphviz, markmap, abcjs, flowchart, plantuml, wavedrom,
  smiles) and MathJax are left out; such a block shows as code.
- `web/app.js` points Vditor here with `cdn: '/vendor/vditor'`.

To update: `npm pack vditor@<version>` in an empty folder, unpack it, copy
the same files over `web/vendor/vditor/`, and change the version here and
in this folder's paths if the layout moved.
