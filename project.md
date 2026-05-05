# NeuroNet Developer Specification

**Version**: 5.7  
**Date**: May 5, 2026  
**Status**: Production-ready with SSS (Semantic Search System) anchoring, complete tool implementations (Analysis v2, Memory SuperProgram, Mindmap), bidirectional quote/analysis linking, layer hierarchy navigation, advanced source editor, and full feature parity across codebase, as well as advanced lite deckbuilder with layer categorising and priority heap ordering as well as a specific study filter system

---

## 1. Product Overview

NeuroNet is a local-first, offline-capable personal knowledge management system built as a single-page application. It provides a complete study environment where users can:

- Create and organize subjects with hierarchical source material
- Extract quote nodes from sources (anchored to specific text positions)
- Create standalone analysis nodes that can reference multiple quotes
- Practice memory via a flashcard system with cue nodes and SuperProgram scheduling
- Visualize connections through an interactive mindmap

> The core philosophy: **Nodes are the system. Tools are lenses.**

---

## 2. Architecture

### 2.1 Technology Stack

| Layer | Technology |
|-------|----------|
| Frontend | Vanilla JavaScript (ES Modules), Vite (build/bundler), HTML5, CSS3 |
| Database | IndexedDB (primary), MongoDB Atlas (cloud) |
| Backend | Node.js/Express (optional, for sync) |
| Authentication | Google OAuth (optional) |

### 2.2 File Structure

```
neuronet/
├── frontend/
│   ├── index.html          # Main SPA shell + global styles (Vite entry point)
│   ├── vite.config.js     # Vite bundler configuration
│   ├── package.json       # Frontend dependencies
│   ├── src/
│   │   ├── main.js        # Application controller, tool routing (renamed from script.js)
│   │   ├── canvas.js      # Background network animation (nodes + waves)
│   │   ├── db.js          # IndexedDB wrapper + CRUD
│   │   ├── migrations.js  # Schema migration utilities
│   │   ├── sync.js        # Cloud sync (optional)
│   │   └── tools/
│   │       ├── analysisTool.js   # Analysis tool logic (v2)
│   │       ├── memoryTool.js     # SuperProgram flashcard system
│   │       └── mindmapTool.js    # Force-directed graph
│   ├── public/
│   │   └── tools/
│   │       ├── analysis.html       # Analysis tool HTML template
│   │       ├── memory.html        # Memory tool HTML template
│   │       ├── mindmap.html       # Mindmap tool HTML template
│   │       └── tracker.html       # Tracker tool (placeholder)
│   └── dist/              # Vite build output
├── backend/                # Optional sync server
│   ├── server.js
│   ├── package.json
│   ├── routes/
│   │   ├── auth.js
│   │   └── nodes.js
│   └── models/
│       ├── Node.js
│       └── User.js
└── plan.md   # This file   
```

### 2.3 Background Canvas Animation (`canvas.js`)

The canvas runs as a fixed background layer (`z-index: -1`) behind the entire UI, creating a living network visualization.

**Architecture**:

```
Node class → update() → draw() → canvas.render
         ↓
   buildGrid() → connect() → draw connections
         ↓
     waves[] → drawField() → wave patterns
```

**Node Physics**:

- 100 nodes with random initial positions
- **Separation force**: Nodes repel when too close (within maxDist = 150px)
- **Edge repulsion**: Nodes pushed away from canvas borders (50px buffer)
- **Random drift**: Small random velocity changes for organic movement
- **Max speed cap**: 2.2 units/frame for smooth motion
- **Damping**: 0.94 per frame for ripple dissipation

**Connection Rendering**:

- Spatial hashing grid for O(n) neighbor lookup
- Each node connects to up to `maxConnections` (3-5) nearby nodes
- Far neighbor (up to 300px) also connected as weak link
- **Distance-based transparency**: Closer = brighter

**Wave Patterns**:

| Pattern | Speed | Type | Description | Trigger |
|--------|-------|------|-------------|----------|
| Radial | 3.8 px/frame | radial | Circle expands from origin | `triggerRadialPulse(x, y)` |
| Sweep | 18 px/frame | linear | Left-to-right wave | `triggerSweep()` |
| Vertical | 18 px/frame | linear | Top-to-bottom wave | `triggerVerticalWave()` |
| Random | varies | activation | Random node activations | `triggerRandomNodes(n)` |

**Wave Physics**:

- Max age: Radial 220 frames, Linear waves 500 frames
- Energy transfer to nodes at wave edge
- Shimmer points: Bright dots appear on connections crossing wave front
- Node velocity boost from wave force
- Linear waves (sweep, vertical) are softer intensity (0.45× multiplier)

**Public API**:

```js
window.__neuronetCanvas.triggerRadialPulse(x, y, strength)
window.__neuronetCanvas.triggerSweep(strength)
window.__neuronetCanvas.triggerVerticalWave(strength)
window.__neuronetCanvas.triggerRandomNodes(count, strength)
window.__neuronetCanvas.getNodes() // → array of Node objects
```

**Initial Behavior**:

- 500ms after page load, a radial pulse fires from screen center
- Random ambient waves spawn occasionally (~0.4% per frame)

### 2.4 Design Principles

1. **Local-first**: The app must fully function offline via IndexedDB
2. **Nodes over notes**: All data exists as reusable, connected nodes
3. **Tools are lenses**: Tools read/write the same stores; they are different views
4. **Separation of concerns**: Quotes and analyses are separate but linkable
5. **Event-driven**: UI updates via `db-change` custom events; no manual refresh
6. **Origin validation**: Only allow from predefined origins (localhost, GitHub Pages)

---

## 2.5 Semantic Search System (SSS) Engine

To ensure that quote nodes remain stable even when source files are edited, NeuroNet uses a **Semantic Search System (SSS)**.

