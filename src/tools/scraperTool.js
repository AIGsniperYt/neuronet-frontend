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
    { month: "JUN", year: 2022, label: "June 2022" },
    { month: "JUN", year: 2023, label: "June 2023" },
    { month: "NOV", year: 2023, label: "November 2023" },
    { month: "JUN", year: 2024, label: "June 2024" }
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
    }
    for (const { url, title } of found) {
      const parsed = parseBoundaryTitle(title);
      if (!parsed) continue;
      discoveredAqa.set(`${seriesKey(parsed.series)}:${parsed.qualId}`, url);
    }
    return found.length;
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
    return `${AQA_FILE_BASE}/${qual.filePrefix}-${series.month}-${series.year}.XLSX`;
  }

  function aqaSeriesUrl(qual, series) {
    return discoveredAqa.get(`${seriesKey(series)}:${qual.id}`) || legacyAqaSeriesUrl(qual, series);
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

  // ---------- status / log helpers ----------
  function setStatus(msg, kind = "") {
    if (el.status) {
      el.status.textContent = msg;
      el.status.className = "scraper-status " + kind;
    }
  }

  function appendLog(line) {
    if (!el.log) return;
    const row = document.createElement("div");
    row.className = "scraper-line";
    row.textContent = line;
    el.log.appendChild(row);
    el.log.scrollTop = el.log.scrollHeight;
  }

  function clearLog() {
    if (el.log) el.log.innerHTML = "";
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

    el.result.innerHTML = `
      <div class="scraper-card">
        <div class="card-head">
          <span class="card-code">${escapeHtml(subject.code)}</span>
          <span class="card-title">${escapeHtml(subject.title)}</span>
          <span class="card-max">Max ${subject.maxMark}</span>
        </div>
        <div class="card-grades">${gradeKeys}</div>
      </div>`;
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
    el.qualSelect.innerHTML = "";
    const quals = boardQuals[currentBoardId()] || QR;
    Object.values(quals).forEach((q) => {
      const opt = document.createElement("option");
      opt.value = q.id;
      opt.textContent = q.name;
      el.qualSelect.appendChild(opt);
    });
  }

  function populateSeriesPicker() {
    if (!el.seriesSelect) return;
    el.seriesSelect.innerHTML = "";
    (boardSeriesBuilders[currentBoardId()]?.() || []).forEach((s) => {
      const opt = document.createElement("option");
      opt.value = `${s.month}-${s.year}`;
      opt.textContent = s.label;
      el.seriesSelect.appendChild(opt);
    });
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

    let url;
    let fileType;
    if (board === "aqa") {
      url = aqaSeriesUrl(qual, series);
      fileType = "xlsx";
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

    if (fileType === "xlsx") {
      await fetchAqaXlsx(url, qual, series);
    } else {
      await fetchBoardPdf(url, board, qual, series);
    }
  }

  async function fetchAqaXlsx(url, qual, series) {
    const res = await fetch(proxyUrl(url));
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching spreadsheet`);
    setStatus("Downloaded spreadsheet. Parsing...", "busy");
    const buf = await res.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    appendLog(`Sheets: ${wb.SheetNames.join(", ")}`);

    subjects = parseAqaXlsx(wb, qual, qual.grades);
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

  function finishFetch(qual, series) {
    renderSubjectPicker(subjects);
    appendLog("Choose a subject from the picker to view its grade boundaries.");
    const boardName = currentBoardId() === "aqa" ? "AQA" : currentBoardId() === "ocr" ? "OCR" : "Pearson";
    setStatus(`${boardName} ${qual.name} ${series.label} loaded`, "ok");
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
        } catch (e) {
          setStatus(e.message || String(e), "err");
          appendLog("ERROR: " + (e.message || String(e)));
        } finally {
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
        setStatus("Change takes effect on next fetch.", "");
      });
    }
    if (el.seriesSelect) {
      el.seriesSelect.addEventListener("change", () => {
        setStatus("Change takes effect on next fetch.", "");
      });
    }

    if (el.subjectInput) {
      el.subjectInput.addEventListener("input", () => {
        renderSuggestions(normalize(el.subjectInput.value));
      });
      el.subjectInput.addEventListener("focus", () => {
        renderSuggestions(normalize(el.subjectInput.value));
      });
      el.subjectInput.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          moveActiveSuggestion(1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          moveActiveSuggestion(-1);
        } else if (e.key === "Enter") {
          e.preventDefault();
          const items = el.suggestions.querySelectorAll(".scraper-suggestion");
          const target = items[activeSuggestionIndex];
          if (target && target.dataset.code) {
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
  bindEvents();
  setStatus("Ready. Pick a board, qualification and series, then fetch boundaries.", "");

  // Best-effort auto-discovery of the latest series per board.
  const autoDiscover = async () => {
    const results = await Promise.allSettled([
      discoverAqaSeries(),
      discoverOcrSeries(),
      discoverPearsonSeries()
    ]);
    refreshPickers();
    const ok = results.filter((r) => r.status === "fulfilled" && r.value && (r.value.kept || r.value.found));
    if (ok.length > 0) {
      appendLog(`Auto-discovered series for ${ok.length} board(s); series pickers updated.`);
      setStatus("Ready. Series lists refreshed from the exam board sites.", "ok");
    } else {
      appendLog("Auto-scan found nothing new; keeping baseline series.");
      setStatus("Ready. Using baseline series (auto-scan unavailable).", "");
    }
  };
  autoDiscover();
}