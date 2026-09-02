import * as XLSX from "../vendor/xlsx/index.js";

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
    qualSelect: $("scraperQual"),
    seriesSelect: $("scraperSeries"),
    subjectInput: $("scraperSubjectInput"),
    suggestions: $("scraperSuggestions")
  };

  let subjects = [];
  let activeSuggestionIndex = -1;

  // ---------- AQA qualification registry ----------
  // Grade labels appear in the workbook header (row index 10); the parser reads
  // them there too, but we keep a default per qualification for fallback display.
  const AQA_QUALIFICATIONS = {
    gcse: {
      id: "gcse",
      name: "GCSE",
      sheets: ["GCSE", "GCSE subject", "GCSE Subject"],
      grades: [9, 8, 7, 6, 5, 4, 3, 2, 1],
      filePrefix: "AQA-GCSE-GDE-BDY"
    },
    aLevel: {
      id: "aLevel",
      name: "A-level",
      sheets: ["A level subject"],
      grades: ["A*", "A", "B", "C", "D", "E"],
      filePrefix: "AQA-A-LEVEL-GDE-BDY"
    },
    as: {
      id: "as",
      name: "AS",
      sheets: ["AS subject"],
      grades: ["A", "B", "C", "D", "E"],
      filePrefix: "AQA-AS-GDE-BDY"
    }
  };

  // AQA grade-boundary files live in two places:
  //  - Legacy filestore URL pattern (verified for JUN 2022 through JUN 2024,
  //    plus the November resit series) -> predictable stat_pdf path.
  //  - Hashed attachment URLs behind www.aqa.org.uk/files/... (Nov 2024+).
  //    Hashes cannot be predicted, so we discover them by scraping the public
  //    grade-boundaries pages, which embed a Sanity JSON payload where every
  //    file has "title":"<Qual> - Grade boundaries <Month> <Year>" and a direct
  //    "url". The legacy list below is only a fallback baseline; the series
  //    picker is populated from whatever live pages we can reach.
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

  // Discovered hashed files: key `${seriesKey}:${qualId}` -> full xlsx url.
  // Series keys use "JUN-2026" style. Discovered files win over the legacy
  // filestore pattern because they are always the live, current artifact.
  const discoveredFiles = new Map();

  function seriesKey(series) {
    return `${series.month}-${series.year}`;
  }

  function legacyAqaSeriesUrl(qual, series) {
    return `${AQA_FILE_BASE}/${qual.filePrefix}-${series.month}-${series.year}.XLSX`;
  }

  function aqaSeriesUrl(qual, series) {
    const discovered = discoveredFiles.get(`${seriesKey(series)}:${qual.id}`);
    return discovered || legacyAqaSeriesUrl(qual, series);
  }

  // Build the series list for the picker: discovered series (newest first)
  // merged with the legacy baseline, deduped by series key.
  function buildSeriesList() {
    const byKey = new Map();
    for (const s of AQA_SERIES) byKey.set(seriesKey(s), { ...s });
    for (const key of discoveredFiles.keys()) {
      const seriesKeyStr = key.split(":")[0];
      const [mAbbrev, yearStr] = seriesKeyStr.split("-");
      const year = Number(yearStr);
      if (!byKey.has(seriesKeyStr)) {
        const match = AQA_MONTHS.find(([, abb]) => abb === mAbbrev);
        const label = match ? `${match[0]} ${year}` : seriesKeyStr;
        byKey.set(seriesKeyStr, { month: mAbbrev, year, label });
      }
    }
    return [...byKey.values()].sort((a, b) =>
      b.year - a.year ||
      AQA_MONTHS.findIndex(([, mb]) => mb === b.month) - AQA_MONTHS.findIndex(([, mb]) => mb === a.month)
    );
  }

  // Scrape the AQA grade-boundaries pages (current + archive) for every hashed
  // xlsx file, reading the Sanity JSON embedded in the page: each file carries
  // a "title" of "<Qual> - Grade boundaries <Month> <Year>" plus a "url".
  // Also grabs any legacy-named stat_pdf path, which doubles as a fallback that
  // survives JSON layout changes.
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
        continue; // A page being unreachable shouldn't block discovery.
      }
      const pairs = extractGradeBoundaryPairs(text);
      found.push(...pairs);
    }

    for (const { url, title } of found) {
      const parsed = parseBoundaryTitle(title);
      if (!parsed) continue;
      const { qualId, series } = parsed;
      const key = `${seriesKey(series)}:${qualId}`;
      if (url) discoveredFiles.set(key, url);
    }
    return found.length;
  }

  // Pull (title, url) pairs out of the embedded Sanity JSON. The payload is
  // double-escaped inside a script tag, so we match both escaped and plain
  // variants. Each pair corresponds to one attached file (pdf or xlsx).
  function extractGradeBoundaryPairs(html) {
    const escaped = /\\"url\\":\\"(https:\/\/cdn\.sanity\.io\/files\/[^\\"]+?\.xlsx)\\"[\s\S]*?\\"title\\":\\"([^\\"]+?)\\"/g;
    const plain = /"url":"(https:\/\/cdn\.sanity\.io\/files\/[^"]+?\.xlsx)"[\s\S]*?"title":"([^"]+?)"/g;
    const out = [];
    const push = (re) => {
      let m;
      while ((m = re.exec(html)) !== null) out.push({ url: m[1], title: m[2] });
    };
    push(escaped);
    if (out.length === 0) push(plain);
    return out;
  }

  // "GCSE - Grade boundaries June 2026" | "GCSE Grade boundaries - November 2024"
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

  // ---------- AQA parsing ----------
  // AQA workbooks share a common header layout, but the sheet name and header
  // row offset vary by series (e.g. sheet is 'GCSE' in Jun 2024 but 'GCSE
  // subject' in 2022/23; the two header rows sit at 7/8 in 2022 but 9/10 in
  // 2023/24). So we locate the sheet by candidate names and find the grade
  // header row by scanning for the 'Subject Code' label instead of hardcoding
  // a row index.
  //
  //   FakeHeader  = SubjectCode, SubjectTitle, MaximumMark, GradeBoundaries, <blank>, <labels...>
  //   GradeHeader = <blank>,9,8,7,6,5,4,3,2,1  (or A*,A,B,C,D,E / A,B,C,D,E)
  //   Data rows   = [code, title, maxMark, bGrade1, bGrade2, ...]
  // English Language (8700) GCSE example row:
  //   ["8700","ENGLISH LANGUAGE",160,121,111,102,92,82,73,54,35,16]
  function parseAqaXlsx(wb, qual, fallbackGrades) {
    let sheet = null;
    for (const name of qual.sheets) {
      if (wb.Sheets[name]) { sheet = wb.Sheets[name]; break; }
    }
    const rows = sheet ? XLSX.utils.sheet_to_json(sheet, { header: 1 }) : [];
    const subjects = [];

    // Find the 'Subject Code' header row, then read grade labels from the
    // next row (the grade header directly above the data).
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
      // AQA subject codes like 8700, 8461F, 8525A, 8145AA, and 2022-era 814A01
      // (3-6 leading digits, then an optional letters/digits suffix).
      if (typeof code === "string" && !/^\d{3,6}[A-Z0-9]*$/.test(String(code).trim())) continue;
      const maxMark = Number(r[2]);
      if (!Number.isFinite(maxMark)) continue;

      // Grade boundaries at column offsets 3..(3 + gradeCount - 1)
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

    // Pre-select English Language in the hardcoded AQA spreadsheet.
    const preferred = subjectList.find(englishLanguageMatches) || subjectList[0];
    if (preferred) selectSubject(preferred);
  }

  // ---------- fetch flow ----------
  // Exam board file stores block browser cross-origin fetches via CORS, so we
  // route the request through a server-side proxy that adds permissive CORS.
  // The proxy base is configurable (defaults to the deployed backend) so it can
  // be pointed at a local server during development (e.g. via a global, or by
  // editing the constant).
  function proxyUrl(real) {
    const base = (typeof window !== "undefined" && window.__NEURONET_PROXY_BASE) ||
      document.querySelector('meta[name="neuronet-proxy"]')?.getAttribute("content") ||
      "https://neuronet-backend.onrender.com";
    const sep = base.endsWith("/") ? "" : "/";
    return `${base}${sep}api/proxy?url=${encodeURIComponent(real)}`;
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

  // ---------- qualification / series pickers ----------
  function populateQualificationPicker() {
    if (!el.qualSelect) return;
    el.qualSelect.innerHTML = "";
    Object.values(AQA_QUALIFICATIONS).forEach((q) => {
      const opt = document.createElement("option");
      opt.value = q.id;
      opt.textContent = q.name;
      el.qualSelect.appendChild(opt);
    });
  }

  function populateSeriesPicker() {
    if (!el.seriesSelect) return;
    el.seriesSelect.innerHTML = "";
    buildSeriesList().forEach((s) => {
      const opt = document.createElement("option");
      opt.value = `${s.month}-${s.year}`;
      opt.textContent = s.label;
      el.seriesSelect.appendChild(opt);
    });
  }

  function currentQualification() {
    const id = el.qualSelect ? el.qualSelect.value : "gcse";
    return AQA_QUALIFICATIONS[id] || AQA_QUALIFICATIONS.gcse;
  }

  function currentSeries() {
    const val = el.seriesSelect ? el.seriesSelect.value : null;
    const list = buildSeriesList();
    return list.find((s) => `${s.month}-${s.year}` === val) || list[0];
  }

  async function fetchAqaBoundaries() {
    clearLog();
    const qual = currentQualification();
    const series = currentSeries();
    const url = aqaSeriesUrl(qual, series);
    setStatus(`Fetching AQA ${qual.name} ${series.label}...`, "busy");
    appendLog(`URL: ${url}`);
    appendLog(`proxy: ${proxyUrl(url)}`);

    const res = await fetch(proxyUrl(url));
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching spreadsheet`);
    setStatus("Downloaded spreadsheet. Parsing...", "busy");
    appendLog(`Downloaded (${(res.headers.get("content-length") || "?").replace(/\D/g, "")} bytes).`);

    const buf = await res.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    appendLog(`Sheets: ${wb.SheetNames.join(", ")}`);

    subjects = parseAqaXlsx(wb, qual, qual.grades);
    appendLog(`Parsed ${subjects.length} ${qual.name} subject rows.`);

    renderSubjectPicker(subjects);
    appendLog("Choose a subject from the picker to view its grade boundaries.");
    setStatus(`${qual.name} ${series.label} loaded`, "ok");
  }

  function bindEvents() {
    if (el.scanBtn) {
      el.scanBtn.addEventListener("click", async () => {
        el.scanBtn.disabled = true;
        el.scanBtn.textContent = "Scanning...";
        clearLog();
        try {
          setStatus("Scanning AQA grade-boundaries pages for available series...", "busy");
          appendLog("Scanning AQA grade-boundaries pages for hashed xlsx files...");
          const count = await discoverAqaSeries();
          const list = buildSeriesList();
          appendLog(`Discovered ${count} hashed file entries; ${discoveredFiles.size} series/qual files kept.`);
          appendLog(`Series now available: ${list.map((s) => s.label).join(", ")}`);
          populateSeriesPicker();
          appendLog("Series picker updated.");
          setStatus(`Found ${discoveredFiles.size} hashed grade-boundary files across ${list.length} series.`, "ok");
        } catch (e) {
          setStatus(e.message || String(e), "err");
          appendLog("ERROR: " + (e.message || String(e)));
        } finally {
          el.scanBtn.disabled = false;
          el.scanBtn.textContent = "Scan AQA site";
        }
      });
    }
    if (el.fetchBtn) {
      el.fetchBtn.addEventListener("click", async () => {
        el.fetchBtn.disabled = true;
        el.fetchBtn.textContent = "Fetching...";
        try {
          await fetchAqaBoundaries();
        } catch (e) {
          setStatus(e.message || String(e), "err");
          appendLog("ERROR: " + (e.message || String(e)));
        } finally {
          el.fetchBtn.disabled = false;
          el.fetchBtn.textContent = "Fetch AQA boundaries";
        }
      });
    }
    // Changing qualification/series only takes effect on the next fetch.
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
        const query = normalize(el.subjectInput.value);
        renderSuggestions(query);
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

  if (el.version && XLSX && XLSX.version) {
    el.version.textContent = `SheetJS v${XLSX.version}`;
  }

  populateQualificationPicker();
  populateSeriesPicker();
  bindEvents();
  setStatus("Ready. Pick a qualification and series, then fetch AQA boundaries.", "");

  // Best-effort auto-discovery so recent series (2025/2026, hashed URLs) show
  // up without a manual scan; failures keep the legacy baseline.
  if (el && el.scanBtn) {
    // auto-run discovery once, silently (status already shows legacy ready)
    discoverAqaSeries().then((count) => {
      if (count > 0) {
        const before = buildSeriesList().length;
        populateSeriesPicker();
        appendLog(`Auto-discovered ${count} hashed grade-boundary files; series updated (${before} total).`);
        setStatus("Ready. Series list refreshed with the latest AQA series.", "ok");
      } else {
        appendLog("Auto-scan found no new AQA files; keeping legacy filestore series.");
        setStatus("Ready. Using verified legacy series (auto-scan found nothing new).", "");
      }
    }).catch(() => {
      appendLog("Auto-scan failed; keeping legacy filestore series.");
      setStatus("Ready. Using verified legacy series (auto-scan unavailable).", "");
    });
  }
}