### **Core Architecture: Visual Text Model**
Unlike traditional offset-based systems that break when line breaks or whitespace change, SSS uses a **Visual Text Model** based on the browser's `textContent`. This ensures that what the user sees in the reader is exactly what is extracted for analysis cards.

**Mechanism**:
Instead of relying solely on character offsets (`start`/`end`), each quote node stores a **Fingerprint**:

- **Prefix**: The 20 characters immediately preceding the quote.
- **Suffix**: The 20 characters immediately following the quote.

**Resolution Algorithm**:
When a quote is rendered, the SSS Engine:
1.  **Resolves Offsets**: Searches for a "fingerprint" (`prefix` + `quote` + `suffix`) within the live DOM's visual text.
2.  **Tightens Indices**: Trims leading and trailing whitespace from the resolved range to eliminate gaps in cards.
3.  **Extracts with Formatting**: Walks the DOM tree to extract rich formatting (Bold, Italic) while injecting `<br>` tags at block boundaries (DIV, P) to maintain readability.
4.  **Self-Heals**: If fingerprints are missing or stale, it performs a fuzzy search to re-anchor the quote to the most likely matching text.

1. Checks the original `start`/`end` indices.
2. If the text at those indices doesn't match the expected quote, it performs a **Semantic Scan**.
3. It searches the source for the `prefix + quote + suffix` pattern using a "fuzzy" greedy match (grepping for context).
4. If found, it "snaps" the indices to the new location and updates the UI.
5. If multiple matches occur, it uses the original indices as a tie-breaker.

**Benefits**:

- **Source Stability**: Quotes survive additions or deletions above them in the source file.
- **Data Integrity**: Eliminates the "broken reference" problem common in index-only systems.
- **Rich Rendering**: Allows tools to fetch the original formatted HTML from the source rather than storing redundant (and potentially stale) plain text.

---

## 3. Data Model (IndexedDB Schema)

### 3.1 Database Configuration

```js
const DB_NAME = "neuronet";
const DB_VERSION = 8; // Added tags store
```

**Object Stores**:

- `nodes` - Source and analysis nodes
- `quotes` - Quote nodes (separate for performance)
- `cues` - Cue nodes (for memory tool prompts)
- `pinnedTools` - User's pinned tool shortcuts
- `tags` - Global tag library

### 3.2 Node Types

All nodes share a base shape:

```json
{
  "id": "uuid",
  "type": "source | subject | analysis | ...",
  "subject": "Macbeth",
  "createdAt": 0,
  "updatedAt": 0
}
```

#### Source Nodes

```json
{
  "id": "source-id",
  "type": "source",
  "subject": "Macbeth",
  "section": "Act 1 > Scene 3",
  "title": "Witches meeting Macbeth",
  "content": "full passage (HTML)",
  "meta": {
    "hierarchyPath": ["Macbeth", "Act 1", "Scene 3"],
    "kind": "source"
  }
}
```

#### Quote Nodes

```json
{
  "id": "quote-id",
  "type": "quote",
  "subject": "Macbeth",
  "section": "Act 1 > Scene 3",
  "title": "Witches opening exchange",
  "quote": "Fair is foul, and foul is fair",
  "priority": 3,
  "link": {
    "sourceId": "source-id",
    "start": 0,
    "end": 29,
    "prefix": "20 char context before",
    "suffix": "20 char context after"
  },
  "meta": {
    "hierarchyPath": ["Macbeth", "Act 1", "Scene 3"],
    "sourceOrder": 0,
    "tags": ["paradox"],
    "analysisNodeIds": ["analysis-id-1", "analysis-id-2"]
  }
}
```

**Purpose**: Atomic quoted excerpt anchored to source position. Stored in separate `quotes` store.

#### Analysis Nodes

```json
{
  "id": "analysis-id",
  "type": "analysis",
  "subject": "Macbeth",
  "title": "Fate vs Free Will",
  "analysis": "The witches' prophecies create a paradox...",
  "tags": ["fate", "determinism"],
  "quoteRefs": [
    {
      "quoteId": "quote-id-1",
      "section": "Act 1 > Scene 3",
      "quote": "Fair is foul..."
    }
  ],
  "meta": {
    "globalScope": true,
    "confidence": 0.8,
    "nextReview": null,
    "flagged": false,
    "flagReason": null
  }
}
```

**Key Points**:

- Standalone, not bound to any hierarchy level
- Can reference 0, 1, or many quotes from any source
- `globalScope: true` means it can be viewed from any source in the subject
- Stores `quoteRefs` array for quick access

#### Cue Nodes

```json
{
  "id": "cue-id",
  "type": "cue",
  "subject": "Macbeth",
  "quoteId": "quote-id-1",
  "analysisId": "analysis-id-1",
  "cue": "What does Macbeth say when he learns Lady Macbeth has died?",
  "meta": {
    "tags": []
  }
}
```

**Purpose**: A human-readable prompt to aid recall. Links to a quote (and optionally analysis). One cue per quote.

**Key Points**:

- One cue per quote (enforced at UI level)
- Standalone node - persists even if associated analysis is deleted
- Primary use case: Memory tool flashcard front display
- Can be created from analysis tool quote refs list (Cue button or right-click menu)
- Fallback: auto-generated cue from quote text if no cue node exists

#### Session-Based Quote Tracking

To support the analysis cleanup dialog, the analysis tool tracks quotes created during the current analysis drafting session:

```js
state.analysisSessionCreatedQuoteIds = [] // quotes created this session
markQuoteCreatedForAnalysisSession(quoteId)  // mark a quote as session-created
getAnalysisSessionCreatedQuoteIds()             // get all session-created IDs
resetAnalysisSessionCreatedQuotes()             // clear on new draft
```

**Purpose**: When discarding a draft, the cleanup dialog can offer to delete only the private quotes that were created during that unfinished session (`canDeleteQuoteAsPrivateDependency` checks if no other analysis references the quote).

