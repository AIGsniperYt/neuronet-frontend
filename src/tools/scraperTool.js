import * as XLSX from "../vendor/xlsx/index.js";

export function initScraperTool(deps, context = {}) {
  const { escapeHtml } = deps;
  const $ = (id) => document.getElementById(id);

  const el = {
    status: $("scraperStatus"),
    log: $("scraperLog"),
    fetchBtn: $("scraperFetchBtn"),
    result: $("scraperResult"),
    version: $("scraperVersion")
  };

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
      if (typeof code === "string" && !/^\d{4,6}$/.test(String(code).trim())) continue;
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

    const subjects = parseAqaXlsx(wb.Sheets["GCSE"]);
    appendLog(`Parsed ${subjects.length} GCSE subject rows.`);

    const match = subjects.find(englishLanguageMatches);
    if (!match) {
      throw new Error("Could not find English Language (8700) in the spreadsheet.");
    }
    appendLog(`Found: ${match.code} ${match.title} (max ${match.maxMark}).`);
    setStatus("Success", "ok");
    renderSubject(match);
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
          el.fetchBtn.textContent = "Fetch AQA GCSE English Language 2024";
        }
      });
    }
  }

  if (el.version && XLSX && XLSX.version) {
    el.version.textContent = `SheetJS v${XLSX.version}`;
  }

  bindEvents();
  setStatus("Ready. This fetches AQA GCSE English Language grade boundaries for June 2024.", "");
}
