const BACKEND = "https://neuronet-backend.onrender.com";
const DEV_MODE = false;

// ========== CANVAS BACKGROUND ==========
const canvas = document.getElementById("neuronet");
const ctx = canvas.getContext("2d");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

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
      moveX -=
        edgeRepulsionStrength *
        ((this.x - (canvas.width - edgeBuffer)) / edgeBuffer);
    if (this.y < edgeBuffer)
      moveY += edgeRepulsionStrength * (1 - this.y / edgeBuffer);
    if (this.y > canvas.height - edgeBuffer)
      moveY -=
        edgeRepulsionStrength *
        ((this.y - (canvas.height - edgeBuffer)) / edgeBuffer);

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

    if (this.x < 0) {
      this.x = 0;
      this.vx *= -1;
    }
    if (this.x > canvas.width) {
      this.x = canvas.width;
      this.vx *= -1;
    }
    if (this.y < 0) {
      this.y = 0;
      this.vy *= -1;
    }
    if (this.y > canvas.height) {
      this.y = canvas.height;
      this.vy *= -1;
    }
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
  nodes.forEach((n) => {
    n.update();
    n.draw();
  });
  connectNodes();
  requestAnimationFrame(animate);
}

function initCanvas() {
  nodes = [];
  resetGrid();
  for (let i = 0; i < nodeCount; i++) nodes.push(new Node());
  animate();
}

window.addEventListener("resize", () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  initCanvas();
});

const mouse = {};
canvas.addEventListener("mousemove", (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});
canvas.addEventListener("mouseleave", () => {
  delete mouse.x;
  delete mouse.y;
});

// ========== AUTH & API ==========
async function fetchUser() {
  try {
    const res = await fetch(`${BACKEND}/auth/user`, {
      credentials: "include",
    });

    if (!res.ok) throw new Error("Not logged in");

    const user = await res.json();
    console.log("Fetched user:", user);

    const pfp = document.getElementById("userPfp");
    pfp.src = user.picture || "https://via.placeholder.com/40";
    
    const userName = document.getElementById("userName");
    if (userName) {
      userName.textContent = user.name || user.email || "User";
    }

    window.currentUser = user;
    return user;
  } catch {
  if (DEV_MODE) {
    console.log("DEV MODE: skipping auth");

    const fakeUser = {
      name: "Dev User",
      email: "dev@local",
      picture: "https://via.placeholder.com/40"
    };

    document.getElementById("userPfp").src = fakeUser.picture;
    document.getElementById("userName").textContent = fakeUser.name;

    window.currentUser = fakeUser;
    return fakeUser;
  }

  window.location.href = `${BACKEND}/auth/google`;
}
}

async function loadNodes() {
  const res = await fetch(`${BACKEND}/api/nodes`, {
    credentials: "include"
  });

  if (!res.ok) return;

  const nodes = await res.json();
  console.log("Nodes:", nodes);
}

async function getNodes() {
  const res = await fetch(`${BACKEND}/api/nodes`, {
    credentials: "include"
  });
  return await res.json();
}

async function createNode(node) {
  await fetch(`${BACKEND}/api/nodes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(node)
  });
}

// ========== TOOL SWITCHING SYSTEM ==========
const toolContainer = document.getElementById("toolContainer");
const toolButtons = document.querySelectorAll(".tool-btn");

function setActiveTool(activeBtn) {
  toolButtons.forEach(btn => btn.classList.remove("active"));
  activeBtn.classList.add("active");
}

async function loadTool(tool) {
  const res = await fetch(`./tools/${tool}.html`);
  const html = await res.text();
  toolContainer.innerHTML = html;

  if (tool === "analysis") initAnalysisTool();
  //if (tool === "memory") initMemoryTool();
  //if (tool === "mindmap") initMindmapTool();
  //if (tool === "tracker") initTrackerTool();
}

function initAnalysisTool() {
  document.getElementById("save").onclick = async () => {

    const quote = document.getElementById("quote").value;
    const analysis = document.getElementById("analysis").value;

    const res = await fetch(`${BACKEND}/api/nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        type: "analysis",
        quote,
        analysis
      })
    });

    console.log("saved:", await res.json());
  };
}

// ========== EVENT LISTENERS ==========
document.addEventListener("DOMContentLoaded", () => {
  initCanvas();

  const pfpElem = document.getElementById("userPfp");
  const dropdown = document.getElementById("dropdown");

  if (pfpElem) {
    pfpElem.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.style.display =
        dropdown.style.display === "block" ? "none" : "block";
    });
  }


document.addEventListener("click", async (e) => {
  // Close dropdown when clicking elsewhere
  if (dropdown) dropdown.style.display = "none";

  if (e.target.id === "saveNodeBtn") {
    await createNode({
      type: "analysis",
      subject: "Macbeth",
      section: "Act 1",
      link: {
        quote: document.getElementById("quote").value,
        analysis: document.getElementById("analysis").value
      }
    });
  }
});

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const res = await fetch(`${BACKEND}/auth/logout`, {
        credentials: "include",
      });

      if (res.ok) {
        window.location.href = `${BACKEND}/auth/google`;
      }
    });
  }

  // Tool switching
  toolButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const tool = btn.dataset.tool;
      setActiveTool(btn);
      loadTool(tool);
    });
  });


  // Initialize auth
  (async () => {
    await fetchUser();

    if (!DEV_MODE) {
      loadNodes();
    } else {
      console.log("DEV MODE: skipping backend");
    }
  })();
});