#### Global Window Functions (Cross-Component Hooks)

The analysis tool exposes these functions on `window` for use by other tools or inline event handlers:

```js
window.addQuoteRefToAnalysis(quoteText, quoteId)   // add a quote ref to the open analysis form
window.removeQuoteRefFromAnalysis(idx)              // remove quote ref by index
window.setQuotePriorityForAnalysis(idx, priority)  // set priority (1-5) for a quote ref
```

#### Quote Deduplication on Creation

Before creating a new quote node, the tool checks for existing quotes:

1. **`findExistingQuoteForSelection({ sourceId, start, end, quote })`** — checks via `findExistingQuote()` (position match), `findExistingQuoteByText()` (text match), then falls back to local state check
2. **`ensureQuoteRecord(ref)`** — ensures a quote record exists: checks `ref.quoteId`, then `findExistingQuoteByText()`, only calls `createQuoteNode()` as last resort

#### Bidirectional Linking

**Quote → Analysis**: `quote.meta.analysisNodeIds: ["analysis-id-1", ...]`

**Analysis → Quote**: `analysis.quoteRefs: [{quoteId, section, quote}, ...]`

**Purpose**:

- When reading source: show which analyses reference this quote
- When viewing analysis: show all quoted evidence

**Consistency Rules**:

- On quote deletion: remove its ID from all referencing analysis nodes
- On analysis deletion: remove its ID from all referenced quote nodes; if quote has no remaining references, delete the quote

#### Tag Nodes

```json
{
  "id": "tag-macbeth",
  "type": "tag",
  "title": "Macbeth",
  "createdAt": 0,
  "updatedAt": 0
}
```

**Purpose**: Global tag library for organizing and filtering content across subjects.

---

## 4. Core Database Operations

### 4.1 Node Store (db.js)

```js
// Initialization
await initDB()

// CRUD
await addNode(node)
await addNodes(nodes)
await getAllNodes()
await getNode(id)
await deleteNode(id)
await clearNodes()

// Queries
await getSubjects()           // Get unique subject names
await getQuotesForSubject(subject)
await getAnalysisNodesForSubject(subject)
await getQuotesReferencedByAnalysis(analysisId)
await getAnalysesReferencingQuote(quoteId)

// Due items (memory)
await getDueQuotesForSubject(subject, {now, limit})
await getDueAnalysisNodesForSubject(subject, {now, limit})

// Pinned tools
await pinTool(toolId, position)
await unpinTool(toolId)
await getPinnedTools()

// Tags
await addTag(tag)
await getAllTags()
await deleteTag(id)
```

### 4.2 Quote Store (db.js)

```js
await addQuote(quote)
await addQuotes(quotes)
await getAllQuotes()
await getQuote(id)
await getQuotesForSource(sourceId)
await deleteQuote(id)
await clearQuotes()

// SSS Utilities
await resolveQuoteInSource(quoteNode, sourceNode) // find real indices
await getFormattedQuote(quoteNode, sourceNode)   // get rich HTML from source
```

### 4.3 Cue Store (db.js)

```js
await addCue(cue)
await addCues(cues)
await getAllCues()
await getCue(id)
await deleteCue(id)
await clearCues()
await getCuesForQuote(quoteId)
await getCuesForAnalysis(analysisId)
await getCuesForSubject(subject)
await updateCueLinks(cueId, quoteId, analysisId)
```

### 4.4 Event System

All operations emit a `db-change` event:

```js
document.dispatchEvent(new CustomEvent("db-change", {
  detail: { type: "upsert", ids: ["uuid1", "uuid2"] }
}))
```

Tools listen for these events to refresh their UI automatically.

---

## 5. Tool System

### 5.1 Tool Registration

Tools are registered in `src/main.js` (renamed from `script.js` for Vite conventions):

```js
const tools = {
  analysis: {
    file: "/tools/analysis.html",
    init: (context) => initAnalysisToolV2(dependencies, context)
  },
  memory: { file: "/tools/memory.html", init: ... },
  mindmap: { file: "/tools/mindmap.html", init: ... },
  tracker: { file: "/tools/tracker.html", init: null }
};
```

### 5.2 Tool Loading Flow

```
User clicks tool → loadTool(name)
                    ↓
            Fetch tool HTML from /tools/ (public folder)
                    ↓
            Inject into #toolContainer
                    ↓
            Initialize with context:
              - getAllNodes, getAllQuotes, getAllCues, getAllTags
              - getNode, addNode, addQuote, addCue, addTag
              - deleteNode, deleteQuote, deleteCue, deleteTag
              - removeNodeEverywhere, removeQuoteEverywhere, removeCueEverywhere
              - backupLocalNodesToCloud
              - normalizeHierarchyPath, buildSection, parseTags, escapeHtml
              - getNodeTimestamp, isSourceNode
              - getCuesForQuote
              - findExistingQuote, findExistingQuoteByText
              - linkAnalysisToQuote, unlinkAnalysisFromQuote
              - currentSubject (via context object)
                    ↓
            Tool renders, listens for db-change
```

**Context object** passed to `initAnalysisToolV2(deps, context)`:

```js
context = {
  subject: "Macbeth",     // pre-select a subject
  nodeId: "quote-id-123"  // pre-select and scroll to a node
}
```

#### Analysis Tool State Object

The analysis tool maintains a `state` object (not exported) with the following shape:

