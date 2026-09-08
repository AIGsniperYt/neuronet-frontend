import { transformRows } from "./trackerImport.js";
import { dialog } from "./dialog.js";
import {
  loadBoundaryCache,
  listCachedCourses,
  matchOfficialCourse,
  findGradeTable,
  boardIdToName,
  qualIdToName,
  boardToId,
  qualToId,
  trackerSeriesToMonth,
  normalizeTitle,
  scoreToGrade,
  canonicalGradeKey,
  normalizeBoundaryTable,
  findGradeMark,
  courseGradeLabels,
  boundarySeriesList,
  bestSeriesForYear,
  discoverBoundarySeries,
  ensureBoundarySeries
} from "./gradeBoundaries.js";

export function initTrackerTool(deps, context = {}) {
  const { getAllNodes, addNode, addNodes, deleteNode, getSubjects, escapeHtml } = deps;
  // ---- DOM refs ----
  const $ = (id) => document.getElementById(id);
  const el = {
    papersBtn: $("trackerPapersBtn"),
    statsBtn: $("trackerStatsBtn"),
    exportBtn: $("trackerExportBtn"),
    importBtn: $("trackerImportBtn"),
    importFile: $("trackerImportFile"),

    papers: $("trackerPapers"),
    stats: $("trackerStats"),

    
    subjectList: $("trackerSubjectList"),
    addBtn: $("trackerAddBtn"),
    dropBtn: $("trackerDropBtn"),
    collapseBtn: $("trackerCollapseBtn"),
    paperGroups: $("trackerPaperGroups"),

    statsGrid: $("trackerStatsGrid"),

    modal: $("trackerModal"),
    modalOverlay: $("trackerModalOverlay"),
    modalClose: $("trackerModalClose"),
    modalTitle: $("trackerModalTitle"),
    formSubject: $("trackerFormSubject"),
    formYear: $("trackerFormYear"),
    formSeries: $("trackerFormSeries"),
    formNotes: $("trackerFormNotes"),
    saveBtn: $("trackerSaveBtn"),
    cancelBtn: $("trackerCancelBtn"),
    formMsg: $("trackerFormMsg"),

    colsBtn: $("trackerCustomiseBtn"),
    colsPop: $("trackerCustomisePop"),
    tableInfo: $("trackerTableInfo"),
    boundaryChips: $("trackerBoundaryChips"),
    boundaryNote: $("trackerBoundaryNote"),
    colList: $("trackerColList"),
    cusReset: $("trackerCusReset"),
    linkArea: $("trackerLinkArea"),
    linkPill: $("trackerLinkPill"),
    linkPop: $("trackerLinkPop"),
    linkFilter: $("trackerLinkFilter"),
    linkFilters: $("trackerLinkFilters"),
    linkList: $("trackerLinkList"),
    linkStatus: $("trackerLinkStatus"),
    unlinkBtn: $("trackerUnlinkBtn"),

    slotList: $("trackerSlotList"),
    addSlotBtn: $("trackerAddSlotBtn")
  };

  // ---- state ----
  let papers = [];
  let allSubjects = [];
  let subjectNodes = [];
  let boardsBySubject = {}; // subject -> examBoard (from subject nodes)
  let coursesBySubject = {}; // subject -> officially linked course { board, code, title, qual }
  let subjectMeta = {}; // subject -> { examBoard, qualification, code } for auto resolution
  const COL_DEFS = [
    { id: "boundary", label: "Boundary" },
    { id: "sitting", label: "Sitting" },
    { id: "avg", label: "Average" }
  ];
  const COL_DEFAULTS = { boundary: true, sitting: true, avg: true };
  let cols = loadCols(); // visible table columns, persisted in localStorage
  let aimGrades = loadAim(); // subject -> boundary grade labels shown as thresholds in the Boundary column
  let chipTokens = new Set(); // toggled quick-filter chips in the link picker — level + board coexist
  let linkHint = null; // auto-suggested official course for the scoped subject (one-click link)
  let focusedSubject = context.subject || null;
  let editingId = null;
  let slotSeq = 0;
  const expandedNotes = new Set();

  function loadCols() {
    try {
      const raw = JSON.parse(localStorage.getItem("neuronet:trackerCols") || "{}");
      const out = { ...COL_DEFAULTS };
      for (const k of Object.keys(COL_DEFAULTS)) if (typeof raw[k] === "boolean") out[k] = raw[k];
      return out;
    } catch (e) { return { ...COL_DEFAULTS }; }
  }
  function saveCols() {
    try { localStorage.setItem("neuronet:trackerCols", JSON.stringify(cols)); } catch (e) {}
  }
  function loadAim() {
    try { return JSON.parse(localStorage.getItem("neuronet:trackerAim") || "{}"); }
    catch (e) { return {}; }
  }
  function saveAimGrades() {
    try { localStorage.setItem("neuronet:trackerAim", JSON.stringify(aimGrades)); } catch (e) {}
  }
  // The grade thresholds shown for a subject in the Boundary column. Labels are
  // picked from the fetched pack; empty = use the top grade only.
  function aimFor(subject) {
    const raw = (subject && Array.isArray(aimGrades[subject])) ? aimGrades[subject] : [];
    return Array.from(new Set(raw.map((label) => canonicalGradeKey(label)).filter(Boolean)));
  }

  function nowISO() { return new Date().toISOString(); }
  function pct(score, max) {
    if (!Number.isFinite(score) || !Number.isFinite(max) || max <= 0) return null;
    return Math.round((score / max) * 100);
  }
  function isLow(p) { return p !== null && p < 60; }

  // ---- persistence ----
  async function loadPapers() {
    const all = await getAllNodes();
    papers = (all || []).filter((n) => n && n.type === "pastpaper");
    return papers;
  }

  async function loadSubjects() {
    try {
      allSubjects = (await getSubjects()) || [];
    } catch (e) {
      allSubjects = [];
    }
    boardsBySubject = {};
    coursesBySubject = {};
    subjectMeta = {};
    subjectNodes = [];
    try {
      const all = (await getAllNodes()) || [];
      for (const n of all) {
        if (n && n.type === "subject") {
          subjectNodes.push(n);
          const name = n.name || n.subject;
          if (name && n.examBoard) boardsBySubject[name] = n.examBoard;
          if (name && n.officialCourse && n.officialCourse.code) coursesBySubject[name] = n.officialCourse;
          if (name) subjectMeta[name] = {
            examBoard: n.examBoard || "",
            qualification: n.qualification || "",
            code: (n.officialCourse && n.officialCourse.code) || ""
          };
        }
      }
    } catch (e) { /* ignore */ }
  }

  async function persist(paper) {
    const now = nowISO();
    const record = {
      ...paper,
      type: "pastpaper",
      results: Array.isArray(paper.results) ? paper.results : [],
      createdAt: paper.createdAt || now,
      updatedAt: now
    };
    await addNode(record);
    await loadPapers();
    await loadSubjects();
  }

  async function persistMany(list) {
    const now = nowISO();
    const records = list.map((p) => ({
      ...p,
      type: "pastpaper",
      results: Array.isArray(p.results) ? p.results : [],
      createdAt: p.createdAt || now,
      updatedAt: now
    }));
    await addNodes(records);
    await loadPapers();
    await loadSubjects();
  }

  async function removePaper(paper) {
    const label = `${paper.subject} ${paper.year ?? ""}${paper.series ? " (" + paper.series + ")" : ""}`.trim();
    const confirmed = await dialog.confirm(`Delete this sitting?\n\n${label}`, "Delete", "danger");
    if (!confirmed) return;
    if (!paper.id) paper.id = `paper-${crypto.randomUUID()}`;
    await deleteNode(paper.id);
    await loadPapers();
    renderPapers();
  }

  // ---- board editing (per subject) ----
  function boardFor(subject) {
    if (subject && boardsBySubject[subject]) return boardsBySubject[subject];
    const p = papers.find((x) => x.subject === subject && x.examBoard);
    return p ? p.examBoard : "";
  }

  function qualFor(subject) {
    const node = subjectNodes.find((s) => (s.name || s.subject) === subject);
    return node ? (node.qualification || "") : "";
  }

  async function ensureSubjectMeta(subject, { examBoard, qualification }) {
    const name = (subject || "").trim();
    if (!name) return;
    const nodes = (await getAllNodes()) || [];
    const existing = nodes.find((n) => n.type === "subject" && (n.subject === name || n.name === name));
    const patch = {};
    if (examBoard != null) patch.examBoard = examBoard.trim();
    if (qualification != null) patch.qualification = qualification.trim();
    if (existing) {
      await addNode({ ...existing, ...patch, updatedAt: Date.now() });
    } else {
      await addNode({
        type: "subject", subject: name, name: name,
        examBoard: (examBoard || "").trim(),
        qualification: (qualification || "").trim(),
        customized: false, officialCourse: null,
        createdAt: Date.now(), updatedAt: Date.now()
      });
    }
    await loadSubjects();
  }

  async function setSubjectBoard(subject, board) {
    const name = (subject || "").trim();
    const b = (board || "").trim();
    if (!name) return;
    const nodes = (await getAllNodes()) || [];
    const existing = nodes.find((n) => n.type === "subject" && (n.subject === name || n.name === name));
    if (existing) {
      await addNode({ ...existing, examBoard: b, updatedAt: Date.now() });
    } else {
      await addNode({
        type: "subject",
        subject: name,
        name: name,
        examBoard: b,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }
    await loadSubjects();
    renderPapers();
  }

  // ---- auto grade boundaries ----
  // The official cached subject for a tracker subject. Never requires manual
  // linking: an explicit stored link wins, else we resolve it automatically
  // from the subject's meta (board/qualification/code) or by exact title match.
  function resolveCourse(cache, name) {
    if (!name) return null;
    const linked = coursesBySubject[name];
    if (linked && linked.code) {
      return linked;
    }
    const meta = subjectMeta[name] || {};
    if (meta.examBoard || meta.qualification) {
      const hit = matchOfficialCourse(cache, {
        board: meta.examBoard,
        qual: meta.qualification,
        title: name,
        code: meta.code
      });
      if (hit) {
        return hit;
      }
    }
    const norm = normalizeTitle(name);
    const hit2 = listCachedCourses(cache).find((c) => c.title && normalizeTitle(c.title) === norm) || null;
    return hit2;
  }

  function resolveBoundaryTable(subject, year, series, cacheSrc) {
    if (/^(mock|specimen)$/i.test(String(series || "").trim())) return null;
    const cache = cacheSrc || loadBoundaryCache();
    const course = subject ? resolveCourse(cache, subject) : null;
    if (!course) return null;
    const hit = findGradeTable(cache, course, year, series);
    if (!hit || !hit.subject) return null;
    return normalizeBoundaryTable({
      grades: hit.subject.grades || {},
      gradesInOrder: Array.isArray(hit.subject.gradesInOrder) ? hit.subject.gradesInOrder : [],
      maxMark: hit.subject.maxMark || null,
      papers: Array.isArray(hit.subject.papers) && hit.subject.papers.length ? hit.subject.papers : [],
      board: hit.boardId,
      qual: hit.qualId,
      seriesLabel: hit.series ? hit.series.label : null,
      seriesKey: hit.series ? `${hit.series.month}-${hit.series.year}` : null,
      fresh: !!hit.fresh
    });
  }

  // The ONE table a row renders from: live per-year cache resolution, else the
  // sitting's stored snapshot — both run through the canonical normalizer so
  // every consumer reads canonical grade keys.
  function effectiveTable(sitting, cacheSrc) {
    const live = resolveBoundaryTable(sitting.subject, numberEq(sitting.year), sitting.series, cacheSrc);
    if (live) {
      return live;
    }
    const snapshot = normalizeBoundaryTable(sitting && sitting.gradeBoundaries);
    return snapshot;
  }

  // Best-effort paper list for a subject: scan the cache across series for any
  // entry of this course that carries a component/paper list.
  function coursePapers(subject) {
    const course = subject ? resolveCourse(loadBoundaryCache(), subject) : null;
    if (!course) return null;
    const cache = loadBoundaryCache();
    for (const entry of Object.values(cache.entries || {})) {
      if (String(entry.board || "").toLowerCase() !== String(course.board || "").toLowerCase()) continue;
      if (String(entry.qual || "").toLowerCase() !== String(course.qual || "").toLowerCase()) continue;
      for (const it of entry.subjects || []) {
        if (it.code === course.code && Array.isArray(it.papers) && it.papers.length) return it.papers;
      }
    }
    return null;
  }

  function topGradeOf(table) {
    const normalized = normalizeBoundaryTable(table);
    const top = normalized && Array.isArray(normalized.gradesInOrder) ? normalized.gradesInOrder[0] : null;
    return top == null ? null : findGradeMark(normalized, top);
  }

  function boundsTooltip(gb) {
    const normalized = normalizeBoundaryTable(gb);
    const lines = normalized.gradesInOrder.filter((g) => Number.isFinite(normalized.grades[g])).map((g) => `${g}: ${normalized.grades[g]}`);
    return `${gb.seriesLabel || "Grade boundaries"}` + (lines.length ? " · " + lines.join(", ") : "");
  }

  function markForGrade(gb, label) {
    return findGradeMark(gb, label);
  }

  // Subject-level grade, NOT per-paper. Sums each paper's best-attempt raw total
  // and compares that aggregate against the whole-subject boundary table:
  //   - totalMax (sum of paper maxes) is compared to the subject maxMark. If they
  //     match, the grade is REAL. If papers are missing (totalMax < maxMark) the
  //     result is normalised to a percentage and reported as PROJECTED, not real.
  // Returns { grade, real, projected, answered, total, max } or null.
  function subjectGrade(sitting, gb) {
    if (!gb || !Array.isArray(gb.gradesInOrder) || !gb.gradesInOrder.length || !(gb.grades && typeof gb.grades === "object")) return null;
    if (!Number.isFinite(gb.maxMark) || gb.maxMark <= 0) return null;
    const rows = (sitting.results || []).map((r) => bestAttemptScore(r)).filter(Boolean);
    if (rows.length === 0) return null;
    const total = rows.reduce((m, b) => m + b.score, 0);
    const max = rows.reduce((m, b) => m + b.max, 0);
    if (max <= 0) return null;
    const real = Math.abs(max - gb.maxMark) <= 1;
    if (real) {
      const grade = scoreToGrade(gb.grades, gb.gradesInOrder, total);
      if (grade == null) return null;
      return { grade, real: true, projected: false, answered: rows.length, total, max, maxMark: gb.maxMark };
    }
    // incomplete — normalise both totals and boundary to percentage and project
    const pctScale = 100;
    const totalPct = (total / max) * pctScale;
    const boundPct = {};
    const boundOrder = [];
    for (const g of gb.gradesInOrder) {
      const m = gb.grades[g];
      if (!Number.isFinite(m)) continue;
      const scaled = (m / gb.maxMark) * pctScale;
      if (!boundPct[g]) { boundPct[g] = scaled; boundOrder.push(g); }
    }
    if (boundOrder.length === 0) return null;
    const grade = scoreToGrade(boundPct, boundOrder, totalPct);
    if (grade == null) return null;
    return { grade, real: false, projected: true, answered: rows.length, total, max, maxMark: gb.maxMark };
  }

  // Renders the subject-level grade badge. Explicitly labels projection so the
  // app never hypes a real grade that isn't earned yet.
  function subjectGradeChip(sitting, gb) {
    const sg = subjectGrade(sitting, gb);
    if (!sg) return "";
    if (sg.real) {
      return `<span class="head-grade real" title="Real subject grade (${escapeHtml(String(sg.answered))} paper(s) complete, totals ${sg.total}/${sg.maxMark})">${escapeHtml(sg.grade)}</span>`;
    }
    const totalPapers = gb && Array.isArray(gb.papers) && gb.papers.length ? gb.papers.length : null;
    const projected = `projected from ${sg.answered}${totalPapers ? "/" + totalPapers : ""} paper(s) \u2014 real once all papers are done`;
    return `<span class="head-grade proj" title="${escapeHtml(projected)}">${escapeHtml(sg.grade)} <em class="proj-label">proj</em></span>`;
  }

  // ---- table customise (persistent popover above the table) ----
  // The Boundary column shows the grade thresholds YOU want to aim for — picked
  // per subject from the fetched pack (the source of truth — the pack itself is
  // never edited here). Any number of grades: 9, 9+7, 9+4, 9+8+7, whatever.
  // Nothing picked = the top grade only, which is the default.
  function aimTable(subject) {
    const cache = loadBoundaryCache();
    const direct = resolveBoundaryTable(subject, null, null, cache);
    if (direct) return direct;
    const sitting = papers.find((p) => p.subject === subject && p.year != null);
    const resolved = sitting
      ? resolveBoundaryTable(subject, numberEq(sitting.year), sitting.series, cache)
      : null;
    if (resolved) return resolved;
    const stored = papers.find((p) => p.subject === subject && p.gradeBoundaries);
    return stored ? normalizeBoundaryTable(stored.gradeBoundaries) : null;
  }
  function pickableGrades(subject) {
    const cache = loadBoundaryCache();
    const course = subject ? resolveCourse(cache, subject) : null;
    const union = course ? courseGradeLabels(cache, course) : [];
    const tableLabels = (() => {
      const t = aimTable(subject);
      if (!t) return [];
      const raw = Array.isArray(t.gradesInOrder) && t.gradesInOrder.length
        ? t.gradesInOrder
        : t.grades && typeof t.grades === "object" ? Object.keys(t.grades) : [];
      return raw.map((g) => canonicalGradeKey(g)).filter((g) => g && g !== "U");
    })();
    const seen = new Set();
    const out = [];
    for (const label of [...union, ...tableLabels]) {
      if (!label || label === "U" || seen.has(label)) continue;
      seen.add(label);
      out.push(label);
    }
    return out;
  }
  function renderBoundaryChips() {
    if (el.boundaryChips) el.boundaryChips.innerHTML = "";
    if (el.boundaryNote) el.boundaryNote.textContent = "";
    if (!focusedSubject) {
      if (el.boundaryChips) el.boundaryChips.innerHTML = `<div class="tracker-cus-empty">Scope to one subject (sidebar) to pick the grades it aims for.</div>`;
      return;
    }
    const options = pickableGrades(focusedSubject);
    if (!options.length) {
      if (el.boundaryChips) el.boundaryChips.innerHTML = `<div class="tracker-cus-empty">No fetched boundaries for ${escapeHtml(focusedSubject)} yet &mdash; fetch them in the Scraper tool (or link the official subject).</div>`;
      return;
    }
    const selected = aimFor(focusedSubject);
    el.boundaryChips.innerHTML = options.map((g) =>
      `<button type="button" class="tracker-chip tracker-grade-chip ${selected.includes(g) ? "active" : ""}" data-g="${escapeHtml(g)}" title="Toggle grade ${escapeHtml(g)}${selected.includes(g) ? " (shown)" : ""}">` +
      `<span class="bmark">${escapeHtml(g)}</span>` +
      `</button>`
    ).join("");
    if (el.boundaryNote) el.boundaryNote.textContent = "";
  }

  function renderColList() {
    if (!el.colList) return;
    el.colList.innerHTML = COL_DEFS.map((c) =>
      `<button type="button" class="tracker-col-toggle ${cols[c.id] ? "" : "off"}" data-col="${c.id}">` +
      `<span class="check">&#10003;</span><span>${c.label}</span></button>`
    ).join("");
  }

  function toggleAim(subject, label) {
    if (!subject) return;
    aimGrades = loadAim();
    const canonical = canonicalGradeKey(label);
    let list = (aimGrades[subject] || []).slice().map((item) => canonicalGradeKey(item)).filter(Boolean);
    const idx = list.indexOf(canonical);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(canonical);
    aimGrades[subject] = Array.from(new Set(list));
    saveAimGrades();
    renderPapers();
  }

  // ---- link subject to an official course ----
  // Bound to the table bar's "Link subject" pill. Boundaries then auto-load from
  // the fetched pack; the auto-resolver also links by name when not explicit.
  function courseSummary(course) {
    if (!course) return "";
    const parts = [boardIdToName(course.board), qualIdToName(course.qual), course.code];
    return `${parts.filter(Boolean).join(" · ")}${course.title ? " — " + course.title : ""}`.trim();
  }

  function renderLinkArea() {
    if (!el.linkPill) return;
    const subject = focusedSubject;
    const course = subject ? coursesBySubject[subject] : null;
    linkHint = null;
    if (course) {
      el.linkPill.innerHTML = `<button type="button" class="tracker-link-pill linked" data-act="open" title="${escapeHtml(courseSummary(course))}"><i class="fa-solid fa-link"></i> ${escapeHtml(courseSummary(course))}</button>`;
    } else {
      linkHint = subject ? matchOfficialCourse(loadBoundaryCache(), {
        board: boardFor(subject),
        qual: qualFor(subject),
        title: subject,
        code: ""
      }) : null;
      if (linkHint) {
        el.linkPill.innerHTML = `<button type="button" class="tracker-link-pill suggest" data-act="suggest" title="Automatically linked from your fetched pack. Click to confirm.">Link: ${escapeHtml(courseSummary(linkHint))}</button>`;
      } else {
        el.linkPill.innerHTML = `<button type="button" class="tracker-link-pill" data-act="open"><i class="fa-solid fa-link"></i> Link subject</button>`;
      }
    }
    const pill = el.linkPill.querySelector(".tracker-link-pill");
    if (pill) {
      pill.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (pill.dataset.act === "suggest") {
          if (linkHint) applyOfficialCourse(subject, linkHint);
        } else {
          openLinkPicker(subject);
        }
      });
    }
  }

  function openLinkPicker(subject) {
    if (el.colsPop) el.colsPop.hidden = true;
    if (el.linkFilter) el.linkFilter.value = "";
    chipTokens.clear();
    renderCourseList();
    seedLinkCourses();
    if (el.unlinkBtn) el.unlinkBtn.hidden = !(subject && coursesBySubject[subject]);
    if (el.linkPop) el.linkPop.hidden = false;
  }

  function closeLinkPicker() {
    if (el.linkPop) el.linkPop.hidden = true;
    clearLinkScratch();
  }

  // Populate the link picker with official subjects for EVERY exam board —
  // AQA, OCR and Pearson — using the exact discovery + fetch engine the scraper
  // uses (gradeBoundaries.js). OCR keeps no baseline series list (discovery-only)
  // and Pearson's newest series is frequently unpublished/broken, so we iterate
  // EVERY series in every board's list for every qual — exactly like the
  // scraper's autoFetchLatest — not just the newest. The cache dedupes by
  // board:qual:code, so the union of all successfully-fetched series fills the
  // picker completely and survives any single bad file.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let linkSeedBusy = false;
  let linkSeedQueued = false;
  async function seedLinkCourses() {
    if (linkSeedBusy) {
      linkSeedQueued = true;
      return;
    }
    linkSeedBusy = true;
    renderCourseList();
    linkScratch("Scanning AQA, OCR and Pearson for grade boundaries...");
    try {
      // Best-effort discovery for OCR (no baseline list) and hashed URLs for
      // AQA/Pearson. Deterministic fallback URLs still work on failure.
      try {
        await discoverBoundarySeries((m) => linkScratch(m));
      } catch {
        /* keep going with baseline series + fallback URLs */
      }
      const boards = ["aqa", "ocr", "pearson"];
      const quals = ["gcse", "aLevel", "as"];
      const shownBusy = el.linkList && listCachedCourses(loadBoundaryCache()).length === 0;
      if (shownBusy) {
        el.linkList.innerHTML = `<div class="tracker-course-empty">Fetching official subjects from AQA, OCR and Pearson...</div>`;
      }
      const withCache = () => loadBoundaryCache();
      for (const board of boards) {
        const list = boundarySeriesList(board);
        if (list.length === 0) continue;
        const boardName = boardIdToName(board);
        const jobs = [];
        for (const series of list) {
          for (const qualId of quals) {
            const key = `${board}:${series.month}-${series.year}:${qualId}`;
            const entry = withCache().entries[key];
            if (entry && entry.subjects && entry.subjects.length) continue;
            jobs.push({ board, qualId, series });
          }
        }
        // Parse each file one at a time, yielding between jobs: pdf/xlsx
        // parsing is synchronous on the main thread, so a macrotask break lets
        // the skeleton animation / spinner actually repaint between files.
        for (const job of jobs) {
          await sleep(0);
          const qualName = qualIdToName(job.qualId);
          const label = `${job.series.label} ${boardName} ${qualName}`;
          linkScratch(`Fetching ${label}...`);
          try {
            await ensureBoundarySeries(job.board, { id: job.qualId }, job.series, (m) =>
              linkScratch(`${label}: ${m}`)
            );
          } catch {
            /* best-effort; that board/qual/series just stays uncached */
          }
        }
        // Let partial results appear as soon as each board's series finish, so
        // the picker fills live instead of hanging until the whole pass ends.
        const boardCount = listCachedCourses(loadBoundaryCache())
          .filter((c) => c.board === board).length;
        linkScratch(`${boardCount} ${boardName} subjects indexed so far...`);
        renderCourseList();
      }
      const total = listCachedCourses(loadBoundaryCache()).length;
      linkScratchDone(`${total} official subjects ready — search to link.`);
    } finally {
      linkSeedBusy = false;
      renderCourseList();
      if (linkSeedQueued) {
        linkSeedQueued = false;
        seedLinkCourses();
      }
    }
  }

  // Search strengthening: every whitespace token must match (order-independent),
  // and qual/board levels are NOT mutually exclusive — "chemistry aqa gcse" and
  // "a level" both work. Matches against title, code, board id/name, qual id/name.
  function normalizeSearch(raw) {
    return String(raw || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\ba level\b/g, "alevel")
      .replace(/\bas level\b/g, "as");
  }

  function courseTerms(c) {
    const set = new Set();
    const put = (...xs) => {
      for (const x of xs) {
        const t = String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        if (!t) continue;
        set.add(t);
        for (const part of t.split(/\s+/)) if (part) set.add(part);
      }
    };
    put(c.code);
    put(c.title);
    put(c.board, c.boardName);
    put(qualIdToName(c.qual), c.qualName);
    const qualProbe = normalizeSearch(`${qualIdToName(c.qual)} ${c.qualName || ""} ${c.qual || ""}`);
    if (qualProbe.includes("alevel")) { set.add("alevel"); set.add("a level"); }
    return set;
  }

  function matchesTokens(c, tokens) {
    if (tokens.length === 0) return true;
    const hay = courseTerms(c);
    return tokens.every((tok) => [...hay].some((h) => h.includes(tok)));
  }

  function queryTokens() {
    const typed = normalizeSearch(el.linkFilter ? el.linkFilter.value : "");
    const t = typed ? typed.split(/\s+/).filter(Boolean) : [];
    return [...new Set([...chipTokens, ...t])];
  }

  function chipForToken(tok) {
    if (tok === "alevel") return "alevel";
    if (tok === "as") return "as";
    if (tok === "gcse") return "gcse";
    if (tok === "aqa") return "aqa";
    if (tok === "ocr") return "ocr";
    if (tok && (tok === "pearson" || tok.includes("edexcel"))) return "pearson";
    return null;
  }

  function updateChipLighting() {
    if (!el.linkFilters) return;
    const tokens = queryTokens();
    const lit = new Set(tokens.map(chipForToken).filter(Boolean));
    if (tokens.length === 0) lit.add("");
    el.linkFilters.querySelectorAll(".tracker-chip").forEach((ch) =>
      ch.classList.toggle("active", lit.has(ch.dataset.f || ""))
    );
  }

  // Scraper-style "scratch buffer": one overwriting log line that sweeps a
  // green gradient while work is in progress, fills on completion, then
  // breathes softly. It never accumulates history — the most recent message
  // replaces the previous one.
  let linkScratchLine = null;
  let linkCompletionTimer = null;

  function linkScratch(message, shimmer = linkSeedBusy) {
    if (!el.linkStatus) return;
    el.linkStatus.hidden = false;
    if (!linkScratchLine) {
      linkScratchLine = document.createElement("div");
      linkScratchLine.className = "tracker-log-line";
      linkScratchLine.innerHTML = `<span class="tracker-log-text"></span>`;
      el.linkStatus.appendChild(linkScratchLine);
    }
    const text = linkScratchLine.querySelector(".tracker-log-text");
    if (text) text.textContent = message;
    if (linkCompletionTimer) clearTimeout(linkCompletionTimer);
    linkCompletionTimer = null;
    linkScratchLine.classList.remove("idle", "tracker-log-done", "tracker-log-glow");
    linkScratchLine.classList.toggle("tracker-log-shimmer", !!shimmer);
  }

  function linkScratchDone(message) {
    linkScratch(message, false);
    if (!linkScratchLine) return;
    if (linkCompletionTimer) clearTimeout(linkCompletionTimer);
    linkScratchLine.classList.remove("tracker-log-shimmer", "tracker-log-done", "tracker-log-glow");
    linkScratchLine.classList.add("tracker-log-done");
    linkCompletionTimer = setTimeout(() => {
      linkScratchLine.classList.remove("tracker-log-done");
      linkScratchLine.classList.add("tracker-log-glow");
      linkCompletionTimer = null;
    }, 2000);
  }

  function clearLinkScratch() {
    if (linkCompletionTimer) clearTimeout(linkCompletionTimer);
    linkCompletionTimer = null;
    linkScratchLine = null;
    if (el.linkStatus) {
      el.linkStatus.innerHTML = "";
      el.linkStatus.hidden = true;
    }
  }

  function renderLinkStatus() {
    if (!el.linkStatus) return;
    if (!linkSeedBusy) {
      if (el.linkFilter) el.linkFilter.classList.remove("tracker-input-skeleton");
      return;
    }
    if (el.linkFilter) el.linkFilter.classList.add("tracker-input-skeleton");
    if (!linkScratchLine) linkScratch("Fetching official subjects from AQA, OCR and Pearson...");
  }

  const TRACKER_SKELETON_ROWS = 6;

  function renderCourseList() {
    const courses = listCachedCourses(loadBoundaryCache());
    const tokens = queryTokens();
    const visible = courses.filter((c) => matchesTokens(c, tokens));
    updateChipLighting();
    renderLinkStatus();
    const subject = focusedSubject;
    const current = subject ? coursesBySubject[subject] : null;

    if (!el.linkList) return;
    if (visible.length === 0) {
      if (linkSeedBusy && courses.length === 0) {
        // Loading placeholder: shimmer rows until the first subjects land so
        // the popover shows instant, tangible progress instead of a plain text
        // line while the fetch pass runs.
        el.linkList.innerHTML =
          `<div class="tracker-track-skel">` +
          Array.from({ length: TRACKER_SKELETON_ROWS }, () => `<div class="tracker-track-skel-row"></div>`).join("") +
          `</div>`;
        return;
      }
      el.linkList.innerHTML = courses.length === 0
        ? `<div class="tracker-course-empty">No subjects available yet &mdash; fetching from AQA, OCR and Pearson failed, or there's no cached data. Open the <b>Scraper</b> tool to fetch boundaries manually.</div>`
        : `<div class="tracker-course-empty">No subjects match those filters.</div>`;
      return;
    }

    let html = "";
    let lastBoard = "";
    for (const c of visible) {
      if (c.boardName !== lastBoard) {
        if (lastBoard !== "") html += "</div>";
        html += `<div class="tracker-course-board">${escapeHtml(c.boardName)}</div>`;
        lastBoard = c.boardName;
      }
      const isSel = !!current && c.board === current.board && c.code === current.code && c.qual === current.qual && normalizeTitle(c.title) === normalizeTitle(current.title);
      const codeTxt = c.code ? `<span class="course-code">${escapeHtml(c.code)}</span> ` : "";
      html +=
        `<button type="button" class="tracker-course-item${isSel ? " sel" : ""}" data-board="${escapeHtml(c.board)}" data-qual="${escapeHtml(c.qual)}" data-code="${escapeHtml(c.code)}" data-title="${escapeHtml(c.title || "")}">` +
        `${codeTxt}${escapeHtml(c.title)} <span class="course-qual">${escapeHtml(c.qualName)}${c.maxMark ? ` &middot; max ${escapeHtml(String(c.maxMark))}` : ""}</span>` +
        `</button>`;
    }
    html += "</div>";
    el.linkList.innerHTML = html;
  }

  async function applyOfficialCourse(subject, candidate) {
    if (!subject || !candidate) return;
    if (el.linkList) el.linkList.innerHTML = "";
    try {
      const nodes = (await getAllNodes()) || [];
      const existing = nodes.find((n) => n.type === "subject" && (n.subject === subject || n.name === subject));
      const course = { board: candidate.board, code: candidate.code, title: candidate.title, qual: candidate.qual };
      if (existing) {
        await addNode({
          ...existing,
          officialCourse: course,
          customized: false,
          examBoard: existing.examBoard || candidate.boardName,
          qualification: existing.qualification || candidate.qualName,
          updatedAt: Date.now()
        });
      } else {
        await addNode({
          type: "subject", subject, name: subject,
          examBoard: candidate.boardName,
          qualification: candidate.qualName,
          customized: false,
          officialCourse: course,
          createdAt: Date.now(), updatedAt: Date.now()
        });
      }
      await loadSubjects();
      closeLinkPicker();
      renderPapers();
      flash(`Linked ${subject} to ${courseSummary(course)}. Boundaries auto-load from the fetched pack.`, true);
    } catch (err) {
      if (el.linkList) el.linkList.innerHTML = `<div class="tracker-course-empty">Could not link ${escapeHtml(subject)} (${escapeHtml(err && err.message ? err.message : String(err))}).</div>`;
    }
  }

  async function unlinkOfficialCourse(subject) {
    if (!subject) return;
    if (el.linkList) el.linkList.innerHTML = "";
    const confirmed = await dialog.confirm(`Unlink ${subject} from its official course?`, "Unlink", "danger");
    if (!confirmed) return;
    try {
      const nodes = (await getAllNodes()) || [];
      const existing = nodes.find((n) => n.type === "subject" && (n.subject === subject || n.name === subject));
      if (existing) {
        await addNode({ ...existing, officialCourse: null, updatedAt: Date.now() });
      } else {
        await addNode({
          type: "subject", subject, name: subject,
          examBoard: "", qualification: "", customized: false, officialCourse: null,
          createdAt: Date.now(), updatedAt: Date.now()
        });
      }
      await loadSubjects();
      closeLinkPicker();
      renderPapers();
      flash(`Unlinked ${subject}.`, true);
    } catch (err) {
      if (el.linkList) el.linkList.innerHTML = `<div class="tracker-course-empty">Could not unlink ${escapeHtml(subject)} (${escapeHtml(err && err.message ? err.message : String(err))}).</div>`;
    }
  }

  // ---- view switching ----
  function showView(view) {
    el.papers.style.display = view === "papers" ? "" : "none";
    el.stats.style.display = view === "stats" ? "" : "none";
    el.papersBtn.classList.toggle("active", view === "papers");
    el.statsBtn.classList.toggle("active", view === "stats");
    if (view === "papers") renderPapers();
    if (view === "stats") renderStats();
  }

  // ---- papers list ----
  function refreshSubjectDatalist() {
    const seen = new Set(allSubjects.map((s) => (typeof s === "string" ? s : s?.name)).filter(Boolean));
    for (const p of papers) if (p.subject) seen.add(p.subject);
    el.subjectList.innerHTML = Array.from(seen).map((s) => `<option value="${escapeHtml(s)}">`).join("");
  }

  function sittingAverage(sitting) {
    const scored = (sitting.results || []).map((r) => bestAttemptPct(r)).filter((p) => p !== null);
    if (scored.length === 0) return null;
    return Math.round(scored.reduce((m, p) => m + p, 0) / scored.length);
  }

  function latestAttempt(result) {
    if (!result.attempts || result.attempts.length === 0) return result;
    return result.attempts[result.attempts.length - 1];
  }

  function numberEq(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function bestAttemptPct(result) {
    const list = (result.attempts && result.attempts.length ? result.attempts : [result]);
    let best = null;
    for (const a of list) {
      const score = numberEq(a.score);
      const max = numberEq(a.maxMarks);
      if (score === null || max === null || max <= 0) continue;
      const p = pct(score, max);
      if (best === null || p > best) best = p;
    }
    return best;
  }

  function compareSorted(a, b) {
    const yb = (numberEq(b.year) || 0) - (numberEq(a.year) || 0);
    if (yb !== 0) return yb;
    const SESSION_ORDER = { "November": 3, "October": 2, "June": 1, "May": 1, "March": 0, "Specimen": -1, "Mock": -1 };
    const sb = (SESSION_ORDER[b.series] ?? 0) - (SESSION_ORDER[a.series] ?? 0);
    if (sb !== 0) return sb;
    return 0;
  }

  function visiblePapers() {
    return focusedSubject
      ? papers.filter((p) => (p.subject || "Unassigned") === focusedSubject)
      : papers;
  }

  function setAllNotes(open) {
    const visible = visiblePapers();
    for (const s of visible) {
      if (!s.notes) continue;
      if (open) expandedNotes.add(s.id);
      else expandedNotes.delete(s.id);
    }
    renderPapers();
  }

  function renderPapers() {
    refreshSubjectDatalist();

    const showAll = !focusedSubject;
    const visible = visiblePapers();

    if (el.tableInfo) {
      el.tableInfo.innerHTML = showAll
        ? `All subjects`
        : `<b>${escapeHtml(focusedSubject)}</b> &middot; ${visible.length} sitting${visible.length === 1 ? "" : "s"}`;
    }

    const anyNotes = visible.some((s) => !!s.notes);
    el.dropBtn.disabled = !anyNotes;
    el.collapseBtn.disabled = !anyNotes;

    if (showAll) {
      if (el.linkPill) el.linkPill.innerHTML = "";
    } else {
      renderLinkArea();
    }

    el.paperGroups.innerHTML = "";
    if (visible.length === 0) {
      el.paperGroups.innerHTML =
        '<div class="tracker-empty">' + (showAll ? "No past papers tracked yet." : `No past papers for <b>${escapeHtml(focusedSubject)}</b> yet.`) +
        '<br><button id="trackerEmptyAddBtn" class="tracker-btn primary">Add a sitting</button></div>';
      const b = $("trackerEmptyAddBtn");
      if (b) b.addEventListener("click", () => openModal(null));
      return;
    }

    const sorted = visible.slice().sort(compareSorted);
    const cacheSrc = loadBoundaryCache();

    const scroll = document.createElement("div");
    scroll.className = "sit-scroll";
    const table = document.createElement("table");
    table.className = "sit-table";
    const thead = document.createElement("thead");
    let header = `<tr>` + (showAll ? `<th class="col-subject">Subject</th>` : "");
    if (cols.sitting) header += `<th class="col-session">Sitting</th>`;
    header += `<th class="col-papers">Papers</th>`;
    if (cols.boundary) header += `<th class="col-boundary">Boundary</th>`;
    if (cols.avg) header += `<th class="col-avg">Avg</th>`;
    header += `<th class="col-actions"></th></tr>`;
    thead.innerHTML = header;
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    const openNow = new Set(expandedNotes);
    for (const sitting of sorted) {
      const hasNote = !!sitting.notes;
      const row = renderMainRow(sitting, showAll, hasNote && openNow.has(sitting.id), cacheSrc);
      tbody.appendChild(row.main);
      if (hasNote) {
        row.note.hidden = !openNow.has(sitting.id);
        tbody.appendChild(row.note);
      }
    }
    table.appendChild(tbody);
    scroll.appendChild(table);
    el.paperGroups.appendChild(scroll);
    maybeWarmBoundaries();
  }

  // Auto-ensure boundary packs for every dated row that has no cached table
  // yet. The scraper's own fetch engine (discovery + download + parse) lives in
  // gradeBoundaries.js and is reused here, so per-year boundaries are populated
  // automatically — the user never has to "warm" anything by hand.
  let warmBusy = false;
  let warmQueued = false;
  async function maybeWarmBoundaries() {
    if (warmBusy) {
      warmQueued = true;
      return;
    }
    warmBusy = true;
    try {
      const cache = loadBoundaryCache();
      const jobs = new Map();
      for (const sitting of papers || []) {
        if (!sitting || !sitting.subject) continue;
        const seriesWord = sitting.series;
        if (/^(mock|specimen)$/i.test(String(seriesWord || "").trim())) continue;
        const year = numberEq(sitting.year);
        if (year === null) continue;
        const course = resolveCourse(cache, sitting.subject);
        if (!course) continue;
        const board = boardToId(course && course.board);
        const qualId = qualToId(course && course.qual);
        if (!board || !qualId) continue;
        // Already resolvable from the cache — nothing to do for this row.
        if (findGradeTable(cache, course, year, seriesWord)) continue;
        const target = bestSeriesForYear(board, year, trackerSeriesToMonth(seriesWord));
        if (!target) continue;
        const key = `${board}|${qualId}|${target.month}-${target.year}`;
        if (!jobs.has(key)) jobs.set(key, { board, qualId, series: target });
      }
      if (jobs.size === 0) return;
      // Discovery improves URL accuracy (hashed 2024+ AQA files); best-effort.
      try {
        await discoverBoundarySeries(() => {});
      } catch {
        /* keep going with deterministic fallback URLs */
      }
      let fetchedAny = false;
      const list = [...jobs.values()];
      for (const { board, qualId, series } of list) {
        await sleep(0);
        try {
          const subjects = await ensureBoundarySeries(board, qualId, series, () => {});
          if (subjects && subjects.length) fetchedAny = true;
        } catch (e) {
          /* best-effort; a failure just leaves that series uncached */
        }
      }
      if (fetchedAny) renderPapers();
    } finally {
      warmBusy = false;
      if (warmQueued) {
        warmQueued = false;
        maybeWarmBoundaries();
      }
    }
  }

  function shortSeries(s) {
    if (!s) return "";
    const m = { june: "J", jun: "J", summer: "S", november: "N", nov: "N", autumn: "A", winter: "W", march: "M" };
    const k = String(s).toLowerCase();
    return m[k] ? m[k] : String(s);
  }

  function sessionTitle(sitting) {
    if (sitting.year == null || sitting.year === "") {
      if (sitting.series) return escapeHtml(shortSeries(sitting.series));
      if (sitting.label) return escapeHtml(String(sitting.label));
      return "Unstated";
    }
    let t = String(sitting.year);
    const ser = shortSeries(sitting.series);
    if (ser) t += " <span class=\"series\">(" + escapeHtml(ser) + ")</span>";
    return t;
  }

  function scoreSummary(sitting) {
    const parts = (sitting.results || []).map((r) => {
      const at = latestAttempt(r);
      const score = numberEq(at.score);
      const max = numberEq(at.maxMarks);
      if (score == null || max == null) return null;
      const short = r.paper ? r.paper.replace(/^Paper\s+/i, "P") : "?";
      const p = pct(score, max);
      const low = p !== null && isLow(p) ? " low" : "";
      return `<span class="head-score"><span class="head-score-name">${escapeHtml(short)}</span> <b${low}>${score}</b>/<i>${max}</i>${p != null ? ` <em>${p}%</em>` : ""}</span>`;
    }).filter(Boolean);
    if (parts.length === 0) return `<span class="tracker-sitting-badge">no scores</span>`;
    return `<span class="head-scores">${parts.join("")}</span>`;
  }

  function highestGradeLabel(subject) {
    const subjNode = subjectNodes.find((s) => (s.name || s.subject) === subject);
    const q = subjNode ? (subjNode.qualification || "") : "";
    if (/A.?Level/i.test(q)) return "A*";
    if (/GCSE/i.test(q)) return "Grade 9";
    return "Boundary";
  }

  async function ensureQualifications() {
    const want = Array.from(new Set(papers.map((p) => p.subject).filter(Boolean)));
    const missing = [];
    for (const subject of want) {
      const node = subjectNodes.find((s) => (s.name || s.subject) === subject);
      if (node && node.qualification) continue; // already set
      if (!node) {
        await addNode({
          type: "subject", subject, name: subject,
          examBoard: "", qualification: "", customized: false, officialCourse: null,
          createdAt: Date.now(), updatedAt: Date.now()
        });
      }
      missing.push(subject);
    }
    if (missing.length === 0) return;

    let answer = null;
    if (missing.length === 1) {
      answer = await dialog.prompt(`Is ${missing[0]} GCSE or A-Level?`, "GCSE");
    } else {
      answer = await dialog.prompt(`What level are these subjects: ${missing.join(", ")}?\n(GCSE or A-Level - drives the grade labels)`, "GCSE");
    }
    if (answer === null) return; // user declined
    const qual = (answer || "").trim();
    if (!qual) return;
    for (const subject of missing) {
      const nodes = (await getAllNodes()) || [];
      const n = nodes.find((x) => x.type === "subject" && (x.subject === subject || x.name === subject));
      if (n) await addNode({ ...n, qualification: qual, updatedAt: Date.now() });
    }
    await loadSubjects();
  }

  function renderMainRow(sitting, showSubject, noteOpen, cacheSrc) {
    const storedBoundary = numberEq(sitting.gradeBoundary);
    const gb = effectiveTable(sitting, cacheSrc);
    const boundary = gb ? null : (storedBoundary === 0 ? null : storedBoundary);
    const hasG = !!(gb && Array.isArray(gb.gradesInOrder) && gb.gradesInOrder.length && gb.grades && typeof gb.grades === "object");

    const avg = sittingAverage(sitting);
    const avgEl = avg !== null
      ? `<span style="color:${avg < 60 ? "#ff8c8c" : "var(--accent)"};font-weight:700;">${avg}%</span>`
      : `<span class="tracker-sitting-badge">&ndash;</span>`;

    const tr = document.createElement("tr");
    tr.className = "row-main";

    const cells = [];
    if (showSubject) {
      cells.push(td(`<span class="sit-subject">${escapeHtml(sitting.subject || "Unassigned")}</span>`, "col-subject"));
    }
    if (cols.sitting) {
      cells.push(td(`<span class="sit-session">${sessionTitle(sitting)}</span>`, "col-session"));
    }
    cells.push(td(`<div class="sit-papers">${scoreSummary(sitting)}${subjectGradeChip(sitting, gb)}</div>`, "col-papers"));
    if (cols.boundary) {
      cells.push(td(boundaryBadges(sitting.subject, gb, hasG, boundary), "col-boundary"));
    }
    if (cols.avg) {
      cells.push(td(avgEl, "col-avg"));
    }

    const hasNote = !!sitting.notes;
    const actionsCell = document.createElement("td");
    actionsCell.className = "col-actions";
    actionsCell.innerHTML =
      (hasNote ? `<button class="row-btn note-toggle ${noteOpen ? "open" : ""}" data-act="note" title="${noteOpen ? "Collapse" : "Expand"} note">` +
        `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 15.7v-5.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="7.1" r="1.3" fill="currentColor"/></svg>` +
        `</button>` : "") +
      `<button class="row-btn" data-act="edit" title="Edit">&#9998;</button>` +
      `<button class="row-btn danger" data-act="del" title="Delete">&#10005;</button>`;
    if (hasNote) {
      actionsCell.querySelector('[data-act="note"]').addEventListener("click", () => toggleNote(sitting));
    }
    actionsCell.querySelector('[data-act="edit"]').addEventListener("click", () => openModal(sitting));
    actionsCell.querySelector('[data-act="del"]').addEventListener("click", () => removePaper(sitting));
    cells.push(actionsCell);

    for (const c of cells) tr.appendChild(c);

    let note = null;
    if (hasNote) {
      note = document.createElement("tr");
      note.className = "note-row";
      const ntd = document.createElement("td");
      ntd.colSpan = cells.length;
      ntd.innerHTML = `<div class="note-inner"></div>`;
      ntd.firstChild.textContent = sitting.notes;
      note.appendChild(ntd);
    }
    return { main: tr, note };
  }

  // Boundary column content. Default: the top grade's threshold (from the fetched
  // pack — the source of truth). When the user picked aim grades for the subject,
  // show those thresholds instead so they see hit/miss against their target.
  // Picked grades always render: from the row's own per-year table when it
  // resolves, else from the subject's best available table (the same one the
  // picker populates from) — so custom picks never silently collapse back to the
  // default top-grade badge just because one year's pack is unfetchable.
  function boundaryBadges(subject, gb, hasG, boundary) {
    const aim = aimFor(subject);
    const pickTable = (aim.length && gb && Array.isArray(gb.gradesInOrder))
      ? gb
      : (aim.length ? aimTable(subject) : null);
    const tip = pickTable && Array.isArray(pickTable.gradesInOrder) ? boundsTooltip(pickTable) : null;
    if (aim.length && pickTable && Array.isArray(pickTable.gradesInOrder)) {
      const items = aim.map((label) => {
        const mark = markForGrade(pickTable, label);
        return { label, mark };
      });
      if (items.length) {
        return items.map((x) =>
          `<span class="tracker-sitting-badge bnd" title="${escapeHtml(tip)}">${escapeHtml(x.label)} &ge; ${x.mark != null ? escapeHtml(String(x.mark)) : "&ndash;"}</span>`
        ).join("");
      }
    }
    if (boundary !== null || hasG) {
      const topLabel = escapeHtml(highestGradeLabel(subject));
      const shownMark = hasG ? topGradeOf(gb) : boundary;
      return `<span class="tracker-sitting-badge bnd"${tip !== null ? ` title="${escapeHtml(tip)}"` : ""}>${topLabel}${shownMark !== null ? ` &ge; ${shownMark}` : ""}</span>`;
    }
    return `<span class="tracker-sitting-badge">&ndash;</span>`;
  }

  function td(html, cls) {
    const c = document.createElement("td");
    if (cls) c.className = cls;
    c.innerHTML = html;
    return c;
  }

  function toggleNote(sitting) {
    const id = sitting.id;
    if (expandedNotes.has(id)) expandedNotes.delete(id);
    else expandedNotes.add(id);
    renderPapers();
  }

  // ---- modal (add / edit a sitting) ----
  function openModal(sitting) {
    editingId = sitting ? sitting.id : null;
    slotSeq = (sitting && sitting.results) ? sitting.results.map((r) => r.paper || "").filter(Boolean) : [];
    el.modalTitle.textContent = editingId ? "Edit sitting" : "Add sitting";

    const initSubject = sitting ? (sitting.subject || "") : (focusedSubject || "");
    el.formSubject.value = initSubject;
    el.formYear.value = sitting ? (sitting.year ?? "") : "";
    el.formSeries.value = sitting ? (sitting.series || "") : "";
    el.formNotes.value = sitting ? (sitting.notes || "") : "";

    const slots = sitting ? (sitting.results || []) : [];
    el.slotList.innerHTML = "";
    const premade = sitting ? null : coursePapers(initSubject);
    if (premade && premade.length) {
      premade.forEach((p) => addSlotRow(null, { paper: p.label, maxMark: p.maxMark }));
    } else if (slots.length === 0) addSlotRow();
    else slots.forEach((r) => addSlotRow(r));

    el.formMsg.textContent = "";
    el.modal.classList.add("open");
    setTimeout(() => el.formSubject.focus(), 0);
  }

  function todayDate() {
    return new Date().toISOString().slice(0, 10);
  }

  function addSlotRow(result, preset) {
    const idx = el.slotList.children.length;
    const row = document.createElement("div");
    row.className = "tracker-slot-editor";
    row.dataset.slot = idx;

    const att = (result && result.attempts) ? result.attempts : [];
    const base = result || {};
    const fresh = att.length === 0;
    const baseMax = fresh && preset && preset.maxMark != null ? preset.maxMark : null;

    let attemptsHTML = "";
    const list = att.length ? att : [{ score: base.score, maxMarks: base.maxMarks, date: base.date }];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const maxVal = a.maxMarks != null ? a.maxMarks : baseMax;
      const dateVal = a.date || (fresh && i === 0 ? todayDate() : "");
      attemptsHTML +=
        `<div class="attempt-row">` +
        `<label style="flex:none;font-size:0.75rem;color:var(--text-muted);">${i === 0 ? "1st" : i === 1 ? "2nd" : (i + 1) + "th"}:</label>` +
        `<input data-att-score class="tracker-att-score" type="number" placeholder="Score" value="${a.score != null ? escapeHtml(String(a.score)) : ""}" />` +
        `<input data-att-max class="tracker-att-max" type="number" placeholder="Max" value="${maxVal != null ? escapeHtml(String(maxVal)) : ""}" />` +
        `<input data-att-date class="tracker-att-date" type="text" placeholder="Date" value="${dateVal ? escapeHtml(String(dateVal)) : ""}" />` +
        `<button class="tracker-att-del" type="button" title="Remove attempt">&times;</button>` +
        `</div>`;
    }

    const usedNames = new Set(slotSeq);
    let paperVal = (preset && preset.paper) || base.paper || "";
    if (!paperVal) {
      let n = 1;
      while (usedNames.has("Paper " + n)) n++;
      paperVal = "Paper " + n;
    }
    usedNames.add(paperVal);

    row.innerHTML =
      `<div class="head">` +
      `<input class="tracker-slot-paper" type="text" placeholder="Paper name" value="${escapeHtml(paperVal)}" />` +
      `<button type="button" class="tracker-slot-del" title="Remove paper">Remove</button>` +
      `</div>` +
      `<div class="tracker-att-list">${attemptsHTML}</div>` +
      `<button type="button" class="tracker-att-add">+ Attempt</button>`;

    row.querySelector(".tracker-slot-del").addEventListener("click", () => row.remove());
    row.querySelector(".tracker-att-add").addEventListener("click", () => {
      const wrap = row.querySelector(".tracker-att-list");
      const div = document.createElement("div");
      div.className = "attempt-row";
      div.innerHTML =
        `<label style="flex:none;font-size:0.75rem;color:var(--text-muted);">${wrap.children.length + 1}-th:</label>` +
        `<input data-att-score type="number" placeholder="Score" />` +
        `<input data-att-max type="number" placeholder="Max" />` +
        `<input data-att-date type="text" placeholder="Date" value="${todayDate()}" />` +
        `<button class="tracker-att-del" type="button" title="Remove attempt">&times;</button>`;
      div.querySelector(".tracker-att-del").addEventListener("click", () => div.remove());
      wrap.appendChild(div);
    });
    row.querySelectorAll(".tracker-att-del").forEach((b) =>
      b.addEventListener("click", (e) => {
        const wrap = row.querySelector(".tracker-att-list");
        if (wrap.children.length <= 1) return;
        e.target.closest(".attempt-row").remove();
      })
    );

    el.slotList.appendChild(row);
  }

  function closeModal() {
    el.modal.classList.remove("open");
    editingId = null;
  }

  async function collectSitting() {
    const subject = el.formSubject.value.trim();
    const yearRaw = el.formYear.value.trim();
    const year = yearRaw === "" ? null : Number(yearRaw);
    const series = el.formSeries.value;
    const notes = el.formNotes.value.trim();
    const examBoard = boardFor(subject);
    const qualification = qualFor(subject);

    if (!subject) { flash("Subject is required.", false); return null; }
    if ((year !== null && !Number.isFinite(year))) { flash("Enter a valid year.", false); return null; }

    const gradeBoundaries = resolveBoundaryTable(subject, year, series) || null;
    let boundary = gradeBoundaries ? topGradeOf(gradeBoundaries) : null;
    if (boundary === null) {
      const existing = editingId && papers.find((p) => p.id === editingId);
      const existingBoundary = existing ? numberEq(existing.gradeBoundary) : null;
      if (existingBoundary !== null && existingBoundary !== 0) boundary = existingBoundary;
      else {
        const sittingLabel = [year, series].filter(Boolean).join(" ") || "this sitting";
        const continueManual = await dialog.confirm(
          `No official grade-boundary data is available for ${subject} (${sittingLabel}). You will need to enter the boundary yourself.`,
          "Enter manually",
          "primary"
        );
        if (!continueManual) { flash("Sitting not saved: a boundary is required.", false); return null; }
        const raw = await dialog.prompt(
          `Enter the top-grade boundary mark for ${subject} (${sittingLabel}). This value will be saved with this sitting.`,
          ""
        );
        if (raw === null || raw.trim() === "") { flash("Sitting not saved: enter a boundary mark.", false); return null; }
        boundary = Number(raw.trim());
        if (!Number.isFinite(boundary) || boundary < 0) {
          flash("Sitting not saved: the boundary must be a non-negative number.", false);
          return null;
        }
      }
    }

    const results = [];
    for (const row of el.slotList.querySelectorAll(".tracker-slot-editor")) {
      const paper = row.querySelector(".tracker-slot-paper").value.trim();
      if (!paper) continue;
      const attempts = [];
      for (const ar of row.querySelectorAll(".attempt-row")) {
        const score = ar.querySelector("[data-att-score]").value.trim();
        const max = ar.querySelector("[data-att-max]").value.trim();
        if (score === "" && max === "") continue;
        if (score === "" || max === "") { flash("Each attempt needs both score and max.", false); return null; }
        const nScore = Number(score), nMax = Number(max);
        if (!Number.isFinite(nScore) || !Number.isFinite(nMax)) { flash("Scores must be numbers.", false); return null; }
        attempts.push({ score: nScore, maxMarks: nMax, date: ar.querySelector("[data-att-date]").value.trim() });
      }
      if (attempts.length === 0) continue;
      results.push({
        paper,
        score: attempts[attempts.length - 1].score,
        maxMarks: attempts[attempts.length - 1].maxMarks,
        date: attempts[attempts.length - 1].date,
        attempts
      });
    }

    return { subject, year, series, gradeBoundary: boundary, gradeBoundaries, notes, examBoard, qualification, results };
  }

  function flash(text, ok) {
    el.formMsg.textContent = text;
    el.formMsg.className = "tracker-form-msg " + (ok ? "ok" : "err");
    clearTimeout(flash._t);
    flash._t = setTimeout(() => { el.formMsg.textContent = ""; }, 3000);
  }

  async function save() {
    const data = await collectSitting();
    if (!data) return;
    const now = nowISO();
    if (editingId) {
      const existing = papers.find((p) => p.id === editingId);
      await persist({
        ...existing,
        ...data,
        id: editingId,
        createdAt: existing ? existing.createdAt : now
      });
      flash("Saved.", true);
    } else {
      await persist({ ...data, id: `paper-${crypto.randomUUID()}`, createdAt: now });
      flash("Added.", true);
    }
    await ensureSubjectMeta(data.subject, {
      examBoard: data.examBoard || "",
      qualification: data.qualification || qualFor(data.subject)
    });
    closeModal();
    renderPapers();
    if (window.__neuronetRefreshSubjects) window.__neuronetRefreshSubjects();
  }

  // ---- stats ----
  function bestAttemptScore(result) {
    const list = (result.attempts && result.attempts.length ? result.attempts : [result]);
    return list.map((a) => ({ score: numberEq(a.score), max: numberEq(a.maxMarks) }))
      .filter((a) => a.score !== null && a.max !== null && a.max > 0)
      .reduce((best, a) => (best === null || pct(a.score, a.max) > pct(best.score, best.max) ? a : best), null);
  }

  function renderStats() {
    const bySubject = {};
    for (const p of papers) {
      (bySubject[p.subject || "Unassigned"] = bySubject[p.subject || "Unassigned"] || []).push(p);
    }
    el.statsGrid.innerHTML = "";
    const names = Object.keys(bySubject).sort();
    if (names.length === 0) {
      el.statsGrid.innerHTML = '<div class="tracker-empty">No data yet. Add some sittings.</div>';
      return;
    }
    const cacheSrc = loadBoundaryCache();
    for (const subject of names) {
      const set = bySubject[subject];
      const bests = [];
      const gradeCounts = {};
      let projCount = 0, realCount = 0;
      for (const s of set) {
        const gb = effectiveTable(s, cacheSrc);
        const hasT = !!(gb && Array.isArray(gb.gradesInOrder) && gb.gradesInOrder.length && gb.grades && typeof gb.grades === "object");
        for (const r of s.results || []) {
          const b = bestAttemptScore(r);
          if (!b) bests.push(null);
          else bests.push(b);
        }
        if (hasT) {
          const sg = subjectGrade(s, gb);
          if (sg) {
            if (sg.real) { gradeCounts[sg.grade] = (gradeCounts[sg.grade] || 0) + 1; realCount++; }
            else { gradeCounts[sg.grade] = (gradeCounts[sg.grade] || 0) + 1; projCount++; }
          }
        }
      }
      const seen = bests.filter((b) => b !== null);
      const avg = seen.length ? Math.round(seen.reduce((m, b) => m + pct(b.score, b.max), 0) / seen.length) : null;
      const max = seen.length ? Math.max(...seen.map((b) => pct(b.score, b.max))) : null;
      const min = seen.length ? Math.min(...seen.map((b) => pct(b.score, b.max))) : null;

      const dist = Object.keys(gradeCounts).sort().map((g) => `${g}\u00d7${gradeCounts[g]}`).join(" ");
      const projNote = projCount ? ` <em style="color:var(--text-muted);font-size:0.72rem;">includes ${projCount} projected</em>` : "";

      const card = document.createElement("div");
      card.className = "tracker-stat-card";
      card.innerHTML =
        `<h4>${escapeHtml(subject)} <span class="count" style="font-size:0.75rem;color:var(--text-muted);">${set.length} sitting${set.length===1?"":"s"}</span></h4>` +
        `<div class="stat">${avg !== null ? avg + "%" : "&ndash;"}</div>` +
        `<div class="stat-sub">average (best per paper)</div>` +
        (max !== null
          ? `<div class="tracker-bar"><div style="width:${Math.max(4, max)}%"></div></div>` +
            `<div class="tracker-trend">best ${max}% &middot; lowest ${min}%</div>`
          : "") +
        (dist ? `<div class="tracker-trend" style="margin-top:4px;">grades <b>${escapeHtml(dist)}</b>${projNote}</div>` : "");
      el.statsGrid.appendChild(card);
    }
  }

  // ---- export / import ----
  function exportData() {
    const data = {
      type: "neuronet-pastpapers",
      version: 3,
      exportedAt: nowISO(),
      subjects: subjectNodes.map((n) => ({
        name: n.name || n.subject,
        examBoard: n.examBoard || "",
        qualification: n.qualification || "",
        customized: n.customized || false,
        officialCourse: n.officialCourse ?? null,
        createdAt: n.createdAt, updatedAt: n.updatedAt
      })),
      sittings: papers.map((p) => ({
        subject: p.subject,
        year: p.year,
        series: p.series,
        label: p.label || null,
        gradeBoundary: p.gradeBoundary,
        gradeBoundaries: p.gradeBoundaries || null,
        examBoard: p.examBoard,
        notes: p.notes,
        results: p.results,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      }))
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "past-papers-tracker.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importDataFile(file) {
    const text = await file.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { flash("Invalid JSON file.", false); return; }
    if (data.type && data.type !== "neuronet-pastpapers") { flash("Unrecognised export (wrong type).", false); return; }

    // Legacy flat export (the old tracker's downloaded rows): array of rows with
    // paper1/paper2/paper3 slots. Transform via the shared importer.
    if (Array.isArray(data) && data.length && "paper1" in data[0]) {
      const { subjects, sittings } = transformRows(data);
      if (sittings.length === 0) { flash("No sittings found in file.", false); return; }
      const existingKeys = new Set(papers.map((p) => p.subject + "|" + p.year + "|" + p.series + "|" + p.gradeBoundary));
      const toAdd = sittings.filter((p) => !existingKeys.has(p.subject + "|" + p.year + "|" + p.series + "|" + p.gradeBoundary));
      if (toAdd.length === 0) { flash("Nothing new to import (all sittings already exist).", false); return; }
      await persistMany(toAdd);
      for (const s of subjects) {
        if (!(await subjectNodeExists(s.name))) await addNode(s);
      }
      await loadSubjects();
      await ensureQualifications();
      flash(`Imported ${toAdd.length} sitting${toAdd.length === 1 ? "" : "s"} across ${subjects.length} subjects. Set each subject's exam board once.`, true);
      renderPapers();
      if (window.__neuronetRefreshSubjects) window.__neuronetRefreshSubjects();
      return;
    }

    let imported = [];
    if (Array.isArray(data)) {
      // v1-style export: array of papers
      imported = data;
    } else if (Array.isArray(data.sittings)) {
      imported = data.sittings;
    } else {
      flash("Unrecognised export format.", false);
      return;
    }

    const valid = imported.filter((p) => p && p.subject);
    if (valid.length === 0) { flash("No sittings found in file.", false); return; }

    const existingKeys = new Set(papers.map((p) => p.subject + "|" + p.year + "|" + p.series));
    const toAdd = valid.filter((p) => !existingKeys.has(p.subject + "|" + p.year + "|" + p.series));
    if (toAdd.length === 0) { flash("Nothing new to import (all sittings already exist).", false); return; }

    for (const p of toAdd) {
      p.id = `paper-${crypto.randomUUID()}`;
      if (!Array.isArray(p.results)) p.results = [];
    }
    await persistMany(toAdd);

    for (const p of toAdd) {
      if (p.examBoard) await setSubjectBoard(p.subject, p.examBoard);
    }

    // Ensure a subject node exists for every imported subject, applying any
    // board / qualification carried in the file.
    const subjectMeta = {};
    for (const s of (data.subjects || [])) {
      if (s && s.name) subjectMeta[s.name] = s;
    }
    for (const subject of new Set(toAdd.map((p) => p.subject).filter(Boolean))) {
      const meta = subjectMeta[subject] || {};
      if (!(await subjectNodeExists(subject))) {
        await addNode({
          type: "subject", subject, name: subject,
          examBoard: meta.examBoard || "",
          qualification: meta.qualification || "",
          customized: meta.customized || false,
          officialCourse: meta.officialCourse ?? null,
          createdAt: Date.now(), updatedAt: Date.now()
        });
      } else if (meta.examBoard || meta.qualification || meta.customized || meta.officialCourse) {
        await setSubjectMeta(subject, meta);
      }
    }

    await loadSubjects();
    await ensureQualifications();
    flash(`Imported ${toAdd.length} sitting${toAdd.length === 1 ? "" : "s"}.`, true);
    renderPapers();
    if (window.__neuronetRefreshSubjects) window.__neuronetRefreshSubjects();
  }

  async function setSubjectMeta(name, meta) {
    const nodes = (await getAllNodes()) || [];
    const existing = nodes.find((n) => n.type === "subject" && (n.subject === name || n.name === name));
    if (!existing) {
      await addNode({
        type: "subject", subject: name, name: name,
        examBoard: meta.examBoard || "",
        qualification: meta.qualification || "",
        customized: meta.customized || false,
        officialCourse: meta.officialCourse ?? null,
        createdAt: Date.now(), updatedAt: Date.now()
      });
    } else {
      await addNode({
        ...existing,
        examBoard: meta.examBoard ?? existing.examBoard ?? "",
        qualification: meta.qualification ?? existing.qualification ?? "",
        customized: meta.customized ?? existing.customized ?? false,
        officialCourse: meta.officialCourse ?? existing.officialCourse ?? null,
        updatedAt: Date.now()
      });
    }
    await loadSubjects();
  }

  async function subjectNodeExists(name) {
    const nodes = (await getAllNodes()) || [];
    return nodes.some((n) => n.type === "subject" && (n.subject === name || n.name === name));
  }

  // ---- wire up ----
  function wire() {
    el.papersBtn.addEventListener("click", () => showView("papers"));
    el.statsBtn.addEventListener("click", () => showView("stats"));
    el.addBtn.addEventListener("click", () => openModal(null));
    el.dropBtn.addEventListener("click", () => setAllNotes(true));
    el.collapseBtn.addEventListener("click", () => setAllNotes(false));
    el.saveBtn.addEventListener("click", save);
    el.cancelBtn.addEventListener("click", () => closeModal());
    el.modalClose.addEventListener("click", () => closeModal());
    el.modalOverlay.addEventListener("click", () => closeModal());

    // ---- link-to-official-subject picker (persistent popover) ----
    el.linkArea.addEventListener("click", (e) => {
      const pill = e.target.closest(".tracker-link-pill");
      if (!pill) return;
      e.preventDefault();
      e.stopPropagation();
      if (pill.dataset.act === "suggest") {
        if (linkHint) applyOfficialCourse(focusedSubject, linkHint);
      } else {
        openLinkPicker(focusedSubject);
      }
    });
    el.linkFilter.addEventListener("input", () => renderCourseList());
    el.linkFilters.addEventListener("click", (e) => {
      const ch = e.target.closest(".tracker-chip");
      if (!ch) return;
      const f = ch.dataset.f || "";
      if (f === "") {
        chipTokens.clear();
        el.linkFilter.value = "";
      } else {
        const typed = normalizeSearch(el.linkFilter.value);
        const typedTokens = typed ? typed.split(/\s+/).filter(Boolean) : [];
        const inTyped = typedTokens.includes(f) || (f === "pearson" && typedTokens.some((t) => t.includes("edexcel")));
        if (chipTokens.has(f) || inTyped) {
          chipTokens.delete(f);
          const keep = typedTokens.filter((t) => t !== f && !(f === "pearson" && t.includes("edexcel")));
          el.linkFilter.value = keep.join(" ");
        } else {
          chipTokens.add(f);
        }
      }
      renderCourseList();
    });
    el.linkList.addEventListener("click", (e) => {
      const item = e.target.closest(".tracker-course-item");
      if (!item) return;
      const c = listCachedCourses(loadBoundaryCache()).find(
        (x) => x.board === item.dataset.board && x.qual === item.dataset.qual && x.code === item.dataset.code && normalizeTitle(x.title) === normalizeTitle(item.dataset.title)
      );
      if (c) applyOfficialCourse(focusedSubject, c);
    });
    el.unlinkBtn.addEventListener("click", () => unlinkOfficialCourse(focusedSubject));
    el.addSlotBtn.addEventListener("click", () => addSlotRow(null));
    el.exportBtn.addEventListener("click", exportData);
    el.importBtn.addEventListener("click", () => el.importFile.click());

    // ---- table customise popover (persistent element, bound once) ----
    el.colsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeLinkPicker();
      if (el.colsPop.hidden) {
        renderBoundaryChips();
        renderColList();
        el.colsPop.hidden = false;
      } else {
        el.colsPop.hidden = true;
      }
    });
    el.colsPop.addEventListener("click", (e) => {
      const chip = e.target.closest(".tracker-grade-chip");
      if (chip) {
        toggleAim(focusedSubject, chip.dataset.g);
        renderBoundaryChips();
        return;
      }
      const colBtn = e.target.closest(".tracker-col-toggle");
      if (colBtn) {
        cols = loadCols();
        cols[colBtn.dataset.col] = !cols[colBtn.dataset.col];
        saveCols();
        renderColList();
        renderPapers();
      }
    });
    el.cusReset.addEventListener("click", () => {
      cols = { ...COL_DEFAULTS };
      saveCols();
      aimGrades = {};
      saveAimGrades();
      renderColList();
      renderBoundaryChips();
      renderPapers();
    });
    document.addEventListener("click", (e) => {
      if (el.colsPop && !el.colsPop.hidden && !e.target.closest(".tracker-cus-wrap")) el.colsPop.hidden = true;
      if (el.linkPop && !el.linkPop.hidden && !e.target.closest(".tracker-link-area")) el.linkPop.hidden = true;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (el.colsPop) el.colsPop.hidden = true;
      if (el.linkPop) el.linkPop.hidden = true;
    });
    el.importFile.addEventListener("change", async () => {
      if (el.importFile.files[0]) await importDataFile(el.importFile.files[0]);
      el.importFile.value = "";
    });
  }

  // ---- init ----
  async function init() {
    wire();
    await loadPapers();
    await loadSubjects();
    await ensureQualifications();
    renderPapers();
  }

  if (typeof context.onload === "function") {
    context.onload(init());
  } else {
    init();
  }

  return { load: init, reload: () => init() };
}
