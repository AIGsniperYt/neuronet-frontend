/* ============================================================================
 * mdeditor.js — md-format as an EMBEDDABLE editor.
 * ----------------------------------------------------------------------------
 * The demo page used to own all of its runtime in index.html; this file is
 * that same machinery pulled out behind one factory so anything can host an
 * editor: the demo page, a SPA, neuronet's taskbar-driven UI, you name it.
 *
 * Usage:
 *
 *     import { createEditor } from "./mdeditor.js";
 *     const ed = createEditor(document.getElementById("app"), {
 *         value:  "# hi\n\nedit me",
 *         theme:  "green",            // "green" | "light" | "nightowl" | { --md-*: ... }
 *         toolbar: ["bold", "italic", "h1", "link"],   // or false for none
 *         onChange: md => saveToServer(md),
 *     });
 *     ed.command("bold");   // drive it from YOUR OWN toolbar
 *
 * What gets built (all under the container you hand over):
 *
 *     .mdedit
 *       .mdedit-bar        ← the optional formatting toolbar
 *         button.tbtn      ← one per tool in opts.toolbar
 *       .mdedit-cols       ← the 50/50 split
 *         .mdedit-pane     ← editor:  textarea.mdedit-editor
 *         .mdedit-divider  ← draggable splitter (changes a RATIO, not px)
 *         .mdedit-pane     ← preview: div.mdedit-scroll → div.md
 *
 * THE DESIGN RULE: the container owns its chrome. The editor does NOT draw a
 * header, a status bar or a view switcher — anyone embedding it wants their
 * own chrome (neuronet has a floating taskbar, the demo has the toolbar above
 * the split). Which is why the bare minimum is one <div> and everything else
 * is optional: `toolbar: false` and you get a clean two-pane WYSIWYG with no
 * bars at all.
 *
 * The returned object is the whole public API (see the bottom of this file
 * for the instance methods): getMarkdown / setMarkdown / focus / command /
 * setView / setOutput / setTheme / setSyncScroll / onChange / onRender /
 * destroy. It also exposes the raw DOM refs (editor, preview, panes, divider,
 * toolbarBar) so a host can style or poke at the surface without fighting the
 * API — the demo's self-test leans on exactly that.
 *
 * Style & palette live in mdeditor.css; themes are just --md-* variables.
 * ========================================================================== */

import { parse } from "./mdparser.js";
import { render } from "./renderers.js";
import { domToMarkdown } from "./domtomd.js";

/* re-export the engine — a host that buys the editor gets the whole pipeline
 * for free (render tables to html, feed the AST to a linter, …). */
export { parse, render, domToMarkdown };

/* ============================================================================
 * renderMathWithKatex(container) — the OPTIONAL maths prettifier hook.
 * ----------------------------------------------------------------------------
 * md-format parses and renders maths on its own ($x$, $$x$$): it draws
 * <span class="md-math" data-tex="…"> / <div class="md-math md-math-display">
 * with the raw tex as the visible fallback, so the maths is ALWAYS readable.
 *
 * Call this if your page has a KaTeX build loaded (window.katex): every
 * .md-math element inside `container` gets swapped to real typeset maths,
 * and the raw tex stays in data-tex for lossless round-tripping. Without
 * window.katex it is a no-op — no bundling, no dependency, nothing breaks.
 * The editor's own refresh() calls it automatically; hosts that render with
 * `render(parse(md), "html")` themselves can call it after injecting.
 * ========================================================================== */
export function renderMathWithKatex(container) {
    if (typeof window === "undefined" || !window.katex) return;
    for (const el of container.querySelectorAll(".md-math")) {
        const tex = el.getAttribute("data-tex") || el.textContent;
        try {
            window.katex.render(tex, el, {
                displayMode: el.classList.contains("md-math-display"),
                throwOnError: false,   // a bad formula keeps its raw tex
            });
        } catch (err) { /* leave the raw tex as-is */ }
    }
}

/* ============================================================================
 * THE TOOL REGISTRY — one plain list of what the toolbar can do.
 * Each tool is { id, label, title, group }: the id is (a) the data-tool
 * attribute the click handler reads and (b) what you pass to ed.command().
 * The label is innerHTML because B/italic/strike draw themselves with real
 * <b>/<i>/<s> tags — the button already looks like what it does. Tools get
 * cluster separators between groups so the bar reads bold | H1 H2 H3 | list.
 * Import MDEDITOR_TOOLS and slice it to build a custom bar, or hand a list of
 * ids straight to createEditor({ toolbar: [...] }).
 * ========================================================================== */