```js
const state = {
  nodes: [],                // all nodes from DB
  quotes: [],               // all quote nodes from DB
  cues: [],                  // all cue nodes from DB
  subjectNodes: [],          // filtered: type === "subject"
  sources: [],               // filtered: type === "source"
  analysisNodes: [],         // filtered: type === "analysis"
  selectedSubject: "",       // current subject filter
  selectedSourceId: "",      // current source being viewed
  selectedRange: null,       // { start, end, quote, range } from reader selection
  subjectEditMode: false,    // show rename/delete buttons on subject cards
  analysisEditMode: false,  // true when editing existing analysis node
  quoteEditMode: false,     // true when editing existing quote node
  cueEditMode: false,       // true when editing existing cue node
  wasInStudy: false,        // tracks if we were in study view
  viewMode: "reader",       // "reader" | "editor"
  focusedNodeId: null,       // which analysis node is highlighted in sidebar
  focusedRangeKey: null,     // "start-end" key for multi-quote highlight
  selectedQuoteRef: [],      // quote refs attached to current analysis draft
  analysisSessionCreatedQuoteIds: [], // session tracking for cleanup dialog
  lastLayer1Value: null      // cache for layer navigation
};
```

### 5.3 Analysis Tool

**Purpose**: Primary engine for creating sources, extracting quotes, and building analyses.

**Features**:

- Source editor with HTML formatting preservation
- Text selection → quote extraction with SSS fingerprinting (prefix/suffix)
- Dynamic quote resolution in reader view to handle source shifts
- Analysis form with title, commentary, tags
- Quote reference UI (add/remove quotes from any source)
- Bidirectional link management
- Flag for review feature

**Modes**:

1. **Edit Mode**: Create/edit subjects, sources, hierarchies
2. **Quote Mode**: Highlight text → create quote node
3. **Analysis Mode**: Create standalone analysis with optional quote references

### 5.4 Memory Tool (SuperProgram Flashcard System)

**Purpose**: Convert nodes into memory practice with SuperProgram scheduling.

**Core Concept**: Flashcards are rendered nodes, not separate data. The tool reads from the database and displays nodes in flashcard format.

**Views/Navigation Flow**:

1. **Launchpad** → Deck list with Study button and item count
2. **Middle UI** → Filter layer between Launchpad and Study
3. **Study** → Flashcard practice with grading

**Modes**:

1. **Quote Learning**: Front = cue, Back = quote (+ optional linked analysis)
2. **Analysis Learning**: Front = analysis question + linked quotes, Back = full analysis
3. **Evidence Matching**: Front = analysis, user selects from multiple quote options
4. **Blurt**: Free recall - user types what they remember, compared to target

**SSS Integration**:

- Flashcard quotes are dynamically resolved from the source file using `getFormattedQuote`.
- Preserves original source formatting (HTML) in the "Answer" section of cards.
- Handles source edits gracefully via semantic fingerprinting.

**Priority System**:

- **Priority pills UI**: Text labels (Very Low/Low/Medium/High/Very High) with color coding
- **Default**: Priority 3 (Medium)
- **Priority scale**: 1-5 (user-defined importance)
- **Integration**: Factors into `computePriority()` via `(priority - 1) * 2` boost
- **Colors**: P1=#9aa4ad (gray), P2=#4ba3ff (blue), P3=#3fd07d (green), P4=#ff9b39 (orange), P5=#ff4d4d (red)

**Deck Builder**:

- **Sidebar layout**: 260px left sidebar + persistent form on right
- **Sidebar features**: Scrollable card list, card count, Edit/Delete buttons, active card highlighting
- **Persistent form**: Always visible with front/back inputs, priority pills, layer pills
- **Sticky bottom action bar**: Back, Clear/Delete, Save Card/Finish Deck buttons
- **Single-screen flow**: No scrolling required, textareas auto-expand
- **Layer system (pill-based)**: Horizontal layout, 0–3 layers, cascade logic
- **Anki Import**: Tab-separated .txt format, `Question[TAB]Answer` per line
- **Custom deck tag**: `meta.tags: ["custom-deck"]`
- **Mass Edit Mode**:
  - **Layout Transition**: Smooth CSS transitions shift from a sidebar layout to a full-width vertically scrolling multi-card editor (`translateX(-100%)` on sidebar).
  - **Batch Operations**: Displays all cards simultaneously with textareas for cue/quote editing, along with inline priority and layer pills.
  - **Data Safety**: Uses a deep copy buffer (`massEditData`) to allow cancelling out without mutating the original deck.
  - **Sticky Actions**: "Save All Changes" and "Cancel" buttons anchored to the bottom of the mass edit view.

**Middle UI Layer**:

- **Purpose**: Filter cards before studying (entire view scrolls)
- **Mode selector pills**: 4 modes (Quote Learning, Analysis Learning, Evidence Matching, Blurt)
- **Filter mode toggle**: AND mode (match ALL) / OR mode (match ANY)
- **Priority filters**: Checkboxes with counts (P1-P5)
- **Tag filters**: Checkboxes with counts from quotes/analyses
- **Layer filters**: Expandable tree (L1 → L2 → L3 hierarchy)
- **Filter logic**: `passesFilter(card, filter)` function supports AND/OR modes

**Blurt Mode**:

- **Free recall**: User types what they remember in `<textarea>`
- **Comparison view**: Side-by-side display of user's recall vs target
- **Virtual cues**: Auto-generated if no explicit cues exist
- **Expected time**: 15 seconds (longer than quote/analysis modes)

**Evidence Matching**:

- Front: analysis, user chooses supporting quote from 4 options (3 distractors + correct)
- Keyboard shortcut: `1-4` to select quote option
- Visual feedback: correct answers highlighted green, incorrect red

**System Thinking Panel**:

- Located in stats sidebar right side
- Typewriter effect with 5-13ms per character speed
- Generates contextual thoughts based on: last grade, card state, heap size, streak, mode
- Triggers background canvas impulses via `window.__neuronetCanvas`

**Keyboard Shortcuts**:

- `Space` - Flip card
- `ArrowLeft` / `ArrowUp` - Previous card
- `ArrowRight` / `ArrowDown` / `Enter` - Next card
- `1-4` - Select quote option in Evidence Matching
- `Ctrl+1-5` - Set quote priority (1-5) while studying

