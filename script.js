import { initDB, addNode, addNodes, getAllNodes, getNode, deleteNode, addQuote, addQuotes, getAllQuotes, getQuote, deleteQuote, clearNodes, clearQuotes, getQuotesForSubject, getAnalysisNodesForSubject, getQuotesReferencedByAnalysis, getAnalysesReferencingQuote, getPinnedTools, pinTool, unpinTool, isToolPinned, setPinnedToolsOrder, getSubjects, addSubject, deleteSubject, renameSubject } from "./db.js";
import { syncLocalWithCloud, syncToCloud, deleteCloudNode, deleteCloudQuote, fetchCloudNodes, fetchCloudQuotes } from "./sync.js";
import { initAnalysisToolV2 } from "./tools/analysisTool.js";
import { initMemoryTool } from "./tools/memoryTool.js";
import { initMindmapTool } from "./tools/mindmapTool.js";

const BACKEND = "https://neuronet-backend.onrender.com";
let DB_READY = false;
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
    file: "analysis.html",  // loaded from ./tools/ by loadTool
    init: (context) => initAnalysisToolV2({
      getAllNodes,
      getAllQuotes,
      addNode,
      addQuote,
      getQuote,
      deleteQuote,
      backupLocalNodesToCloud,
      removeNodeEverywhere,
      removeQuoteEverywhere,
      normalizeHierarchyPath,
      buildSection,
      parseTags,
      escapeHtml,
      getNodeTimestamp,
      isSourceNode
    }, context)
  },

  memory: {
    file: "memory.html",
    init: (context) => initMemoryTool({
      getAllNodes,
      getAllQuotes,
      getQuotesForSubject,
      getAnalysisNodesForSubject,
      getQuotesReferencedByAnalysis,
      getAnalysesReferencingQuote,
      getNode,
      getNodeTimestamp,
      escapeHtml
    }, context)
  },

  mindmap: {
    file: "mindmap.html",
    init: (context) => initMindmapTool({
      getAllNodes,
      getAllQuotes,
      addNode,
      addQuote,
      deleteNode,
      deleteQuote,
      removeNodeEverywhere,
      removeQuoteEverywhere,
      escapeHtml
    }, context)
  },
  tracker: {
    name: "Tracker",
    file: "tracker.html",
    init: null
  }
};

const toolDefinitions = {
  analysis: { name: "Analysis", file: "analysis.html", icon: "A", desc: "Create source-linked analysis nodes and analyse a source text" },
  memory: { name: "Memory", file: "memory.html", icon: "M", desc: "Flashcard study across subjects to memorise nodes you analyse" },
  mindmap: { name: "Mindmap", file: "mindmap.html", icon: "N", desc: "Visual database overview for establishing connections" },
  tracker: { name: "Tracker", file: "tracker.html", icon: "T", desc: "Track study progress with past paper data" }
};

// ========== CANVAS BACKGROUND ==========
let canvas, ctx;
let nodes = [],
  nodeCount = 92,
  maxDist = 150,
  separationStrength = 0.02,
  edgeRepulsionStrength = 0.01,
  edgeBuffer = 50;
const cellSize = maxDist;
let grid = {},
  gridWidth,
  gridHeight;

function resetGrid() {
  grid = {};
  gridWidth = Math.ceil(canvas.width / cellSize);
  gridHeight = Math.ceil(canvas.height / cellSize);
}