export const MDEDITOR_TOOLS = [
    { id: "bold", label: "<b>B</b>", title: "Bold (select text first)", group: "inline" },
    { id: "italic", label: "<i>I</i>", title: "Italic", group: "inline" },
    { id: "strike", label: "<s>S</s>", title: "Strikethrough", group: "inline" },
    { id: "code", label: "<code>&lt;/&gt;</code>", title: "Inline code", group: "inline" },
    { id: "h1", label: "H1", title: "Heading 1", group: "heading" },
    { id: "h2", label: "H2", title: "Heading 2", group: "heading" },
    { id: "h3", label: "H3", title: "Heading 3", group: "heading" },
    { id: "quote", label: "Quotation", title: "Blockquote", group: "block" },
    { id: "ul", label: "&#8226; List", title: "Bullet list", group: "block" },
    { id: "ol", label: "1. List", title: "Numbered list", group: "block" },
    { id: "task", label: "[ ] Task", title: "Task checkbox", group: "block" },
    { id: "link", label: "Link", title: "Link", group: "insert" },
    { id: "img", label: "Image", title: "Image", group: "insert" },
    { id: "codeblock", label: "<code>&lt;/&gt; block</code>", title: "Fenced code block", group: "insert" },
    { id: "hr", label: "&#8212;", title: "Horizontal rule", group: "insert" },
];

/* ============================================================================
 * THEMES — palettes as CSS-variable maps. A string name picks one of these;
 * a plain object is merged over the container's existing --md-* variables, so
 * customising is "/* --md-accent: hotpink; /" as a JS object. The default
 * green matches the project's look; nightowl is the VS Code Night Owl set
 * everyone keeps asking for. Simply add keys to MDEDITOR_THEMES to register a
 * reusable theme of your own.
 * ========================================================================== */
export const MDEDITOR_THEMES = {
    green: {
        "--md-bg": "#0b0f0c", "--md-panel": "#101612", "--md-panel2": "#151d17",
        "--md-border": "#1d2a20", "--md-text": "#e8f5ee", "--md-muted": "#7f9b8d",
        "--md-accent": "#4cff9a", "--md-accent-dim": "#2fa265",
        "--md-code-bg": "#0a0f0b", "--md-link": "#5fb8ff", "--md-strike": "#9aa",
    },
    light: {
        "--md-bg": "#f7f8f5", "--md-panel": "#ffffff", "--md-panel2": "#f0f2ec",
        "--md-border": "#d8ded2", "--md-text": "#1e2a1e", "--md-muted": "#5f7568",
        "--md-accent": "#0c8a4d", "--md-accent-dim": "#0c8a4d",
        "--md-code-bg": "#f0f2ec", "--md-link": "#0b5bb5", "--md-strike": "#6b7a6b",
    },
    nightowl: {
        "--md-bg": "#011627", "--md-panel": "#01111f", "--md-panel2": "#0a2438",
        "--md-border": "#1d3b5f", "--md-text": "#d6deeb", "--md-muted": "#637777",
        "--md-accent": "#82aaff", "--md-accent-dim": "#5b8bc4",
        "--md-code-bg": "#01111f", "--md-link": "#82aaff", "--md-strike": "#8ea3b3",
    },
};

const VIEWS = ["split", "md", "preview"];
const OUTPUTS = ["html", "htmlsrc", "text", "ansi", "markdown", "ast"];

/* tiny helper: make a div with the given class */
const div = cls => { const d = document.createElement("div"); d.className = cls; return d; };

/* ============================================================================
 * createEditor(container, opts) — THE one factory.
 * Accepts and normalises options, then assembles the DOM, wires every event
 * and boots the first render. Everything is private closure state except the
 * refs/API deliberately published on the returned object (below).
 * ========================================================================== */