**State Objects** (memoryTool.js):

```js
// Main state
const state = {
  view: "launchpad" | "middle-ui" | "study",
  currentMode: "quote-learning" | "analysis-learning" | "evidence-matching" | "blurt",
  sessionFilter: null,
  selectedPriorities: [],
  selectedTags: [],
  selectedLayers: [],
  filterMode: "AND" | "OR"
};

// Deck builder state
const deckBuilderState = {
  cards: [],
  deckName: "",
  currentCardIndex: -1,
  layerPillState: { selectedLayers: [] }
};
```

**MaxHeap Priority Queue** (memoryTool.js:941-983):

- Used for due-card scheduling in quote/analysis/blurt modes
- Cards popped by highest priority (overdue + uncertainty + quote priority boost)
- Surprise cards inserted with +0.7 priority boost (8% chance)

**Stats Panel**:

- Right sidebar slides in from right
- Stats Grid: Total Studied, Correct, Streak, Best Streak, Accuracy %
- Priority Distribution: P1-P5 counts with color-coded pills
- Heap Queue Display: Sorted by priority, shows rank, label, priority value, due date, interval, last grade

**SuperProgram Formulas**: See Section 11 for complete mathematical model (Core State, Time Model, Grade Encoding, Update Equations, Recall Model, Scheduling Rule, Full Update Function).

### 5.5 Mindmap Tool (Force-Directed Graph)

**Purpose**: Visualize relationships between nodes.

**Architecture**:

```
Node Metadata → buildGraph() → state.graph.edges → Physics + Rendering
```

**Edge Types** (hierarchical):

| Edge | Connection |
|------|-----------|
| subject-source | Source belongs to subject |
| source-quote | Quote anchored to source |
| quote-analysis | Analysis references quote |

**Physics**:

- Repulsion between all nodes
- Attraction along edges
- Anchor forces based on node type (target ring radius)

**Ring Radii**:

- Subject: 0 (center)
- Layer: 70px
- Source: 150px
- Quote: 250px
- Analysis: 350px

### 5.6 Tracker Tool

Placeholder for future analytics functionality.

---

## 6. User Interface

### 6.1 Launchpad Screen

Entry point showing:

- Global stats (subjects, sources, quotes, analyses count)
- Subjects panel with inline add input and edit toggle
- Tool catalogue with pinnable shortcuts

**Key UX Features**:

- Subject add button disabled when input is empty or subject exists
- Input + Add button in single row, left of Edit button
- Focus mode collapses sidebar

### 6.2 Subject Workspace

Inside a subject:

- Sidebar with tool buttons and focus toggle
- Tool-specific content area
- Source explorer with hierarchy

### 6.3 Event Animations

Transitions use CSS classes:

- `.entering` → animate in (scale, opacity, blur)
- `.zooming-out` → shrink and fade

### 6.4 Global Styles

**Color Palette** (CSS variables in index.html):

```css
:root {
  --bg-1: #0b1f17;
  --bg-2: #102b20;
  --panel-bg: rgba(16,43,32,0.6);
  --accent: #2cffb3;
  --accent-soft: rgba(44,255,179,0.45);
  --text-main: #e6fff5;
  --text-muted: rgba(230,255,245,0.65);
}
```

### 6.5 Origin Validation

Access is restricted to predefined origins:

```js
const ALLOWED_ORIGINS = [
  "http://127.0.0.1:5500",
  "https://aigsniperyt.github.io"
];
```

---

## 7. Backend (Optional)

### 7.1 Sync Philosophy

- Local-first always
- Cloud enhances, never blocks
- Same schema used locally and remotely

### 7.2 Endpoints

```
POST /api/auth/google    → Google OAuth
GET  /api/auth/user    → Get current user
POST /api/auth/logout  → Logout user
GET  /api/nodes       → Fetch all nodes
POST /api/nodes       → Create node
PUT  /api/nodes/:id   → Update node
DELETE /api/nodes/:id → Delete node
GET  /api/nodes/quotes      → Fetch all quotes
POST /api/nodes/quotes     → Create quote
DELETE /api/nodes/quotes/:id → Delete quote
GET  /api/nodes/cues       → Fetch all cues
POST /api/nodes/cues      → Create cue
DELETE /api/nodes/cues/:id → Delete cue
POST /api/nodes/bulk     → Bulk sync nodes
POST /api/nodes/quotes/bulk → Bulk sync quotes
POST /api/nodes/cues/bulk → Bulk sync cues
```

---

## 8. Development Guide

### 8.1 Key Files

| File | Purpose |
|------|----------|
| `index.html` | HTML shell + global CSS (Vite entry point) |
| `vite.config.js` | Vite bundler configuration |
| `src/main.js` | App controller, tool routing, global state (renamed from script.js) |
| `src/db.js` | IndexedDB wrapper, all CRUD operations |
| `src/tools/analysisTool.js` | Analysis tool logic |
| `src/tools/memoryTool.js` | SuperProgram flashcard system |
| `src/tools/mindmapTool.js` | Force-directed graph |
| `src/canvas.js` | Background network animation |
| `src/sync.js` | Optional cloud sync |
| `public/tools/` | Tool HTML templates (analysis.html, memory.html, etc.) |
| `dist/` | Vite build output |

### 8.2 Adding a New Tool

1. Create `public/tools/newtool.html` with tool template
2. Create `src/tools/newtoolTool.js` exporting init function
3. Register in `src/main.js`:

   ```js
   const tools = {
     newtool: {
       file: "/tools/newtool.html",
       init: (deps, context) => initNewTool(deps, context)
     }
   };
   ```

4. Add to `toolDefinitions` object

### 8.3 Common Patterns

**Listening for database changes**:

