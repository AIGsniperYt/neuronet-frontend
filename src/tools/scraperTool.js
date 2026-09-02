import * as XLSX from "../vendor/xlsx/index.js";

export function initScraperTool(deps, context = {}) {
  const { escapeHtml } = deps;
  const $ = (id) => document.getElementById(id);

  const el = {
    status: $("scraperStatus"),
    log: $("scraperLog"),
    fetchBtn: $("scraperFetchBtn"),
    result: $("scraperResult"),
    version: $("scraperVersion"),
    subjectInput: $("scraperSubjectInput"),
    suggestions: $("scraperSuggestions")
  };

  let subjects = [];
  let activeSuggestionIndex = -1;

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
  // The AQA 'GCSE' sheet layout (June 2024 observed):
  //   Row 10 = header: SubjectCode, SubjectTitle, MaximumMark, GradeBoundaries, <blank>, 9,8,7,6,5,4,3,2,1
  //   Rows 11+ = data: [code, title, maxMark, b9, b8, b7, b6, b5, b4, b3, b2, b1]
  // English Language (8700) example row:
  //   ["8700","ENGLISH LANGUAGE",160,121,111,102,92,82,73,54,35,16]
  function parseAqaXlsx(sheet) {
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    const subjects = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || [];
      const code = r[0];
      const title = r[1];
      if (code == null || String(code).trim() === "") continue;
      // AQA subject codes are 4-6 digits, optionally followed by a tier/
      // option suffix of uppercase letters (e.g. 8700, 8461F, 8525A, 8145AA).
      if (typeof code === "string" && !/^\d{4,6}[A-Z]*$/.test(String(code).trim())) continue;
      const maxMark = Number(r[2]);
      if (!Number.isFinite(maxMark)) continue;

      // grades at indices 3..11 (9 -> 1)
      const grades = {};
      const gradeLabels = [9, 8, 7, 6, 5, 4, 3, 2, 1];
      for (let g = 0; g < gradeLabels.length; g++) {
        const v = Number(r[3 + g]);
        if (Number.isFinite(v)) grades[gradeLabels[g]] = v;
      }

      subjects.push({
        code: String(code).trim(),
        title: String(title || "").trim(),
        maxMark,
        grades
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
  const AQA_GCSE_JUN2024_XLSX =
    "https://filestore.aqa.org.uk/over/stat_pdf/AQA-GCSE-GDE-BDY-JUN-2024.XLSX";

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
    const gradeKeys = [9, 8, 7, 6, 5, 4, 3, 2, 1]
      .map((g) => {
        const v = subject.grades[g];
        return v !== undefined
          ? `<div class="scraper-grade"><span class="grade-num">${g}</span><span class="grade-mark">${v}</span></div>`
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

  async function fetchAqaGcseEnglishLang() {
    clearLog();
    setStatus("Fetching AQA GCSE grade boundary spreadsheet...", "busy");
    const requestUrl = proxyUrl(AQA_GCSE_JUN2024_XLSX);
    appendLog(`URL: ${AQA_GCSE_JUN2024_XLSX}`);
    appendLog(`proxy: ${requestUrl}`);

    const res = await fetch(requestUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching spreadsheet`);
    setStatus("Downloaded spreadsheet. Parsing...", "busy");
    appendLog(`Downloaded (${(res.headers.get("content-length") || "?").replace(/\D/g, "")} bytes).`);

    const buf = await res.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    appendLog(`Sheets: ${wb.SheetNames.join(", ")}`);

    subjects = parseAqaXlsx(wb.Sheets["GCSE"]);
    appendLog(`Parsed ${subjects.length} GCSE subject rows.`);

    renderSubjectPicker(subjects);
    appendLog("Choose a subject from the picker to view its grade boundaries.");
    setStatus("Select a subject", "ok");
  }

  function bindEvents() {
    if (el.fetchBtn) {
      el.fetchBtn.addEventListener("click", async () => {
        el.fetchBtn.disabled = true;
        el.fetchBtn.textContent = "Fetching...";
        try {
          await fetchAqaGcseEnglishLang();
        } catch (e) {
          setStatus(e.message || String(e), "err");
          appendLog("ERROR: " + (e.message || String(e)));
        } finally {
          el.fetchBtn.disabled = false;
          el.fetchBtn.textContent = "Fetch AQA GCSE boundaries";
        }
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

  bindEvents();
  setStatus("Ready. This fetches AQA GCSE English Language grade boundaries for June 2024.", "");
}