function getCellIndex(x, y) {
  return `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
}

class Node {
  constructor() {
    this.x = Math.random() * canvas.width;
    this.y = Math.random() * canvas.height;
    this.vx = (Math.random() - 0.5) * 1.2;
    this.vy = (Math.random() - 0.5) * 1.2;
    this.maxConnections = Math.floor(Math.random() * 3) + 3;
    this.radius = 2 + Math.random() * 2;
  }

  update() {
    let moveX = 0,
      moveY = 0;
    const cellX = Math.floor(this.x / cellSize),
      cellY = Math.floor(this.y / cellSize);
    let nearbyNodes = [];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${cellX + dx},${cellY + dy}`;
        if (grid[key]) nearbyNodes.push(...grid[key]);
      }
    }

    for (let other of nearbyNodes) {
      if (other === this) continue;
      let dx = other.x - this.x,
        dy = other.y - this.y,
        dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0.01 && dist < maxDist) {
        let force = separationStrength * (1 / dist) * (1 - dist / maxDist);
        moveX -= dx * force;
        moveY -= dy * force;
      }
    }

    if (this.x < edgeBuffer)
      moveX += edgeRepulsionStrength * (1 - this.x / edgeBuffer);
    if (this.x > canvas.width - edgeBuffer)
      moveX -= edgeRepulsionStrength * ((this.x - (canvas.width - edgeBuffer)) / edgeBuffer);
    if (this.y < edgeBuffer)
      moveY += edgeRepulsionStrength * (1 - this.y / edgeBuffer);
    if (this.y > canvas.height - edgeBuffer)
      moveY -= edgeRepulsionStrength * ((this.y - (canvas.height - edgeBuffer)) / edgeBuffer);

    const mouseForceRadius = 50,
      mouseRepelStrength = 0.5;
    if (mouse.x !== undefined && mouse.y !== undefined) {
      let dx = this.x - mouse.x,
        dy = this.y - mouse.y,
        dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < mouseForceRadius && dist > 0.01) {
        let force = mouseRepelStrength * (1 - dist / mouseForceRadius);
        moveX += (dx / dist) * force;
        moveY += (dy / dist) * force;
      }
    }

    const randomDrift = 0.02;
    this.vx += moveX + (Math.random() - 0.5) * randomDrift;
    this.vy += moveY + (Math.random() - 0.5) * randomDrift;

    const maxSpeed = 0.6;
    let speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (speed > maxSpeed) {
      this.vx = (this.vx / speed) * maxSpeed;
      this.vy = (this.vy / speed) * maxSpeed;
    }

    this.x += this.vx;
    this.y += this.vy;

    if (this.x < 0) { this.x = 0; this.vx *= -1; }
    if (this.x > canvas.width) { this.x = canvas.width; this.vx *= -1; }
    if (this.y < 0) { this.y = 0; this.vy *= -1; }
    if (this.y > canvas.height) { this.y = canvas.height; this.vy *= -1; }
  }

  draw() {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = "#9fffd6";
    ctx.fill();
  }
}

function buildGrid() {
  resetGrid();
  for (const node of nodes) {
    const key = getCellIndex(node.x, node.y);
    if (!grid[key]) grid[key] = [];
    grid[key].push(node);
  }
}

function connectNodes() {
  buildGrid();
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    const cellX = Math.floor(a.x / cellSize),
      cellY = Math.floor(a.y / cellSize);
    let candidates = [];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${cellX + dx},${cellY + dy}`;
        if (grid[key]) candidates.push(...grid[key]);
      }
    }

    candidates = candidates
      .filter((n) => n !== a)
      .map((b) => {
        const dx = b.x - a.x,
          dy = b.y - a.y,
          dist = Math.sqrt(dx * dx + dy * dy);
        return { node: b, dist };
      });

    let neighbors = candidates.filter((c) => c.dist < maxDist);
    let farNeighbors = candidates.filter(
      (c) => c.dist >= maxDist && c.dist < maxDist * 2
    );

    neighbors.sort((n1, n2) => n1.dist - n2.dist);
    farNeighbors.sort((n1, n2) => n1.dist - n2.dist);

    neighbors = neighbors.slice(0, a.maxConnections);
    if (farNeighbors.length > 0) neighbors.push(farNeighbors[0]);

    for (let { node: b, dist } of neighbors) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = `rgba(31,209,138,${0.5 * (1 - dist / maxDist)})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

function animate() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  nodes.forEach((n) => { n.update(); n.draw(); });
  connectNodes();
  requestAnimationFrame(animate);
}

function initCanvas() {
  canvas = document.getElementById("neuronet");
  if (!canvas) return;
  ctx = canvas.getContext("2d");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  nodes = [];
  resetGrid();
  for (let i = 0; i < nodeCount; i++) nodes.push(new Node());
  animate();
}

window.addEventListener("resize", () => {
  initCanvas();
});

const mouse = {};
function initCanvasListeners() {
  const c = document.getElementById("neuronet");
  if (!c) {
    setTimeout(initCanvasListeners, 100);
    return;
  }
  c.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });
  c.addEventListener("mouseleave", () => {
    delete mouse.x;
    delete mouse.y;
  });
}

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
  if (!window.currentUser || syncInProgress) return;
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
  if (!window.currentUser || syncInProgress) return;
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

  const launchpad = document.getElementById("globalLaunchpad");
  if (launchpad) {
    launchpad.className = "launchpad";
    launchpad.classList.add("zooming-in");
    launchpad.style.transition = "transform 0.15s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.15s ease, filter 0.15s ease";
  }

  currentToolName = toolName;
  currentSubject = context.subject || null;
  setActiveTool(toolName);

  // Hide content briefly until tool initializes to prevent flash
  if (toolContainer) {
    toolContainer.style.visibility = "hidden";
    toolContainer.style.display = "block";
  }

  const tool = tools[toolName];
  const res = await fetch(`./tools/${tool.file}`);
  toolContainer.innerHTML = await res.text();

  if (tool.init) {
    tool.init(context);
  }

  // Reveal after init completes
  if (toolContainer) toolContainer.style.visibility = "";

  setTimeout(() => {
    hideLaunchpad();
  }, 150);
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
  await deleteNode(id);

  if (!window.currentUser) return;

  try {
    await deleteCloudNode(id);
  } catch (error) {
    console.log("Cloud delete skipped", error);
  }
}