```js
document.addEventListener("db-change", async (e) => {
  await refreshData(); // fetch new data from DB
  render(); // update UI
});
```

**Reading from IndexedDB**:

```js
const nodes = await getAllNodes();
const quotes = await getQuotesForSubject("Macbeth");
```

**Creating a node**:

```js
await addNode({
  type: "source",
  subject: "Macbeth",
  title: "Scene 3",
  content: "..."
});
```

**Linking quote to analysis**:

```js
await linkAnalysisToQuote(quoteId, analysisId);
// Updates both:
// - quote.meta.analysisNodeIds
// - analysis.quoteRefs
```

### 8.4 Browser Testing

- Use Chrome DevTools → Application → IndexedDB to inspect data
- Use console to test db.js functions directly
- Check Network tab for optional sync requests

---

## 9. Known Issues

1. **Analysis deletion**: Must properly remove from DB and clean up quote references
2. **Quote highlighting**: Multi-line selection issues in some cases
3. **Mindmap performance**: Large datasets may need optimization

---

## 10. April Updates Summary

### Analysis Tool v2 Features

#### Complete "Add Quote" / Open Analysis Modal Flow

The full click path when a user selects text and triggers "Add Quote":

1. **Text selection**: `captureSelection()` (mouseup/keyup on `analysisReader`) → calls `getSelectionFromReader()` to extract `{ start, end, quote, quoteHtml, sourceId, range }`
2. **Quote button appears**: `showQuoteButton(range)` positions `quoteSelectionBtn` near the selection in the reader
3. **Click "Add Quote"** (`quoteSelectionBtn` click handler):
   - Calls `findExistingQuoteForSelection()` to check for duplicate by position, then by text
   - Calls `createQuoteNode()` (or reuses existing) → saves to DB via `addQuote()`
   - Marks quote as session-created: `markQuoteCreatedForAnalysisSession(quoteId)`
   - Builds `quoteRef` via `buildQuoteRefFromQuoteNode()` and pushes to `state.selectedQuoteRef`
   - Renders updated quote refs list in modal via `renderModalQuoteRefsListHtml()`
   - Calls **`showAnalysisCard()`** → opens the analysis modal with pre-filled quote refs
4. **Analysis modal** (`showAnalysisCard()` at `analysisTool.js:1420`):
   - Sets `analysisCardKicker` to "Create Analysis Node" or "Edit Analysis Node"
   - Sets `analysisSubmitBtn` text to "Save Analysis Node" or "Update Analysis Node"
   - Renders `quoteRefsListContainer` with `renderModalQuoteRefsListHtml()`
   - Attaches event listeners via `attachQuoteRefEventListeners()`

#### Source Editor (`analysisTool.js`)

