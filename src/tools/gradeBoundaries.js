// Shared access to the isolated grade-boundary cache.
//
// The scraper tool writes fetched exam-board grade boundaries to a private
// localStorage key (neuronet:gradeBoundaries). This module is the single
// shared API for that cache so the tracker can link subjects to official
// courses and auto-fill grade boundary tables without re-fetching or manual
// typing, while the cache itself never enters the user's graph or JSON export.

export const BOUNDARY_CACHE_KEY = "neuronet:gradeBoundaries";

const RESULTS_WINDOW_MS = 60 * 24 * 60 * 60 * 1000; // ~60 days, results-day policy

export function loadBoundaryCache() {
  try {
    const raw = localStorage.getItem(BOUNDARY_CACHE_KEY);
    if (!raw) return { version: 1, entries: {} };
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : { version: 1, entries: {} };
  } catch {
    return { version: 1, entries: {} };
  }
}

export function saveBoundaryCache(cache) {
  try {
    localStorage.setItem(BOUNDARY_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* storage full/unavailable — degrade to no-cache */
  }
}

// Mutable cache handle used by the scraper. Keeps the raw entry lookup + the
// results-day staleness policy in one place, shared with the tracker.
export function createBoundaryCacheStore() {
  let cache = loadBoundaryCache();
  const key = (board, qualId, series) =>
    `${String(board).toLowerCase()}:${series.month}-${series.year}:${qualId}`;
  return {
    reload() { cache = loadBoundaryCache(); },
    getEntry(board, qualId, series) {
      return cache.entries[key(board, qualId, series)] || null;
    },
    getCachedSubjects(board, qualId, series) {
      const entry = cache.entries[key(board, qualId, series)];
      if (!entry) return null;
      if (Date.now() - (entry.fetchedAt || 0) > RESULTS_WINDOW_MS) return null;
      return entry.subjects || null;
    },
    setCachedSubjects(board, qualId, series, subjects) {
      cache.entries[key(board, qualId, series)] = {
        series: { month: series.month, year: series.year, label: series.label },
        qual: qualId,
        board: String(board).toLowerCase(),
        fetchedAt: Date.now(),
        subjects
      };
      saveBoundaryCache(cache);
    }
  };
}

const BOARD_IDS = { aqa: "AQA", ocr: "OCR", pearson: "Pearson (Edexcel)" };
const QUAL_IDS = { gcse: "GCSE", alevel: "A-Level", as: "AS" };

export function boardToId(board) {
  const b = String(board || "").trim().toLowerCase();
  if (b.includes("aqa")) return "aqa";
  if (b.includes("ocr")) return "ocr";
  if (b.includes("pearson") || b.includes("edexcel")) return "pearson";
  return null;
}

export function boardIdToName(id) {
  return BOARD_IDS[String(id).toLowerCase()] || String(id);
}

export function qualToId(qual) {
  const q = String(qual || "").trim().toLowerCase();
  if (q.includes("gcse")) return "gcse";
  if (q.includes("a-level") || q.includes("a level") || q.includes("alevel")) return "alevel";
  if (q === "as" || q === "a/s") return "as";
  return null;
}

export function qualIdToName(id) {
  return QUAL_IDS[String(id).toLowerCase()] || String(id);
}

// Tracker series words -> exam-board month code (cache entries are stored by
// month-year, e.g. "JUN-2025"). Mock/Specimen/blank carry no month.
const SERIES_MONTHS = {
  june: "JUN", january: "JAN",
  november: "NOV", march: "MAR", may: "MAY", october: "OCT"
};

export function trackerSeriesToMonth(seriesWord) {
  if (!seriesWord) return null;
  return SERIES_MONTHS[String(seriesWord).trim().toLowerCase()] || null;
}

export function normalizeTitle(t) {
  return String(t || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function findSubjectInEntry(entry, course) {
  const title = normalizeTitle(course.title);
  const code = singleCode(course.code);
  for (const item of entry.subjects || []) {
    if (code && singleCode(item.code) === code) return item;
  }
  for (const item of entry.subjects || []) {
    if (title && normalizeTitle(item.title) === title) return item;
  }
  return null;
}

export function listCachedCourses(cache) {
  const out = [];
  const seen = new Set();
  for (const entry of Object.values((cache && cache.entries) || {})) {
    const boardId = String(entry.board || "").toLowerCase();
    const qualId = String(entry.qual || "").toLowerCase();
    if (!BOARD_IDS[boardId]) continue;
    if (!QUAL_IDS[qualId]) continue;
    for (const item of entry.subjects || []) {
      const code = singleCode(item.code);
      const key = `${boardId}:${qualId}:${code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        board: boardId,
        boardName: BOARD_IDS[boardId],
        qual: qualId,
        qualName: QUAL_IDS[qualId],
        code,
        title: item.title,
        maxMark: item.maxMark,
        papers: Array.isArray(item.papers) && item.papers.length ? item.papers : null
      });
    }
  }
  return out.sort((a, b) =>
    a.boardName.localeCompare(b.boardName) ||
    a.qual.localeCompare(b.qual) ||
    (a.title || "").localeCompare(b.title || "")
  );
}

// High-confidence single match used to tentatively auto-link a subject node
// from its existing free-text exam board + qualification. Returns the course
// only when exactly one distinct cached course matches, else null.
export function matchOfficialCourse(cache, { board, qual, title, code } = {}) {
  const b = boardToId(board);
  const q = qualToId(qual);
  if (!b || !q) return null;
  const normTitle = normalizeTitle(title);
  const normCode = singleCode(code);
  const matches = listCachedCourses(cache).filter((c) => {
    if (c.board !== b || c.qual !== q) return false;
    if (normCode && singleCode(c.code) === normCode) return true;
    if (normTitle && c.title && normalizeTitle(c.title) === normTitle) return true;
    return false;
  });
  return matches.length === 1 ? matches[0] : null;
}

function numberEq(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function seriesProximity(series, year, monthAbbr) {
  const y = numberEq(year);
  if (y === null || series == null || series.year == null) return { d: 0, exactYear: false, exactMonth: false };
  const d = Math.abs(Number(series.year) - y);
  const sameMonth = monthAbbr ? series.month === monthAbbr : true;
  return { d, exactYear: d === 0, exactMonth: sameMonth };
}

// Resolve the per-grade boundary table for a linked official course and a
// tracker sitting (year + series word). Picks the cached series closest to the
// sitting (exact month+year > same year > nearest year > most recent). Returns
// { subject, series, boardId, qualId, fresh } or null.
export function findGradeTable(cache, course, year, seriesWord) {
  const boardId = boardToId(course && course.board);
  const qualId = qualToId(course && course.qual);
  if (!boardId || !qualId) return null;
  const monthAbbr = trackerSeriesToMonth(seriesWord);
  const candidates = [];
  for (const entry of Object.values((cache && cache.entries) || {})) {
    if (String(entry.board || "").toLowerCase() !== boardId) continue;
    if (String(entry.qual || "").toLowerCase() !== qualId) continue;
    const subject = findSubjectInEntry(entry, course);
    if (!subject) continue;
    const p = seriesProximity(entry.series, year, monthAbbr);
    candidates.push({
      subject,
      series: entry.series || null,
      fetchedAt: entry.fetchedAt || 0,
      prox: p
    });
  }
  if (candidates.length === 0) return null;
  // Prefer the sitting's exact year+month, then the exact year, then the
  // closest year, then the most recent fetch. Never lets a different-year row
  // silently share the latest fetched table.
  candidates.sort((a, b) => {
    const ea = a.prox.exactYear && a.prox.exactMonth;
    const eb = b.prox.exactYear && b.prox.exactMonth;
    if (ea !== eb) return ea ? -1 : 1;
    if (a.prox.exactYear !== b.prox.exactYear) return a.prox.exactYear ? -1 : 1;
    if (a.prox.d !== b.prox.d) return a.prox.d - b.prox.d;
    if (a.prox.exactMonth !== b.prox.exactMonth) return a.prox.exactMonth ? -1 : 1;
    return b.fetchedAt - a.fetchedAt;
  });
  const best = candidates[0];
  return {
    subject: best.subject,
    series: best.series,
    boardId,
    qualId,
    fresh: Date.now() - best.fetchedAt <= RESULTS_WINDOW_MS
  };
}

export function singleCode(code) {
  return String(code || "").trim();
}

// Convert a raw total score to a grade label with a boundary table, e.g.
// grades: { "9": 132, ... }, gradesInOrder: ["9","8",...,"U"].
export function scoreToGrade(grades, gradesInOrder, score) {
  const s = numberEq(score);
  if (s === null || !Array.isArray(gradesInOrder) || gradesInOrder.length === 0) return null;
  for (const g of gradesInOrder) {
    const mark = grades && grades[g];
    if (Number.isFinite(mark) && s >= mark) return g;
  }
  return gradesInOrder[gradesInOrder.length - 1];
}