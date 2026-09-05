import { transformRows } from "./trackerImport.js";
import { dialog } from "./dialog.js";
import {
  loadBoundaryCache,
  listCachedCourses,
  matchOfficialCourse,
  findGradeTable,
  boardIdToName,
  qualIdToName,
  scoreToGrade
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

    scope: $("trackerScope"),
    subjectList: $("trackerSubjectList"),
    resultCount: $("trackerResultCount"),
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
    formQualification: $("trackerFormQualification"),
    formBoard: $("trackerFormBoard"),
    qualRow: $("trackerQualRow"),
    boardRow: $("trackerBoardRow"),
    boardList: $("trackerBoardList"),
    formYear: $("trackerFormYear"),
    formSeries: $("trackerFormSeries"),
    formBoundary: $("trackerFormBoundary"),
    boundaryHint: $("trackerBoundaryHint"),
    courseState: $("trackerCourseState"),
    coursePicker: $("trackerCoursePicker"),
    courseFilter: $("trackerCourseFilter"),
    courseFilters: $("trackerCourseFilters"),
    courseList: $("trackerCourseList"),
    slotList: $("trackerSlotList"),
    addSlotBtn: $("trackerAddSlotBtn"),
    formNotes: $("trackerFormNotes"),
    saveBtn: $("trackerSaveBtn"),
    cancelBtn: $("trackerCancelBtn"),
    formMsg: $("trackerFormMsg")
  };

  // ---- state ----
  let papers = [];
  let allSubjects = [];
  let subjectNodes = [];
  let boardsBySubject = {}; // subject -> examBoard (from subject nodes)
  let coursesBySubject = {}; // subject -> linked official course { board, code, title, qual }
  let autoFilled = false; // boundary field value was populated from the cache
  let chipTokens = new Set(); // toggled quick-filter chips — level + board coexist
  let focusedSubject = context.subject || null;
  let editingId = null;
  let slotSeq = 0;
  const expandedNotes = new Set();

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
    subjectNodes = [];
    try {
      const all = (await getAllNodes()) || [];
      for (const n of all) {
        if (n && n.type === "subject") {
          subjectNodes.push(n);
          const name = n.name || n.subject;
          if (name && n.examBoard) boardsBySubject[name] = n.examBoard;
          if (name && n.officialCourse && n.officialCourse.code) coursesBySubject[name] = n.officialCourse;
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

  // ---- official subject linking + auto grade boundaries ----
  function courseSummary(course) {
    if (!course) return "";
    return `${boardIdToName(course.board)} ${qualIdToName(course.qual)} — ${course.code} ${course.title}`.trim();
  }

  function resolveBoundaryTable(subject, year, series, cacheSrc) {
    const course = subject ? coursesBySubject[subject] : null;
    if (!course) return null;
    const hit = findGradeTable(cacheSrc || loadBoundaryCache(), course, year, series);
    if (!hit || !hit.subject) return null;
    return {
      grades: hit.subject.grades || {},
      gradesInOrder: Array.isArray(hit.subject.gradesInOrder) ? hit.subject.gradesInOrder : [],
      maxMark: hit.subject.maxMark || null,
      papers: Array.isArray(hit.subject.papers) && hit.subject.papers.length ? hit.subject.papers : [],
      board: hit.boardId,
      qual: hit.qualId,
      seriesLabel: hit.series ? hit.series.label : null,
      seriesKey: hit.series ? `${hit.series.month}-${hit.series.year}` : null,
      fresh: !!hit.fresh
    };
  }

  // Best-effort paper list for a linked subject: scan the cache across series
  // for any entry of this course that carries a component/paper list.
  function coursePapers(subject) {
    const course = subject ? coursesBySubject[subject] : null;
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
    const top = table && table.gradesInOrder && table.gradesInOrder[0];
    const mark = table && top && table.grades && table.grades[top];
    return Number.isFinite(mark) ? mark : null;
  }

  function boundsTooltip(gb) {
    const lines = gb.gradesInOrder.filter((g) => Number.isFinite(gb.grades[g])).map((g) => `${g}: ${gb.grades[g]}`);
    return `${gb.seriesLabel || "Grade boundaries"}` + (lines.length ? " · " + lines.join(", ") : "");
  }

  function inlineBounds(gb) {
    const lines = gb.gradesInOrder.filter((g) => Number.isFinite(gb.grades[g])).map((g) => `${g}=${gb.grades[g]}`);
    return lines.slice(0, 3).join(" ") + (lines.length > 3 ? " &hellip;" : "");
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

  // Render the link/unlink + quick-suggestion controls for the modal's subject.
  function renderCourseState() {
    if (!el.courseState) return;
    const subject = el.formSubject.value.trim();
    const course = subject ? coursesBySubject[subject] : null;
    const hint = subject && !course ? matchOfficialCourse(loadBoundaryCache(), {
      board: el.formBoard.value || boardFor(subject),
      qual: el.formQualification.value || qualFor(subject),
      title: subject,
      code: ""
    }) : null;

    if (course) {
      el.courseState.innerHTML =
        `<span class="tracker-course-linked"><i class="fa-solid fa-link"></i> ${escapeHtml(courseSummary(course))}</span>` +
        `<button type="button" class="tracker-btn" id="trackerCourseChangeBtn" style="font-size:0.78rem;padding:4px 10px;">Change</button>` +
        `<button type="button" class="tracker-btn danger" id="trackerCourseUnlinkBtn" style="font-size:0.78rem;padding:4px 10px;">Unlink</button>`;
      $("trackerCourseChangeBtn").addEventListener("click", () => openCoursePicker(subject));
      $("trackerCourseUnlinkBtn").addEventListener("click", async () => {
        await unlinkOfficialCourse(subject);
        renderCourseState();
        maybeAutoFillBoundary();
        flash(`Unlinked ${subject}.`, true);
      });
    } else if (hint) {
      el.courseState.innerHTML =
        `<span class="tracker-course-none">Not linked</span>` +
        `<button type="button" class="tracker-btn primary" id="trackerCourseLinkBtn" style="font-size:0.78rem;padding:4px 10px;">Link: ${escapeHtml(courseSummary(hint))}</button>` +
        `<button type="button" class="tracker-btn" id="trackerCoursePickBtn" style="font-size:0.78rem;padding:4px 10px;">Choose&hellip;</button>`;
      $("trackerCourseLinkBtn").addEventListener("click", async () => { await applyOfficialCourse(subject, hint); });
      $("trackerCoursePickBtn").addEventListener("click", () => openCoursePicker(subject));
    } else {
      el.courseState.innerHTML = subject
        ? `<span class="tracker-course-none">Not linked</span>` +
          `<button type="button" class="tracker-btn" id="trackerCoursePickBtn" style="font-size:0.78rem;padding:4px 10px;">Choose linked subject&hellip;</button>`
        : `<span class="tracker-course-none">Pick a subject first</span>`;
      const b = $("trackerCoursePickBtn");
      if (b && subject) b.addEventListener("click", () => openCoursePicker(subject));
    }
    syncBoilerplate();
  }

  // Once a subject is linked to an official course, its qualification + exam
  // board are derived facts — hide those inputs (they are kept in sync) so the
  // form doesn't invite conflicting boilerplate.
  function syncBoilerplate() {
    const subject = el.formSubject ? el.formSubject.value.trim() : "";
    const course = subject ? coursesBySubject[subject] : null;
    if (el.qualRow) el.qualRow.classList.toggle("tracker-auto-hidden", !!course);
    if (el.boardRow) el.boardRow.classList.toggle("tracker-auto-hidden", !!course);
    if (course) {
      if (el.formQualification && !el.formQualification.value) el.formQualification.value = qualIdToName(course.qual);
      if (el.formBoard && !el.formBoard.value) el.formBoard.value = boardIdToName(course.board);
    }
  }

  function openCoursePicker(subject) {
    if (!subject) { flash("Pick a subject first.", false); return; }
    el.coursePicker.hidden = false;
    if (el.courseFilter) el.courseFilter.value = "";
    chipTokens.clear();
    renderCourseList();
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

  // Match a course only if every token is present somewhere in it (AND, order
  // independent). Level and board tokens coexist — "alevel" + "aqa" both apply.
  function matchesTokens(c, tokens) {
    if (tokens.length === 0) return true;
    const hay = courseTerms(c);
    return tokens.every((tok) => [...hay].some((h) => h.includes(tok)));
  }

  // The live query = toggled chips + whatever is typed, de-duplicated.
  function queryTokens() {
    const typed = normalizeSearch(el.courseFilter ? el.courseFilter.value : "");
    const t = typed ? typed.split(/\s+/).filter(Boolean) : [];
    return [...new Set([...chipTokens, ...t])];
  }

  // Which quick-filter pill a token would light up (board and level are
  // separate categories, so both can be lit at once).
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
    if (!el.courseFilters) return;
    const tokens = queryTokens();
    const lit = new Set(tokens.map(chipForToken).filter(Boolean));
    if (tokens.length === 0) lit.add("");
    el.courseFilters.querySelectorAll(".tracker-chip").forEach((ch) =>
      ch.classList.toggle("active", lit.has(ch.dataset.f || ""))
    );
  }

  function renderCourseList() {
    const courses = listCachedCourses(loadBoundaryCache());
    const tokens = queryTokens();
    const visible = courses.filter((c) => matchesTokens(c, tokens));
    updateChipLighting();
    const subject = el.formSubject.value.trim();
    const current = subject ? coursesBySubject[subject] : null;

    if (visible.length === 0) {
      el.courseList.innerHTML = courses.length === 0
        ? `<div class="tracker-course-empty">No subjects cached yet.<br>Open the <b>Scraper</b> tool, pick a board / qualification / series and fetch boundaries, then link here.</div>`
        : `<div class="tracker-course-empty">No subjects match those filters.</div>`;
      return;
    }

    let html = "";
    let lastBoard = "";
    for (const c of visible) {
      if (c.boardName !== lastBoard) {
        if (lastBoard !== "") html += "</div>";
        html += `<div class="tracker-course-group"><div class="tracker-course-board">${escapeHtml(c.boardName)}</div>`;
        lastBoard = c.boardName;
      }
      const isSel = !!current && c.board === current.board && c.code === current.code && c.qual === current.qual;
      const codeTxt = c.code ? `<span class="course-code">${escapeHtml(c.code)}</span> ` : "";
      html +=
        `<button type="button" class="tracker-course-item${isSel ? " sel" : ""}" data-board="${escapeHtml(c.board)}" data-qual="${escapeHtml(c.qual)}" data-code="${escapeHtml(c.code)}">` +
        `${codeTxt}${escapeHtml(c.title)} <span class="course-qual">${escapeHtml(c.qualName)}${c.maxMark ? ` &middot; max ${escapeHtml(String(c.maxMark))}` : ""}</span>` +
        `</button>`;
    }
    html += "</div>";
    el.courseList.innerHTML = html;
    el.courseList.querySelectorAll(".tracker-course-item").forEach((btn) =>
      btn.addEventListener("click", () => {
        const c = visible.find((x) => x.board === btn.dataset.board && x.qual === btn.dataset.qual && x.code === btn.dataset.code);
        if (c) applyOfficialCourse(subject, c);
      })
    );
  }

  async function applyOfficialCourse(subject, candidate) {
    if (!subject || !candidate) return;
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
    renderPapers();
    if (!el.formBoard.value.trim()) el.formBoard.value = candidate.boardName;
    if (!el.formQualification.value) el.formQualification.value = candidate.qualName;
    el.coursePicker.hidden = true;
    renderCourseState();
    maybeAutoFillBoundary();
    flash(`Linked ${subject} to ${courseSummary(course)}.`, true);
  }

  async function unlinkOfficialCourse(subject) {
    if (!subject) return;
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
    el.coursePicker.hidden = true;
    renderCourseState();
    maybeAutoFillBoundary();
    renderPapers();
  }

  // Auto-fill the boundary field (and show the resolved table) whenever the
  // modal's subject is linked to an official course and a cached series is near
  // the sitting's year/series. Manual input is never clobbered.
  function maybeAutoFillBoundary() {
    if (!el.boundaryHint) return;
    const subject = el.formSubject.value.trim();
    const course = subject ? coursesBySubject[subject] : null;
    if (!course) {
      el.boundaryHint.innerHTML = "";
      return;
    }
    const year = numberEq(el.formYear.value.trim());
    const series = el.formSeries.value;
    const table = resolveBoundaryTable(subject, year, series);
    if (!table) {
      el.boundaryHint.innerHTML =
        `<span class="bnd-auto">${escapeHtml(courseSummary(course))}</span>` +
        ` &mdash; no cached boundaries for a matching series yet; fetch in the <b>Scraper</b> tool.`;
      return;
    }
    const top = topGradeOf(table);
    if (top !== null) {
      const hasManual = el.formBoundary.value.trim() !== "";
      if (!hasManual || autoFilled) {
        el.formBoundary.value = top;
        autoFilled = true;
      }
    }
    const lines = table.gradesInOrder.filter((g) => Number.isFinite(table.grades[g])).map((g) => `${g}:${table.grades[g]}`);
    el.boundaryHint.innerHTML =
      `<span class="bnd-auto">Auto: ${escapeHtml(boardIdToName(table.board))} ${escapeHtml(qualIdToName(table.qual))}${table.seriesLabel ? " " + escapeHtml(table.seriesLabel) : ""}</span>` +
      (lines.length ? ` &middot; ${escapeHtml(lines.join("  "))}` : "") +
      (table.fresh ? "" : " &middot; <em>older cached series</em>");
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

    el.resultCount.textContent = `${visible.length} sitting${visible.length === 1 ? "" : "s"}`;

    const anyNotes = visible.some((s) => !!s.notes);
    el.dropBtn.disabled = !anyNotes;
    el.collapseBtn.disabled = !anyNotes;

    if (showAll) {
      el.scope.innerHTML = `<span class="tracker-scope">Scope: <b>All subjects</b></span>`;
    } else {
      const q = qualFor(focusedSubject);
      const b = boardFor(focusedSubject);
      const course = coursesBySubject[focusedSubject] || null;
      el.scope.innerHTML = `<span class="tracker-scope">Scope: <b>${escapeHtml(focusedSubject)}</b>` +
        (q ? ` <span class="tracker-sitting-badge">${escapeHtml(q)}</span>` : "") +
        (b ? ` <span class="tracker-sitting-badge">${escapeHtml(b)}</span>` : "") +
        (course ? ` <span class="tracker-sitting-badge bnd" title="${escapeHtml(courseSummary(course))}"><i class="fa-solid fa-link"></i> linked</span>` : "") +
        `</span>`;
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
    thead.innerHTML =
      `<tr>` +
      (showAll ? `<th class="col-subject">Subject</th>` : "") +
      `<th class="col-session">Sitting</th>` +
      `<th class="col-papers">Papers</th>` +
      `<th class="col-boundary">Boundary</th>` +
      `<th class="col-avg">Avg</th>` +
      `<th class="col-actions"></th>` +
      `</tr>`;
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
      answer = await dialog.prompt(`What level are these subjects: ${missing.join(", ")}?\n(GCSE or A-Level - stored per subject, editable later)`, "GCSE");
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
    const boundary = numberEq(sitting.gradeBoundary);
    const alive = resolveBoundaryTable(sitting.subject, numberEq(sitting.year), sitting.series, cacheSrc) || sitting.gradeBoundaries || null;
    const gb = alive;
    const hasG = !!(gb && Array.isArray(gb.gradesInOrder) && gb.gradesInOrder.length && gb.grades && typeof gb.grades === "object");
    let boundaryEl;
    if (boundary !== null || hasG) {
      const topLabel = escapeHtml(highestGradeLabel(sitting.subject));
      const shownMark = hasG ? topGradeOf(gb) : boundary;
      const tip = hasG ? boundsTooltip(gb) : null;
      const badge =
        `<span class="tracker-sitting-badge bnd"${tip !== null ? ` title="${escapeHtml(tip)}"` : ""}>` +
        `${topLabel}${shownMark !== null ? ` &ge; ${shownMark}` : ""}` +
        `${hasG ? ` <span class="bnd-auto-chip">auto</span>` : ""}` +
        `</span>`;
      boundaryEl = badge + (hasG ? `<div class="tracker-bounds" title="${escapeHtml(tip)}">${inlineBounds(gb)}</div>` : "");
    } else {
      boundaryEl = `<span class="tracker-sitting-badge">&ndash;</span>`;
    }

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
    cells.push(td(`<span class="sit-session">${sessionTitle(sitting)}</span>`, "col-session"));
    cells.push(td(`<div class="sit-papers">${scoreSummary(sitting)}${subjectGradeChip(sitting, gb)}</div>`, "col-papers"));
    cells.push(td(boundaryEl, "col-boundary"));
    cells.push(td(avgEl, "col-avg"));

    const hasNote = !!sitting.notes;
    const actionsCell = document.createElement("td");
    actionsCell.className = "col-actions";
    actionsCell.innerHTML =
      (hasNote ? `<button class="row-btn note-toggle ${noteOpen ? "open" : ""}" data-act="note" title="${noteOpen ? "Collapse" : "Expand"} note">\u2139</button>` : "") +
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
    autoFilled = false;
    slotSeq = (sitting && sitting.results) ? sitting.results.map((r) => r.paper || "").filter(Boolean) : [];
    el.modalTitle.textContent = editingId ? "Edit sitting" : "Add sitting";

    const initSubject = sitting ? (sitting.subject || "") : (focusedSubject || "");
    el.formSubject.value = initSubject;
    el.formBoard.value = sitting ? boardFor(sitting.subject) : boardFor(initSubject);
    el.formQualification.value = sitting ? (qualFor(sitting.subject) || "") : (qualFor(initSubject) || "");
    el.formYear.value = sitting ? (sitting.year ?? "") : "";
    el.formSeries.value = sitting ? (sitting.series || "") : "";
    el.formBoundary.value = sitting ? (sitting.gradeBoundary ?? "") : "";
    el.formNotes.value = sitting ? (sitting.notes || "") : "";
    el.courseState.innerHTML = "";
    el.boundaryHint.innerHTML = "";
    if (el.coursePicker) el.coursePicker.hidden = true;

    // keep board + qualification in sync with subject selection
    el.formSubject.oninput = () => {
      const b = boardFor(el.formSubject.value);
      if (b) el.formBoard.value = b;
      const q = qualFor(el.formSubject.value);
      if (q) el.formQualification.value = q;
      renderCourseState();
      maybeAutoFillBoundary();
    };
    el.formYear.oninput = () => maybeAutoFillBoundary();
    el.formSeries.onchange = () => maybeAutoFillBoundary();
    el.formQualification.onchange = () => renderCourseState();
    el.formBoard.oninput = () => renderCourseState();
    if (el.courseFilter) {
      el.courseFilter.oninput = () => renderCourseList();
    }

    const slots = sitting ? (sitting.results || []) : [];
    el.slotList.innerHTML = "";
    const premade = sitting ? null : coursePapers(initSubject);
    if (premade && premade.length) {
      premade.forEach((p) => addSlotRow(null, { paper: p.label, maxMark: p.maxMark }));
    } else if (slots.length === 0) addSlotRow();
    else slots.forEach((r) => addSlotRow(r));

    el.formMsg.textContent = "";
    el.modal.classList.add("open");
    renderCourseState();
    maybeAutoFillBoundary();
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

  function collectSitting() {
    const subject = el.formSubject.value.trim();
    const yearRaw = el.formYear.value.trim();
    const year = yearRaw === "" ? null : Number(yearRaw);
    const series = el.formSeries.value;
    const boundaryRaw = el.formBoundary.value.trim();
    let boundary = boundaryRaw === "" ? null : Number(boundaryRaw);
    const notes = el.formNotes.value.trim();
    const examBoard = el.formBoard.value.trim() || boardFor(subject);
    const qualification = el.formQualification.value.trim() || qualFor(subject);

    const gradeBoundaries = resolveBoundaryTable(subject, year, series);
    if (boundary === null && gradeBoundaries) boundary = topGradeOf(gradeBoundaries);

    if (!subject) { flash("Subject is required.", false); return null; }
    if ((year !== null && !Number.isFinite(year))) { flash("Enter a valid year.", false); return null; }

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
    const data = collectSitting();
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
        const gb = resolveBoundaryTable(s.subject, numberEq(s.year), s.series, cacheSrc) || s.gradeBoundaries || null;
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

  // ---- prompt for board (per subject) ----
  async function promptBoard(subject) {
    const current = boardFor(subject);
    const val = await dialog.prompt(`Exam board for ${subject}:`, current || "");
    if (val === null) return;
    await setSubjectBoard(subject, val);
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
    el.addSlotBtn.addEventListener("click", () => addSlotRow(null));
    el.exportBtn.addEventListener("click", exportData);
    el.importBtn.addEventListener("click", () => el.importFile.click());
    if (el.courseFilters) {
      el.courseFilters.querySelectorAll(".tracker-chip").forEach((ch) =>
        ch.addEventListener("click", () => {
          const f = ch.dataset.f || "";
          if (f === "") {
            chipTokens.clear();
            el.courseFilter.value = "";
          } else {
            const typed = normalizeSearch(el.courseFilter.value);
            const typedTokens = typed ? typed.split(/\s+/).filter(Boolean) : [];
            const inTyped = typedTokens.includes(f) || (f === "pearson" && typedTokens.some((t) => t.includes("edexcel")));
            if (chipTokens.has(f) || inTyped) {
              chipTokens.delete(f);
              const keep = typedTokens.filter((t) => t !== f && !(f === "pearson" && t.includes("edexcel")));
              el.courseFilter.value = keep.join(" ");
            } else {
              chipTokens.add(f);
            }
          }
          renderCourseList();
        })
      );
    }
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