1. **Paste handling**:
   - Extracts content between `<!--StartFragment-->` and `<!--EndFragment-->` markers from clipboard HTML
   - Falls back to plain text if HTML not available
   - Post-paste cleanup removes inline styles, empty spans, anchor name attributes
   - Converts Microsoft Word/Google Docs HTML: `convertWordHtml()`, `convertGoogleDocsHtml()`
   - Markdown conversion on Enter: headings (#, ##, ###), blockquotes (>)

2. **Source hierarchy**:
   - Three-level layer navigation (layer1, layer2, layer3 selects)
   - Hierarchy path stored in `meta.hierarchyPath`
   - Auto-computed from subject + section splits

3. **Quote system**:
   - Text selection → quote extraction with SSS fingerprinting (prefix/suffix)
   - Priority stars (1-5) for quote importance
   - Quote highlighting in source reader with `.highlight-quote` spans
   - Quote position storage: `link: { sourceId, start, end, prefix, suffix }`

4. **Bidirectional linking**:
   - Quote → Analysis: `quote.meta.analysisNodeIds: ["analysis-id-1", ...]`
   - Analysis → Quote: `analysis.quoteRefs: [{quoteId, section, quote, sourceId, start, end}, ...]`
   - `linkAnalysisToQuote()`, `unlinkAnalysisFromQuote()` functions

5. **Analysis form**:
   - Modal card with quote refs list
   - Priority setting per quote ref
   - Cue button for each quote ref
   - Tags input parsing

6. **Analysis cleanup dialog**:
   - When discarding drafts with private quotes, prompts user to keep or delete
   - Handles cascade delete of orphaned quotes/cues

#### Flag for Review Feature

Added ability to flag analysis nodes for later review:

1. **UI** (`analysisTool.js`):
   - Flag button (🚩) added to analysis node card actions
   - Button turns red when flagged (`.flag-btn.flagged`)
   - Analysis card gets red left border when flagged (`.analysis-item.flagged`)

2. **Backend** (`Node.js` schema):
   - `meta.flagged: Boolean` - toggle flag state
   - `meta.flagReason: String` - optional reason for flagging

#### Cue Nodes

1. **Cue creation modal**: Via "Add Cue" button in quote refs or right-click context menu
2. **Cue fields**: cueId, quoteId, analysisId, cue text
3. **Storage**: Separate IndexedDB store `cues`
4. **Operations**: addCue, getCuesForQuote, getCuesForAnalysis, getCuesForSubject, updateCueLinks

#### Smart Navigation

1. **Scroll sync**: When reader scrolls, highlights auto-follow and sidebar scrolls to matching analysis
2. **Jump to quote**: Click highlighted text to jump to corresponding analysis card in sidebar
3. **Hover preview**: Mouse over highlight scrolls analysis card into view
4. **Smart scroll sync** (`analysisReader` scroll listener):
   - Calculates which highlight is closest to the reader center
   - Resolves the correct analysis node via `resolveAnalysisIdForSidebar()` (handles comma-separated focusIds from multi-quote links)
   - Auto-scrolls the sidebar `analysisNodeList` to the matched card
5. **Click on highlight** (`analysisReader` click handler):
   - Supports comma-separated `data-focus-id` (multiple analyses linked to one quote)
   - Finds exact `data-range-key` match for multi-quote analyses
   - Updates `state.focusedNodeId` and `state.focusedRangeKey`, then re-renders
6. **Right-click context menu on highlights**: Opens cue creation/edit menu directly from reader highlights

#### Source Editor Deep Features

1. **Inline markdown conversion** (`convertInlineMarkdownInPlace()`):
   - Processes text nodes in real-time (debounced 300ms on input)
   - Supports: `***bold italic***`, `**bold**`, `*italic*`, `~~strikethrough~~`, `` `code` ``
   - Order matters: longest patterns first to avoid greedy matches
   - Preserves cursor position across conversions (`saveCursorPosition`/`restoreCursorPosition`)
2. **Block markdown on Enter** (`convertMdOnEnter()`):
   - `# Text` → H1, `## Text` → H2, `### Text` → H3
   - `> Text` → blockquote
   - Strips prefix from paragraph text after conversion
3. **Keyboard shortcuts** (Ctrl/Cmd):
   - `B` → bold, `I` → italic, `U` → underline, `` ` `` → code, `Shift+X` → strikethrough
4. **Paste handling**: Extracts `<!--StartFragment-->` / `<!--EndFragment-->` from clipboard HTML; falls back to plain text; runs `convertGoogleDocsHtml()` and `convertWordHtml()` cleanup
5. **HTML sanitization** (`sanitizeRichHtml()`):
   - Strips disallowed tags (only allows: P, DIV, BR, STRONG, B, EM, I, U, UL, OL, LI, BLOCKQUOTE, H1, H2, H3, A)
   - Normalizes B→STRONG, I→EM
   - Converts pasted HTML to safe `{ contentHtml, contentText }` shape
6. **Toolbar drag-and-drop**: Drag handle lets user reposition editor toolbar; snaps back to `toolbar-snap-slot` at top of editor wrapper
7. **`formatQuoteForDisplay()` / `getFormattedFromSource()`**: Renders quotes with original source formatting (bold, italic) by walking the source DOM and extracting inline styles per text slice

#### Quote/Analysis Integrity Functions

1. **`saveAnalysisNodeWithIntegrity({ analysisId, analysis, tags })`**:
   - Clones current `state.selectedQuoteRef` via `cloneQuoteRef()`
   - Calls `ensureQuoteRecord()` for each ref to create/update quote nodes
   - Builds `analysisNode` with `quoteRefs` array
   - Calls `addNode()`, then `reconcileAnalysisQuoteLinks()` to sync bidirectional links
2. **`deleteAnalysisNodeWithIntegrity(node, options)`**:
   - Unlinks analysis from all referenced quotes via `unlinkAnalysisFromQuote()`
   - Deletes orphaned quotes (no other analysis references) via `removeQuoteAndLinkedCuesEverywhere()`
   - Removes the analysis node via `removeNodeEverywhere()`
3. **`reconcileAnalysisQuoteLinks(analysisId, previousRefs, nextRefs)`**:
   - Unlinks removed refs: `unlinkAnalysisFromQuote(quoteId, analysisId)` + optional delete if private
   - Links new refs: `linkAnalysisToQuote(quoteId, analysisId)`
4. **`getQuoteCleanupSummary(quoteIds, excludedAnalysisIds)`**: Returns `{ attachedQuoteIds, deletableQuoteIds, attachedCueCount, deletableCueCount }` for the cleanup dialog

#### Utility Functions

1. **`buildQuoteRefFromQuoteNode(quoteNode)`**: Converts a quote node into a `quoteRef` object for `analysis.quoteRefs[]`
2. **`cloneQuoteRef(ref)`**: Deep-clones a quote ref with defaults for missing fields
3. **`pathsMatchForHighlight(quotePath, sourcePath)`**: Prefix-based hierarchy matching — highlight only activates when quote's hierarchy path is a prefix of the source path
4. **`resolveRefJumpForRef(ref)`**: Resolves `{ sourceId, start, end }` for jumping to a quote ref's location in any source document
5. **`resolveLegacyLinkedOffsets(node, source, domText)`**: Fallback for old-style analysis nodes that store `link.start`/`link.end` directly
6. **`findQuoteInSource(quote, sourceText)`**: Fuzzy quote-to-source position matching with normalized whitespace comparison
7. **`htmlToPlainText(html)`** / **`plainTextToHtml(text)`**: Convert between rich HTML and plain text representations (handles block elements, speakers, stage directions for play scripts)

### Tags System

Added global tag library in DB_VERSION 8:

1. **Store**: `tags` object store in IndexedDB
2. **Operations**: addTag, getAllTags, deleteTag
3. **Integration**: Used in mindmap tool for filtering
4. **Tag selection UI in analysis tool**:
   - Tag selector toggle button next to tags input field
   - Shows existing tags filtered by current subject (or all tags if none in subject)
   - Click to add/remove tags from the analysis form
   - Visual feedback: selected tags have highlighted background
   - Auto-syncs tags from node/quote metadata to the tag store via `syncTagsToTagStore()`
   - On init, scans all nodes and quotes to populate tag store

### Mindmap Tool (`mindmapTool.js`)

1. **Layer hierarchy visualization**: Shows layer nodes (layer 1, 2, 3) derived from source hierarchies
2. **Force-directed layout**:
   - Repulsion: 80 units, range 180px
   - Attraction: 0.002
   - Damping: 0.94
3. **Ring radii by type**: Subject 0, Layer 70, Source 150, Quote 250, Analysis 350
4. **Node colors**: Subject red, Layer purple, Source blue, Quote orange, Analysis green, Cue pink, Tag yellow
5. **Pan and zoom**: Configurable canvas view
6. **Metadata display**: Shows memory state, timestamps, node details
7. **Tag filtering**: Filter by tags via sidebar

### Origin Validation

Access is restricted to predefined origins:

```js
const ALLOWED_ORIGINS = [
  "http://127.0.0.1:5500",
  "https://aigsniperyt.github.io"
];
```

---

## 11. SuperProgram Memory Specification

### 11.1 Core State Model

Each card (quote / analysis / cue-linked unit) maintains:

```
S ∈ [0.1, ∞)      (stability / memory strength)
D ∈ [0.1, ∞)      (difficulty)
U ∈ [0, 1]        (uncertainty)
I ∈ [0.1, ∞)      (interval in days)
```

For numerical stability:

```
S_min = 0.1
D_min = 0.1
U_clamp = [0, 1]
```

### 11.2 Time Model

#### Response Time Factor

```
TF = T_actual / T_expected
```

#### Smoothed transform

```
T_effect = 1 / (1 + e^(k(TF - 1)))
```

Default: `k = 2.0`

### 11.3 Grade Encoding

```
easy       → G = +1.0
kinda      → G =  0.0
didnt_know → G = -1.0
```

```
G_abs = |G|
```

### 11.4 Core Update Equations

#### Stability (S)

```
S' = S × (1 + α · G · T_effect) - β · (1 - T_effect) · (G_abs + 0.2)
```

α = 0.25, β = 0.15

#### Difficulty (D)

```
D' = D × (1 - γ · G · T_effect) + δ · (1 - G_abs) · (1 - T_effect)
```

γ = 0.2, δ = 0.1

#### Uncertainty (U)

```
U' = U + λ · (1 - consistency) + μ · (1 - T_effect)
```

λ = 0.2, μ = 0.15

#### Interval (I)

```
I_base = S / (D + ε)
```

ε = 0.5

```
I' = I_base × (1 + κ · G · T_effect)
```

κ = 0.8

### 11.5 Recall Model

```
R(t) = exp(-t / S)
```

Threshold: `θ = 0.7`

### 11.6 Scheduling Rule

```
nextReview = now + I'
nextReview *= (1 - 0.2·U')
```

### 11.7 Full Update Function

```js
function updateCard(card, grade, T_actual, T_expected) {
  const TF = T_actual / T_expected
  const T_effect = 1 / (1 + Math.exp(2 * (TF - 1)))

  let G = grade === "easy" ? 1 : grade === "kinda" ? 0 : -1
  let G_abs = Math.abs(G)

  let S = card.S
  S = S * (1 + 0.25 * G * T_effect);
       - 0.15 * (1 - T_effect) * (G_abs + 0.2)
  S = Math.max(S, 0.1)

  let D = card.D
  D = D * (1 - 0.2 * G * T_effect);
       + 0.1 * (1 - G_abs) * (1 - T_effect)
  D = Math.max(D, 0.1)

  let U = card.U
  let consistency = card.consistency ?? 0.7
  U = U + 0.2 * (1 - consistency) + 0.15 * (1 - T_effect)
  U = Math.min(Math.max(U, 0), 1)

  let I_base = S / (D + 0.5)
  let I = I_base * (1 + 0.8 * G * T_effect)
  I = Math.min(Math.max(I, 0.1), 365)

  let nextReview = Date.now() + I * 86400000
  nextReview *= (1 - 0.2 * U)

  return {
    ...card,
    S,
    D,
    U,
    interval: I,
    nextReview,
    lastReview: Date.now()
  }
}
```

### 11.8 Behaviour Guarantees

#### Easy + Fast

Strong reinforcement, fast interval growth

#### Easy + Slow

Weaker reinforcement but still positive

#### Kinda

Neutral stabilisation behaviour

#### Didn't Know

Strong decay in S, increase in D and U

### 11.9 Stability Constraints

```
S ∈ [0.1, 1000]
D ∈ [0.1, 1000]
U ∈ [0, 1]
I ∈ [0.1, 365]
```

### 11.10 Priority Scheduling

```
priority = 1 + overdueDays + U * 0.8 + (quotePriority - 1) * 2
```

Where:

- `overdueDays = (now - nextReview) / 86400000` (can be negative for future reviews)
- `U` = uncertainty (0 to 1)
- `quotePriority` = 1-5 scale (adds 0 to 8 boost)

New cards (no nextReview): `overdueDays = 0` (treated as exactly due)

### 11.11 Conceptual Outcome

This system behaves like a unified model of:

- FSRS scheduling
- Anki-style repetition
- Cognitive time-based retrieval modelling
- Adaptive difficulty tutoring

### 11.12 Key Insight

Memory is not stored as correctness.

It is stored as:

> stability × timing × uncertainty dynamics

---

## 12. Future Roadmap

| Feature | Priority |
|---------|----------|
| Blurt mode (bulk recall test) | Medium |
| Tracker analytics | Low |
| Notes tool (source creation) | Low |

---

## 13. Quick Reference

### Import Dependencies in tool files

```js
import { getAllNodes, getAllQuotes, getAllCues, addNode, addQuote, ... } from "../db.js";
```

### Global State Variables (src/main.js)

```js
let currentToolName = ""    // Current active tool
let currentSubject = null  // Selected subject
let subjectEditMode = false // Edit mode toggle
```

### Key DOM Elements

```js
const toolContainer = document.getElementById("toolContainer");
const sidebar = document.getElementById("sidebar");
const globalLaunchpad = document.getElementById("globalLaunchpad");
```

### Canvas Public API

```js
window.__neuronetCanvas.triggerRadialPulse(x, y, strength)
window.__neuronetCanvas.triggerSweep(strength)
window.__neuronetCanvas.triggerVerticalWave(strength)
window.__neuronetCanvas.triggerRandomNodes(count, strength)
window.__neuronetCanvas.getNodes()
```

---

*Build local. Think in nodes. Learn deeply.*
