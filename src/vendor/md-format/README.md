md-format editor, vendored.

Upstream: https://github.com/AIGsniperYt/md-format (tools/md-format in the
website monorepo). This folder is a snapshot copied here so the app works
fully offline with no build step or network fetch.

The five files are self-contained ESM with only relative imports between
them - no bundler required. Public surface used by this app:

  createEditor(container, opts)         build an editor; returns an instance
    opts: { value, theme, toolbar, storage, syncScroll, readonly, tabSize }
    instance: setMarkdown / getMarkdown / setView("md"|"preview"|"split")
              / command(toolId) / onChange(cb) / onRender(cb) / focus / destroy
  parse(text) -> AST          (mdparser.js)
  render(ast, type) -> html|text|ansi|markdown   (renderers.js)
  domToMarkdown(element) -> markdown     (domtomd.js)
  renderMathWithKatex(container)          maths prettifier: no-op unless
                                          window.katex is loaded — call after
                                          injecting rendered html

To refresh a newer version: copy mdparser.js, renderers.js, domtomd.js,
mdeditor.js, mdeditor.css from tools/md-format/ over this folder, then
re-verify with:  node --check src/vendor/md-format/*.js