async function removeQuoteEverywhere(id) {
  await deleteQuote(id);

  if (!window.currentUser) return;

  try {
    await deleteCloudQuote(id);
  } catch (error) {
    console.log("Cloud quote delete skipped", error);
  }
}

async function exportDatabaseJson() {
  const [nodes, quotes] = await Promise.all([getAllNodes(), getAllQuotes()]);
  const payload = {
    schemaVersion: 3,
    exportedAt: new Date().toISOString(),
    nodes,
    quotes
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
  const nodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
  const quotes = Array.isArray(payload?.quotes) ? payload.quotes : [];

  await clearNodes();
  await clearQuotes();
  await addNodes(nodes);
  await addQuotes(quotes);

  if (window.currentUser) {
    const [cloudNodes, cloudQuotes] = await Promise.all([fetchCloudNodes(), fetchCloudQuotes()]);
    await Promise.all([
      ...cloudNodes.map((node) => deleteCloudNode(node.id)),
      ...cloudQuotes.map((quote) => deleteCloudQuote(quote.id))
    ]);
    await syncToCloud(nodes, quotes);
  }

  if (currentToolName) {
    await loadTool(currentToolName);
  }
}

// ========== LAUNCHPAD FUNCTIONS ==========

function showLaunchpad() {
  const tc = document.getElementById("toolContainer");
  if (tc) tc.style.display = "none";
  const launchpad = document.getElementById("globalLaunchpad");
  if (!launchpad) {
    setTimeout(() => showLaunchpad(), 100);
    return;
  }
  launchpad.className = "launchpad";
  launchpad.style.display = "flex";
  launchpad.style.transition = "none";
  launchpad.classList.add("entering");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      launchpad.style.transition = "all 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)";
      launchpad.classList.remove("entering");
      launchpad.classList.add("entered");
    });
  });
}

function hideLaunchpad() {
  const tc = document.getElementById("toolContainer");
  if (tc) tc.style.display = "block";
  const launchpad = document.getElementById("globalLaunchpad");
  if (!launchpad) return;
  launchpad.classList.remove("entered");
  launchpad.classList.add("entering");
  launchpad.style.transition = "all 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)";
  setTimeout(() => {
    if (launchpad.classList.contains("entering")) {
      launchpad.style.display = "none";
    }
  }, 350);
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
        const updated = window.prompt(`Rename subject "${subject}" to:`, subject);
        const next = (updated || "").trim();
        if (!next || next === subject) return;
        await renameSubject(subject, next);
      } else if (action === "delete-subject") {
        if (!confirm(`Delete subject "${subject}" and all its content?`)) return;
        await deleteSubject(subject);
      }
      await updateGlobalStats();
      await renderSubjectList();
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
  const addSubjectBtn = document.getElementById("addSubjectBtn");
  if (addSubjectBtn) addSubjectBtn.disabled = true;
}

async function initLaunchpad() {
  await updateGlobalStats();
  await renderSubjectList();
  await renderToolCatalogue();

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
  initCanvas();
  initCanvasListeners();
  setProfileUI(null);

  const loadingOverlay = document.getElementById("loadingOverlay");
  const loadingMessage = document.getElementById("loadingMessage");
  const loadingCheckmark = document.getElementById("loadingCheckmark");
  const appElement = document.getElementById("app");

  loadingOverlay.style.display = "flex";
  loadingMessage.textContent = "Connecting to the server...";

  const sidebarEl = document.getElementById("sidebar");
  const launchpadEl = document.getElementById("globalLaunchpad");
  if (sidebarEl) sidebarEl.classList.add("entering");
  if (launchpadEl) launchpadEl.classList.add("entering");

  await initDB();
  DB_READY = true;

  loadingMessage.textContent = "Authenticating with the cloud...";
  let user;
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

  loadingOverlay.classList.add("completed");
  loadingOverlay.style.display = "none";

  if (canvas) {
    canvas.style.filter = "brightness(0.85) contrast(1.15)";
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

      try {
        await fetch(`${BACKEND}/auth/logout`, {
          credentials: "include",
        });
      } catch (error) {
        console.log("Logout request failed, staying offline locally", error);
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
      const confirmed = window.confirm("Importing JSON will overwrite your current NeuroNet database. Continue?");
      if (!confirmed) {
        importJsonInput.value = "";
        return;
      }

      try {
        await importDatabaseJson(file);
        if (dropdown) dropdown.style.display = "none";
      } catch (error) {
        console.error("Import failed", error);
        alert("Import failed. Please check the JSON file format.");
      } finally {
        importJsonInput.value = "";
      }
    });
  }
});
