import * as XLSX from "../vendor/xlsx/index.js";
import { extractPdfLayoutLines, parsePdfBoundaries } from "./pdfBoundaries.js";

export function initScraperTool(deps, context = {}) {
  const { escapeHtml } = deps;
  const $ = (id) => document.getElementById(id);

  const el = {
    status: $("scraperStatus"),
    log: $("scraperLog"),
    fetchBtn: $("scraperFetchBtn"),
    scanBtn: $("scraperScanBtn"),
    result: $("scraperResult"),
    version: $("scraperVersion"),
    boardSelect: $("scraperBoard"),
    qualSelect: $("scraperQual"),
    seriesSelect: $("scraperSeries"),
    subjectInput: $("scraperSubjectInput"),
    suggestions: $("scraperSuggestions")
  };

  let subjects = [];
  let activeSuggestionIndex = -1;

  // ---------- qualification registry (shared across boards) ----------
  const QR = {
    gcse: { id: "gcse", name: "GCSE" },
    aLevel: { id: "aLevel", name: "A-level" },
    as: { id: "as", name: "AS" }
  };

  // ---------- AQA qualification / series registry ----------
  // AQA publishes xlsx workbooks. Legacy filestore URL pattern is predictable;
  // Nov 2024+ files moved behind hashed URLs that must be discovered from the
  // public grade-boundaries pages (Sanity JSON with title+url per file).
  const AQA_QUALIFICATIONS = {
    gcse: {
      id: "gcse", name: "GCSE",
      sheets: ["GCSE", "GCSE subject", "GCSE Subject"],
      grades: [9, 8, 7, 6, 5, 4, 3, 2, 1],
      filePrefix: "AQA-GCSE-GDE-BDY"
    },
    aLevel: {
      id: "aLevel", name: "A-level",
      sheets: ["A level subject"],
      grades: ["A*", "A", "B", "C", "D", "E"],
      filePrefix: "AQA-A-LEVEL-GDE-BDY"
    },
    as: {
      id: "as", name: "AS",
      sheets: ["AS subject"],
      grades: ["A", "B", "C", "D", "E"],
      filePrefix: "AQA-AS-GDE-BDY"
    }
  };

  const AQA_SERIES = [
    // Older series (pre-2022) were published as PDFs, not xlsx. Summer 2020 had
    // no exams (COVID) and 2021 was teacher-assessed, so only resit series exist
    // for those two years. 2018+ only, as we target current-gen 9-1 students.
    { month: "JUN", year: 2018, label: "June 2018", format: "pdf" },
    { month: "NOV", year: 2018, label: "November 2018", format: "pdf" },
    { month: "JUN", year: 2019, label: "June 2019", format: "pdf" },
    { month: "NOV", year: 2019, label: "November 2019", format: "pdf" },
    { month: "NOV", year: 2020, label: "November 2020", format: "pdf" },
    { month: "NOV", year: 2021, label: "November 2021", format: "pdf" },
    { month: "JUN", year: 2022, label: "June 2022", format: "xlsx" },
    { month: "NOV", year: 2022, label: "November 2022", format: "xlsx" },
    { month: "JUN", year: 2023, label: "June 2023", format: "xlsx" },
    { month: "NOV", year: 2023, label: "November 2023", format: "xlsx" },
    { month: "JUN", year: 2024, label: "June 2024", format: "xlsx" },
    { month: "NOV", year: 2024, label: "November 2024", format: "xlsx" },
    { month: "JUN", year: 2025, label: "June 2025", format: "xlsx" },
    { month: "NOV", year: 2025, label: "November 2025", format: "xlsx" },
    { month: "JUN", year: 2026, label: "June 2026", format: "xlsx" }
  ];
  const AQA_FILE_BASE = "https://filestore.aqa.org.uk/over/stat_pdf";
  const AQA_PAGE_BASE = "https://www.aqa.org.uk/exams-administration/results-days/grade-boundaries";
  const AQA_PAGE_ARCHIVE = `${AQA_PAGE_BASE}/archive`;
  const AQA_MONTHS = [
    ["January", "JAN"], ["February", "FEB"], ["March", "MAR"], ["April", "APR"],
    ["May", "MAY"], ["June", "JUN"], ["July", "JUL"], ["August", "AUG"],
    ["September", "SEP"], ["October", "OCT"], ["November", "NOV"], ["December", "DEC"]
  ];

  // Per-board discovered files: key `${seriesKey}:${qualId}` -> full file url.
  const discoveredAqa = new Map();

  // Legacy AQA series have different file naming conventions per qual + format.
  // Map seriesKey -> per-qual { qualPrefix, format }. Older PDFs use qual-specific
  // prefixes (GCSE-RF for reformed 9-1, A-LEVEL-RL / AS-RL for reformed linear),
  // while 2022+ use the unified GDE-BDY XLSX pattern.
  const AQA_LEGACY_PREFIX = {
    "JUN-2018": { gcse: "AQA-GCSE-RF-GDE-BDY", aLevel: "AQA-A-LEVEL-RL-GDE-BDY", as: "AQA-AS-RL-GDE-BDY" },
    "NOV-2018": { gcse: "AQA-GCSE-GDE-BDY", aLevel: "AQA-A-LEVEL-GDE-BDY", as: "AQA-AS-GDE-BDY" },
    "JUN-2019": { gcse: "AQA-GCSE-GDE-BDY", aLevel: "AQA-A-LEVEL-RL-GDE-BDY", as: "AQA-AS-RL-GDE-BDY" },
    "NOV-2019": { gcse: "AQA-GCSE-GDE-BDY", aLevel: "AQA-A-LEVEL-GDE-BDY", as: "AQA-AS-GDE-BDY" },
    "NOV-2020": { gcse: "AQA-GCSE-GDE-BDY", aLevel: "AQA-A-LEVEL-RL-GDE-BDY", as: "AQA-AS-RL-GDE-BDY" },
    "NOV-2021": { gcse: "AQA-GCSE-2-GDE-BDY", aLevel: "AQA-A-LEVEL-GDE-BDY", as: "AQA-AS-GDE-BDY" }
  };

  // ---------- OCR registry ----------
  // OCR publishes one PDF per qualification family per series (e.g.
  // "gcse-grade-boundaries-june-2026.pdf", "as-and-a-level-..."). Filenames
  // carry unpredictable numeric ids (/Images/<id>-...pdf) so the series list is
  // built by scraping the index + archive pages, which contain every series.
  const OCR_PAGE_BASE = "https://www.ocr.org.uk/administration/grade-boundaries/index.aspx";
  const OCR_PAGE_ARCHIVE = "https://www.ocr.org.uk/administration/grade-boundaries/grade-boundaries-archive/grade-boundaries-archive.aspx";
  const OCR_QUAL_PATTERNS = {
    gcse: /gcse-grade-boundaries-/,
    aLevel: /as-and-a-level-grade-boundaries-|a-level-grade-boundaries-/,
    as: /as-and-a-level-grade-boundaries-|a-level-grade-boundaries-/
  };
  const discoveredOcr = new Map();

  // ---------- Pearson / Edexcel registry ----------
  // Pearson publishes PDFs under predictable DAM paths plus a current-series
  // page (grade-boundaries.html) that embeds a hidden-asset list. Older series
  // follow a stable filename pattern (like AQA's legacy filestore): the same
  // path with a different month/year. We combine both: current from the page,
  // historical from the verified pattern.
  const PEARSON_PAGE = "https://qualifications.pearson.com/en/support/support-topics/results-certification/grade-boundaries.html";
  const PEARSON_DAM = "https://qualifications.pearson.com/content/dam/pdf/Support/Grade-boundaries";
  const PEARSON_BASELINE = [
    { month: "JUN", year: 2023, label: "June 2023" },
    { month: "JUN", year: 2024, label: "June 2024" },
    { month: "NOV", year: 2024, label: "November 2024" },
    { month: "JUN", year: 2025, label: "June 2025" },
    { month: "NOV", year: 2025, label: "November 2025" }
  ];
  const discoveredPearson = new Map();

  // ---------- isolated boundary cache ----------
  // Grade boundaries are a self-contained reference lookup and MUST NEVER enter
  // the user's mindmap graph or JSON export. They live only here under their
  // own localStorage key. Exam data changes on results days (roughly Jan/Aug),
  // so we refresh only when a new series appears or the cache is older than the
  // results-day window (60 days) — never on a daily cadence.
  const CACHE_KEY = "neuronet:gradeBoundaries";
  const RESULTS_WINDOW_MS = 60 * 24 * 60 * 60 * 1000; // ~60 days
  let boundaryCache = loadBoundaryCache();

  function loadBoundaryCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return { version: 1, entries: {} };
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : { version: 1, entries: {} };
    } catch {
      return { version: 1, entries: {} };
    }
  }

  function saveBoundaryCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(boundaryCache));
    } catch {
      /* storage full/unavailable — degrade to no-cache */
    }
  }

  function cacheKeyFor(board, series, qual) {
    return `${board}:${seriesKey(series)}:${qual.id}`;
  }

  function getCachedSubjects(board, series, qual) {
    const entry = boundaryCache.entries[cacheKeyFor(board, series, qual)];
    if (!entry) return null;
    // Stale if fetched too long ago (results-day window elapsed since).
    if (Date.now() - (entry.fetchedAt || 0) > RESULTS_WINDOW_MS) return null;
    return entry.subjects;
  }

  function setCachedSubjects(board, series, qual, subjects) {
    boundaryCache.entries[cacheKeyFor(board, series, qual)] = {
      series: { month: series.month, year: series.year, label: series.label },
      qual: qual.id,
      board,
      fetchedAt: Date.now(),
      subjects
    };
    saveBoundaryCache();
  }

  function seriesKey(series) {
    return `${series.month}-${series.year}`;
  }

  function monthAbbrevToFull(abbrev) {
    const m = AQA_MONTHS.find(([, abb]) => abb === abbrev);
    return m ? m[0] : abbrev;
  }

  function monthAbbrevToSlug(abbrev) {
    return monthAbbrevToFull(abbrev).toLowerCase();
  }

  // ---------- persisted selection ----------
  // Remember the last board/qual/series the user picked so the tool opens the
  // way they left it. Kept in its own small key, separate from user graph data.
  const PREFS_KEY = "neuronet:scraperPrefs";
  const statePrefs = (() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  })();

  function savePrefs(patch) {
    Object.assign(statePrefs, patch);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(statePrefs));
    } catch {
      /* non-fatal */
    }
  }

  function restorePrefs() {
    if (el.boardSelect && statePrefs.board && [...el.boardSelect.options].some((o) => o.value === statePrefs.board)) {
      el.boardSelect.value = statePrefs.board;
    }
    refreshPickers();
    if (el.qualSelect && statePrefs.qual && [...el.qualSelect.options].some((o) => o.value === statePrefs.qual)) {
      el.qualSelect.value = statePrefs.qual;
    }
    if (el.seriesSelect && statePrefs.series && [...el.seriesSelect.options].some((o) => o.value === statePrefs.series)) {
      el.seriesSelect.value = statePrefs.series;
    }
  }

  // ---------- proxy ----------
  // Exam board file stores block browser cross-origin fetches via CORS, so we
  // route requests through a server-side proxy that adds permissive CORS.
  function proxyUrl(real) {
    const base = (typeof window !== "undefined" && window.__NEURONET_PROXY_BASE) ||
      document.querySelector('meta[name="neuronet-proxy"]')?.getAttribute("content") ||
      "https://neuronet-backend.onrender.com";
    const sep = base.endsWith("/") ? "" : "/";
    return `${base}${sep}api/proxy?url=${encodeURIComponent(real)}`;
  }

  // ---------- series list building ----------
  function buildSeriesListFor(board, baseline, discovered) {
    const byKey = new Map();
    for (const s of baseline) byKey.set(seriesKey(s), { ...s });
    for (const key of discovered.keys()) {
      const sk = key.split(":")[0];
      const [mAbbrev, yearStr] = sk.split("-");
      const year = Number(yearStr);
      if (!byKey.has(sk)) {
        byKey.set(sk, { month: mAbbrev, year, label: `${monthAbbrevToFull(mAbbrev)} ${year}` });
      }
    }
    return [...byKey.values()].sort((a, b) =>
      b.year - a.year ||
      AQA_MONTHS.findIndex(([, mb]) => mb === b.month) - AQA_MONTHS.findIndex(([, mb]) => mb === a.month)
    );
  }

  // ---------- AQA discovery ----------
  // Scrape the current + archive pages for the Sanity JSON: each hashed xlsx
  // carries "title":"<Qual> - Grade boundaries <Month> <Year>" + a "url".
  async function discoverAqaSeries() {
    const found = [];
    const pages = [proxyUrl(AQA_PAGE_ARCHIVE), proxyUrl(AQA_PAGE_BASE)];
    for (const page of pages) {
      let text;
      try {
        const res = await fetch(page);
        if (!res.ok) continue;
        text = await res.text();
      } catch {
        continue;
      }
      found.push(...extractGradeBoundaryPairs(text));
      // The archive page also lists legacy (2018-2021) PDF files in <li> anchors.
      parseAqaArchiveAnchors(text);
    }
    for (const { url, title } of found) {
      const parsed = parseBoundaryTitle(title);
      if (!parsed) continue;
      discoveredAqa.set(`${seriesKey(parsed.series)}:${parsed.qualId}`, { url, format: "xlsx" });
    }
    return found.length;
  }

  // Reads the archive page's <li> anchor list for the real (non-hashed) legacy
  // file URLs and their format (.PDF / .XLS / .XLSX). This fills in the older
  // series (2018-2021) that are published as PDFs and don't appear in the
  // Sanity JSON of the current pages. Returns { anchors, kept }.
  function parseAqaArchiveAnchors(html) {
    const liRe = /<li[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/li>/gi;
    let m;
    // Extract both the label text and the href; then map by filename prefix.
    const anchors = [];
    while ((m = liRe.exec(html)) !== null) {
      anchors.push({ href: m[1], label: m[2].replace(/<[^>]+>/g, "").trim() });
    }
    let kept = 0;
    for (const { href, label } of anchors) {
      const fileName = href.split("/").pop();
      const extMatch = fileName.match(/\.(PDF|XLSX|XLS)$/i);
      if (!extMatch) continue;
      const format = extMatch[1].toLowerCase() === "pdf" ? "pdf" : "xlsx";
      const series = parseAqaSeriesFromFilename(fileName);
      if (!series) continue;
      // We target current-gen (9-1) students; ignore pre-2018 legacy specs.
      if (series.year < 2018) continue;
      const qualId = qualFromAqaFile(fileName) || qualFromAqaLabel(label);
      if (!qualId) continue;
      const key = `${seriesKey(series)}:${qualId}`;
      if (!discoveredAqa.has(key)) kept++;
      discoveredAqa.set(key, { url: href, format });
    }
    return { anchors: anchors.length, kept };
  }

  // Extracts { month, year, label } from a legacy AQA filename like
  // "AQA-GCSE-GDE-BDY-NOV-2019.PDF" or "AQA-A-LEVEL-RL-GDE-BDY-JUN-2018.PDF".
  function parseAqaSeriesFromFilename(fileName) {
    const m = fileName.match(/-((?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(?:UARY|E|Y|EMBER)?)-(20\d\d)\./i);
    if (!m) return null;
    const raw = m[1].toUpperCase();
    const map = {
      JANUARY: "JAN", FEBRUARY: "FEB", MARCH: "MAR", APRIL: "APR", MAY: "MAY",
      JUNE: "JUN", JULY: "JUL", AUGUST: "AUG", SEPTEMBER: "SEP",
      OCTOBER: "OCT", NOVEMBER: "NOV", DECEMBER: "DEC"
    };
    const month = map[raw] || raw.slice(0, 3);
    if (!["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"].includes(month)) return null;
    const year = Number(m[2]);
    const fullMonth = { JAN: "January", FEB: "February", MAR: "March", APR: "April", MAY: "May", JUN: "June", JUL: "July", AUG: "August", SEP: "September", OCT: "October", NOV: "November", DEC: "December" }[month];
    return { month, year, label: `${fullMonth} ${year}`, format: "pdf" };
  }

  function qualFromAqaFile(fileName) {
    if (/GCSE/.test(fileName)) return "gcse";
    if (/A-LEVEL/.test(fileName) || /A-LEVEL-UM/.test(fileName)) return "aLevel";
    if (/\bAS\b/.test(fileName)) return "as";
    return null;
  }

  function qualFromAqaLabel(label) {
    if (/^GCSE\b/.test(label)) return "gcse";
    if (/^A-level/.test(label)) return "aLevel";
    if (/^AS\b/.test(label)) return "as";
    return null;
  }

  function extractGradeBoundaryPairs(html) {
    const escaped = /\\"url\\":\\"(https:\/\/cdn\.sanity\.io\/files\/[^\\"]+?\.xlsx)\\"[\s\S]*?\\"title\\":\\"([^\\"]+?)\\"/g;
    const plain = /"url":"(https:\/\/cdn\.sanity\.io\/files\/[^"]+?\.xlsx)"[\s\S]*?"title":"([^"]+?)"/g;
    const out = [];
    for (const re of [escaped, plain]) {
      let m;
      while ((m = re.exec(html)) !== null) out.push({ url: m[1], title: m[2] });
      if (out.length > 0) break;
    }
    return out;
  }

  function parseBoundaryTitle(title) {
    const m = title.match(/(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})/);
    if (!m) return null;
    const month = AQA_MONTHS.find(([full]) => full === m[1]);
    const series = { month: month[1], year: Number(m[2]), label: `${m[1]} ${m[2]}` };
    let qualId = null;
    if (/\bGCSE\b/.test(title)) qualId = "gcse";
    else if (/A-level/.test(title)) qualId = "aLevel";
    else if (/\bAS\b/.test(title)) qualId = "as";
    return qualId ? { qualId, series } : null;
  }

  function legacyAqaSeriesUrl(qual, series) {
    // Pre-2022 series used qual-specific PDF prefixes; 2022+ use XLSX.
    const legacy = AQA_LEGACY_PREFIX[seriesKey(series)];
    if (legacy && legacy[qual.id]) {
      return `${AQA_FILE_BASE}/${legacy[qual.id]}-${series.month}-${series.year}.PDF`;
    }
    const ext = series.format === "pdf" ? ".XLS" : ".XLSX";
    return `${AQA_FILE_BASE}/${qual.filePrefix}-${series.month}-${series.year}${ext}`;
  }

  function aqaSeriesFormat(qual, series) {
    return (discoveredAqa.get(`${seriesKey(series)}:${qual.id}`)?.format) || series.format || "xlsx";
  }

  function aqaSeriesUrl(qual, series) {
    return discoveredAqa.get(`${seriesKey(series)}:${qual.id}`)?.url || legacyAqaSeriesUrl(qual, series);
  }

  // ---------- OCR discovery ----------
  // OCR index + archive pages list every series' PDFs as
  //   <a href="/Images/<id>-gcse-grade-boundaries-june-2026.pdf">...
  async function discoverOcrSeries() {
    const found = [];
    for (const page of [proxyUrl(OCR_PAGE_BASE), proxyUrl(OCR_PAGE_ARCHIVE)]) {
      let text;
      try {
        const res = await fetch(page);
        if (!res.ok) continue;
        text = await res.text();
      } catch {
        continue;
      }
      found.push(...extractOcrPdfLinks(text));
    }
    let kept = 0;
    for (const { url, fileName } of found) {
      const fullMatch = fileName.match(/-(january|february|march|april|may|june|july|august|september|october|november|december)-(\d{4})\b/i);
      if (!fullMatch) continue;
      const full = fullMatch[1][0].toUpperCase() + fullMatch[1].slice(1).toLowerCase();
      const month = AQA_MONTHS.find(([f]) => f === full);
      const seriesObj = { month: month[1], year: Number(fullMatch[2]), label: `${full} ${fullMatch[2]}` };
      for (const [qualId, pattern] of Object.entries(OCR_QUAL_PATTERNS)) {
        if (!pattern.test(fileName)) continue;
        const key = `${seriesKey(seriesObj)}:${qualId}`;
        if (!discoveredOcr.has(key)) kept++;
        discoveredOcr.set(key, url);
      }
    }
    return { found: found.length, kept };
  }

  function extractOcrPdfLinks(html) {
    const re = /<a\s+[^>]*href="(\/Images\/[^"]*?grade-boundaries[^"]*?\.pdf)"/gi;
    const out = [];
    let m;
    while ((m = re.exec(html)) !== null) {
      const fileName = m[1].split("/").pop();
      out.push({ url: `https://www.ocr.org.uk${m[1]}`, fileName });
    }
    return out;
  }

  // ---------- Pearson discovery ----------
  // Current series comes from the hidden-asset list on grade-boundaries.html:
  //   <span class= "hiddenAssetTitle">Grade Boundaries - June 2026 - GCE</span>
  //   <span class= "hiddenAssetUrl">/content/dam/pdf/.../grade-boundaries-june-2026-gce.pdf</span>
  async function discoverPearsonSeries() {
    let text;
    try {
      const res = await fetch(proxyUrl(PEARSON_PAGE));
      if (!res.ok) return { found: 0, kept: 0 };
      text = await res.text();
    } catch {
      return { found: 0, kept: 0 };
    }
    const titles = [...text.matchAll(/class= *"hiddenAssetTitle">\s*([^<]+?)\s*<\/span>/g)].map((m) => m[1]);
    const urls = [...text.matchAll(/class= *"hiddenAssetUrl">\s*([^<]+?)\s*<\/span>/g)].map((m) => m[1]);
    let kept = 0;
    for (let i = 0; i < Math.min(titles.length, urls.length); i++) {
      const title = titles[i];
      const urlPath = urls[i].trim();
      if (!urlPath.endsWith(".pdf")) continue;
      const url = `https://qualifications.pearson.com${urlPath.startsWith("/") ? "" : "/"}${urlPath}`;
      const m = title.match(/(January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})/i);
      if (!m) continue;
      const month = AQA_MONTHS.find(([f]) => f.toLowerCase() === m[1].toLowerCase());
      const series = { month: month[1], year: Number(m[2]), label: `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}` };

      const norm = title.toLowerCase();
      if (/gcse \(9-1\)/.test(norm) && /notional/.test(norm)) continue;
      let quals = [];
      if (/gcse \(9-1\)/.test(norm) && !/international|\bproject\b|award|maths|\bmath\b|bt|level 3/i.test(norm)) quals.push("gcse");
      if (/ - gce\b/.test(norm) && !/international|\bproject\b|award|mathematics in context|level 3/i.test(norm)) {
        quals.push("aLevel", "as");
      }
      for (const q of quals) {
        const key = `${seriesKey(series)}:${q}`;
        if (!discoveredPearson.has(key)) kept++;
        discoveredPearson.set(key, url);
      }
    }
    return { found: titles.length, kept };
  }

  // Pearson DAM pattern for older series (predictable, verified for 2023-2025).
  function pearsonSeriesUrl(qual, series) {
    const discovered = discoveredPearson.get(`${seriesKey(series)}:${qual.id}`);
    if (discovered) return discovered;
    const slug = monthAbbrevToSlug(series.month);
    if (qual.id === "gcse") {
      return `${PEARSON_DAM}/GCSE/grade-boundaries-${slug}-${series.year}-gcse.pdf`;
    }
    // AS + A-level share the "GCE" file.
    return `${PEARSON_DAM}/A-level/grade-boundaries-${slug}-${series.year}-gce.pdf`;
  }

  // ---------- status / scratch-buffer log helpers ----------
  // The fetch log is a single overwriting "scratch buffer" line with a gradient
  // shimmer sweep while work is in progress. It never accumulates history — the
  // release is for end users, and debugging happens in dev sessions. The most
  // recent message replaces the previous one.
  let scratchLine = null;
  let busyScratch = false;

  function setStatus(msg, kind = "") {
    if (el.status) {
      el.status.textContent = msg;
      el.status.className = "scraper-status " + kind;
    }
  }

  function setScratchBusy(busy) {
    busyScratch = !!busy;
    if (!scratchLine) return;
    scratchLine.classList.toggle("scraper-shimmer", busyScratch);
  }

  // Shimmer the subject search field while a fetch is in progress, so the
  // placeholder reads as "loading" rather than "empty". Harmless & subtle.
  function setFieldShimmer(busy) {
    if (el.subjectInput) el.subjectInput.classList.toggle("scraper-shimmer-field", !!busy);
  }

  // Task-complete hook: fire a radial ripple on the app's background canvas so
  // a finished fetch / background cache warm reads as a satisfying, responsive
  // beat rather than just a static scratch line. Best-effort; no-op if the
  // canvas isn't mounted (e.g. in an isolated harness).
  function pulseTaskComplete() {
    const nc = window.__neuronetCanvas;
    if (!nc) return;
    try {
      if (typeof nc.triggerRandomNodes === "function") nc.triggerRandomNodes(4, 0.9);
      if (typeof nc.triggerRadialPulse === "function") {
        const nodes = typeof nc.getNodes === "function" ? nc.getNodes() : null;
        if (nodes && nodes.length) {
          const n = nodes[(Math.random() * nodes.length) | 0];
          nc.triggerRadialPulse(n.x, n.y, 1.4);
        } else {
          const c = nc.getCanvas && nc.getCanvas();
          if (c) nc.triggerRadialPulse(c.width / 2, c.height / 2, 1.4);
        }
      }
    } catch {
      /* canvas unavailable — ignore */
    }
  }

  function scratch(message, shimmer = busyScratch) {
    if (!el.log) return;
    if (!scratchLine) {
      scratchLine = document.createElement("div");
      scratchLine.className = "scraper-line idle";
      scratchLine.innerHTML = `<span class="scraper-log-text"></span>`;
      el.log.appendChild(scratchLine);
    }
    const logText = scratchLine.querySelector(".scraper-log-text");
    if (logText) logText.textContent = message;
    scratchLine.classList.remove("idle");
    scratchLine.classList.toggle("scraper-shimmer", !!shimmer && busyScratch);
  }

  // Append a transient note that does not persist (kept for parity with the old
  // call sites; it just refreshes the scratch buffer).
  function appendLog(message) {
    scratch(message);
  }

  function clearLog() {
    if (!el.log) return;
    el.log.innerHTML = "";
    scratchLine = null;
    scratch("Waiting for an action...", false);
  }

  // ---------- AQA xlsx parsing ----------
  function parseAqaXlsx(wb, qual, fallbackGrades) {
    let sheet = null;
    for (const name of qual.sheets) {
      if (wb.Sheets[name]) { sheet = wb.Sheets[name]; break; }
    }
    const rows = sheet ? XLSX.utils.sheet_to_json(sheet, { header: 1 }) : [];
    const subjects = [];

    let gradeLabels = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || [];
      if (String(r[0] || "").trim() === "Subject Code") {
        const gradeRow = rows[i + 1] || [];
        for (let g = 0; g < 9; g++) {
          const label = gradeRow[3 + g];
          if (label === undefined || label === null || String(label).trim() === "") break;
          gradeLabels.push(String(label).trim());
        }
        break;
      }
    }
    if (gradeLabels.length === 0) gradeLabels = fallbackGrades;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || [];
      const code = r[0];
      const title = r[1];
      if (code == null || String(code).trim() === "") continue;
      if (typeof code === "string" && !/^\d{3,6}[A-Z0-9]*$/.test(String(code).trim())) continue;
      const maxMark = Number(r[2]);
      if (!Number.isFinite(maxMark)) continue;

      const grades = {};
      for (let g = 0; g < gradeLabels.length; g++) {
        const v = Number(r[3 + g]);
        if (Number.isFinite(v)) grades[gradeLabels[g]] = v;
      }

      subjects.push({
        code: String(code).trim(),
        title: String(title || "").trim(),
        maxMark,
        grades,
        gradesInOrder: gradeLabels
      });
    }
    return subjects;
  }

  // ---------- subject picker ----------
  function normalize(s) {
    return String(s || "").toUpperCase().replace(/\s+/g, " ").trim();
  }

  function englishLanguageMatches(subject) {
    const code = normalize(subject.code);
    const title = normalize(subject.title);
    return code === "8700" || /^ENGLISH LANGUAGE\b/.test(title);
  }

  function subjectMatches(subject, query) {
    if (!query) return true;
    return (
      normalize(subject.code).includes(query) ||
      normalize(subject.title).includes(query)
    );
  }

  function renderSuggestions(filter) {
    if (!el.suggestions) return;
    const matches = subjects.filter((s) => subjectMatches(s, filter));
    el.suggestions.innerHTML = "";
    if (matches.length === 0) {
      const div = document.createElement("div");
      div.className = "scraper-suggestion";
      div.innerHTML = `<span class="s-no-match">No subjects match "${escapeHtml(filter)}"</span>`;
      el.suggestions.appendChild(div);
    } else {
      matches.slice(0, 50).forEach((s) => {
        const div = document.createElement("div");
        div.className = "scraper-suggestion";
        div.textContent = `${s.code} — ${s.title} (max ${s.maxMark})`;
        div.dataset.code = s.code;
        div.addEventListener("mousedown", (e) => {
          e.preventDefault();
          selectSubject(s);
        });
        el.suggestions.appendChild(div);
      });
    }
    activeSuggestionIndex = -1;
    el.suggestions.hidden = false;
  }

  function selectSubject(subject) {
    if (!subject) return;
    activeSuggestionIndex = -1;
    if (el.subjectInput) {
      el.subjectInput.value = `${subject.code} — ${subject.title}`;
    }
    if (el.suggestions) el.suggestions.hidden = true;
    renderSubject(subject);
  }

  function moveActiveSuggestion(delta) {
    const items = el.suggestions ? el.suggestions.querySelectorAll(".scraper-suggestion") : [];
    if (items.length === 0) return;
    activeSuggestionIndex = (activeSuggestionIndex + delta + items.length) % items.length;
    items.forEach((n, i) => n.classList.toggle("active", i === activeSuggestionIndex));
  }

  function renderSubjectPicker(subjectList) {
    if (!el.subjectInput) return;
    el.subjectInput.disabled = false;
    el.subjectInput.value = "";
    el.subjectInput.placeholder = `Search ${subjectList.length} subjects...`;

    const preferred = subjectList.find(englishLanguageMatches) || subjectList[0];
    if (preferred) selectSubject(preferred);
  }

  function renderSubject(subject) {
    if (!el.result) return;
    const gradeLabels = subject.gradesInOrder || [];
    const gradeKeys = gradeLabels
      .map((g) => {
        const v = subject.grades[g];
        return v !== undefined
          ? `<div class="scraper-grade"><span class="grade-num">${escapeHtml(String(g))}</span><span class="grade-mark">${v}</span></div>`
          : "";
      })
      .join("");

    const boardName = currentBoardId() === "aqa" ? "AQA" : currentBoardId() === "ocr" ? "OCR" : "Pearson";
    const qualName = currentQualification().name;

    el.result.innerHTML = `
      <div class="scraper-card">
        <div class="card-head">
          <span class="card-code">${escapeHtml(subject.code)}</span>
          <span class="card-title">${escapeHtml(subject.title)}</span>
          <span class="card-max">Max ${subject.maxMark}</span>
          <button class="card-copy" type="button" title="Copy grade boundaries">Copy</button>
        </div>
        <div class="card-grades">${gradeKeys}</div>
      </div>`;

    const copyBtn = el.result.querySelector(".card-copy");
    if (copyBtn) copyBtn.addEventListener("click", () => copySubject(subject, boardName, qualName, copyBtn));
  }

  function copySubject(subject, boardName, qualName, btn) {
    const parts = gradeLinesForSubject(subject);
    const text =
      `${boardName} ${qualName} — ${subject.code} ${subject.title} (max ${subject.maxMark})\n` +
      parts.map(([g, m]) => `  ${g}: ${m}`).join("\n");
    const done = () => {
      if (!btn) return;
      const original = btn.textContent;
      btn.textContent = "Copied ✓";
      btn.classList.add("done");
      clearTimeout(btn._timer);
      btn._timer = setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove("done");
      }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, btn, done));
    } else {
      fallbackCopy(text, btn, done);
    }
  }

  function fallbackCopy(text, btn, done) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      done();
    } catch {
      /* clipboard unavailable; leave button unchanged */
    }
  }

  function gradeLinesForSubject(subject) {
    return (subject.gradesInOrder || [])
      .map((g) => {
        const v = subject.grades[g];
        return v !== undefined ? [g, v] : null;
      })
      .filter(Boolean);
  }

  // ---------- pickers ----------
  function currentBoardId() {
    return el.boardSelect ? el.boardSelect.value : "aqa";
  }

  function populateBoardPicker() {
    if (!el.boardSelect) return;
    if (!el.boardSelect.options.length) {
      [["aqa", "AQA"], ["ocr", "OCR"], ["pearson", "Pearson (Edexcel)"]].forEach(([v, t]) => {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = t;
        el.boardSelect.appendChild(opt);
      });
    }
  }

  const boardSeriesBuilders = {
    aqa: () => buildSeriesListFor("aqa", AQA_SERIES, discoveredAqa),
    ocr: () => buildSeriesListFor("ocr", [], discoveredOcr),
    pearson: () => buildSeriesListFor("pearson", PEARSON_BASELINE, discoveredPearson)
  };
  const boardQuals = {
    aqa: AQA_QUALIFICATIONS,
    ocr: QR,
    pearson: QR
  };

  function populateQualificationPicker() {
    if (!el.qualSelect) return;
    const keep = el.qualSelect.value;
    el.qualSelect.innerHTML = "";
    const quals = boardQuals[currentBoardId()] || QR;
    Object.values(quals).forEach((q) => {
      const opt = document.createElement("option");
      opt.value = q.id;
      opt.textContent = q.name;
      el.qualSelect.appendChild(opt);
    });
    if (keep && [...el.qualSelect.options].some((o) => o.value === keep)) el.qualSelect.value = keep;
  }

  function populateSeriesPicker() {
    if (!el.seriesSelect) return;
    const keep = el.seriesSelect.value;
    el.seriesSelect.innerHTML = "";
    (boardSeriesBuilders[currentBoardId()]?.() || []).forEach((s) => {
      const opt = document.createElement("option");
      opt.value = `${s.month}-${s.year}`;
      opt.textContent = s.label;
      el.seriesSelect.appendChild(opt);
    });
    if (keep && [...el.seriesSelect.options].some((o) => o.value === keep)) el.seriesSelect.value = keep;
  }

  function currentQualification() {
    const id = el.qualSelect ? el.qualSelect.value : "gcse";
    return boardQuals[currentBoardId()]?.[id] || AQA_QUALIFICATIONS.gcse;
  }

  function currentSeries() {
    const val = el.seriesSelect ? el.seriesSelect.value : null;
    const builder = boardSeriesBuilders[currentBoardId()];
    const list = builder?.() || [];
    return list.find((s) => `${s.month}-${s.year}` === val) || list[0];
  }

  // ---------- fetch + parse dispatch ----------
  async function fetchBoundaries() {
    clearLog();
    const board = currentBoardId();
    const qual = currentQualification();
    const series = currentSeries();
    if (!series) {
      setStatus("No series available yet — scan the site first.", "err");
      return;
    }

    // Serve from cache first (isolated boundary store; never user graph data).
    const cached = getCachedSubjects(board, series, qual);
    if (cached && cached.length) {
      subjects = cached;
      appendLog(`Loaded ${cached.length} ${qual.name} subjects from cache (${boundaryCache.entries[cacheKeyFor(board, series, qual)].fetchedAt ? new Date(boundaryCache.entries[cacheKeyFor(board, series, qual)].fetchedAt).toLocaleDateString() : "?"}).`);
      finishFetch(qual, series, true);
      return;
    }

    let url;
    let fileType;
    if (board === "aqa") {
      url = aqaSeriesUrl(qual, series);
      fileType = aqaSeriesFormat(qual, series);
    } else if (board === "ocr") {
      url = discoveredOcr.get(`${seriesKey(series)}:${qual.id}`);
      fileType = "pdf";
      if (!url) {
        setStatus(`No OCR log found for ${qual.name} ${series.label} — scan the site first.`, "err");
        return;
      }
    } else if (board === "pearson") {
      url = pearsonSeriesUrl(qual, series);
      fileType = "pdf";
    }

    const boardName = board === "aqa" ? "AQA" : board === "ocr" ? "OCR" : "Pearson";
    setStatus(`Fetching ${boardName} ${qual.name} ${series.label}...`, "busy");
    appendLog(`Board: ${boardName}`);
    appendLog(`URL: ${url}`);
    appendLog(`proxy: ${proxyUrl(url)}`);
    setScratchBusy(true);
    setFieldShimmer(true);

    try {
      if (fileType === "xlsx") {
        await fetchAqaXlsx(url, board, qual, series);
      } else {
        await fetchBoardPdf(url, board, qual, series);
      }
    } catch (e) {
      setScratchBusy(false);
      setFieldShimmer(false);
      setStatus(e.message || String(e), "err");
      scratch("ERROR: " + (e.message || String(e)), false);
      return;
    }
    setScratchBusy(false);
    setFieldShimmer(false);
  }

  async function fetchAqaXlsx(url, board, qual, series) {
    const res = await fetch(proxyUrl(url));
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching spreadsheet`);
    setStatus("Downloaded spreadsheet. Parsing...", "busy");
    const buf = await res.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    appendLog(`Sheets: ${wb.SheetNames.join(", ")}`);

    subjects = parseAqaXlsx(wb, qual, qual.grades).map((s) => ({ ...s, board, qual: qual.id }));
    appendLog(`Parsed ${subjects.length} ${qual.name} subject rows.`);
    finishFetch(qual, series);
  }

  async function fetchBoardPdf(url, board, qual, series) {
    appendLog("Extracting PDF text (pdf.js)...");
    const lines = await extractPdfLayoutLines(url, proxyUrl);
    appendLog(`Extracted ${lines.length} layout lines across ${new Set(lines.map((l) => l.page)).size} pages.`);

    subjects = parsePdfBoundaries(lines, board, qual.id).map((s) => ({
      ...s,
      board,
      qual: qual.id
    }));
    appendLog(`Parsed ${subjects.length} ${qual.name} subject rows.`);
    if (subjects.length === 0) {
      appendLog("Note: PDF layout parsing is best-effort; check the fetch log for anomalies.");
    }
    finishFetch(qual, series);
  }

  function finishFetch(qual, series, fromCache = false) {
    if (!fromCache && subjects && subjects.length) {
      setCachedSubjects(currentBoardId(), series, qual, subjects);
    }
    renderSubjectPicker(subjects);
    appendLog("Choose a subject from the picker to view its grade boundaries.");
    setScratchBusy(false);
    setFieldShimmer(false);
    pulseTaskComplete();
    const boardName = currentBoardId() === "aqa" ? "AQA" : currentBoardId() === "ocr" ? "OCR" : "Pearson";
    setStatus(`${boardName} ${qual.name} ${series.label} loaded${fromCache ? " (cached)" : ""}`, "ok");
  }

  // ---------- events ----------
  function refreshPickers() {
    populateQualificationPicker();
    populateSeriesPicker();
  }

  function bindEvents() {
    if (el.boardSelect) {
      el.boardSelect.addEventListener("change", () => {
        refreshPickers();
        savePrefs({ board: el.boardSelect.value, qual: currentQualification().id, series: el.seriesSelect ? el.seriesSelect.value : undefined });
        setStatus("Board changed — series takes effect on next fetch.", "");
      });
    }

    if (el.scanBtn) {
      el.scanBtn.addEventListener("click", async () => {
        const board = currentBoardId();
        el.scanBtn.disabled = true;
        el.scanBtn.textContent = "Scanning...";
        clearLog();
        try {
          setScratchBusy(true);
          let result;
          if (board === "aqa") {
            setStatus("Scanning AQA grade-boundaries pages for available series...", "busy");
            appendLog("Scanning AQA grade-boundaries pages for hashed xlsx files...");
            const count = await discoverAqaSeries();
            result = { found: count, kept: discoveredAqa.size, boardName: "AQA" };
          } else if (board === "ocr") {
            setStatus("Scanning OCR grade-boundaries pages for available series...", "busy");
            appendLog("Scanning OCR index + archive pages for PDF links...");
            result = await discoverOcrSeries();
            result.boardName = "OCR";
          } else {
            setStatus("Scanning Pearson grade-boundaries page...", "busy");
            appendLog("Scanning Pearson grade-boundaries page hidden assets...");
            result = await discoverPearsonSeries();
            result.boardName = "Pearson";
          }
          populateSeriesPicker();
          const list = boardSeriesBuilders[board]?.() || [];
          appendLog(`Discovered ${result.found} file entries; kept ${result.kept} series/qual files.`);
          appendLog(`Series now available: ${list.map((s) => s.label).join(", ") || "(none)"}`);
          setStatus(`Found ${list.length} series for ${result.boardName}.`, "ok");
          pulseTaskComplete();
        } catch (e) {
          setStatus(e.message || String(e), "err");
          appendLog("ERROR: " + (e.message || String(e)));
        } finally {
          setScratchBusy(false);
          el.scanBtn.disabled = false;
          el.scanBtn.textContent = "Scan site";
        }
      });
    }

    if (el.fetchBtn) {
      el.fetchBtn.addEventListener("click", async () => {
        el.fetchBtn.disabled = true;
        el.fetchBtn.textContent = "Fetching...";
        try {
          await fetchBoundaries();
        } catch (e) {
          setStatus(e.message || String(e), "err");
          appendLog("ERROR: " + (e.message || String(e)));
        } finally {
          el.fetchBtn.disabled = false;
          el.fetchBtn.textContent = "Fetch boundaries";
        }
      });
    }

    if (el.qualSelect) {
      el.qualSelect.addEventListener("change", () => {
        savePrefs({ board: currentBoardId(), qual: el.qualSelect.value, series: el.seriesSelect ? el.seriesSelect.value : undefined });
        setStatus("Change takes effect on next fetch.", "");
      });
    }
    if (el.seriesSelect) {
      el.seriesSelect.addEventListener("change", () => {
        savePrefs({ board: currentBoardId(), qual: currentQualification().id, series: el.seriesSelect.value });
        setStatus("Change takes effect on next fetch.", "");
      });
    }

    if (el.subjectInput) {
      el.subjectInput.addEventListener("input", () => {
        renderSuggestions(normalize(el.subjectInput.value));
      });
      el.subjectInput.addEventListener("focus", () => {
        // Pre-filled (auto-selected) value should be replaced by typing; select it.
        if (el.subjectInput.value) el.subjectInput.select();
        renderSuggestions(normalize(el.subjectInput.value));
      });
      el.subjectInput.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          moveActiveSuggestion(1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          moveActiveSuggestion(-1);
        } else if (e.key === "Enter" || e.key === "Tab") {
          const items = el.suggestions ? el.suggestions.querySelectorAll(".scraper-suggestion") : [];
          if (items.length === 0) return;
          // Pick the active one, else the first real suggestion (skip no-match).
          let target = items[activeSuggestionIndex] && items[activeSuggestionIndex].dataset.code
            ? items[activeSuggestionIndex]
            : null;
          if (!target) target = [...items].find((n) => n.dataset.code) || null;
          if (target && target.dataset.code) {
            e.preventDefault();
            selectSubject(subjects.find((s) => s.code === target.dataset.code));
          }
        } else if (e.key === "Escape") {
          if (el.suggestions) el.suggestions.hidden = true;
        }
      });
    }

    document.addEventListener("mousedown", (e) => {
      if (
        el.suggestions &&
        !el.suggestions.contains(e.target) &&
        el.subjectInput &&
        !el.subjectInput.contains(e.target)
      ) {
        el.suggestions.hidden = true;
      }
    });
  }

  if (el.version) {
    Promise.allSettled([Promise.resolve(XLSX.version), import("./pdfBoundaries.js")]).then(([v]) => {
      if (el.version) el.version.textContent = `SheetJS v${v.value || "?"} + pdf.js`;
    });
  }

  populateBoardPicker();
  populateQualificationPicker();
  populateSeriesPicker();
  restorePrefs();
  bindEvents();
  setStatus("Ready. Pick a board, qualification and series, then fetch boundaries.", "");

  // Best-effort auto-discovery of the latest series per board, then background
  // fetch of the newest series per qual to warm the isolated cache. This makes
  // the tool feel live on first load (fetch animation) while repeat visits hit
  // the cache instantly.
  const autoDiscover = async () => {
    const results = await Promise.allSettled([
      discoverAqaSeries(),
      discoverOcrSeries(),
      discoverPearsonSeries()
    ]);
    refreshPickers();
    // Re-apply the saved series now that discovery may have revealed a
    // discovered-only series (e.g. newest JUN series not in the baseline list).
    if (el.seriesSelect && statePrefs.series && [...el.seriesSelect.options].some((o) => o.value === statePrefs.series) && el.seriesSelect.value !== statePrefs.series) {
      el.seriesSelect.value = statePrefs.series;
    }
    const ok = results.filter((r) => r.status === "fulfilled" && r.value && (r.value.kept || r.value.found));
    if (ok.length > 0) {
      appendLog(`Auto-discovered series for ${ok.length} board(s); series pickers updated.`);
      setStatus("Ready. Series lists refreshed from the exam board sites.", "ok");
    } else {
      appendLog("Auto-scan found nothing new; keeping baseline series.");
      setStatus("Ready. Using baseline series (auto-scan unavailable).", "");
    }
    await autoFetchLatest();
  };
  autoDiscover();

  // Fetch the newest available series for each board×qual into the cache, but
  // only when the cache is missing or stale for that combination. Runs in the
  // background so the UI isn't blocked.
  async function autoFetchLatest() {
    const boards = ["aqa", "ocr", "pearson"];
    const qualIds = ["gcse", "aLevel", "as"];
    const jobs = [];
    for (const board of boards) {
      const list = boardSeriesBuilders[board]?.() || [];
      if (list.length === 0) continue;
      const newest = list[0]; // builders sort newest-first
      const quals = boardQuals[board] || QR;
      for (const qid of qualIds) {
        const qual = quals[qid];
        if (!qual) continue;
        if (getCachedSubjects(board, newest, qual)) continue; // fresh already
        jobs.push({ board, qual, series: newest });
      }
    }
    if (jobs.length === 0) return;
    appendLog(`Background: caching latest series for ${jobs.length} board×qual combo(s)...`);
    for (const { board, qual, series } of jobs) {
      if (document.hidden) break;
      try {
        await fetchBoundariesFor(board, qual, series);
      } catch {
        /* best-effort; a failure here just means that combo stays uncached */
      }
    }
    appendLog("Background caching complete.");
    pulseTaskComplete();
  }

  // Like fetchBoundaries, but targeted at an explicit board/qual/series and
  // silent (no UI churn beyond log lines + cache write).
  async function fetchBoundariesFor(board, qual, series) {
    let url;
    let fileType;
    if (board === "aqa") {
      url = aqaSeriesUrl(qual, series);
      fileType = aqaSeriesFormat(qual, series);
    } else if (board === "ocr") {
      url = discoveredOcr.get(`${seriesKey(series)}:${qual.id}`);
      fileType = "pdf";
      if (!url) return;
    } else if (board === "pearson") {
      url = pearsonSeriesUrl(qual, series);
      fileType = "pdf";
    }
    if (!url) return;

    if (fileType === "xlsx") {
      const res = await fetch(proxyUrl(url));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const wb = XLSX.read(await res.arrayBuffer(), { type: "array" });
      const parsed = parseAqaXlsx(wb, qual, qual.grades).map((s) => ({ ...s, board, qual: qual.id }));
      if (parsed.length) setCachedSubjects(board, series, qual, parsed);
    } else {
      const lines = await extractPdfLayoutLines(url, proxyUrl);
      const parsed = parsePdfBoundaries(lines, board, qual.id).map((s) => ({ ...s, board, qual: qual.id }));
      if (parsed.length) setCachedSubjects(board, series, qual, parsed);
    }
    appendLog(`Cached ${qual.name} ${series.label} (${board}).`);
  }
}