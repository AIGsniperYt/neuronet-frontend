import { cleanupOldDemoDatabases, initDB, addNode, addNodes, getAllNodes, getNode, deleteNode, addQuote, addQuotes, getAllQuotes, getQuote, deleteQuote, clearNodes, clearQuotes, clearCues, addCues, getQuotesForSubject, getAnalysisNodesForSubject, getDueQuotesForSubject, getDueAnalysisNodesForSubject, getQuotesReferencedByAnalysis, getAnalysesReferencingQuote, getPinnedTools, pinTool, unpinTool, isToolPinned, setPinnedToolsOrder, getSubjects, addSubject, deleteSubject, renameSubject, addCue, getAllCues, getCue, deleteCue, getCuesForQuote, getCuesForAnalysis, getCuesForSubject, updateCueLinks, getAllTags, addTag, deleteTag, findExistingQuote, findExistingQuoteByText, linkAnalysisToQuote, unlinkAnalysisFromQuote, getFormattedQuote, resolveQuoteInSource } from "./db.js";
import { syncLocalWithCloud, syncToCloud, deleteCloudNode, deleteCloudQuote, deleteCloudCue, fetchCloudNodes, fetchCloudQuotes, fetchCloudCues } from "./sync.js";
import { initAnalysisToolV2 } from "./tools/analysisTool.js";
import { dialog } from "./tools/dialog.js";
import { initMemoryTool } from "./tools/memoryTool.js";
import { initMindmapTool } from "./tools/mindmapTool.js";
import { initTrackerTool } from "./tools/trackerTool.js";
import { performMigration } from "./migrations.js";
import { upgradeDataset, upgradeStoredData, SCHEMA_VERSION } from "./schemaUpgrade.js";
import { initCanvas } from "./canvas.js";

initCanvas();

const canvasEl = window.__neuronetCanvas.getCanvas();
const ctx = window.__neuronetCanvas.getCtx();

const BACKEND = "https://neuronet-backend.onrender.com";
let DB_READY = false;
const DEMO_MODE = true;
window.APP_VERSION = "v9"; // change per branch
window.DEMO_MODE = DEMO_MODE; // true for old versions
const USE_BACKEND = !window.DEMO_MODE;
const DEFAULT_PROFILE = {
  name: "Offline Mode",
  email: "local@device",
  picture: "https://via.placeholder.com/40"
};

let syncInProgress = false;
let subjectEditMode = false;

let currentToolName = "";
let currentSubject = null;
let toolContainer;

const tools = {
  analysis: {
    file: "analysis.html",
    init: (context) => initAnalysisToolV2({
      getAllNodes,
      getAllQuotes,
      getAllCues,
      getAllTags,
      getNode,
      addNode,
      addQuote,
      addCue,
      addTag,
      getQuote,
      getCue,
      getCuesForQuote,
      deleteQuote,
      deleteCue,
      removeCueEverywhere,
      backupLocalNodesToCloud,
      removeNodeEverywhere,
      removeQuoteEverywhere,
      normalizeHierarchyPath,
      buildSection,
      parseTags,
      escapeHtml,
      getNodeTimestamp,
      isSourceNode,
      findExistingQuote,
      findExistingQuoteByText,
      linkAnalysisToQuote,
      unlinkAnalysisFromQuote,
      getFormattedQuote,
      resolveQuoteInSource
    }, context)
  },

  memory: {
    file: "memory.html",
    init: (context) => initMemoryTool({
      getAllNodes,
      getAllQuotes,
      getAllCues,
      addNode,
      addQuote,
      addCue,
      addSubject,
      getQuotesForSubject,
      getAnalysisNodesForSubject,
      getDueQuotesForSubject,
      getDueAnalysisNodesForSubject,
      getQuotesReferencedByAnalysis,
      getAnalysesReferencingQuote,
      getCuesForQuote,
      getCuesForSubject,
      deleteCue,
      deleteQuote,
      renameSubject,
      getNode,
      getNodeTimestamp,
      getCue,
      getQuote,
      getSubjects,
      getFormattedQuote,
      resolveQuoteInSource,
      escapeHtml
    }, context)
  },

  mindmap: {
    file: "mindmap.html",
    init: (context) => initMindmapTool({
      getAllNodes,
      getAllQuotes,
      getAllCues,
      addNode,
      addQuote,
      addCue,
      deleteNode,
      deleteQuote,
      deleteCue,
      removeNodeEverywhere,
      removeQuoteEverywhere,
      removeCueEverywhere,
      getAllTags,
      addTag,
      deleteTag,
      escapeHtml,
      linkAnalysisToQuote,
      unlinkAnalysisFromQuote
    }, context)
  },
  tracker: {
    name: "Tracker",
    file: "tracker.html",
    init: (context) => initTrackerTool({
      getAllNodes,
      addNode,
      addNodes,
      deleteNode,
      getSubjects,
      escapeHtml
    }, context)
  }
};

const toolDefinitions = {
  analysis: { name: "Analysis", file: "analysis.html", icon: "A", desc: "Create source-linked analysis nodes and analyse a source text" },
  memory: { name: "Memory", file: "memory.html", icon: "M", desc: "Flashcard study across subjects to memorise nodes you analyse" },
  mindmap: { name: "Mindmap", file: "mindmap.html", icon: "N", desc: "Visual database overview for establishing connections" },
  tracker: { name: "Tracker", file: "tracker.html", icon: "T", desc: "Track study progress with past paper data" }
};