export function createEditor(container, opts = {}) {
    if (!container) throw new Error("createEditor: a container element is required");
    if (!(container instanceof Element)) throw new Error("createEditor: container must be a DOM element");

    /* ---- normalise options ---------------------------------------- */
    const tabSize = Math.max(1, opts.tabSize ?? 2);
    const readonly = !!opts.readonly;
    let currentView = opts.view || "split";
    if (!VIEWS.includes(currentView)) currentView = "split";
    let currentOutput = opts.output || "html";
    if (!OUTPUTS.includes(currentOutput)) currentOutput = "html";

    /* persistence: pass `storage: false` to opt out, or a custom prefix.
     * The view mode, split ratio and theme are remembered under it. */
    const storeKey = opts.storage === false ? null : (opts.storage || "mdedit");
    const store = {
        get(k, dflt) {
            if (!storeKey) return dflt;
            try { return localStorage.getItem(storeKey + ":" + k) ?? dflt; } catch { return dflt; }
        },
        set(k, v) {
            if (!storeKey) return;
            try { localStorage.setItem(storeKey + ":" + k, String(v)); } catch { /* private mode */ }
        },
    };
    const storedView = store.get("view", currentView);
    if (VIEWS.includes(storedView)) currentView = storedView;
    const splitRatio = parseFloat(store.get("split", "0.5")) || 0.5;

    /* ---- where edits are remembered between folds ------------------ */
    const onChangeCbs = [];
    const onRenderCbs = [];
    let lastEmitted = null;

    /* ---- build the DOM under the container ------------------------- */
    container.classList.add("mdedit");
    const cols = div("mdedit-cols");
    const editorPane = div("mdedit-pane");
    const editor = document.createElement("textarea");
    editor.className = "mdedit-editor";
    editor.placeholder = "markdown";
    editor.spellcheck = false;
    editor.readOnly = readonly;
    editor.value = opts.value ?? "";
    editorPane.appendChild(editor);

    const dividerEl = div("mdedit-divider");
    const previewPane = div("mdedit-pane");
    const preview = div("mdedit-scroll");
    previewPane.appendChild(preview);
    cols.append(editorPane, dividerEl, previewPane);
    container.appendChild(cols);

    /* ---- optional toolbar ------------------------------------------ */
    let toolbarBar = null;
    const wantedTools = opts.toolbar === undefined
        ? MDEDITOR_TOOLS.map(t => t.id)
        : (opts.toolbar === false || opts.toolbar === null ? [] : opts.toolbar);
    if (wantedTools.length && !readonly) {
        toolbarBar = div("mdedit-bar");
        let lastGroup = null;
        for (const id of wantedTools) {
            const tool = MDEDITOR_TOOLS.find(t => t.id === id);
            if (!tool) continue;
            if (tool.group !== lastGroup) {
                if (lastGroup) toolbarBar.appendChild(div("sep"));
                lastGroup = tool.group;
            }
            const btn = document.createElement("button");
            btn.className = "tbtn";
            btn.dataset.tool = tool.id;
            btn.title = tool.title;
            btn.innerHTML = tool.label;
            toolbarBar.appendChild(btn);
        }
        if (toolbarBar.children.length) container.insertBefore(toolbarBar, cols);
        else toolbarBar = null;
    }

    /* the instance: public refs + API. Habit: `ed` closes over everything,
     * so handlers and the returned object always point at the same editor
     * even after setMarkdown/refresh churn. */
    const ed = {
        container, cols, editor, editorPane, preview, previewPane,
        divider: dividerEl, toolbarBar,
        syncEnabled: opts.syncScroll !== false,
        tabSize, readonly,
        focus() { (currentView === "preview" ? preview : editor).focus(); },
    };

    /* abort controller: destroy() pulls the plug on every listener at once */
    const ac = new AbortController();
    const sig = { signal: ac.signal };

    /* ====================================================================
     * RENDERING — the one refresh() every source/format/view change routes
     * through. Parses once, asks the registry for the current output type,
     * and paints the preview. WYSIWYG (editing the rendered HTML) is only
     * true in the pretty html output while not in md-only view.
     * ================================================================== */
    let wysiwyg = false;

    /* a document-induced API object for onRender() — rebuild the stats each
     * pass rather than keeping a stale counter around. */
    const currentStats = { chars: 0, blocks: 0, ms: 0, source: "", type: "html", error: null };
    function emitRender() {
        for (const cb of onRenderCbs) {
            try { cb(currentStats); } catch { /* a host callback must never
                                               * take the editor down */ }
        }
    }
    function emitChange() {
        if (editor.value === lastEmitted) return;
        lastEmitted = editor.value;
        for (const cb of onChangeCbs) {
            try { cb(editor.value); } catch { /* same rule as above */ }
        }
    }

    const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const rootForMd = () => preview.querySelector(".md") || preview;

    function refresh() {
        try {
            const src = editor.value;
            const t0 = performance.now();

            // parse once, render however the current output type says
            const ast = parse(src);
            switch (currentOutput) {
                case "html": {
                    const html = render(ast, "html");
                    preview.innerHTML = `<div class="md">${html}</div>`;
                    preview.removeAttribute("data-raw");
                    // THE WYSIWYG switch: in html mode the preview is an
                    // editing surface (unless we're in md-only view).
                    wysiwyg = currentView !== "md";
                    preview.contentEditable = wysiwyg && !readonly ? "true" : "false";
                    // typing depends on the checkbox being clickable — the
                    // renderer emits it `disabled`, undo that.
                    for (const cb of preview.querySelectorAll('input[type="checkbox"]')) {
                        cb.disabled = false;
                    }
                    // prettify maths with KaTeX, if the host loaded it
                    renderMathWithKatex(preview);
                    break;
                }
                case "htmlsrc":
                case "text":
                case "ansi":
                case "markdown": {
                    wysiwyg = false;
                    preview.contentEditable = "false";
                    let out = render(ast, currentOutput);
                    if (currentOutput === "ansi") {
                        // make the invisible ESC control-char visible, and
                        // highlight it so the codes are legible.
                        out = out.replace(/\u001b/g, "\u241B");
                        out = out.replace(/␛\[/g, "&#92;x1b[");
                    }
                    preview.innerHTML = `<pre class="source ansi">${esc(out)}</pre>`;
                    preview.setAttribute("data-raw", "1");
                    break;
                }
                case "ast": {
                    wysiwyg = false;
                    preview.contentEditable = "false";
                    preview.innerHTML = `<pre class="source">${esc(JSON.stringify(ast, null, 2))}</pre>`;
                    preview.setAttribute("data-raw", "1");
                    break;
                }
            }

            currentStats.chars = src.length;
            currentStats.blocks = ast.children.length;
            currentStats.ms = performance.now() - t0;
            currentStats.source = src;
            currentStats.type = currentOutput;
            currentStats.error = null;
            emitRender();
            emitChange();
        } catch (err) {
            // never let a parse error nuke the host page — surface it
            preview.innerHTML = `<pre class="source" style="color:#ff6b6b">${esc(String(err && err.stack || err))}</pre>`;
            currentStats.error = err;
            emitRender();
        }
    }

    /* debounced live re-render — typing stays smooth, stale nodes drop */
    let refreshTimer = null;
    function requestRefresh() {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refresh, 120);
    }
    editor.addEventListener("input", requestRefresh, sig);

    /* ====================================================================
     * VIEW MODES — split / markdown-only / preview-only.
     * The whole-view switches hide a pane; the editor stays inside lib land
     * so a host just calls ed.setView("preview") and the panes obey. The
     * last chosen view is remembered so opening back up lands where you quit.
     * ================================================================== */
    function applyView() {
        const mdOnly = currentView === "md", pvOnly = currentView === "preview";
        editorPane.classList.toggle("gone", pvOnly);
        previewPane.classList.toggle("gone", mdOnly);
        dividerEl.style.display = mdOnly || pvOnly ? "none" : "";
        if (currentView !== "md") editor.focus();
        refresh();
    }

    /* ====================================================================
     * SYNC SCROLL — mirror editor scroll onto preview (and back).
     * Both panes have their own scrollbar. Setting `to.scrollTop` fires a
     * scroll event on `to`; blindly mirroring that back would ping-pong for
     * ever. The latch swallows the one echo and expires after 150ms.
     * ================================================================== */
    let syncingFrom = null;
    let syncingTimer = null;
    function scrollSync(from, to) {
        if (!ed.syncEnabled || syncingFrom) return;
        syncingFrom = from;
        clearTimeout(syncingTimer);
        syncingTimer = setTimeout(() => (syncingFrom = null), 150);
        const travel = Math.max(1, from.scrollHeight - from.clientHeight);
        const ratio = from.scrollTop / travel;
        to.scrollTop = ratio * Math.max(0, to.scrollHeight - to.clientHeight);
    }
    editor.addEventListener("scroll", () => {
        if (syncingFrom) { syncingFrom = null; return; }   // echo of our own write
        scrollSync(editor, preview);
    }, sig);
    preview.addEventListener("scroll", () => {
        if (syncingFrom) { syncingFrom = null; return; }   // echo of our own write
        scrollSync(preview, editor);
    }, sig);

    /* Tab in the source inserts spaces instead of jumping out of the pane */
    editor.addEventListener("keydown", (e) => {
        if (e.key === "Tab") {
            e.preventDefault();
            const start = editor.selectionStart, end = editor.selectionEnd;
            editor.value = editor.value.slice(0, start) + " ".repeat(tabSize) + editor.value.slice(end);
            editor.selectionStart = editor.selectionEnd = start + tabSize;
            refresh();
        }
    }, sig);

    /* ====================================================================
     * WYSIWYG — bidirectional writing through the rendered preview.
     * The preview is contenteditable, so the user types into REAL html.
     * Each edit we: (1) capture the caret as a stable DOM PATH (a chain of
     * child-indexes down into the .md tree — never text tokens, so nothing
     * can leak into the source), (2) walk the whole preview back to markdown,
     * (3) write CLEAN markdown into the source editor, (4) re-render from
     * that clean source, (5) walk the path again in the NEW dom to park the
     * caret exactly where the user left it. The source editor is
     * authoritative: preview edits become source edits, source edits still
     * drive the preview. Both directions, permanently in sync.
     * ================================================================== */

    /* snap the caret into {path, offset, context} — path is the child-index
     * list from the .md root down to the caret text node; context is a prefix
     * of that node's text, used as a fallback anchor if the path shifts. */
    function saveCaretPath(container) {
        const sel = window.getSelection();
        if (!sel.rangeCount) return null;
        const node = sel.focusNode;
        if (!node || !container.contains(node)) return null;
        const off = sel.focusOffset;
        if (node.nodeType !== Node.TEXT_NODE) return null;   // text carets only
        const path = [];
        let n = node;
        while (n && n !== container) {
            path.unshift(Array.from(n.parentNode.childNodes).indexOf(n));
            n = n.parentNode;
        }
        if (n !== container) return null;
        return { path, off, len: node.data.length, context: node.data.slice(0, 160) };
    }

    /* walk the captured path down a FRESH dom; on shape change fall back to
     * hunting for a node whose text still contains the captured window. */
    function locateTextNode(container, path) {
        let node = container;
        for (const idx of path) {
            const kids = node.childNodes;
            if (idx < kids.length) node = kids[idx];
            else return null;
        }
        return node.nodeType === Node.TEXT_NODE ? node : null;
    }

    function restoreCaretPath(container, state) {
        if (!state) return;
        let node = locateTextNode(container, state.path);
        if (!node) {
            // structure moved under us — find the survivor whose text matches.
            // If even that is gone, give up quietly: typing continues.
            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
            let n;
            while ((n = walker.nextNode())) {
                if (state.context && n.data.startsWith(state.context.slice(0, 40))) { node = n; break; }
            }
            if (!node) return;
        }
        const off = Math.min(state.off, node.data.length);
        const range = document.createRange();
        range.setStart(node, off);
        range.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        preview.focus({ preventScroll: true });   // never yank the viewport
    }

    /* the full round trip for one preview edit */
    let wysiwygTimer = null;
    function wysiwygSync() {
        const caret = saveCaretPath(rootForMd());   // capture BEFORE serialize
        let md;
        try { md = domToMarkdown(rootForMd()); }
        catch { return; }

        if (md !== editor.value) {
            // heal any self-links a previous round trip already minted:
            // `[https://x.y](https://x.y)` → plain `https://x.y`
            md = md.replace(/\[((?:https?:\/\/|www\.)[^\s\]\\]+)\]\(\1(?:\s*"[^"]*")?\)/g, "$1");
            const keptScroll = preview.scrollTop;   // the preview is a lens:
            editor.value = md;                      // clean source, no tokens
            refresh();                              // re-render from clean source
            preview.scrollTop = Math.min(keptScroll, preview.scrollHeight - preview.clientHeight);
            restoreCaretPath(rootForMd(), caret);   // caret home
        }
        // nothing material changed → the browser's own selection IS the caret.
    }
    const scheduleWysiwyg = () => {
        clearTimeout(wysiwygTimer);
        wysiwygTimer = setTimeout(wysiwygSync, 120);
    };
    preview.addEventListener("input", () => {
        if (wysiwyg) scheduleWysiwyg();
    }, sig);

    /* a clicked task checkbox edits the DOM; fold it back too. We deliberately
     * do NOT intercept the toggle — in a contenteditable a checkbox's native
     * flip isn't reliably preventable, and fighting it double-flips. Let the
     * browser change it, then fold the now-current state via 'change'. */
    preview.addEventListener("change", (e) => {
        if (!wysiwyg) return;
        if (e.target instanceof HTMLInputElement && e.target.type === "checkbox") {
            scheduleWysiwyg();
        }
    }, sig);

    /* Cmd/Ctrl+click a link in the preview opens it rather than placing a
     * caret — a plain click still moves the caret (it's an editing surface). */
    preview.addEventListener("mousedown", (e) => {
        if (!(e.metaKey || e.ctrlKey)) return;
        if (e.target.closest("a")) e.preventDefault();
    }, sig);
    preview.addEventListener("click", (e) => {
        if (!(e.metaKey || e.ctrlKey)) return;
        const a = e.target.closest("a");
        if (!a) return;
        e.preventDefault();
        window.open(a.getAttribute("href") || a.href, "_blank", "noopener");
    }, sig);

    /* ====================================================================
     * THE FORMATTING TOOLBAR — every press edits the SOURCE.
     * The source editor is authoritative (both panes render from it), so a
     * press always rewrites editor.value and refreshes. The tricky part is
     * figuring WHERE to apply when the caret lives in the WYSIWYG preview:
     * park two private-use sentinels at the selection, serialize the DOM to
     * markdown (sentinels ride along), read their positions, strip them —
     * the md is clean and the sentinels vanish when the preview re-renders.
     * No scanner can ever collide with \uE000 / \uE002.
     * ================================================================== */
    if (toolbarBar) {
        toolbarBar.addEventListener("mousedown", (e) => e.preventDefault(), sig);   // keep focus (caret)
        toolbarBar.addEventListener("click", (e) => {
            const btn = e.target.closest(".tbtn");
            if (!btn) return;
            e.preventDefault();
            applyTool(btn.dataset.tool);
        }, sig);
    }

    /* parkSent: drop a private-use sentinel into the LIVE dom at a caret
     * edge, without disturbing the browser's own selection. Split the text
     * node at the offset so the sentinel is truly BETWEEN characters. */
    function parkSent(node, off, ch) {
        const m = document.createTextNode(ch);
        if (node.nodeType === Node.TEXT_NODE) {
            if (off > 0 && off < node.length) {
                const rest = node.splitText(off);
                node.parentNode.insertBefore(m, rest);
            } else if (off === 0) {
                node.parentNode.insertBefore(m, node);
            } else {
                node.parentNode.insertBefore(m, node.nextSibling);
            }
        } else {
            node.insertBefore(m, node.childNodes[off] || null);
        }
    }

    /* wrapInline: bold / italic / strike / inline-code share this. Wraps the
     * selection in a marker pair; pressing the SAME button again UNWRAPS it.
     * With no selection it inserts the markers with the caret parked between
     * them. Returns { text, s, e } — applyTool uses `e` to place a collapsed
     * caret (see the "don't leave a highlight" note down there). */
    function wrapInline(src, s, e, pre, post) {
        const sel = src.slice(s, e);
        if (s === e) {
            const text = src.slice(0, s) + pre + post + src.slice(e);
            const at = s + pre.length;
            return { text, s: at, e: at };
        }
        const isWrapped = src.slice(Math.max(0, s - pre.length), s) === pre &&
                          src.slice(e, e + post.length) === post;
        if (isWrapped) {
            const text = src.slice(0, s - pre.length) + sel + src.slice(e + post.length);
            return { text, s: s - pre.length, e: e - pre.length };
        }
        const text = src.slice(0, s) + pre + sel + post + src.slice(e);
        return { text, s, e: e + pre.length + post.length };
    }

    /* linePrefix: headings, quotes and lists are PREFIX markers. Toggle the
     * prefix on every line the selection touches (like wrapInline's toggle) —
     * handles multi-line selections by splitting on \n. */
    function linePrefix(text, s, e, prefix) {
        const ls = text.lastIndexOf("\n", Math.max(0, s - 1)) + 1;
        const nl = text.indexOf("\n", e);
        const le = nl < 0 ? text.length : nl;
        const out = text.slice(ls, le).split("\n")
            .map(l => l.startsWith(prefix) ? l.slice(prefix.length) : prefix + l)
            .join("\n");
        return { text: text.slice(0, ls) + out + text.slice(le), s: ls, e: ls + out.length };
    }

    /* formatText: the ONLY place a toolbar request knows markdown syntax.
     * Every case reduces to "wrap a span", "prefix some lines" or "drop a
     * block in". Returns null only when a prompt is cancelled — the caller
     * then bails without touching the source. */
    function formatText(src, s, e, tool) {
        const sel = src.slice(s, e);
        switch (tool) {
            case "bold":   return wrapInline(src, s, e, "**", "**");
            case "italic": return wrapInline(src, s, e, "*", "*");
            case "strike": return wrapInline(src, s, e, "~~", "~~");
            case "code":   return wrapInline(src, s, e, "`", "`");
            case "link": {
                const url = prompt("Link URL", "https://");
                if (!url) return null;
                const md = `[${sel || "text"}](${url})`;
                return { text: src.slice(0, s) + md + src.slice(e), s: s + md.length, e: s + md.length };
            }
            case "img": {
                const url = prompt("Image URL", "https://");
                if (!url) return null;
                const md = `![${sel || "alt"}](${url})`;
                return { text: src.slice(0, s) + md + src.slice(e), s: s + md.length, e: s + md.length };
            }
            case "h1": return linePrefix(src, s, e, "# ");
            case "h2": return linePrefix(src, s, e, "## ");
            case "h3": return linePrefix(src, s, e, "### ");
            case "quote": return linePrefix(src, s, e, "> ");
            case "ul": return linePrefix(src, s, e, "- ");
            case "ol": return linePrefix(src, s, e, "1. ");
            case "task": return linePrefix(src, s, e, "- [ ] ");
            case "codeblock": {
                const ls = src.lastIndexOf("\n", Math.max(0, s - 1)) + 1;
                const nl = src.indexOf("\n", e);
                const le = nl < 0 ? src.length : nl;
                const md = "```\n" + src.slice(ls, le) + "\n```";
                const text = src.slice(0, ls) + md + src.slice(le);
                return { text, s: ls + md.length, e: ls + md.length };
            }
            case "hr": {
                const md = "\n\n---\n\n";
                const text = src.slice(0, s) + md + src.slice(e);
                const at = s + md.length;
                return { text, s: at, e: at };
            }
        }
        return { text: src, s, e };
    }

    /* restoreByContext: put the caret back after a source rewrite. capture a
     * fingerprint (start of the caret text node + offset) BEFORE re-render;
     * afterwards glue ALL the text nodes together, find the needle in the
     * whole string, then convert that char offset back to (node, offset). A
     * bold wrap SPLITS the text across the new <strong>, so hunting one text
     * node would miss — the gluing exists for exactly that. */
    function restoreByContext(container, ctx) {
        if (!ctx) return;
        const needle = ctx.text.slice(0, 28);
        const parts = [];
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) parts.push({ n, t: n.data });
        if (!parts.length) return;
        const joined = parts.map(p => p.t).join("");
        const i = joined.indexOf(needle);
        if (i < 0) return;                 // page changed too hard — let it be
        let pos = Math.min(i + ctx.off, joined.length - 1);
        let acc = 0, k = 0;
        while (k < parts.length && acc + parts[k].t.length <= pos) { acc += parts[k].t.length; k++; }
        const node = parts[Math.min(k, parts.length - 1)].n;
        const o = Math.min(pos - acc, node.data.length);
        const range = document.createRange();
        range.setStart(node, o); range.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(range);
    }

    /* applyTool: the one shared entry point for every toolbar request, and
     * the backing of ed.command(). KNOWING WHERE THE EDIT MEANS is the hard
     * part: if the caret lives in the live preview we park sentinels at the
     * selection, fold the DOM to markdown and let the markdown OFFSETS
     * describe the region — the DOM and source never share coordinates, so
     * the sentinels are the only bridge. If the caret is in the textarea we
     * use selectionStart/End directly. */
    function applyTool(tool) {
        const caretInPreview = wysiwyg && preview.contains(document.activeElement);
        let src, s, e, ctx = null;
        if (caretInPreview) {
            const sel = window.getSelection();
            if (!sel.rangeCount) return;
            const r = sel.getRangeAt(0);
            if (!rootForMd().contains(r.startContainer)) return;
            if (sel.focusNode && sel.focusNode.nodeType === Node.TEXT_NODE) {
                // grab a fingerprint BEFORE we nuke the dom re-rendering
                ctx = { text: sel.focusNode.data.slice(0, 140), off: sel.focusOffset };
            }
            parkSent(r.startContainer, r.startOffset, "\uE000");
            parkSent(r.endContainer, r.endOffset, "\uE002");
            const md = domToMarkdown(rootForMd());
            let a = md.indexOf("\uE000");
            let b = md.indexOf("\uE002");
            src = md.replace(/[\uE000\uE002]/g, "");
            if (a < 0) a = 0;
            if (b < 0) b = src.length;
            if (a > b) { const t = a; a = b; b = t; }   // backwards selection
            // a and b point AT the sentinel positions in `md`. The opening
            // sentinel is where the selection starts, but the CLOSING one sits
            // immediately AFTER it — so the real end in the stripped source is
            // b - 1. Get this wrong and every wrap eats one extra character.
            s = a;
            e = Math.max(a, b - 1);
        } else {
            src = editor.value;
            s = editor.selectionStart ?? 0;
            e = editor.selectionEnd ?? 0;
            ctx = { text: src.slice(Math.max(0, s - 70), s + 70), off: 70 };
        }
        const out = formatText(src, s, e, tool);
        if (!out) return;   // user cancelled a prompt
        editor.value = out.text;
        if (caretInPreview) {
            refresh();
            preview.focus({ preventScroll: true });
            restoreByContext(rootForMd(), ctx);
        } else {
            editor.focus();
            // collapse the caret to the END of the formatted span: re-selecting
            // would leave a highlight and the next keystroke would REPLACE it,
            // nuking the format and the original text. A collapsed caret lets
            // typing continue straight after, nothing to overwrite.
            const at = Math.min(out.e, out.text.length);
            editor.setSelectionRange(at, at);
            refresh();
        }
    }

    /* ====================================================================
     * THE DRAGGABLE SPLITTER — changes a RATIO, never an absolute size.
     * flex-basis% is relative, so after a window resize the split keeps its
     * proportion — the panes are a lens, not bolted to the window.
     * ================================================================== */
    let ratio = splitRatio;
    const applySplit = () => { editorPane.style.flex = `0 0 ${(ratio * 100).toFixed(1)}%`; };
    let dragging = false;
    dividerEl.addEventListener("mousedown", () => { dragging = true; dividerEl.classList.add("dragging"); }, sig);
    window.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const rect = cols.getBoundingClientRect();
        ratio = Math.min(0.85, Math.max(0.15, (e.clientX - rect.left) / rect.width));
        applySplit();
    }, sig);
    window.addEventListener("mouseup", () => {
        if (!dragging) return;
        dragging = false;
        dividerEl.classList.remove("dragging");
        store.set("split", String(ratio));
    }, sig);

    /* ====================================================================
     * THE PUBLIC API.
     * ================================================================== */
    ed.setView = (v) => {
        if (!VIEWS.includes(v)) return ed;
        currentView = v;
        store.set("view", v);
        applyView();
        return ed;
    };
    ed.getView = () => currentView;
    ed.setOutput = (o) => {
        if (!OUTPUTS.includes(o)) return ed;
        currentOutput = o;
        refresh();
        return ed;
    };
    ed.getOutput = () => currentOutput;
    ed.setTheme = (theme) => {
        let palette = null;
        let name = typeof theme === "string" ? theme : "";
        if (typeof theme === "string" && MDEDITOR_THEMES[theme]) palette = MDEDITOR_THEMES[theme];
        else if (typeof theme === "object" && theme) { palette = theme; name = ""; }
        container.dataset.theme = name;
        if (palette) for (const [k, v] of Object.entries(palette)) container.style.setProperty(k, v);
        store.set("theme", name);
        return ed;
    };
    ed.setSyncScroll = (on) => { ed.syncEnabled = !!on; return ed; };
    ed.command = (tool) => { applyTool(tool); return ed; };
    ed.onChange = (cb) => { onChangeCbs.push(cb); return () => onChangeCbs.splice(onChangeCbs.indexOf(cb), 1); };
    ed.onRender = (cb) => { onRenderCbs.push(cb); return () => onRenderCbs.splice(onRenderCbs.indexOf(cb), 1); };
    ed.setMarkdown = (md) => { editor.value = md; refresh(); return ed; };
    ed.getMarkdown = () => editor.value;
    ed.getTheme = () => container.dataset.theme || (readonly ? "green" : "green");
    ed.resize = () => { applySplit(); };
    ed.destroy = () => {
        ac.abort();
        clearTimeout(refreshTimer);
        clearTimeout(wysiwygTimer);
        clearTimeout(syncingTimer);
        container.replaceChildren();
        container.classList.remove("mdedit");
    };

    /* ---- boot ------------------------------------------------------ */
    // an object palette wins over anything stored; otherwise restore the
    // remembered theme (the very first visit falls back to the option).
    const initialTheme = typeof opts.theme === "object" && opts.theme
        ? opts.theme
        : store.get("theme", opts.theme || "green");
    ed.setTheme(initialTheme);
    applySplit();     // restore the saved split ratio
    lastEmitted = editor.value;
    applyView();      // boots the stored view mode AND does the first render
    return ed;
}