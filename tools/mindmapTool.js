export async function initMindmapTool(deps, context = {}) {
  const {
    getAllNodes,
    getAllQuotes,
    addNode,
    addQuote,
    deleteNode,
    deleteQuote,
    removeNodeEverywhere,
    removeQuoteEverywhere,
    escapeHtml
  } = deps;

  const { subject: contextSubject } = context;

  if (typeof window.__neuronetMindmapCleanup === "function") {
    window.__neuronetMindmapCleanup();
  }

  const state = {
    nodes: [],
    quotes: [],
    currentSubject: contextSubject || null,
    viewMode: "network",
    selectedNodeId: null,
    hoveredNodeId: null,
    isDragging: false,
    dragStartPos: { x: 0, y: 0 },
    forcePositions: new Map()
  };

  const canvas = document.getElementById("mindmapCanvas");
  const ctx = canvas?.getContext("2d");
  const nodeFloatingCard = document.getElementById("nodeFloatingCard");
  const nodePointsContainer = document.getElementById("nodePoints");
  const nodeLabelsContainer = document.getElementById("nodeLabels");

  const config = {
    nodeRadius: 6,
    labelOffset: 20,
    connectionDistance: 150,
    repulsionStrength: 500,
    attractionStrength: 0.01,
    centerPull: 0.001,
    damping: 0.9,
    minSpeed: 0.1
  };

  function getNodeColor(type) {
    switch (type) {
      case "source": return "#4da6ff";
      case "quote": return "#ff9b39";
      case "analysis": return "#2cffb3";
      default: return "#9aa4ad";
    }
  }

  function getNodeTypeIcon(type) {
    switch (type) {
      case "source": return "📄";
      case "quote": return "💬";
      case "analysis": return "💡";
      default: return "●";
    }
  }

  function getNodeDisplayTitle(node) {
    if (node.type === "quote") {
      return node.quote?.substring(0, 50) + (node.quote?.length > 50 ? "..." : "") || "Untitled Quote";
    }
    if (node.type === "analysis") {
      return node.title || node.analysis?.substring(0, 50) + (node.analysis?.length > 50 ? "..." : "") || "Untitled Analysis";
    }
    if (node.type === "source") {
      return node.title || node.subject || "Untitled Source";
    }
    return node.subject || node.title || "Unknown Node";
  }

  function getNodePreview(node, maxLength = 100) {
    if (node.type === "quote") {
      return node.quote || "";
    }
    if (node.type === "analysis") {
      return node.analysis || "";
    }
    if (node.type === "source") {
      return node.content?.substring(0, maxLength) || node.contentText?.substring(0, maxLength) || "";
    }
    return "";
  }

  function initializePositions(containerWidth, containerHeight) {
    state.forcePositions.clear();
    
    const allItems = [...state.nodes, ...state.quotes];
    const centerX = containerWidth / 2;
    const centerY = containerHeight / 2;
    
    allItems.forEach((item, index) => {
      if (!state.forcePositions.has(item.id)) {
        const angle = (index / allItems.length) * Math.PI * 2;
        const radius = Math.min(containerWidth, containerHeight) * 0.3;
        state.forcePositions.set(item.id, {
          x: centerX + Math.cos(angle) * radius + (Math.random() - 0.5) * 50,
          y: centerY + Math.sin(angle) * radius + (Math.random() - 0.5) * 50,
          vx: 0,
          vy: 0
        });
      }
    });
  }

  function getConnections() {
    const connections = [];
    const connectionSet = new Set();

    state.nodes.filter(n => n.type === "analysis").forEach(analysis => {
      if (analysis.quoteRefs) {
        analysis.quoteRefs.forEach(ref => {
          if (ref.quoteId) {
            const key = [ref.quoteId, analysis.id].sort().join("-");
            if (!connectionSet.has(key)) {
              connectionSet.add(key);
              connections.push({
                from: ref.quoteId,
                to: analysis.id,
                type: "quote-analysis"
              });
            }
          }
        });
      }
    });

    state.quotes.forEach(quote => {
      if (quote.meta?.analysisNodeIds) {
        quote.meta.analysisNodeIds.forEach(analysisId => {
          const key = [quote.id, analysisId].sort().join("-");
          if (!connectionSet.has(key)) {
            connectionSet.add(key);
            connections.push({
              from: quote.id,
              to: analysisId,
              type: "quote-analysis"
            });
          }
        });
      }
    });

    return connections;
  }

  function applyForces(containerWidth, containerHeight) {
    const connections = getConnections();
    const allIds = new Set([...state.nodes.map(n => n.id), ...state.quotes.map(q => q.id)]);
    
    allIds.forEach(id => {
      if (!state.forcePositions.has(id)) return;
      const pos = state.forcePositions.get(id);
      
      let fx = 0, fy = 0;

      allIds.forEach(otherId => {
        if (otherId === id) return;
        const otherPos = state.forcePositions.get(otherId);
        if (!otherPos) return;
        
        const dx = pos.x - otherPos.x;
        const dy = pos.y - otherPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        
        if (dist < config.connectionDistance) {
          const force = config.repulsionStrength / (dist * dist);
          fx += (dx / dist) * force;
          fy += (dy / dist) * force;
        }
      });

      connections.forEach(conn => {
        let otherId = null;
        if (conn.from === id) otherId = conn.to;
        else if (conn.to === id) otherId = conn.from;
        
        if (otherId) {
          const otherPos = state.forcePositions.get(otherId);
          if (otherPos) {
            const dx = otherPos.x - pos.x;
            const dy = otherPos.y - pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            
            if (dist > config.connectionDistance) {
              const force = (dist - config.connectionDistance) * config.attractionStrength;
              fx += (dx / dist) * force;
              fy += (dy / dist) * force;
            } else if (dist < config.connectionDistance * 0.5) {
              const force = (config.connectionDistance * 0.5 - dist) * config.attractionStrength * 0.5;
              fx -= (dx / dist) * force;
              fy -= (dy / dist) * force;
            }
          }
        }
      });

      const centerX = containerWidth / 2;
      const centerY = containerHeight / 2;
      fx += (centerX - pos.x) * config.centerPull;
      fy += (centerY - pos.y) * config.centerPull;

      pos.vx = (pos.vx + fx) * config.damping;
      pos.vy = (pos.vy + fy) * config.damping;

      const speed = Math.sqrt(pos.vx * pos.vx + pos.vy * pos.vy);
      if (speed < config.minSpeed) {
        pos.vx *= 0.9;
        pos.vy *= 0.9;
      }

      pos.x += pos.vx;
      pos.y += pos.vy;

      const margin = 50;
      if (pos.x < margin) { pos.x = margin; pos.vx *= -0.5; }
      if (pos.x > containerWidth - margin) { pos.x = containerWidth - margin; pos.vx *= -0.5; }
      if (pos.y < margin) { pos.y = margin; pos.vy *= -0.5; }
      if (pos.y > containerHeight - margin) { pos.y = containerHeight - margin; pos.vy *= -0.5; }
    });
  }

  function render() {
    if (!ctx || !canvas) return;
    
    const container = canvas.parentElement;
    const width = container.clientWidth;
    const height = container.clientHeight;
    
    canvas.width = width;
    canvas.height = height;
    
    ctx.clearRect(0, 0, width, height);

    if (state.viewMode === "network") {
      applyForces(width, height);
    }

    const connections = getConnections();
    connections.forEach(conn => {
      const fromPos = state.forcePositions.get(conn.from);
      const toPos = state.forcePositions.get(conn.to);
      
      if (fromPos && toPos) {
        const isActive = state.selectedNodeId === conn.from || state.selectedNodeId === conn.to;
        ctx.beginPath();
        ctx.moveTo(fromPos.x, fromPos.y);
        ctx.lineTo(toPos.x, toPos.y);
        ctx.strokeStyle = isActive ? "rgba(44, 255, 179, 0.6)" : "rgba(44, 255, 179, 0.2)";
        ctx.lineWidth = isActive ? 2 : 1;
        ctx.stroke();
      }
    });

    const allItems = [...state.nodes.map(n => ({ ...n, itemType: "node" })), ...state.quotes.map(q => ({ ...q, itemType: "quote" }))];
    
    allItems.forEach(item => {
      const pos = state.forcePositions.get(item.id);
      if (!pos) return;
      
      const isSelected = state.selectedNodeId === item.id;
      const isHovered = state.hoveredNodeId === item.id;
      const color = getNodeColor(item.type);
      
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, isSelected || isHovered ? config.nodeRadius * 1.5 : config.nodeRadius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      
      if (isSelected) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });

    renderNodeElements();
    updateStats();
    
    requestAnimationFrame(render);
  }

  function renderNodeElements() {
    if (!nodePointsContainer || !nodeLabelsContainer) return;
    
    nodePointsContainer.innerHTML = "";
    nodeLabelsContainer.innerHTML = "";
    
    const allItems = [...state.nodes, ...state.quotes];
    
    allItems.forEach(item => {
      const pos = state.forcePositions.get(item.id);
      if (!pos) return;
      
      const isSelected = state.selectedNodeId === item.id;
      const isHovered = state.hoveredNodeId === item.id;
      const color = getNodeColor(item.type);
      const title = getNodeDisplayTitle(item);
      
      const point = document.createElement("div");
      point.className = "node-point" + (isSelected ? " selected" : "") + (isHovered ? " hovered" : "");
      point.style.left = pos.x + "px";
      point.style.top = pos.y + "px";
      point.style.background = color;
      point.dataset.nodeId = item.id;
      point.addEventListener("click", (e) => {
        e.stopPropagation();
        selectNode(item.id);
      });
      point.addEventListener("mouseenter", () => {
        state.hoveredNodeId = item.id;
      });
      point.addEventListener("mouseleave", () => {
        state.hoveredNodeId = null;
      });
      nodePointsContainer.appendChild(point);
      
      const label = document.createElement("div");
      label.className = "node-label";
      label.style.left = pos.x + "px";
      label.style.top = pos.y + "px";
      label.textContent = title;
      nodeLabelsContainer.appendChild(label);
    });
  }

  function selectNode(nodeId) {
    state.selectedNodeId = nodeId;
    
    const allItems = [...state.nodes, ...state.quotes];
    const selectedItem = allItems.find(item => item.id === nodeId);
    
    if (!selectedItem || !nodeFloatingCard) return;
    
    const card = nodeFloatingCard.querySelector(".node-card");
    if (!card) return;
    
    const titleEl = card.querySelector(".node-card-title");
    const typeEl = card.querySelector(".node-card-type");
    const contentEl = card.querySelector(".node-card-content");
    const connectionEl = card.querySelector(".connection-info");
    
    titleEl.textContent = getNodeDisplayTitle(selectedItem);
    typeEl.innerHTML = `<span>${getNodeTypeIcon(selectedItem.type)}</span> ${selectedItem.type.charAt(0).toUpperCase() + selectedItem.type.slice(1)}`;
    
    const preview = getNodePreview(selectedItem);
    contentEl.textContent = preview;
    
    const connections = getConnections();
    const connectionCount = connections.filter(c => c.from === nodeId || c.to === nodeId).length;
    connectionEl.innerHTML = `<span class="node-link-indicator">🔗 ${connectionCount} connection${connectionCount !== 1 ? "s" : ""}</span>`;
    
    const editBtn = card.querySelector(".edit-btn");
    const deleteBtn = card.querySelector(".delete-btn");
    
    if (editBtn) {
      editBtn.onclick = () => handleEditNode(selectedItem);
    }
    if (deleteBtn) {
      deleteBtn.onclick = () => handleDeleteNode(selectedItem);
    }
    
    const itemPos = state.forcePositions.get(nodeId);
    if (itemPos && nodeFloatingCard) {
      const container = nodeFloatingCard.parentElement;
      const cardWidth = 320;
      const cardHeight = 250;
      
      let cardX = itemPos.x + 20;
      let cardY = itemPos.y;
      
      if (cardX + cardWidth > container.clientWidth - 20) {
        cardX = itemPos.x - cardWidth - 20;
      }
      if (cardY + cardHeight > container.clientHeight - 20) {
        cardY = container.clientHeight - cardHeight - 20;
      }
      if (cardY < 20) cardY = 20;
      
      nodeFloatingCard.style.left = cardX + "px";
      nodeFloatingCard.style.top = cardY + "px";
    }
    
    nodeFloatingCard.classList.add("visible");
  }

  function deselectNode() {
    state.selectedNodeId = null;
    if (nodeFloatingCard) {
      nodeFloatingCard.classList.remove("visible");
    }
  }

  function updateStats() {
    const totalNodes = document.getElementById("totalNodes");
    const totalQuotes = document.getElementById("totalQuotes");
    const totalAnalyses = document.getElementById("totalAnalyses");
    const totalConnections = document.getElementById("totalConnections");
    
    if (totalNodes) totalNodes.textContent = state.nodes.length + state.quotes.length;
    if (totalQuotes) totalQuotes.textContent = state.quotes.length;
    if (totalAnalyses) totalAnalyses.textContent = state.nodes.filter(n => n.type === "analysis").length;
    
    const connections = getConnections();
    if (totalConnections) totalConnections.textContent = connections.length;
  }

  async function handleEditNode(node) {
    console.log("Edit node:", node.id);
    deselectNode();
  }

  async function handleDeleteNode(node) {
    const confirmed = window.confirm(`Delete this ${node.type}? This action cannot be undone.`);
    if (!confirmed) return;
    
    try {
      if (node.type === "quote" || node.itemType === "quote") {
        await removeQuoteEverywhere(node.id);
      } else {
        if (node.type === "analysis") {
          for (const ref of node.quoteRefs || []) {
            if (ref.quoteId) {
              const quote = state.quotes.find(q => q.id === ref.quoteId);
              if (quote?.meta?.analysisNodeIds) {
                quote.meta.analysisNodeIds = quote.meta.analysisNodeIds.filter(id => id !== node.id);
                await addQuote(quote);
              }
            }
          }
        }
        await removeNodeEverywhere(node.id);
      }
      
      await refreshData();
    } catch (error) {
      console.error("Failed to delete node:", error);
      alert("Failed to delete node: " + error.message);
    }
  }

  async function refreshData() {
    const [nodes, quotes] = await Promise.all([getAllNodes(), getAllQuotes()]);
    state.nodes = nodes;
    state.quotes = quotes;
    
    const container = canvas?.parentElement;
    if (container) {
      initializePositions(container.clientWidth, container.clientHeight);
    }
  }

  function handleCanvasClick(e) {
    if (e.target === canvas || e.target.classList.contains("node-point")) {
      if (state.selectedNodeId && !e.target.closest(".node-floating-card")) {
        deselectNode();
      }
    }
  }

  function setupEventListeners() {
    const container = canvas?.parentElement;
    if (container) {
      container.addEventListener("click", handleCanvasClick);
      
      container.addEventListener("dblclick", (e) => {
        if (e.target.classList.contains("node-point")) {
          const nodeId = e.target.dataset.nodeId;
          if (nodeId) {
            const item = [...state.nodes, ...state.quotes].find(i => i.id === nodeId);
            if (item) {
              handleEditNode(item);
            }
          }
        }
      });
    }

    const networkViewBtn = document.getElementById("networkViewBtn");
    const hierarchyViewBtn = document.getElementById("hierarchyViewBtn");
    
    if (networkViewBtn) {
      networkViewBtn.addEventListener("click", () => {
        state.viewMode = "network";
        networkViewBtn.classList.add("active");
        if (hierarchyViewBtn) hierarchyViewBtn.classList.remove("active");
      });
    }
    
    if (hierarchyViewBtn) {
      hierarchyViewBtn.addEventListener("click", () => {
        state.viewMode = "hierarchy";
        hierarchyViewBtn.classList.add("active");
        if (networkViewBtn) networkViewBtn.classList.remove("active");
      });
    }

    const exportMapBtn = document.getElementById("exportMapBtn");
    if (exportMapBtn) {
      exportMapBtn.addEventListener("click", () => {
        const data = {
          nodes: state.nodes,
          quotes: state.quotes,
          connections: getConnections()
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `neuronet-mindmap-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        URL.revokeObjectURL(url);
      });
    }
  }

  function handleDBChange() {
    refreshData();
  }

  function handleResize() {
    const container = canvas?.parentElement;
    if (container && state.forcePositions.size === 0) {
      initializePositions(container.clientWidth, container.clientHeight);
    }
  }

  window.addEventListener("resize", handleResize);
  
  document.addEventListener("db-change", handleDBChange);

  await refreshData();
  
  const container = canvas?.parentElement;
  if (container) {
    initializePositions(container.clientWidth, container.clientHeight);
  }
  
  setupEventListeners();
  
  render();

  window.__neuronetMindmapCleanup = () => {
    document.removeEventListener("db-change", handleDBChange);
    window.removeEventListener("resize", handleResize);
  };
}