// ========== AUTH & API ==========
function setProfileUI(user) {
  const pfp = document.getElementById("userPfp");
  const userName = document.getElementById("userName");
  const authActionBtn = document.getElementById("authActionBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  const activeUser = user || DEFAULT_PROFILE;

  if (pfp) pfp.src = activeUser.picture || DEFAULT_PROFILE.picture;
  if (userName) {
    userName.textContent = user ? user.name || user.email || "User" : DEFAULT_PROFILE.name;
  }

  if (authActionBtn) authActionBtn.style.display = user ? "none" : "block";
  if (logoutBtn) logoutBtn.style.display = user ? "block" : "none";
}

async function fetchUser() {
  if (!USE_BACKEND) {
    window.currentUser = null;
    setProfileUI(null);
    return null;
  }
  try {
    const res = await fetch(`${BACKEND}/auth/user`, { credentials: "include" });
    if (!res.ok) throw new Error("Not logged in");

    const user = await res.json();
    window.currentUser = user;
    setProfileUI(user);
    return user;
  } catch (error) {
    window.currentUser = null;
    setProfileUI(null);
    return null;
  }
}

async function backupLocalNodesToCloud() {
  if (!USE_BACKEND || !window.currentUser || syncInProgress) return;
  syncInProgress = true;
  try {
    const [localNodes, localQuotes] = await Promise.all([getAllNodes(), getAllQuotes()]);
    await syncToCloud(localNodes, localQuotes);
  } catch (error) {
    console.log("Background cloud backup skipped", error);
  } finally {
    syncInProgress = false;
  }
}

async function syncAfterLogin() {
  if (!USE_BACKEND || !window.currentUser || syncInProgress) return;
  syncInProgress = true;
  try {
    await syncLocalWithCloud();
  } catch (error) {
    console.log("Cloud merge failed", error);
  } finally {
    syncInProgress = false;
  }
}

function startGoogleLogin() {
  if (!USE_BACKEND) return;
  window.location.href = `${BACKEND}/auth/google`;
}

function setActiveTool(toolName) {
  const wrappers = document.querySelectorAll(".tool-btn-wrapper");
  wrappers.forEach(w => w.classList.remove("active"));
  const activeWrapper = document.querySelector(`.tool-btn-wrapper[data-tool="${toolName}"]`);
  if (activeWrapper) activeWrapper.classList.add("active");
}

async function loadTool(toolName, context = {}) {
  if (currentToolName === "analysis" && toolName !== "analysis") {
    if (typeof window.__neuronetAnalysisCleanup === "function") {
      window.__neuronetAnalysisCleanup();
    }
  }

  currentToolName = toolName;
  currentSubject = context.subject || null;
  setActiveTool(toolName);

  const tool = tools[toolName];
  toolContainer.innerHTML = "";

  // Fetch and load tool
  fetch(`./tools/${tool.file}`).then(r => r.text()).then(html => {
    toolContainer.innerHTML = html;
    if (tool.init) tool.init(context);
    hideLaunchpad();
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeHierarchyPath(parts) {
  return (parts || []).map((part) => String(part || "").trim()).filter(Boolean);
}

function buildSection(path) {
  return path.slice(1).join(" > ");
}

function getNodeTimestamp(node) {
  return Number(node?.updatedAt || node?.createdAt || 0);
}

function isSourceNode(node) {
  return node?.type === "source" || node?.meta?.kind === "source";
}

function isAnalysisNode(node) {
  return node?.type === "analysis" || typeof node?.analysis === "string";
}

function parseTags(value) {
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

async function removeNodeEverywhere(id) {
  const node = await getNode(id);

  // Cascade deletes + integrity cleanup
  if (node) {
    const nodeType = node.type || node?.meta?.kind || "";

    if (nodeType === "subject") {
      const subjectName = String(node.subject || node.title || "").trim();
      if (subjectName) {
        await deleteSubjectCascadeEverywhere(subjectName);
        return;
      }
    }

    if (nodeType === "source") {
      await deleteSourceCascadeEverywhere(node);
    }

    if (nodeType === "analysis") {
      await detachAnalysisFromQuotesAndCues(node);
    }
  }

  await deleteNode(id);

  if (!USE_BACKEND || !window.currentUser) return;

  try {
    await deleteCloudNode(id);
  } catch (error) {
    console.log("Cloud delete skipped", error);
  }
}

async function removeQuoteEverywhere(id) {
  await deleteQuoteCascadeLocal(id);
  await deleteQuote(id);

  if (!USE_BACKEND || !window.currentUser) return;

  try {
    await deleteCloudQuote(id);
  } catch (error) {
    console.log("Cloud quote delete skipped", error);
  }
}

function isEmptyAnalysisNode(node) {
  if (!node || node.type !== "analysis") return false;
  const analysisText = String(node.analysis || "").trim();
  const quoteRefs = Array.isArray(node.quoteRefs) ? node.quoteRefs.filter((r) => r && r.quoteId) : [];
  return analysisText.length === 0 && quoteRefs.length === 0;
}

async function detachAnalysisFromQuotesAndCues(analysisNode) {
  if (!analysisNode?.id) return;
  const analysisId = analysisNode.id;

  // Remove analysisId from any quote.meta.analysisNodeIds (fast enough for current scale)
  const allQuotes = await getAllQuotes();
  const now = Date.now();
  for (const quote of allQuotes || []) {
    const ids = Array.isArray(quote?.meta?.analysisNodeIds) ? quote.meta.analysisNodeIds : [];
    if (!ids.includes(analysisId)) continue;
    const nextIds = ids.filter((qid) => qid !== analysisId);
    await addQuote({
      ...quote,
      meta: {
        ...(quote.meta || {}),
        analysisNodeIds: nextIds
      },
      updatedAt: now
    });
  }

  // Clear analysisId on cues that were attached to this analysis (keep cue if it still has a quoteId)
  const cues = await getCuesForAnalysis(analysisId);
  for (const cue of cues || []) {
    if (!cue?.id) continue;
    if (!cue.quoteId) {
      await removeCueEverywhere(cue.id);
      continue;
    }
    await updateCueLinks(cue.id, cue.quoteId, null);
  }
}

async function deleteQuoteCascadeLocal(quoteId) {
  if (!quoteId) return;

  // Remove quote reference from analysis nodes; delete emptied analyses.
  const analyses = await getAnalysesReferencingQuote(quoteId);
  const now = Date.now();
  for (const analysis of analyses || []) {
    if (!analysis?.id) continue;
    const nextRefs = (analysis.quoteRefs || []).filter((ref) => ref?.quoteId && ref.quoteId !== quoteId);
    const nextAnalysis = { ...analysis, quoteRefs: nextRefs, updatedAt: now };
    if (isEmptyAnalysisNode(nextAnalysis)) {
      await removeNodeEverywhere(analysis.id);
    } else {
      await addNode(nextAnalysis);
    }
  }

  // Delete cues for this quote (quote -> cues ownership)
  const cues = await getCuesForQuote(quoteId);
  for (const cue of cues || []) {
    if (!cue?.id) continue;
    await removeCueEverywhere(cue.id);
  }
}

async function deleteSourceCascadeEverywhere(sourceNode) {
  if (!sourceNode?.id) return;

  // Delete quotes that belong to this source.
  const allQuotes = await getAllQuotes();
  const linkedQuotes = (allQuotes || []).filter((q) => q?.link?.sourceId === sourceNode.id);
  for (const quote of linkedQuotes) {
    if (!quote?.id) continue;
    await removeQuoteEverywhere(quote.id);
  }
}

async function deleteSubjectCascadeEverywhere(subjectName) {
  const subject = String(subjectName || "").trim();
  if (!subject) return;

  // Delete nodes first to avoid expensive integrity updates while wiping the subject.
  const allNodes = await getAllNodes();
  const relatedNodes = (allNodes || []).filter((node) => {
    if (!node) return false;
    if (node.type === "subject" || node?.meta?.kind === "subject") {
      return String(node.subject || node.title || "").trim() === subject;
    }
    return node.subject === subject;
  });

  for (const node of relatedNodes) {
    if (!node?.id) continue;
    await deleteNode(node.id);
    if (USE_BACKEND && window.currentUser) {
      try { await deleteCloudNode(node.id); } catch (error) { console.log("Cloud delete skipped", error); }
    }
  }

  // Delete quotes (and their cues) for the subject.
  const subjectQuotes = await getQuotesForSubject(subject);
  for (const quote of subjectQuotes || []) {
    if (!quote?.id) continue;
    await removeQuoteEverywhere(quote.id);
  }

  // Safety: if any cues remain for the subject, delete them.
  const subjectCues = await getCuesForSubject(subject);
  for (const cue of subjectCues || []) {
    if (!cue?.id) continue;
    await removeCueEverywhere(cue.id);
  }
}

async function removeCueEverywhere(id) {
  await deleteCue(id);

  if (!USE_BACKEND || !window.currentUser) return;

  try {
    await deleteCloudCue(id);
  } catch (error) {
    console.log("Cloud cue delete skipped", error);
  }
}

// ---- toast notifications ----
function toast(message, { sticky = false, action = null } = {}) {
  const root = document.getElementById("nnToastRoot");
  if (!root) return;
  const el = document.createElement("div");
  el.className = "nn-toast";
  const text = document.createElement("span");
  text.textContent = message;
  el.appendChild(text);
  if (action) {
    const btn = document.createElement("button");
    btn.className = "nn-toast-btn";
    btn.textContent = action.label;
    el.appendChild(btn);
    btn.addEventListener("click", (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      dismiss();
      if (action.onClick) action.onClick();
    });
  }
  const dismiss = () => {
    el.classList.add("hide");
    setTimeout(() => el.remove(), 320);
  };
  root.appendChild(el);
  if (!sticky) setTimeout(dismiss, 7000);
  return dismiss;
}

// Stable fingerprint of a dataset (used to detect whether the user is on
// pristine demo data vs. a modified/own dataset).
function fingerprintDataset(nodes, quotes, cues) {
  const norm = (arr) => arr
    .map((o) => JSON.stringify(o))
    .sort()
    .join("|");
  const str = norm(nodes || []) + "||" + norm(quotes || []) + "||" + norm(cues || []);
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

async function currentFingerprint() {
  const [nodes, quotes, cues] = await Promise.all([getAllNodes(), getAllQuotes(), getAllCues()]);
  return fingerprintDataset(nodes, quotes, cues);
}

async function demoFingerprint() {
  try {
    const res = await fetch("demo-data.json", { cache: "no-store" });
    if (!res.ok) return null;
    const payload = await res.json();
    const { dataset } = upgradeDataset(payload);
    return fingerprintDataset(dataset?.nodes || [], dataset?.quotes || [], dataset?.cues || []);
  } catch (e) {
    return null;
  }
}

async function fetchDemoPayload() {
  const res = await fetch("demo-data.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Demo data not found");
  return res.json();
}

async function exportDatabaseJson() {
  const [nodes, quotes, cues] = await Promise.all([getAllNodes(), getAllQuotes(), getAllCues()]);
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    nodes,
    quotes,
    cues
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `neuronet-export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importDatabaseJson(file) {
  const text = await file.text();
  const payload = JSON.parse(text);
  await importPayload(payload);
}

async function importPayload(payload) {
  // Auto-upgrade any legacy data to the markdown-first schema on the way in,
  // so old export files work as-is (no manual migration needed).
  const { dataset } = upgradeDataset(payload);

  const nodes = Array.isArray(dataset?.nodes) ? dataset.nodes : [];
  const quotes = Array.isArray(dataset?.quotes) ? dataset.quotes : [];
  const cues = Array.isArray(dataset?.cues) ? dataset.cues : [];

  await clearNodes();
  await clearQuotes();
  await clearCues();
  await addNodes(nodes);
  await addQuotes(quotes);
  await addCues(cues);

  if (USE_BACKEND && window.currentUser) {
    const [cloudNodes, cloudQuotes, cloudCues] = await Promise.all([
      fetchCloudNodes(),
      fetchCloudQuotes(),
      fetchCloudCues()
    ]);
    await Promise.all([
      ...cloudNodes.map((node) => deleteCloudNode(node.id)),
      ...cloudQuotes.map((quote) => deleteCloudQuote(quote.id)),
      ...cloudCues.map((cue) => deleteCloudCue(cue.id))
    ]);
    await syncToCloud(nodes, quotes, cues);
  }

  // Refresh global launchpad with fresh data
  await updateGlobalStats();
  await renderSubjectList();

  // Notify tools that DB has changed so they can refresh
  document.dispatchEvent(new Event("db-change"));

  if (currentToolName) {
    await loadTool(currentToolName);
  }
}

async function upgradeStoredDatabaseIfNeeded() {
  try {
    const [nodes, quotes, cues] = await Promise.all([getAllNodes(), getAllQuotes(), getAllCues()]);
    const { upgraded, stats, dataset } = upgradeStoredData(nodes, quotes, cues);
    if (upgraded && dataset) {
      await Promise.all([addNodes(dataset.nodes), addQuotes(dataset.quotes), addCues(dataset.cues)]);
      console.log(
        `[UPGRADE] legacy data upgraded: sources=${stats.sourceUpgraded} ` +
        `quotes relocated=${stats.quoteRelocated} kept=${stats.quoteKept} failed=${stats.quoteFailed} ` +
        `quoteRefs relocated=${stats.refRelocated} failed=${stats.refFailed}`
      );
    }
  } catch (error) {
    console.error("[UPGRADE] error during stored-data upgrade:", error);
  }
}

// ========== DEMO DATA & DELETE DATA ==========

async function importDemoData() {
  const cur = await currentFingerprint();
  const empty = cur === fingerprintDataset([], [], []);
  if (!empty) {
    const ok = await dialog.confirm(
      "Importing demo data will overwrite YOUR current NeuroNet database. Continue?",
      "Import demo",
      "danger"
    );
    if (!ok) return;
  }
  try {
    const payload = await fetchDemoPayload();
    await importPayload(payload);
    toast("Demo data imported. Explore the launchpad or click a tool.");
  } catch (error) {
    console.error("Demo import failed", error);
    dialog.alert("Could not load demo data. It may not be deployed yet.");
  }
}

async function deleteAllData() {
  const [nodes, quotes, cues] = await Promise.all([getAllNodes(), getAllQuotes(), getAllCues()]);
  const isDemo = await isOnDemoData(nodes, quotes, cues);

  // Easy path: pristine demo data, fully recoverable via re-import.
  if (isDemo) {
    const ok = await dialog.confirm(
      "This is demo data — safe to remove and you can re-import it anytime.\n\nDelete demo data?",
      "Delete demo data",
      "danger"
    );
    if (!ok) return;
    await wipeDatabase();
    toast("Demo data removed. Use “Import Demo Data” in your profile to get it back.");
    return;
  }

  // Modified / user data: full caution flow.
  const gate = await dialog.confirm(
    "Delete ALL of your NeuroNet data? This removes every subject, source, analysis, quote, cue and past paper from this browser. This is a danger zone.\n\nContinue?",
    "Continue to delete",
    "danger"
  );
  if (!gate) return;

  // Optional backup — never forced.
  const makeBackup = await dialog.confirm(
    "Back up your data first as a .json file? Recommended, optional.\n\nChoose whether to download a backup before deleting.\n\nYes = download backup now.  No = skip (delete without backup).",
    "Yes, back up",
    "primary",
    "No"
  );
  if (makeBackup) {
    await exportDatabaseJson();
    await dialog.alert(
      "Backup downloaded.\n\nKeep your .json data file safe — you can re-import it into NeuroNet anytime (profile → Import JSON Data)."
    );
  }

  const finalOk = await dialog.confirm(
    "FINAL WARNING: This permanently deletes everything from this browser. There is no undo.\n\nProceed to delete?",
    "Delete all data",
    "danger"
  );
  if (!finalOk) return;

  // Real typed double-check ("danger zone").
  const typeOk = await dialog.prompt(
    "This is the danger area. Type the word DELETE to permanently erase all data, or Cancel to keep everything.",
    ""
  );
  if (typeOk == null || String(typeOk).trim().toUpperCase() !== "DELETE") {
    await dialog.alert("Deletion cancelled — nothing was deleted.");
    return;
  }

  await wipeDatabase();
  toast("All data deleted. Your database is now empty.");
}

async function isOnDemoData(nodes, quotes, cues) {
  const demoFp = await demoFingerprint();
  if (demoFp == null) return false;
  return fingerprintDataset(nodes, quotes, cues) === demoFp;
}

async function wipeDatabase() {
  await clearNodes();
  await clearQuotes();
  await clearCues();
  if (USE_BACKEND && window.currentUser) {
    try {
      const [cloudNodes, cloudQuotes, cloudCues] = await Promise.all([
        fetchCloudNodes(), fetchCloudQuotes(), fetchCloudCues()
      ]);
      await Promise.all([
        ...cloudNodes.map((node) => deleteCloudNode(node.id)),
        ...cloudQuotes.map((quote) => deleteCloudQuote(quote.id)),
        ...cloudCues.map((cue) => deleteCloudCue(cue.id))
      ]);
      await syncToCloud([], [], []);
    } catch (error) {
      console.log("Cloud wipe skipped", error);
    }
  }
  await updateGlobalStats();
  await renderSubjectList();
  document.dispatchEvent(new Event("db-change"));
  if (currentToolName) await loadTool(currentToolName);
}

// ========== LAUNCHPAD FUNCTIONS ==========

function showLaunchpad() {
  const tc = document.getElementById("toolContainer");
  const launchpad = document.getElementById("globalLaunchpad");
  if (!launchpad) return;

  // Animate tool container out if it exists
  if (tc) {
    tc.classList.add("exiting");
    setTimeout(() => {
      tc.style.display = "none";
      tc.classList.remove("exiting");
      tc.innerHTML = "";
    }, 350);
  }

  // Animate launchpad in
  launchpad.style.display = "flex";
  launchpad.classList.add("entering");
  void launchpad.offsetWidth; // force reflow
  launchpad.classList.remove("entering");
  launchpad.classList.add("entered");
}

function hideLaunchpad() {
  const tc = document.getElementById("toolContainer");
  const launchpad = document.getElementById("globalLaunchpad");
  if (!launchpad) return;

  // Animate launchpad out
  launchpad.classList.add("exiting");
  launchpad.classList.remove("entered");
  setTimeout(() => {
    launchpad.style.display = "none";
    launchpad.classList.remove("exiting");
  }, 350);

  // Show tool container
  if (tc) {
    tc.style.display = "block";
    tc.classList.add("entering");
    void tc.offsetWidth;
    tc.classList.remove("entering");
    tc.classList.add("entered");
  }
}

function openTool(toolName, context = {}) {
  currentToolName = toolName;
  currentSubject = context.subject || null;
  setActiveTool(toolName);
  const tool = tools[toolName];
  toolContainer.innerHTML = "";
  fetch(`./tools/${tool.file}`).then(r => r.text()).then(html => {
    toolContainer.innerHTML = html;
    if (tool.init) tool.init(context);
    hideLaunchpad();
  });
}

async function updateGlobalStats() {
  const [allNodes, allQuotes] = await Promise.all([getAllNodes(), getAllQuotes()]);

  const subjects = new Set();
  const sources = [];
  const analyses = [];

  allNodes.forEach(node => {
    if (node.subject) subjects.add(node.subject);
    if (node.type === "source" || node.meta?.kind === "source") sources.push(node);
    if (node.type === "analysis") analyses.push(node);
  });

  document.getElementById("statSubjects").textContent = subjects.size;
  document.getElementById("statSources").textContent = sources.length;
  document.getElementById("statQuotes").textContent = allQuotes.length;
  document.getElementById("statAnalyses").textContent = analyses.length;
}

async function renderSubjectList() {
  const subjectList = document.getElementById("subjectList");
  const [allNodes, allQuotes] = await Promise.all([getAllNodes(), getAllQuotes()]);

  const subjectData = {};
  allNodes.forEach(node => {
    if (node.subject) {
      if (!subjectData[node.subject]) {
        subjectData[node.subject] = { sources: 0, analyses: 0 };
      }
      if (node.type === "source" || node.meta?.kind === "source") {
        subjectData[node.subject].sources++;
      }
      if (node.type === "analysis") {
        subjectData[node.subject].analyses++;
      }
    }
  });
  allQuotes.forEach(quote => {
    if (quote.subject && subjectData[quote.subject]) {
      subjectData[quote.subject].quotes = (subjectData[quote.subject].quotes || 0) + 1;
    }
  });

  const subjects = Object.keys(subjectData).sort();

  if (subjects.length === 0) {
    subjectList.innerHTML = '<p class="empty-note">No subjects yet. Create one to get started.</p>';
    return;
  }

  subjectList.innerHTML = subjects.map(subject => `
    <article class="subject-card" data-subject="${escapeHtml(subject)}">
      <span class="subject-name">${escapeHtml(subject)}</span>
      <div class="subject-actions" ${subjectEditMode ? "" : "hidden"} data-subject="${escapeHtml(subject)}">
        <button type="button" data-action="rename-subject" data-subject="${escapeHtml(subject)}">Rename</button>
        <button type="button" data-action="delete-subject" data-subject="${escapeHtml(subject)}">Delete</button>
      </div>
    </article>
  `).join("");

  subjectList.querySelectorAll(".subject-card").forEach(card => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".subject-actions")) return;
      if (card.dataset.subject) {
        enterSubjectWorkspace(card.dataset.subject);
      }
    });
  });

  subjectList.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const action = e.target.dataset.action;
      const subject = e.target.dataset.subject;
      if (!action || !subject) return;

      if (action === "rename-subject") {
        const updated = await dialog.prompt(`Rename subject "${subject}" to:`, subject);
        const next = (updated || "").trim();
        if (!next || next === subject) return;
        await renameSubject(subject, next);
      } else if (action === "delete-subject") {
        const ok = await dialog.confirm(`Delete subject "${subject}" and all its content?`, "Delete", "danger");
        if (!ok) return;
        await deleteSubject(subject);
      }
      await updateGlobalStats();
      await renderSubjectList();
      await renderSidebarSubjects();
    });
  });
}

async function addSubjectFromInput() {
  const input = document.getElementById("newSubjectName");
  const name = input.value.trim();
  if (!name) return;

  await addSubject(name);
  input.value = "";
  await renderSubjectList();
  await updateGlobalStats();
  await renderSidebarSubjects();
  const addSubjectBtn = document.getElementById("addSubjectBtn");
  if (addSubjectBtn) addSubjectBtn.disabled = true;
}

async function initLaunchpad() {
  await updateGlobalStats();
  await renderSubjectList();
  await renderToolCatalogue();
  await renderSidebarSubjects();

  const allBtn = document.getElementById("sidebarSubjectAll");
  if (allBtn) {
    allBtn.addEventListener("click", () => selectSidebarSubject(""));
  }

  const addSubjectBtn = document.getElementById("addSubjectBtn");
  const newSubjectInput = document.getElementById("newSubjectName");
  const toggleSubjectEdit = document.getElementById("toggleSubjectEdit");

  async function updateSubjectCreateState() {
    if (!newSubjectInput || !addSubjectBtn) return;
    const subject = (newSubjectInput.value || "").trim();
    const existingSubjects = await getSubjects();
    const disabled = !subject || existingSubjects.includes(subject);
    addSubjectBtn.disabled = disabled;
  }

  if (addSubjectBtn) {
    addSubjectBtn.addEventListener("click", addSubjectFromInput);
  }
  if (newSubjectInput) {
    newSubjectInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") addSubjectFromInput();
    });
    newSubjectInput.addEventListener("input", updateSubjectCreateState);
    await updateSubjectCreateState();
  }
  async function refreshSubjectAddState() {
    await updateSubjectCreateState();
  }
  window.refreshSubjectAddState = refreshSubjectAddState;
  const toggleBtn = document.getElementById("toggleSubjectEdit");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      subjectEditMode = !subjectEditMode;
      toggleBtn.textContent = subjectEditMode ? "Done" : "Edit";

      const actions = document.querySelectorAll(".subject-actions");
      actions.forEach(el => {
        el.hidden = !subjectEditMode;
      });
    });
  }
}

async function enterSubjectWorkspace(subject) {
  currentSubject = subject;
  hideLaunchpad();
  await renderSidebarSubjects();
  await loadTool("analysis", { subject });
}

function returnToGlobalLaunchpad() {
  console.log("Returning to global launchpad");
  currentToolName = "";
  currentSubject = null;
  setActiveTool("");
  // Notify tools to cleanup their internal state
  if (typeof window.__neuronetOnReturnToGlobal === "function") {
    window.__neuronetOnReturnToGlobal();
  }
  showLaunchpad();
  renderSidebarSubjects();

  // Make the transition back to home prominent on the neural background
  if (window.__neuronetCanvas) {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    // High-strength pulse for prominence
    window.__neuronetCanvas.triggerRadialPulse(cx, cy, 2.2);
    // Burst of energy for "alien intelligent" feel
    setTimeout(() => {
      window.__neuronetCanvas.triggerRandomNodes(15, 0.9);
      window.__neuronetCanvas.triggerVerticalWave(0.5);
    }, 50);
  }
}

// Wire up back button handler
window.__neuronetReturnToLaunchpad = returnToGlobalLaunchpad;

// For tools to register cleanup when returning to global launchpad
window.__neuronetOnReturnToGlobal = null;

// ========== PINNED TOOLS SIDEBAR ==========

async function initPinnedToolsSidebar() {
  const container = document.getElementById("toolButtonsContainer");
  if (!container) return;

  const pinnedTools = await getPinnedTools();
  const pinnedIds = pinnedTools.map(t => t.toolId);

  // Default: pin all tools initially
  const toolsToShow = Object.keys(toolDefinitions);
  for (const toolId of toolsToShow) {
    if (!pinnedIds.includes(toolId)) {
      await pinTool(toolId);
    }
  }

  await renderPinnedToolsSidebar();
}

async function renderPinnedToolsSidebar() {
  const container = document.getElementById("toolButtonsContainer");
  if (!container) return;

  const pinnedTools = await getPinnedTools();

  container.innerHTML = pinnedTools.map((pinned, index) => {
    const def = toolDefinitions[pinned.toolId];
    if (!def) return "";
    const isActive = currentToolName === pinned.toolId ? "active" : "";
    return `
      <div class="tool-btn-wrapper entering ${isActive}" data-tool="${pinned.toolId}">
        <button class="tool-btn" data-tool="${pinned.toolId}">${def.icon} ${def.name}</button>
        <div class="tool-actions-menu">
          <button class="tool-action-btn pin" data-action="unpin" data-tool="${pinned.toolId}" title="Unpin">Unpin</button>
        </div>
      </div>
    `;
  }).join("");

  container.querySelectorAll(".tool-btn-wrapper").forEach((wrapper, i) => {
    setTimeout(() => {
      wrapper.classList.remove("entering");
      wrapper.classList.add("entered");
    }, 50 + i * 40);
  });

  container.querySelectorAll(".tool-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const toolName = btn.dataset.tool;
      const subject = currentSubject;
      window.closeSubjectDrawer?.();
      hideLaunchpad();
      loadTool(toolName, { subject });
    });
  });

  container.querySelectorAll(".tool-btn-wrapper").forEach(wrapper => {
    wrapper.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      container.querySelectorAll(".tool-btn-wrapper.show-actions").forEach(el => {
        if (el !== wrapper) el.classList.remove("show-actions");
      });
      wrapper.classList.toggle("show-actions");
    });
  });

  document.addEventListener("click", () => {
    container.querySelectorAll(".tool-btn-wrapper.show-actions").forEach(el => {
      el.classList.remove("show-actions");
    });
  });

  container.querySelectorAll(".tool-action-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const toolId = btn.dataset.tool;
      if (action === "unpin") {
        showUnpinModal(toolId);
      }
      btn.closest(".tool-btn-wrapper").classList.remove("show-actions");
    });
  });
}

// ========== SIDEBAR SUBJECT SWITCHER ==========

async function renderSidebarSubjects() {
  const listEl = document.getElementById("sidebarSubjectList");
  const allBtn = document.getElementById("sidebarSubjectAll");
  if (!listEl || !allBtn) return;

  const subjects = await getSubjects();
  const norm = (s) => String(s || "").trim().toLowerCase();

  allBtn.classList.toggle("active", !currentSubject);

  listEl.innerHTML = subjects.map(subject => `
    <button type="button" class="subject-pill ${norm(subject) === norm(currentSubject) ? "active" : ""}"
            data-subject="${escapeHtml(subject)}">${escapeHtml(subject)}</button>
  `).join("");

  listEl.querySelectorAll(".subject-pill").forEach(btn => {
    btn.addEventListener("click", () => selectSidebarSubject(btn.dataset.subject));
  });
}

async function selectSidebarSubject(subject) {
  if (typeof window.closeSubjectDrawer === "function") {
    window.closeSubjectDrawer();
  }
  const next = subject || null;
  const subjectChanged = next !== currentSubject;
  currentSubject = next;
  setActiveTool(currentToolName);
  await renderSidebarSubjects();

  if (!subjectChanged) return;
  if (currentToolName) {
    loadTool(currentToolName, { subject: next });
  } else if (next) {
    enterSubjectWorkspace(next);
  } else {
    returnToGlobalLaunchpad();
  }
}

window.__neuronetSelectSubject = selectSidebarSubject;

window.__neuronetRefreshSubjects = async () => {
  await renderSidebarSubjects();
};

// ========== UNPIN MODAL ==========

let pendingUnpinTool = null;

function showUnpinModal(toolId) {
  pendingUnpinTool = toolId;
  const def = toolDefinitions[toolId];
  document.getElementById("unpinToolName").textContent = def?.name || toolId;
  document.getElementById("unpinModal").style.display = "flex";
}

function hideUnpinModal() {
  pendingUnpinTool = null;
  document.getElementById("unpinModal").style.display = "none";
}

async function confirmUnpin() {
  if (!pendingUnpinTool) return;
  await unpinTool(pendingUnpinTool);
  hideUnpinModal();
  await renderPinnedToolsSidebar();
  await renderToolCatalogue();
}

// ========== TOOL CATALOGUE ==========

async function renderToolCatalogue() {
  const grid = document.getElementById("toolCardsGrid");
  if (!grid) return;

  const pinnedTools = await getPinnedTools();
  const pinnedIds = new Set(pinnedTools.map(t => t.toolId));

  grid.innerHTML = Object.entries(toolDefinitions).map(([toolId, def]) => {
    const isPinned = pinnedIds.has(toolId);
    const actionText = isPinned ? "Unpin" : "Pin";
    return `
      <div class="tool-card" data-tool="${toolId}">
        <div class="tool-card-actions">
          <button class="tool-card-action-btn" data-action="${isPinned ? 'unpin' : 'pin'}" data-tool="${toolId}">${actionText}</button>
        </div>
        <div class="tool-card-icon">${def.icon}</div>
        <div class="tool-card-title">${def.name}</div>
        <div class="tool-card-desc">${def.desc}</div>
      </div>
    `;
  }).join("");

  const cards = grid.querySelectorAll(".tool-card");
  cards.forEach((card) => {
    card.style.opacity = "1";
    card.style.transform = "translateY(0) scale(1)";
  });

  grid.querySelectorAll(".tool-card").forEach(card => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".tool-card-actions")) return;
      const toolName = card.dataset.tool;
      hideLaunchpad();
      loadTool(toolName, {});
    });

    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      grid.querySelectorAll(".tool-card.show-actions").forEach(el => {
        if (el !== card) el.classList.remove("show-actions");
      });
      card.classList.toggle("show-actions");
    });
  });

  document.addEventListener("click", () => {
    grid.querySelectorAll(".tool-card.show-actions").forEach(el => {
      el.classList.remove("show-actions");
    });
  });

  grid.querySelectorAll(".tool-card-action-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const toolId = btn.dataset.tool;

      if (action === "unpin") {
        showUnpinModal(toolId);
      } else if (action === "pin") {
        await pinTool(toolId);
        await renderPinnedToolsSidebar();
        await renderToolCatalogue();
      }
    });
  });
}

// ========== EVENT LISTENERS ==========
document.addEventListener("DOMContentLoaded", async () => {
  toolContainer = document.getElementById("toolContainer");
  setProfileUI(null);

  const loadingOverlay = document.getElementById("loadingOverlay");
  const loadingMessage = document.getElementById("loadingMessage");
  const loadingCheckmark = document.getElementById("loadingCheckmark");
  const appElement = document.getElementById("app");

  // Origin validation
  const ALLOWED_ORIGINS = [
    "http://127.0.0.1:5500",
    "http://localhost:5173",
    "http://localhost:4173",
    "https://aigsniperyt.github.io"
  ];
  const currentOrigin = window.location.origin;
  const isAllowed = ALLOWED_ORIGINS.some(origin => currentOrigin.startsWith(origin));

  if (!isAllowed) {
    loadingOverlay.style.display = "flex";
    loadingMessage.innerHTML = `<span style="color:#ff6b6b;font-size:1.2rem;">&#10060; Access denied</span>`;
    const checkmark = loadingOverlay.querySelector(".checkmark");
    if (checkmark) checkmark.remove();
    return;
  }

  loadingOverlay.style.display = "flex";
  loadingMessage.textContent = "Connecting to the server...";

  const sidebarEl = document.getElementById("sidebar");
  const launchpadEl = document.getElementById("globalLaunchpad");
  if (sidebarEl) sidebarEl.classList.add("entering");
  if (launchpadEl) launchpadEl.classList.add("entering");

  await cleanupOldDemoDatabases();
  await initDB();
  DB_READY = true;

  // Upgrade any legacy stored data to the markdown-first schema in place
  // (idempotent, cheap no-op when nothing is legacy). Runs in both demo and
  // cloud modes so old local DBs self-heal without a manual re-import.
  await upgradeStoredDatabaseIfNeeded();

  if (!window.DEMO_MODE) {
    await performMigration(getAllNodes, addNode, addQuote);
  }

  loadingMessage.textContent = "Authenticating with the cloud...";
  let user;
  if (USE_BACKEND) {
    try {
      user = await fetchUser();
    } finally {
      loadingMessage.textContent = "Loading page content complete!";
      loadingCheckmark.classList.add("show");
    }

    await new Promise(r => setTimeout(r, 800));

    loadingOverlay.classList.add("fade-out");

    await new Promise(r => setTimeout(r, 800));

    if (user) {
      await syncAfterLogin();
    }
  } else {
    loadingMessage.textContent = "Loading page content complete!";
    loadingCheckmark.classList.add("show");
    await new Promise(r => setTimeout(r, 800));
    loadingOverlay.classList.add("fade-out");
    await new Promise(r => setTimeout(r, 800));
  }

  loadingOverlay.classList.add("completed");
  loadingOverlay.style.display = "none";

  if (canvasEl) {
    canvasEl.style.filter = "brightness(0.85) contrast(1.15)";
  }

  const sidebarElDone = document.getElementById("sidebar");
  sidebarElDone?.classList.remove("entering");
  sidebarElDone?.classList.add("entered");
  if (launchpadEl) {
    launchpadEl.classList.remove("entering");
    launchpadEl.classList.add("entered");
  }

  const toolCards = document.querySelectorAll(".tool-card.entering");
  toolCards.forEach((card, i) => {
    setTimeout(() => {
      card.classList.remove("entering");
      card.classList.add("entered");
    }, 50 + i * 50);
  });

  const sidebarTools = document.querySelectorAll(".tool-btn-wrapper.entering");
  sidebarTools.forEach((tool, i) => {
    setTimeout(() => {
      tool.classList.remove("entering");
      tool.classList.add("entered");
    }, 50 + i * 40);
  });

  window.addEventListener("neuronet-open-tool", (e) => {
    const { tool, nodeId, subject } = e.detail || {};
    if (tool) {
      loadTool(tool, { nodeId, subject });
    }
  });

  const profileElem = document.getElementById("sidebarProfile");
  const dropdown = document.getElementById("dropdown");
  const authActionBtn = document.getElementById("authActionBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const exportJsonBtn = document.getElementById("exportJsonBtn");
  const importJsonBtn = document.getElementById("importJsonBtn");
  const importJsonInput = document.getElementById("importJsonInput");
  const importDemoBtn = document.getElementById("importDemoBtn");
  const deleteDataBtn = document.getElementById("deleteDataBtn");

  if (profileElem) {
    profileElem.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.style.display =
        dropdown.style.display === "block" ? "none" : "block";
    });
  }

  document.addEventListener("click", () => {
    if (dropdown) dropdown.style.display = "none";
  });

  // Mobile navigation drawer: hamburger opens, backdrop / selection closes.
  const hamburger = document.getElementById("sidebarHamburger");
  const mobileNavPanel = document.getElementById("mobileNavPanel");
  const subjectBackdrop = document.getElementById("sidebarSubjectBackdrop");
  const mobileSubjectsToggle = document.getElementById("mobileSubjectsToggle");
  const mobileToolsToggle = document.getElementById("mobileToolsToggle");
  const mobileSubjectsSection = document.getElementById("mobileSubjectsSection");
  const mobileToolsSection = document.getElementById("mobileToolsSection");
  window.closeSubjectDrawer = closeSubjectDrawer;
  function closeSubjectDrawer() {
    mobileNavPanel?.classList.remove("open");
    subjectBackdrop?.classList.remove("show");
    hamburger?.setAttribute("aria-expanded", "false");
  }
  function openSubjectDrawer() {
    mobileNavPanel?.classList.add("open");
    subjectBackdrop?.classList.add("show");
    hamburger?.setAttribute("aria-expanded", "true");
  }
  hamburger?.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = mobileNavPanel?.classList.contains("open");
    open ? closeSubjectDrawer() : openSubjectDrawer();
  });
  subjectBackdrop?.addEventListener("click", closeSubjectDrawer);
  function setMobileNavSection(section, toggle, open) {
    if (!section || !toggle) return;
    section.classList.toggle("mobile-section-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  }
  function toggleMobileNavSection(sectionName) {
    const isSubjects = sectionName === "subjects";
    const section = isSubjects ? mobileSubjectsSection : mobileToolsSection;
    const toggle = isSubjects ? mobileSubjectsToggle : mobileToolsToggle;
    const open = toggle?.getAttribute("aria-expanded") !== "true";
    setMobileNavSection(mobileSubjectsSection, mobileSubjectsToggle, isSubjects && open);
    setMobileNavSection(mobileToolsSection, mobileToolsToggle, !isSubjects && open);
  }
  mobileSubjectsToggle?.addEventListener("click", () => toggleMobileNavSection("subjects"));
  mobileToolsToggle?.addEventListener("click", () => toggleMobileNavSection("tools"));
  if (window.matchMedia("(max-width: 700px), (pointer: coarse) and (hover: none)").matches) {
    setMobileNavSection(mobileToolsSection, mobileToolsToggle, false);
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSubjectDrawer();
  });

  // Keep the sidebar subject pills (and launchpad subjects) in sync with any
  // database change across all tools.
  document.addEventListener("db-change", async () => {
    await renderSidebarSubjects();
  });

  const unpinCancel = document.getElementById("unpinCancel");
  const unpinConfirm = document.getElementById("unpinConfirm");

  if (unpinCancel) {
    unpinCancel.addEventListener("click", hideUnpinModal);
  }
  if (unpinConfirm) {
    unpinConfirm.addEventListener("click", confirmUnpin);
  }

  // Initialize pinned tools sidebar
  await initPinnedToolsSidebar();

  // Initialize launchpad
  await initLaunchpad();

  // Default to launchpad (no tool selected)
  showLaunchpad();

  // Logo click - return to launchpad
  const logo = document.getElementById("logo");
  if (logo) {
    logo.addEventListener("click", () => {
      returnToGlobalLaunchpad();
    });
  } else {
    // Fallback: use event delegation
    document.addEventListener("click", (e) => {
      const h2 = e.target.closest("h2");
      if (h2 && h2.id === "logo") {
        returnToGlobalLaunchpad();
      }
    });
  }

  if (authActionBtn) {
    authActionBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      startGoogleLogin();
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async (e) => {
      e.stopPropagation();

      if (USE_BACKEND) {
        try {
          await fetch(`${BACKEND}/auth/logout`, {
            credentials: "include",
          });
        } catch (error) {
          console.log("Logout request failed, staying offline locally", error);
        }
      }

      window.currentUser = null;
      setProfileUI(null);
      if (dropdown) dropdown.style.display = "none";
    });
  }

  if (exportJsonBtn) {
    exportJsonBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await exportDatabaseJson();
      if (dropdown) dropdown.style.display = "none";
    });
  }

  if (importJsonBtn && importJsonInput) {
    importJsonBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      importJsonInput.click();
    });

    importJsonInput.addEventListener("change", async () => {
      const [file] = importJsonInput.files || [];
      if (!file) return;
      const confirmed = await dialog.confirm("Importing JSON will overwrite your current NeuroNet database. Continue?", "Import", "danger");
      if (!confirmed) {
        importJsonInput.value = "";
        return;
      }

      try {
        await importDatabaseJson(file);
        if (dropdown) dropdown.style.display = "none";
      } catch (error) {
        console.error("Import failed", error);
        dialog.alert("Import failed. Please check the JSON file format.");
      } finally {
        importJsonInput.value = "";
      }
    });
  }

  if (importDemoBtn) {
    importDemoBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (dropdown) dropdown.style.display = "none";
      await importDemoData();
    });
  }

  if (deleteDataBtn) {
    deleteDataBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (dropdown) dropdown.style.display = "none";
      deleteAllData();
    });
  }

  // First-entry / data-state toast: nudge the user toward the profile card
  // (Import Demo Data / Delete Data live there). Shown whenever the DB is
  // pristine demo data, empty, OR it's the user's first visit — and only
  // stops once they've made their first change (own/modified data).
  try {
    const visitedKey = "nn-first-visit";
    const visited = !!localStorage.getItem(visitedKey);
    if (!visited) localStorage.setItem(visitedKey, "1");

    const [nodes, quotes, cues] = await Promise.all([getAllNodes(), getAllQuotes(), getAllCues()]);
    const isEmpty = nodes.length === 0 && quotes.length === 0 && cues.length === 0;
    const isDemo = await isOnDemoData(nodes, quotes, cues);

    if (isEmpty || isDemo || !visited) {
      setTimeout(() => {
        toast("Tap your profile card (bottom) for data options — import demo data or delete everything.", {
          sticky: true,
          action: {
            label: "Open",
            onClick: () => {
              if (dropdown) dropdown.style.display = "block";
            }
          }
        });
      }, 1400);
    }
  } catch (e) { /* ignore */ }
});
