export async function initMemoryTool(deps, context = {}) {
  const {
    getAllNodes,
    getAllQuotes,
    getAllCues,
    getQuotesForSubject,
    getAnalysisNodesForSubject,
    getDueQuotesForSubject,
    getDueAnalysisNodesForSubject,
    addQuote,
    addNode,
    addCue,
    addSubject,
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
    escapeHtml
  } = deps;

  const { subject: contextSubject } = context;

  if (typeof window.__neuronetMemoryCleanup === "function") {
    window.__neuronetMemoryCleanup();
  }

  const state = {
    view: contextSubject ? "study" : "launchpad",
    currentSubject: contextSubject || "",
    currentMode: "quote-learning",
    flashcards: [], // session history (cards shown)
    currentIndex: 0,
    isFlipped: false,
    showAnalysis: false,
    editMode: false,
    session: {
      heap: null,
      surprisePool: [],
      shownAt: null,
      revealedAt: null,
      suppressDBChange: 0,
      lastGradeReaction: null
    },
    stats: {
      totalStudied: 0,
      correctAnswers: 0,
      streak: 0,
      bestStreak: 0
    },
    evidenceMatching: {
      currentAnalysis: null,
      quoteOptions: [],
      selectedOption: null,
      correctOption: null,
      answered: false,
      wasCorrect: null
    },
    // Middle UI state
    sessionFilter: null,
    selectedPriorities: [],
    selectedTags: [],
    selectedLayers: [],
    filterMode: "AND", // "AND" | "OR"
    // Middle UI data cache
    middleUIData: {
      priorities: [],
      tags: [],
      layers: []
    }
  };

  let memoryTool, modeSelect, newSessionBtn, statsBtn, backToDecksBtn;
  let memoryLaunchpad, deckList, memoryContent, editDecksBtn;
  let flashcardContainer, flashcard, flashcardContent, flashcardBackContent;
  let gradingControls, gradeDidntKnowBtn, gradeKindaBtn, gradeEasyBtn, priorityControls, priorityToggle;
  let evidenceMatchingContainer, evidencePrompt, quoteOptions, evidenceFeedback;
  let memoryStats, statsContent, closeStatsBtn, roundProgress, resetMemoryBtn;
  let systemThinkingText;
  // Deck builder elements
  let deckBuilderModal, deckNameInput, deckDescriptionInput, createDeckBtn, closeDeckBuilderBtn;
  let step1DeckInfo, step2Flashcards, step3Success;
  let cueInput, quoteInput, priorityPills, saveCardBtn, cancelCardBtn, clearFormBtn, deleteCardBtn;
  let nextToDeckBtn, addNewCardBtn, backToDeckInfoBtn, finishDeckBtn;
  let studyNewDeckBtn, backToLaunchpadBtn, flashcardList;
  let deckNameDisplay, cardCountDisplay, builderTitle;
    // New: layer rows, import
   let importToggleBtn, ankiImportInput, processImportBtn, cancelImportBtn, importFeedback;
  // Middle UI elements
  let middleUI, middleHeader, middleBackBtn, middleSubjectName, middleStudyBtn;
  let middleModeSelector, andFilterBtn, orFilterBtn, filterModeHint;
  let prioritySection, priorityCheckboxes, tagsSection, tagsCheckboxes, layersSection, layersCheckboxes;
  let cardCount;

  // Deck builder state
  const deckBuilderState = {
    cards: [], // Array of {cueId, cueFront, quoteId, quoteBack, priority, layers: [], isExisting}
    deckName: "",
    deckDescription: "",
    currentCardIndex: -1,
    isEditingCard: false,
    editingSubject: null,
    deletedCardIds: [], // Track deleted card IDs for editing
    layerPillState: {
      selectedLayers: []   // currently selected layer names for the editing card (max 3)
    }
  };

  function getDOMElements() {
    memoryTool = document.getElementById("memoryTool");
    modeSelect = document.getElementById("modeSelect");
    newSessionBtn = document.getElementById("newSessionBtn");
    statsBtn = document.getElementById("statsBtn");
    backToDecksBtn = document.getElementById("backToDecksBtn");
    memoryLaunchpad = document.getElementById("memoryLaunchpad");
    deckList = document.getElementById("deckList");
    memoryContent = document.getElementById("memoryContent");
    flashcardContainer = document.getElementById("flashcardContainer");
    flashcard = document.getElementById("flashcard");
    flashcardContent = document.getElementById("flashcardContent");
    flashcardBackContent = document.getElementById("flashcardBackContent");

    gradingControls = document.getElementById("gradingControls");
    gradeDidntKnowBtn = document.getElementById("gradeDidntKnowBtn");
    gradeKindaBtn = document.getElementById("gradeKindaBtn");
    gradeEasyBtn = document.getElementById("gradeEasyBtn");
    priorityControls = document.getElementById("priorityControls");
    priorityToggle = document.getElementById("priorityToggle");
    evidenceMatchingContainer = document.getElementById("evidenceMatchingContainer");
    evidencePrompt = document.getElementById("evidencePrompt");
    quoteOptions = document.getElementById("quoteOptions");
    evidenceFeedback = document.getElementById("evidenceFeedback");
    memoryStats = document.getElementById("memoryStats");
    statsContent = document.getElementById("statsContent");
    closeStatsBtn = document.getElementById("closeStatsBtn");
    roundProgress = document.getElementById("roundProgress");
    resetMemoryBtn = document.getElementById("resetMemoryBtn");
    systemThinkingText = document.getElementById("systemThinkingText");

    // Deck builder elements
    deckBuilderModal = document.getElementById("deckBuilderModal");
    deckNameInput = document.getElementById("deckNameInput");
    deckDescriptionInput = document.getElementById("deckDescriptionInput");
    createDeckBtn = document.getElementById("createDeckBtn");
    editDecksBtn = document.getElementById("editDecksBtn");
    closeDeckBuilderBtn = document.getElementById("closeDeckBuilderBtn");
    step1DeckInfo = document.getElementById("step1-deckInfo");
    step2Flashcards = document.getElementById("step2-flashcards");
    step3Success = document.getElementById("step3-success");
    cueInput = document.getElementById("cueInput");
    quoteInput = document.getElementById("quoteInput");
    priorityPills = document.getElementById("priorityPills");
    saveCardBtn = document.getElementById("saveCardBtn");
    cancelCardBtn = document.getElementById("cancelCardBtn");
    clearFormBtn = document.getElementById("clearFormBtn");
    deleteCardBtn = document.getElementById("deleteCardBtn");
    nextToDeckBtn = document.getElementById("nextToDeckBtn");
    addNewCardBtn = document.getElementById("addNewCardBtn");
    backToDeckInfoBtn = document.getElementById("backToDeckInfoBtn");
    finishDeckBtn = document.getElementById("finishDeckBtn");
    studyNewDeckBtn = document.getElementById("studyNewDeckBtn");
    backToLaunchpadBtn = document.getElementById("backToLaunchpadBtn");
    flashcardList = document.getElementById("flashcardList");
    deckNameDisplay = document.getElementById("deckNameDisplay");
    cardCountDisplay = document.getElementById("cardCountDisplay");
    builderTitle = document.getElementById("builderTitle");
    // Layer row elements (dynamically rendered, accessed via getElementById in render functions)
    // Import elements
    importToggleBtn = document.getElementById("importToggleBtn");
    ankiImportInput = document.getElementById("ankiImportInput");
    processImportBtn = document.getElementById("processImportBtn");
    cancelImportBtn = document.getElementById("cancelImportBtn");
    importFeedback = document.getElementById("importFeedback");
    // Layer row elements
    // (dynamically rendered, accessed via getElementById in render functions)
    // Card count display
    cardCount = document.getElementById("cardCount");

    // Middle UI elements
    middleUI = document.getElementById("middleUI");
    middleHeader = document.getElementById("middleHeader");
    middleBackBtn = document.getElementById("middleBackBtn");
    middleSubjectName = document.getElementById("middleSubjectName");
    middleStudyBtn = document.getElementById("middleStudyBtn");
    middleModeSelector = document.getElementById("middleModeSelector");
    andFilterBtn = document.getElementById("andFilterBtn");
    orFilterBtn = document.getElementById("orFilterBtn");
    filterModeHint = document.getElementById("filterModeHint");
    prioritySection = document.getElementById("prioritySection");
    priorityCheckboxes = document.getElementById("priorityCheckboxes");
    tagsSection = document.getElementById("tagsSection");
    tagsCheckboxes = document.getElementById("tagsCheckboxes");
    layersSection = document.getElementById("layersSection");
    layersCheckboxes = document.getElementById("layersCheckboxes");
  }

  async function initialize() {
    try {
      getDOMElements();
      await loadLaunchpad();
      if (state.currentSubject) {
        await loadFlashcards();
      }
      renderUI();
      attachEventListeners();
      attachKeyboardShortcuts();
      document.addEventListener("db-change", handleDBChange);
    } catch (error) {
      console.error("Failed to initialize memory tool:", error);
      if (flashcardContent) {
        flashcardContent.textContent = `Error loading memory tool: ${error.message}`;
      }
    }
  }

  function attachEventListeners() {
    if (backToDecksBtn) {
      backToDecksBtn.addEventListener("click", async () => {
        state.view = "launchpad";
        state.currentSubject = "";
        state.sessionFilter = null;
        await loadLaunchpad();
        renderUI();
      });
    }

    if (editDecksBtn) {
      editDecksBtn.addEventListener("click", async () => {
        state.editMode = !state.editMode;
        editDecksBtn.classList.toggle("active", state.editMode);
        await loadLaunchpad();
        renderUI();
      });
    }

    if (modeSelect) {
      modeSelect.addEventListener("click", async () => {
        const modes = ["quote-learning", "analysis-learning", "evidence-matching", "blurt"];
        const currentIndex = modes.indexOf(state.currentMode);
        state.currentMode = modes[(currentIndex + 1) % modes.length];
        await loadFlashcards();
        renderUI();
      });
    }

    if (newSessionBtn) {
      newSessionBtn.addEventListener("click", async () => {
        state.currentIndex = 0;
        state.isFlipped = false;
        state.showAnalysis = false;
        await loadFlashcards();
        renderUI();
      });
    }

    if (statsBtn) {
      let statsInterval = null;

      const openStats = () => {
        renderStats();
        updateSystemThought();
        if (memoryStats) memoryStats.classList.add("open");
        if (!statsInterval) {
          statsInterval = setInterval(() => {
            if (memoryStats && memoryStats.classList.contains("open")) {
              renderStats();
            } else {
              clearInterval(statsInterval);
              statsInterval = null;
            }
          }, 1000);
        }
      };

      const closeStats = () => {
        if (memoryStats) memoryStats.classList.remove("open");
        clearInterval(statsInterval);
        statsInterval = null;
      };

      statsBtn.addEventListener("click", () => {
        if (memoryStats && memoryStats.classList.contains("open")) {
          closeStats();
        } else {
          openStats();
        }
      });

      if (closeStatsBtn) {
        closeStatsBtn.addEventListener("click", closeStats);
      }

      window.__neuronetStatsCleanup = () => {
        clearInterval(statsInterval);
        statsInterval = null;
      };
    }


    if (gradeDidntKnowBtn) {
      gradeDidntKnowBtn.addEventListener("click", async () => {
        await gradeCurrentCard("didnt_know");
      });
    }
    if (gradeKindaBtn) {
      gradeKindaBtn.addEventListener("click", async () => {
        await gradeCurrentCard("kinda");
      });
    }
    if (gradeEasyBtn) {
      gradeEasyBtn.addEventListener("click", async () => {
        await gradeCurrentCard("easy");
      });
    }

    if (resetMemoryBtn) {
      resetMemoryBtn.addEventListener("click", async () => {
        if (confirm("Are you sure you want to reset ALL memory metadata for this subject? This cannot be undone.")) {
          await resetSubjectMemoryMetadata();
          await loadFlashcards();
          renderUI();
        }
      });
    }

    // Priority toggle button (bottom-right)
    const priorityToggleBtn = document.getElementById("priorityToggle");
    if (priorityToggleBtn) {
      priorityToggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const controls = document.getElementById("priorityControls");
        if (controls) {
          const isVisible = controls.style.display !== "none";
          if (!isVisible) {
            // Populate priority buttons when showing
            const currentCard = state.flashcards[state.currentIndex];
            if (currentCard?.record?.priority !== undefined) {
              controls.innerHTML = `
                <span class="priority-label">Priority:</span>
                ${[1,2,3,4,5].map(v => {
                  const active = v <= currentCard.record.priority;
                  const color = getPriorityColor(v);
                  return `<button type="button" class="priority-btn ${active ? 'active' : ''}"
                    style="color:${active ? color : 'rgba(230,255,245,0.3)'};"
                    data-value="${v}" title="Set priority to ${v}">${active ? '★' : '☆'}</button>`;
                }).join("")}
              `;
              controls.querySelectorAll(".priority-btn").forEach(btn => {
                btn.addEventListener("click", async (e) => {
                  const newPriority = parseInt(e.target.dataset.value);
                  const card = state.flashcards[state.currentIndex];
                  if (card?.record?.id) {
                    await updateQuotePriority(card.record.id, newPriority);
                  }
                });
              });
            }
          }
          controls.style.display = isVisible ? "none" : "flex";
        }
      });
    }

    if (closeStatsBtn && !closeStatsBtn.dataset.bound) {
      closeStatsBtn.dataset.bound = "1";
      closeStatsBtn.addEventListener("click", () => {
        if (memoryStats) memoryStats.classList.remove("open");
      });
    }

    if (flashcard) {
      flashcard.addEventListener("click", (e) => {
        if (e.target.closest(".memory-btn") || e.target.closest(".grade-btn")) return;
        flipCard();
      });
    }

    // Deck Builder Event Listeners
    if (createDeckBtn) {
      createDeckBtn.addEventListener("click", openDeckBuilder);
    }

    if (closeDeckBuilderBtn) {
      closeDeckBuilderBtn.addEventListener("click", closeDeckBuilder);
    }

    if (deckBuilderModal) {
      deckBuilderModal.addEventListener("click", (e) => {
        if (e.target === deckBuilderModal) {
          closeDeckBuilder();
        }
      });
    }

    if (nextToDeckBtn) {
      nextToDeckBtn.addEventListener("click", () => {
        deckBuilderState.deckName = deckNameInput?.value?.trim() || "";
        deckBuilderState.deckDescription = deckDescriptionInput?.value?.trim() || "";
        if (!deckBuilderState.deckName) {
          alert("Please enter a deck name");
          return;
        }
        showDeckBuilderStep(2);
      });
    }

    if (addNewCardBtn) {
      addNewCardBtn.addEventListener("click", () => {
        startEditingCard(-1);
      });
    }

    // Import toggle
    if (importToggleBtn) {
      importToggleBtn.addEventListener("click", () => {
        const importView = document.getElementById("importView");
        const cardEditForm = document.getElementById("cardEditForm");
        if (importView) {
          const isVisible = importView.style.display !== "none";
          importView.style.display = isVisible ? "none" : "block";
          if (cardEditForm) cardEditForm.style.display = isVisible ? "block" : "none";
        }
      });
    }

    if (processImportBtn) {
      processImportBtn.addEventListener("click", processAnkiImport);
    }

    if (cancelImportBtn) {
      cancelImportBtn.addEventListener("click", () => {
        const importView = document.getElementById("importView");
        const cardEditForm = document.getElementById("cardEditForm");
        if (importView) importView.style.display = "none";
        if (cardEditForm) cardEditForm.style.display = "block";
        if (ankiImportInput) ankiImportInput.value = "";
        if (importFeedback) importFeedback.textContent = "";
      });
    }

    if (saveCardBtn) {
      saveCardBtn.addEventListener("click", () => {
        const cueFront = cueInput?.value?.trim() || "";
        const quoteBack = quoteInput?.value?.trim() || "";
        if (!cueFront || !quoteBack) {
          alert("Please enter both front and back of the card");
          return;
        }
        // Get selected priority from pills
        const activePill = priorityPills?.querySelector(".priority-pill.active");
        const priority = activePill ? parseInt(activePill.dataset.priority) : 3;
        saveFlashcard(cueFront, quoteBack, priority);
      });
    }

    if (clearFormBtn) {
      clearFormBtn.addEventListener("click", () => {
        finishEditingCard();
      });
    }

    if (deleteCardBtn) {
      deleteCardBtn.addEventListener("click", () => {
        if (deckBuilderState.currentCardIndex >= 0) {
          deleteFlashcard(deckBuilderState.currentCardIndex);
        }
      });
    }

    if (cancelCardBtn) {
      cancelCardBtn.addEventListener("click", () => {
        finishEditingCard();
      });
    }

    if (backToDeckInfoBtn) {
      backToDeckInfoBtn.addEventListener("click", () => {
        showDeckBuilderStep(1);
      });
    }

    if (finishDeckBtn) {
      finishDeckBtn.addEventListener("click", async () => {
        if (deckBuilderState.cards.length === 0) {
          alert("Please add at least one card to the deck");
          return;
        }
        await saveDeckToDB();
      });
    }

    if (studyNewDeckBtn) {
      studyNewDeckBtn.addEventListener("click", async () => {
        state.currentSubject = deckBuilderState.deckName;
        state.view = "study";
        await loadFlashcards();
        renderUI();
        closeDeckBuilder();
      });
    }

    if (backToLaunchpadBtn) {
      backToLaunchpadBtn.addEventListener("click", async () => {
        await loadLaunchpad();
        renderUI();
        closeDeckBuilder();
      });
    }

    // Middle UI event listeners
    if (middleBackBtn) {
      middleBackBtn.addEventListener("click", async () => {
        state.view = "launchpad";
        state.currentSubject = "";
        state.sessionFilter = null;
        await loadLaunchpad();
        renderUI();
      });
    }

    if (middleStudyBtn) {
      middleStudyBtn.addEventListener("click", async () => {
        // Build session filter from selected options
        state.sessionFilter = {
          mode: state.currentMode,
          filterMode: state.filterMode,
          priorities: [...state.selectedPriorities],
          tags: [...state.selectedTags],
          layers: [...state.selectedLayers]
        };
        state.view = "study";
        await loadFlashcards();
        renderUI();
      });
    }

    // Mode selector pills
    if (middleModeSelector) {
      middleModeSelector.querySelectorAll(".mode-pill").forEach(btn => {
        btn.addEventListener("click", () => {
          middleModeSelector.querySelectorAll(".mode-pill").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          state.currentMode = btn.dataset.mode;
        });
      });
    }

    // AND/OR filter toggle
    if (andFilterBtn) {
      andFilterBtn.addEventListener("click", () => {
        state.filterMode = "AND";
        andFilterBtn.classList.add("active");
        orFilterBtn.classList.remove("active");
      });
    }

    if (orFilterBtn) {
      orFilterBtn.addEventListener("click", () => {
        state.filterMode = "OR";
        orFilterBtn.classList.add("active");
        andFilterBtn.classList.remove("active");
      });
    }

    // Cue/quote input listeners for save button state
    if (cueInput && quoteInput && saveCardBtn) {
      const updateSaveButton = () => {
        const hasContent = cueInput.value.trim() && quoteInput.value.trim();
        saveCardBtn.disabled = !hasContent;
        saveCardBtn.style.opacity = hasContent ? "1" : "0.4";
        saveCardBtn.style.pointerEvents = hasContent ? "auto" : "none";
      };
      cueInput.addEventListener("input", updateSaveButton);
      quoteInput.addEventListener("input", updateSaveButton);
    }
  }

  function attachKeyboardShortcuts() {
    document.addEventListener("keydown", handleKeyDown);
  }

  async function handleKeyDown(e) {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    // Priority shortcut: Ctrl+1-5 to set quote priority
    if (e.ctrlKey && e.key >= "1" && e.key <= "5") {
      const currentCard = state.flashcards[state.currentIndex];
      if (currentCard?.record?.priority !== undefined) {
        e.preventDefault();
        await updateQuotePriority(currentCard.record.id, parseInt(e.key));
        return;
      }
    }

    if (state.currentMode === "evidence-matching") {
      if (!state.evidenceMatching.answered) {
        if (e.key >= "1" && e.key <= "4") {
          e.preventDefault();
          const index = parseInt(e.key) - 1;
          if (index < state.evidenceMatching.quoteOptions.length) {
            selectQuoteOption(index);
          }
          return;
        }
      }
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        await navigateNext();
        return;
      }
    }

    switch (e.key) {
      case " ":
        e.preventDefault();
        flipCard();
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        await navigatePrevious();
        break;
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        await navigateNext();
        break;
    }
  }

  function flipCard() {
    const wasFlipped = state.isFlipped;
    state.isFlipped = !state.isFlipped;
    if (!wasFlipped && state.isFlipped) {
      const currentCard = state.flashcards[state.currentIndex];
      if (currentCard?.type !== "blurt") {
        state.session.revealedAt = Date.now();
      }
    }
    renderUI();
  }

  async function gradeCurrentCard(grade) {
    const currentCard = state.flashcards[state.currentIndex];
    if (!currentCard?.review?.required || currentCard.review.graded) return;
    if (!state.isFlipped) return;
    if (typeof addQuote !== "function" || typeof addNode !== "function") {
      console.warn("Memory grading is unavailable: addQuote/addNode not provided to Memory Tool.");
      return;
    }

    const nowMs = Date.now();
    const shownAt = state.session.shownAt ?? nowMs;
    const revealedAt = state.session.revealedAt ?? nowMs;
    const responseTimeMs = clampNumber(revealedAt - shownAt, 200, 240000) * 1;

    const isBlurt = currentCard.type === "blurt";
    const persistKind = isBlurt ? currentCard.targetKind : currentCard.memoryKind;
    const persistRecord = isBlurt ? currentCard.targetRecord : currentCard.record;
    if (!persistKind || !persistRecord) return;

    const updatedMemoryState = updateCardMemoryState(
      currentCard.memoryState,
      { grade, responseTimeMs, confidence: null },
      nowMs
    );

    currentCard.review.graded = true;
    currentCard.review.grade = grade;
    currentCard.review.responseTimeMs = responseTimeMs;
    currentCard.memoryState = updatedMemoryState;

    if (persistKind === "quote") {
      const updatedQuote = {
        ...persistRecord,
        meta: mergeMemoryStateIntoMeta(persistRecord.meta || {}, updatedMemoryState),
        updatedAt: nowMs
      };
      state.session.suppressDBChange++;
      await addQuote(updatedQuote);
      if (isBlurt) {
        currentCard.targetRecord = updatedQuote;
      } else {
        currentCard.record = updatedQuote;
      }
    } else if (persistKind === "analysis") {
      const updatedNode = {
        ...persistRecord,
        meta: mergeMemoryStateIntoMeta(persistRecord.meta || {}, updatedMemoryState),
        updatedAt: nowMs
      };
      state.session.suppressDBChange++;
      await addNode(updatedNode);
      if (isBlurt) {
        currentCard.targetRecord = updatedNode;
      } else {
        currentCard.record = updatedNode;
      }
    }

    state.stats.totalStudied++;
    if (grade === "easy") {
      state.stats.correctAnswers++;
      state.stats.streak++;
      if (state.stats.streak > state.stats.bestStreak) {
        state.stats.bestStreak = state.stats.streak;
      }
    } else {
      state.stats.streak = 0;
    }

    await maybeEnqueueSurpriseCard();

    // Build recycled card for re-queueing
    const cardForHeap = {
      ...currentCard,
      review: { required: true, graded: false, grade: null, responseTimeMs: null },
      memoryState: updatedMemoryState
    };
    if (isBlurt) {
      cardForHeap.blurt = { submitted: false, text: "" };
    }
    const quotePriority = cardForHeap.memoryKind === "quote" ? (cardForHeap.record?.priority ?? null) : null;
    const nextPriority = computePriority(updatedMemoryState, nowMs, quotePriority);
    if (state.session.heap) {
      state.session.heap.push({ priority: nextPriority, card: cardForHeap });
    }

    renderUI();
    state.session.lastGradeReaction = grade;
    // Always trigger reactive thought/impulse on grade
    updateSystemThought(grade);
    await navigateNext();
  }

  async function navigatePrevious() {
    const currentCard = state.flashcards[state.currentIndex];
    if (currentCard?.review?.required && !currentCard.review.graded) {
      return;
    }
    if (state.currentIndex > 0) {
      await navigateTo(state.currentIndex - 1);
    }
  }

  async function navigateNext() {
    if (state.currentMode === "evidence-matching") {
      if (state.evidenceMatching.selectedOption !== null && !state.evidenceMatching.answered) {
        checkEvidenceMatchingAnswer();
        renderUI();
        return;
      }
      if (state.evidenceMatching.answered) {
        if (state.currentIndex < state.flashcards.length - 1) {
          await navigateTo(state.currentIndex + 1);
        } else {
          // If at end, maybe reload or show finished
          alert("Completed all evidence matching for this round!");
        }
        return;
      }
    }

    const currentCard = state.flashcards[state.currentIndex];
    if (currentCard?.review?.required && !currentCard.review.graded) {
      return;
    }

    if (state.currentIndex < state.flashcards.length - 1) {
      await navigateTo(state.currentIndex + 1);
      return;
    }

    if (state.session.heap && state.session.heap.size() > 0) {
      if (flashcard) {
        flashcard.classList.add("slide-away");
        setTimeout(() => {
          drawNextCardFromHeap();
          renderUI();
          flashcard.classList.remove("slide-away");
          flashcard.classList.add("slide-in");
          setTimeout(() => {
            flashcard.classList.remove("slide-in");
          }, 250);
        }, 350);
      } else {
        drawNextCardFromHeap();
        renderUI();
      }
    }
  }

  async function navigateTo(index) {
    if (index === state.currentIndex || index < 0 || index >= state.flashcards.length) return;

    updateSystemThought();

    const direction = index > state.currentIndex ? "forward" : "back";

    if (flashcard) {
      const exitClass = direction === "forward" ? "slide-away" : "slide-away-back";
      const enterClass = direction === "forward" ? "slide-in" : "slide-in-back";

      flashcard.classList.add(exitClass);
      setTimeout(async () => {
        state.currentIndex = index;
        state.isFlipped = false;
        state.session.shownAt = Date.now();
        state.session.revealedAt = null;

        if (state.currentMode === "evidence-matching") {
          await loadEvidenceMatchingForAnalysis(state.flashcards[index].id);
        }

        renderUI();

        flashcard.classList.remove(exitClass);
        flashcard.classList.add(enterClass);
        setTimeout(() => {
          flashcard.classList.remove(enterClass);
        }, 250);
      }, 350);
    } else {
      state.currentIndex = index;
      state.isFlipped = false;
      renderUI();
    }
  }

  async function moveToNextEvidenceQuestion() {
    const analyses = await getAnalysisNodesForSubject(state.currentSubject);
    if (!analyses || analyses.length === 0) return;
    const currentIdx = analyses.findIndex(a => a.id === state.evidenceMatching.currentAnalysis?.id);
    const nextIdx = (currentIdx + 1) % analyses.length;
    await loadEvidenceMatchingForAnalysis(analyses[nextIdx].id);
    renderUI();
  }

  function handleDBChange(event) {
    if (state.session.suppressDBChange > 0) {
      state.session.suppressDBChange--;
      return;
    }
    loadFlashcards().then(renderUI);
  }

  async function loadLaunchpad() {
    const subjects = await getSubjects();
    if (!deckList) return;

    deckList.innerHTML = "";
    if (subjects.length === 0) {
      deckList.innerHTML = `<div style="color: var(--text-muted);">No decks found. Add quotes or analyses in the Analysis Tool.</div>`;
      return;
    }

    for (const subject of subjects) {
      const quotes = await getQuotesForSubject(subject) || [];
      const analyses = await getAnalysisNodesForSubject(subject) || [];
      const total = quotes.length + analyses.length;

       const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card-title">${escapeHtml(subject)}</div>
        <button class="card-btn deck-study-btn" data-subject="${escapeHtml(subject)}">Study</button>
        <div class="card-meta deck-stats">${total} items</div>
        ${state.editMode ? `<button class="deck-edit-btn" data-subject="${escapeHtml(subject)}">✎</button>` : ""}
      `;

      if (state.editMode) {
        const editBtn = card.querySelector(".deck-edit-btn");
        editBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          await openDeckEditor(subject);
        });
      }

      // Study button - quick study with no filters
      const studyBtn = card.querySelector(".deck-study-btn");
      studyBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        state.currentSubject = subject;
        state.currentMode = "quote-learning";
        state.sessionFilter = null;
        state.view = "study";
        await loadFlashcards();
        renderUI();
      });

      // Card click - go to middle UI for filters
      card.addEventListener("click", async () => {
        if (state.editMode) return;
        state.currentSubject = subject;
        state.view = "middle-ui";
        await loadMiddleUIData();
        renderUI();
      });

      deckList.appendChild(card);
    }
  }

  async function loadFlashcards() {
    if (!state.currentSubject) {
      state.flashcards = [];
      return;
    }

    state.flashcards = [];
    state.currentIndex = 0;
    state.isFlipped = false;
    state.showAnalysis = false;
    state.session.heap = new MaxHeap();
    state.session.surprisePool = [];
    state.session.shownAt = null;
    state.session.revealedAt = null;
    state.session.suppressDBChange = 0;

    if (state.currentMode === "quote-learning") {
      await buildQuoteLearningQueue();
      drawNextCardFromHeap();
    } else if (state.currentMode === "analysis-learning") {
      await buildAnalysisLearningQueue();
      drawNextCardFromHeap();
    } else if (state.currentMode === "blurt") {
      await buildBlurtQueue();
      drawNextCardFromHeap();
    } else if (state.currentMode === "evidence-matching") {
      await loadEvidenceMatchingFlashcards();
    }
  }

  class MaxHeap {
    constructor() {
      this.items = [];
    }
    size() {
      return this.items.length;
    }
    push(value) {
      this.items.push(value);
      this.#bubbleUp(this.items.length - 1);
    }
    pop() {
      if (this.items.length === 0) return null;
      const top = this.items[0];
      const last = this.items.pop();
      if (this.items.length > 0 && last) {
        this.items[0] = last;
        this.#bubbleDown(0);
      }
      return top;
    }
    #bubbleUp(index) {
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if ((this.items[parent]?.priority ?? 0) >= (this.items[index]?.priority ?? 0)) return;
        [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
        index = parent;
      }
    }
    #bubbleDown(index) {
      const length = this.items.length;
      while (true) {
        let largest = index;
        const left = 2 * index + 1;
        const right = 2 * index + 2;
        if (left < length && (this.items[left]?.priority ?? 0) > (this.items[largest]?.priority ?? 0)) largest = left;
        if (right < length && (this.items[right]?.priority ?? 0) > (this.items[largest]?.priority ?? 0)) largest = right;
        if (largest === index) return;
        [this.items[index], this.items[largest]] = [this.items[largest], this.items[index]];
        index = largest;
      }
    }
  }

  function clampNumber(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
  }

  function getPriorityColor(priority) {
    const p = clampNumber(Number(priority), 1, 5);
    switch (p) {
      case 1: return "#9aa4ad";
      case 2: return "#4ba3ff";
      case 3: return "#3fd07d";
      case 4: return "#ff9b39";
      case 5: return "#ff4d4d";
      default: return "#3fd07d";
    }
  }

  function getExpectedTimeMs(kind) {
    if (kind === "analysis") return 8000;
    if (kind === "blurt") return 15000;
    return 4000;
  }

  function getMemoryStateFromMeta(meta = {}, kind) {
    return {
      S: clampNumber(Number(meta.S ?? 1.0), 0.1, 1000),
      D: clampNumber(Number(meta.D ?? 1.0), 0.1, 1000),
      U: clampNumber(Number(meta.U ?? 0.5), 0, 1),
      interval: clampNumber(Number(meta.interval ?? 0.1), 0.1, 365),
      nextReview: Number.isFinite(Number(meta.nextReview)) ? Number(meta.nextReview) : 0,
      lastReview: Number.isFinite(Number(meta.lastReview)) ? Number(meta.lastReview) : null,
      reviewCount: Number.isFinite(Number(meta.reviewCount)) ? meta.reviewCount : 0,
      expectedTime: clampNumber(Number(meta.expectedTime ?? (getExpectedTimeMs(kind) / 1000)), 1, 120),
      avgTime: clampNumber(Number(meta.avgTime ?? (getExpectedTimeMs(kind) / 1000)), 0.2, 240),
      timeVariance: clampNumber(Number(meta.timeVariance ?? 0.7), 0, 1000),
      consistency: clampNumber(Number(meta.consistency ?? 0.7), 0, 1),
      confidence: clampNumber(Number(meta.confidence ?? 0.7), 0, 1),
      lastGrade: meta.lastGrade || null
    };
  }

  function mergeMemoryStateIntoMeta(existingMeta = {}, memoryState) {
    return {
      ...existingMeta,
      S: memoryState.S,
      D: memoryState.D,
      U: memoryState.U,
      interval: memoryState.interval,
      nextReview: memoryState.nextReview,
      lastReview: memoryState.lastReview,
      reviewCount: memoryState.reviewCount,
      expectedTime: memoryState.expectedTime,
      avgTime: memoryState.avgTime,
      timeVariance: memoryState.timeVariance,
      consistency: memoryState.consistency,
      confidence: memoryState.confidence,
      lastGrade: memoryState.lastGrade
    };
  }

  function updateCardMemoryState(memoryState, { grade, responseTimeMs, confidence }, nowMs) {
    const gradeNorm = grade === "easy" ? 1 : grade === "kinda" ? 0 : -1;
    const gradeAbs = Math.abs(gradeNorm);

    const expectedSeconds = clampNumber(Number(memoryState.expectedTime ?? 4), 1, 120);
    const actualSeconds = clampNumber(Number(responseTimeMs ?? 4000) / 1000, 0.2, 240);

    const TF = actualSeconds / expectedSeconds;
    const T_effect = 1 / (1 + Math.exp(2 * (TF - 1)));

    let S = memoryState.S;
    S = S * (1 + 0.25 * gradeNorm * T_effect) - 0.15 * (1 - T_effect) * (gradeAbs + 0.2);
    S = clampNumber(S, 0.1, 1000);

    let D = memoryState.D;
    D = D * (1 - 0.2 * gradeNorm * T_effect) + 0.1 * (1 - gradeAbs) * (1 - T_effect);
    D = clampNumber(D, 0.1, 1000);

    let consistency = clampNumber(memoryState.consistency ?? 0.7, 0, 1);
    consistency = clampNumber(consistency + 0.05 * gradeNorm * T_effect - 0.02 * (1 - T_effect), 0, 1);

    let U = memoryState.U;
    U = U + 0.2 * (1 - consistency) + 0.15 * (1 - T_effect);
    U = clampNumber(U, 0, 1);

    const I_base = S / (D + 0.5);
    let intervalDays = I_base * (1 + 0.8 * gradeNorm * T_effect);
    intervalDays = clampNumber(intervalDays, 0.1, 365);

    const intervalMs = intervalDays * 86400000;
    const uncertaintyFactor = 1 - 0.2 * U;
    const nextReview = nowMs + intervalMs * uncertaintyFactor;

    const avgTimePrev = clampNumber(Number(memoryState.avgTime ?? expectedSeconds), 0.2, 240);
    const avgTime = clampNumber(avgTimePrev * 0.8 + actualSeconds * 0.2, 0.2, 240);
    const timeVariancePrev = clampNumber(Number(memoryState.timeVariance ?? 0.7), 0, 1000);
    const timeVariance = clampNumber(timeVariancePrev * 0.8 + Math.pow(actualSeconds - avgTime, 2) * 0.2, 0, 1000);

    const reviewCount = (memoryState.reviewCount ?? 0) + 1;
    const confidenceBase = confidence ?? memoryState.confidence ?? 0.7;
    const confidenceOut = clampNumber(confidenceBase + 0.06 * gradeNorm - 0.03 * (1 - T_effect), 0, 1);

    return {
      ...memoryState,
      S,
      D,
      U,
      interval: intervalDays,
      nextReview,
      lastReview: nowMs,
      reviewCount,
      avgTime,
      timeVariance,
      consistency,
      confidence: confidenceOut,
      lastGrade: grade
    };
  }

  function computePriority(memoryState, nowMs, quotePriority = null) {
    let overdueDays;
    if (Number.isFinite(Number(memoryState.nextReview)) && memoryState.nextReview > 0) {
      overdueDays = (nowMs - Number(memoryState.nextReview)) / 86400000;
    } else {
      // New card - give it priority comparable to exactly due cards
      overdueDays = 0;
    }
    const U = clampNumber(Number(memoryState.U ?? 0.5), 0, 1);
    let result = 1 + overdueDays + U * 0.8;

    // Factor in quote priority (1-5 scale, 5 = highest user priority)
    if (quotePriority !== null && quotePriority !== undefined) {
      const p = clampNumber(Number(quotePriority), 1, 5);
      result += (p - 1) * 2; // Priority 5 adds 8.0 boost, Priority 1 adds 0
    }

    return result;
  }

  async function maybeEnqueueSurpriseCard() {
    if (state.currentMode !== "quote-learning" && state.currentMode !== "analysis-learning") return;
    if (!state.session.heap) return;
    if (!Array.isArray(state.session.surprisePool) || state.session.surprisePool.length === 0) return;
    if (Math.random() > 0.08) return;

    const idx = Math.floor(Math.random() * state.session.surprisePool.length);
    const candidate = state.session.surprisePool.splice(idx, 1)[0];
    if (!candidate?.record?.id) return;

    const alreadySeen = state.flashcards.some((c) => c?.record?.id === candidate.record.id || c?.id === candidate.record.id);
    if (alreadySeen) return;

    const nowMs = Date.now();
    let card = null;

    if (candidate.memoryKind === "quote") {
      const quote = candidate.record;
      const analyses = await getAnalysesReferencingQuote(quote.id);
      const cueNode = candidate.cueNode || null;
      card = {
        id: quote.id,
        memoryKind: "quote",
        type: "quote-learning",
        record: quote,
        review: { required: true, graded: false, grade: null, responseTimeMs: null },
        front: {
          content: getCueForQuote(quote, cueNode),
          isCue: true,
          cueNode
        },
        back: {
          content: quote.quote,
          isQuote: true,
          quoteData: quote,
          analyses: analyses
        },
        memoryState: candidate.memoryState
      };
    } else if (candidate.memoryKind === "analysis") {
      const analysis = candidate.record;
      const quotes = await getQuotesReferencedByAnalysis(analysis.id);
      card = {
        id: analysis.id,
        memoryKind: "analysis",
        type: "analysis-learning",
        record: analysis,
        review: { required: true, graded: false, grade: null, responseTimeMs: null },
        front: {
          content: analysis.title || "What is the analysis?",
          isQuestion: true,
          quotes: quotes
        },
        back: {
          content: analysis.analysis,
          isAnalysis: true,
          analysisData: analysis
        },
        memoryState: candidate.memoryState
      };
    }

    if (!card) return;
    const quotePriority = card.memoryKind === "quote" ? (card.record?.priority ?? null) : null;
    const priority = computePriority(card.memoryState, nowMs, quotePriority) + 0.7;
    state.session.heap.push({ priority, card });
  }

  function drawNextCardFromHeap() {
    const next = state.session.heap?.pop();
    if (!next?.card) return;

    state.flashcards.push(next.card);
    state.currentIndex = state.flashcards.length - 1;
    state.isFlipped = false;
    state.showAnalysis = false;
    state.session.shownAt = Date.now();
    state.session.revealedAt = null;
    updateSystemThought();
  }

  async function buildQuoteLearningQueue() {
    const nowMs = Date.now();
    const [allQuotes, allCues] = await Promise.all([
      getQuotesForSubject(state.currentSubject),
      getAllCues()
    ]);

    // Build cue map: quoteId -> cue
    const cuesByQuoteId = new Map();
    (allCues || [])
      .filter((c) => c?.subject === state.currentSubject && c?.quoteId)
      .forEach((cue) => {
        if (!cuesByQuoteId.has(cue.quoteId)) {
          cuesByQuoteId.set(cue.quoteId, cue);
        }
      });

    state.session.surprisePool = [];

    const isCustomDeck = (quote) => quote?.meta?.tags?.includes("custom-deck");

    const cards = await Promise.all(
      (allQuotes || []).map(async (quote) => {
        const analyses = await getAnalysesReferencingQuote(quote.id);
        const cueNode = cuesByQuoteId.get(quote.id) || null;
        const memoryState = getMemoryStateFromMeta(quote.meta || {}, "quote");

        // For custom decks, display cue on front, quote on back
        let frontContent;
        if (isCustomDeck(quote) && cueNode?.cue) {
          frontContent = cueNode.cue;
        } else {
          frontContent = getCueForQuote(quote, cueNode);
        }

        return {
          id: quote.id,
          memoryKind: "quote",
          type: "quote-learning",
          record: quote,
          review: { required: true, graded: false, grade: null, responseTimeMs: null },
          front: {
            content: frontContent,
            isCue: !isCustomDeck(quote),
            cueNode,
            isCustomDeck: isCustomDeck(quote)
          },
          back: {
            content: quote.quote,
            isQuote: true,
            quoteData: quote,
            analyses: analyses
          },
          memoryState
        };
      })
    );

    // Apply filters if set
    let filteredCards = cards;
    if (state.sessionFilter) {
      filteredCards = cards.filter(card => {
        return passesFilter(card, state.sessionFilter);
      });
    }

    filteredCards.forEach((card) => {
      const quotePriority = card.record?.priority ?? null;
      const priority = computePriority(card.memoryState, nowMs, quotePriority);
      state.session.heap.push({ priority, card });
    });
  }

  function getCueForQuote(quote, cueNode = null) {
     // Check for custom cue (from deck builder or manually added)
     if (cueNode?.cue) {
       return cueNode.cue;
     }
     // Fallback: show truncated quote as cue
     const words = quote.quote.split(' ');
     if (words.length <= 4) return quote.quote;
     return `${words[0]} ... ${words[words.length - 1]}`;
   }

  async function buildAnalysisLearningQueue() {
    const nowMs = Date.now();
    const allAnalyses = await getAnalysisNodesForSubject(state.currentSubject);

    state.session.surprisePool = [];

    const cards = await Promise.all(
      (allAnalyses || []).map(async (analysis) => {
        const quotes = await getQuotesReferencedByAnalysis(analysis.id);
        const memoryState = getMemoryStateFromMeta(analysis.meta || {}, "analysis");
        return {
          id: analysis.id,
          memoryKind: "analysis",
          type: "analysis-learning",
          record: analysis,
          review: { required: true, graded: false, grade: null, responseTimeMs: null },
          front: {
            content: analysis.title || "What is the analysis?",
            isQuestion: true,
            quotes: quotes
          },
          back: {
            content: analysis.analysis,
            isAnalysis: true,
            analysisData: analysis
          },
          memoryState
        };
      })
    );

    // Apply filters if set
    let filteredCards = cards;
    if (state.sessionFilter) {
      filteredCards = cards.filter(card => {
        return passesFilter(card, state.sessionFilter);
      });
    }

    filteredCards.forEach((card) => {
      // Analysis nodes don't have quote priority, but we could compute from referenced quotes
      const priority = computePriority(card.memoryState, nowMs);
      state.session.heap.push({ priority, card });
    });
  }

  async function buildBlurtQueue() {
    const nowMs = Date.now();
    const [allCues, quotes, analyses] = await Promise.all([
      getAllCues(),
      getQuotesForSubject(state.currentSubject),
      getAnalysisNodesForSubject(state.currentSubject)
    ]);

    const quotesById = new Map((quotes || []).map((q) => [q.id, q]));
    const analysesById = new Map((analyses || []).map((a) => [a.id, a]));

    let subjectCues = (allCues || []).filter((c) => c?.subject === state.currentSubject && c?.cue);

    // FALLBACK: If no explicit cues exist for this subject, generate virtual cues from quotes and analyses
    if (subjectCues.length === 0) {
      // Build a map of quoteId -> [analyses] to find cross-references
      const quoteToAnalyses = new Map();
      (analyses || []).forEach(a => {
        if (a.quoteRefs) {
          a.quoteRefs.forEach(ref => {
            if (!quoteToAnalyses.has(ref.quoteId)) quoteToAnalyses.set(ref.quoteId, []);
            quoteToAnalyses.get(ref.quoteId).push(a);
          });
        }
      });

      (quotes || []).forEach(q => {
        // For a quote, if it has a referencing analysis, use that as a hint
        const linkedAnalyses = quoteToAnalyses.get(q.id) || [];
        let cueText = q.section ? `Recall quote from: ${q.section}` : "Recall this quote";

        if (linkedAnalyses.length > 0) {
          const a = linkedAnalyses[0];
          const cleanA = (a.analysis || "").replace(/[#*`]/g, "").trim();
          const aSnippet = cleanA.substring(0, 80) + (cleanA.length > 80 ? "..." : "");
          cueText = `Recall quote related to analysis: "${aSnippet}"`;
        }

        subjectCues.push({
          id: `v-cue-q-${q.id}`,
          subject: state.currentSubject,
          quoteId: q.id,
          cue: cueText,
          isVirtual: true
        });
      });

      (analyses || []).forEach(a => {
        let cueText = "";

        // For an analysis, if it has linked quotes, use the first quote as the prompt
        if (a.quoteRefs && a.quoteRefs.length > 0) {
          const firstQuote = quotesById.get(a.quoteRefs[0].quoteId);
          if (firstQuote) {
            cueText = `Recall analysis for quote: "${firstQuote.quote.substring(0, 100)}${firstQuote.quote.length > 100 ? "..." : ""}"`;
          }
        }

        // Fallback to snippet if no linked quotes or quote not found
        if (!cueText) {
          const clean = (a.analysis || "").replace(/[#*`]/g, "").trim();
          const displayTitle = a.title || (clean.substring(0, 50) + (clean.length > 50 ? "..." : ""));
          cueText = displayTitle ? `Recall analysis: ${displayTitle}` : "Recall this analysis";
        }

        subjectCues.push({
          id: `v-cue-a-${a.id}`,
          subject: state.currentSubject,
          analysisId: a.id,
          cue: cueText,
          isVirtual: true
        });
      });
    }

    subjectCues.forEach((cue) => {
      let targetKind = null;
      let targetRecord = null;
      if (cue.quoteId && quotesById.has(cue.quoteId)) {
        targetKind = "quote";
        targetRecord = quotesById.get(cue.quoteId);
      } else if (cue.analysisId && analysesById.has(cue.analysisId)) {
        targetKind = "analysis";
        targetRecord = analysesById.get(cue.analysisId);
      } else {
        return;
      }

      const memoryState = getMemoryStateFromMeta(targetRecord.meta || {}, targetKind);
      // Blurt is harder, so we expect more time
      memoryState.expectedTime = Math.max(memoryState.expectedTime, getExpectedTimeMs("blurt") / 1000);

      const card = {
        id: cue.id,
        memoryKind: "blurt",
        type: "blurt",
        cue,
        targetKind,
        targetRecord,
        review: { required: true, graded: false, grade: null, responseTimeMs: null },
        front: { content: cue.cue, isCue: true, cueNode: cue },
        back: {
          isBlurtInput: true,
          targetContent: targetKind === "quote" ? targetRecord.quote : targetRecord.analysis,
          targetRecord,
          targetKind
        },
        blurt: { submitted: false, text: "" },
        memoryState
      };

      const priority = computePriority(memoryState, nowMs, cue.quoteId ? (quotesById.get(cue.quoteId)?.priority ?? null) : null);
      state.session.heap.push({ priority, card });
    });
  }

  async function loadEvidenceMatchingFlashcards() {
    if (!state.currentSubject) {
      state.flashcards = [];
      return;
    }
    const analyses = await getAnalysisNodesForSubject(state.currentSubject);
    if (analyses.length === 0) {
      state.flashcards = [];
      return;
    }

    // Create placeholders for all analyses to show in the dots
    state.flashcards = analyses.map(analysis => ({
      id: analysis.id,
      type: "evidence-matching",
      record: analysis,
      memoryState: getMemoryStateFromMeta(analysis.meta || {}, "analysis"),
      review: { required: false, graded: false }, // Evidence matching doesn't strictly grade in SRS yet
      front: { content: analysis.analysis, isAnalysis: true },
      back: { content: "Select supporting quotes", isInstruction: true }
    }));

    state.currentIndex = 0;
    await loadEvidenceMatchingForAnalysis(state.flashcards[0].id);
  }

  async function resetSubjectMemoryMetadata() {
    if (!state.currentSubject) return;

    const [quotes, analyses] = await Promise.all([
      getQuotesForSubject(state.currentSubject),
      getAnalysisNodesForSubject(state.currentSubject)
    ]);

    const srsKeys = ["S", "D", "U", "interval", "nextReview", "lastReview", "reviewCount", "expectedTime", "avgTime", "timeVariance", "consistency", "confidence", "lastGrade"];

    state.session.suppressDBChange = (quotes || []).length + (analyses || []).length;

    const promises = [];

    for (const quote of (quotes || [])) {
      if (quote.meta) {
        srsKeys.forEach(key => delete quote.meta[key]);
        promises.push(addQuote(quote));
      }
    }

    for (const analysis of (analyses || [])) {
      if (analysis.meta) {
        srsKeys.forEach(key => delete analysis.meta[key]);
        promises.push(addNode(analysis));
      }
    }

    await Promise.all(promises);
    console.log("Memory metadata reset successfully for subject:", state.currentSubject);
  }

  async function loadEvidenceMatchingForAnalysis(analysisId) {
    if (!state.currentSubject || !analysisId) {
      return;
    }
    const analysis = await getNode(analysisId);
    if (!analysis) return;

    const referencedQuotes = await getQuotesReferencedByAnalysis(analysisId);
    const allQuotes = await getQuotesForSubject(state.currentSubject);
    const distractorQuotes = allQuotes
      .filter(q => !referencedQuotes.some(rq => rq.id === q.id))
      .slice(0, Math.min(3, allQuotes.length));

    const allOptions = [...referencedQuotes, ...distractorQuotes];
    shuffleArray(allOptions);

    state.evidenceMatching = {
      currentAnalysis: analysis,
      quoteOptions: allOptions,
      selectedOption: null,
      correctOption: referencedQuotes.map(q => q.id),
      answered: false,
      wasCorrect: null
    };

    const cardIndex = state.flashcards.findIndex(f => f.id === analysisId);
    const existingCard = cardIndex !== -1 ? state.flashcards[cardIndex] : null;

    const card = {
      ...(existingCard || {}),
      id: analysisId,
      type: "evidence-matching",
      front: {
        content: analysis.analysis,
        isAnalysis: true
      },
      back: {
        content: "Select the quotes that support this analysis",
        isInstruction: true
      }
    };

    if (cardIndex !== -1) {
      state.flashcards[cardIndex] = card;
    } else {
      state.flashcards.push(card);
    }
  }

  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  function renderUI() {
    if (!flashcardContainer || !flashcardContent || !flashcardBackContent) {
      getDOMElements();
    }

     if (state.view === "launchpad") {
      if (memoryLaunchpad) memoryLaunchpad.style.display = "flex";
      if (memoryContent) memoryContent.style.display = "none";
      if (middleUI) middleUI.style.display = "none";
      if (modeSelect) modeSelect.style.display = "none";
      if (newSessionBtn) newSessionBtn.style.display = "none";
      if (statsBtn) statsBtn.style.display = "none";
      if (backToDecksBtn) backToDecksBtn.style.display = "none";
      return;
    } else if (state.view === "middle-ui") {
      if (memoryLaunchpad) memoryLaunchpad.style.display = "none";
      if (memoryContent) memoryContent.style.display = "none";
      if (middleUI) middleUI.style.display = "flex";
      if (modeSelect) modeSelect.style.display = "none";
      if (newSessionBtn) newSessionBtn.style.display = "none";
      if (statsBtn) statsBtn.style.display = "none";
      if (backToDecksBtn) backToDecksBtn.style.display = "none";
      renderMiddleUI();
      return;
    } else {
      if (memoryLaunchpad) memoryLaunchpad.style.display = "none";
      if (memoryContent) memoryContent.style.display = "flex";
      if (middleUI) middleUI.style.display = "none";
      if (modeSelect) modeSelect.style.display = "inline-block";
      if (newSessionBtn) newSessionBtn.style.display = "inline-block";
      if (statsBtn) statsBtn.style.display = "inline-block";
      if (backToDecksBtn) backToDecksBtn.style.display = "inline-block";
    }

    if (modeSelect) {
      modeSelect.textContent =
        state.currentMode === "quote-learning" ? "Quote Learning" :
        state.currentMode === "analysis-learning" ? "Analysis Learning" :
        state.currentMode === "blurt" ? "Blurt" :
        "Evidence Matching";
    }

    if (flashcardContainer) flashcardContainer.style.display =
      state.currentMode !== "evidence-matching" ? "flex" : "none";
    if (evidenceMatchingContainer) evidenceMatchingContainer.style.display =
      state.currentMode === "evidence-matching" ? "block" : "none";

    if (!state.currentSubject) {
      if (flashcardContent) flashcardContent.textContent = "Select a subject to start studying.";
      if (flashcardBackContent) flashcardBackContent.textContent = "Use the sidebar to enter a subject.";
      return;
    }

    if (state.flashcards.length > 0 && state.currentIndex < state.flashcards.length) {
      const flashcardData = state.flashcards[state.currentIndex];
      updateFlashcardDisplay(flashcardData, flashcard);
    } else {
      if (flashcardContent) flashcardContent.textContent = "No flashcards available.";
      if (flashcardBackContent) flashcardBackContent.textContent = "Add content in the Analysis tool.";
    }

    const currentCard = state.flashcards[state.currentIndex];
    if (gradingControls) {
      const shouldShowGrading =
        state.currentMode !== "evidence-matching" &&
        !!currentCard?.review?.required &&
        state.isFlipped &&
        !currentCard.review.graded &&
        (currentCard.type !== "blurt" || !!currentCard.blurt?.submitted);

      if (shouldShowGrading) {
        requestAnimationFrame(() => {
          gradingControls.classList.add("visible");
        });
      } else {
        gradingControls.classList.remove("visible");
      }
    }

    // Show/hide priority toggle button (bottom-right)
    const priorityToggleBtn = document.getElementById("priorityToggle");
    const priorityCtrl = document.getElementById("priorityControls");
    if (priorityToggleBtn) {
      const isQuoteCard = currentCard?.memoryKind === "quote" || currentCard?.type === "quote-learning";
      if (isQuoteCard && currentCard?.record?.priority !== undefined) {
        priorityToggleBtn.style.display = "block";
        priorityToggleBtn.textContent = `${"★".repeat(currentCard.record.priority)}${"☆".repeat(5 - currentCard.record.priority)}`;
      } else {
        priorityToggleBtn.style.display = "none";
        if (priorityCtrl) priorityCtrl.style.display = "none";
      }
    }

    if (state.currentMode === "evidence-matching") {
      renderEvidenceMatchingUI();
    }

    renderRoundProgress();
  }

  function renderRoundProgress() {
    if (!roundProgress) return;
    roundProgress.innerHTML = "";

    const roundSize = 8;
    const isHeapMode = ["analysis-learning", "blurt"].includes(state.currentMode);

    // For heap-based modes, always show: already-seen history cards + upcoming from heap
    // For quote-learning (linear), use the standard paged window
    const roundStart = isHeapMode ? 0 : Math.floor(state.currentIndex / roundSize) * roundSize;

    const upcoming = (state.session.heap && state.session.heap.items.length > 0)
      ? [...state.session.heap.items].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      : [];

    // For heap modes, show the last [roundSize] cards seen + preview upcoming
    let slotCards = [];
    if (isHeapMode) {
      // Show current window: up to 8 slots, starting from max(0, currentIndex - roundSize + 1)
      const windowStart = Math.max(0, state.currentIndex - roundSize + 1);
      for (let i = windowStart; i < windowStart + roundSize; i++) {
        if (i < state.flashcards.length) {
          slotCards.push({ card: state.flashcards[i], index: i });
        } else {
          const upcomingIdx = i - state.flashcards.length;
          slotCards.push({ card: upcoming[upcomingIdx]?.card || null, index: i });
        }
      }
    } else {
      for (let i = roundStart; i < roundStart + roundSize; i++) {
        if (i < state.flashcards.length) {
          slotCards.push({ card: state.flashcards[i], index: i });
        } else {
          const upcomingIdx = i - state.flashcards.length;
          slotCards.push({ card: upcoming[upcomingIdx]?.card || null, index: i });
        }
      }
    }

    slotCards.forEach(({ card, index }) => {
      const dot = document.createElement("div");
      dot.className = "progress-dot";
      if (index === state.currentIndex) dot.classList.add("active");

      if (card && card.review) {
        let displayGrade = null;
        if (card.review.graded) {
          displayGrade = card.review.grade;
        } else if (card.memoryState && card.memoryState.lastGrade) {
          displayGrade = card.memoryState.lastGrade;
          dot.style.opacity = "0.4";
        }
        if (displayGrade === "didnt_know") dot.classList.add("grade-dk");
        else if (displayGrade === "kinda") dot.classList.add("grade-kinda");
        else if (displayGrade === "easy") dot.classList.add("grade-easy");
      }

      dot.title = card ? `Card ${index + 1}` : "Upcoming from heap";

      dot.addEventListener("click", () => {
        if (index < state.flashcards.length) navigateTo(index);
      });

      roundProgress.appendChild(dot);
    });
  }

  function updateFlashcardDisplay(flashcardData, flashcardElement) {
    if (!flashcardContent || !flashcardBackContent || !flashcardData) return;

    const front = flashcardData.front || {};
    const back = flashcardData.back || {};

 // Front content
     if (front.isCue) {
       // For blurt cards pointing at a quote, render the cue more prominently
       const isBlurtQuoteCard = flashcardData.type === "blurt" && flashcardData.targetKind === "quote";
       const isBlurtAnalysisCard = flashcardData.type === "blurt" && flashcardData.targetKind === "analysis";
       const isCustomDeckCard = front.isCustomDeck;

       if (isBlurtQuoteCard) {
         flashcardContent.innerHTML = `
           <div class="blurt-prompt-label">Recall the quote:</div>
           <div class="cue">${escapeHtml(front.content || "")}</div>
         `;
       } else if (isBlurtAnalysisCard) {
         flashcardContent.innerHTML = `
           <div class="blurt-prompt-label">Recall the analysis:</div>
           <div class="cue">${escapeHtml(front.content || "")}</div>
         `;
       } else if (isCustomDeckCard) {
         // Custom deck: show cue prominently on front
         flashcardContent.innerHTML = `
           <div class="custom-deck-label">${escapeHtml(flashcardData.record?.subject || "Custom Deck")}</div>
           <div class="cue">${escapeHtml(front.content || "")}</div>
         `;
       } else {
         flashcardContent.innerHTML = `<div class="cue">${escapeHtml(front.content || "")}</div>`;
       }
     } else if (front.isQuestion) {
       flashcardContent.innerHTML = `<div class="question">${escapeHtml(front.content || "")}</div>`;
       if (front.quotes && front.quotes.length > 0) {
         flashcardContent.innerHTML += `<div class="linked-quotes">`;
         flashcardContent.innerHTML += `<div class="linked-quotes-title">Which quote relates to this?</div>`;
         front.quotes.forEach(quote => {
           flashcardContent.innerHTML += `<div class="linked-quote-item">${escapeHtml(quote.quote)}</div>`;
           if (quote.section) {
             flashcardContent.innerHTML += `<div class="linked-quote-source">${escapeHtml(quote.section)}</div>`;
           }
         });
         flashcardContent.innerHTML += `</div>`;
       }
     } else if (front.isAnalysis) {
       flashcardContent.innerHTML = `<div class="analysis-preview">${formatAnalysisForDisplay(front.content || "")}</div>`;
     } else if (front.isQuote) {
       flashcardContent.innerHTML = `<div class="quote">${escapeHtml(front.content || "")}</div>`;
       const quoteData = flashcardData.front?.quoteData;
       if (quoteData && !quoteData.meta?.tags?.includes("custom-deck")) {
         flashcardContent.innerHTML += `<div class="quote-meta">From: ${escapeHtml(quoteData.section || "unknown source")}</div>`;
       }
       // Show priority subtly in corner
       if (quoteData?.priority) {
         const stars = [1,2,3,4,5].map(v => v <= quoteData.priority ? "★" : "☆").join("");
         flashcardContent.innerHTML += `<div class="quote-priority-subtle">${stars}</div>`;
       }
    } else {
     flashcardContent.textContent = front.content || "";
     }

// Back content - Only populate if flipped to prevent spoiling the next card during transitions
    if (state.isFlipped) {
      if (back.isQuote) {
        flashcardBackContent.innerHTML = `<div class="quote">${escapeHtml(back.content || "")}</div>`;
        if (back.quoteData && !back.quoteData.meta?.tags?.includes("custom-deck")) {
          flashcardBackContent.innerHTML += `<div class="quote-meta">From: ${escapeHtml(back.quoteData.section || "unknown source")}</div>`;
        }
        if (back.analyses && back.analyses.length > 0) {
          flashcardBackContent.innerHTML += `<div class="linked-analyses">`;
          flashcardBackContent.innerHTML += `<div class="linked-analyses-title">Linked Analyses:</div>`;
          back.analyses.forEach(analysis => {
            flashcardBackContent.innerHTML += `<div class="linked-analysis-item">${formatAnalysisForDisplay(analysis.analysis || '')}</div>`;
          });
          flashcardBackContent.innerHTML += `</div>`;
        }
      } else if (back.isAnalysis) {
        flashcardBackContent.innerHTML = `<div class="analysis">${formatAnalysisForDisplay(back.content || "")}</div>`;
        if (back.quotes && back.quotes.length > 0) {
          flashcardBackContent.innerHTML += `<div class="linked-quotes">`;
          flashcardBackContent.innerHTML += `<div class="linked-quotes-title">Linked Quotes:</div>`;
          back.quotes.forEach(quote => {
            flashcardBackContent.innerHTML += `<div class="linked-quote-item">${escapeHtml(quote.quote)}</div>`;
            if (quote.section) {
              flashcardBackContent.innerHTML += `<div class="linked-quote-source">${escapeHtml(quote.section)}</div>`;
            }
          });
          flashcardBackContent.innerHTML += `</div>`;
        }
      } else if (back.isBlurtInput) {
        if (!flashcardData.blurt?.submitted) {
          const existingText = flashcardData?.blurt?.text || "";
          flashcardBackContent.innerHTML = `
            <div class="instruction">Type your recall. When finished, submit to grade.</div>
            <textarea id="blurtInput" class="blurt-input" rows="6" placeholder="Write what you remember...">${escapeHtml(existingText)}</textarea>
            <button id="blurtSubmitBtn" class="memory-btn">Submit Recall</button>
          `;

          const input = flashcardBackContent.querySelector("#blurtInput");
          const submitBtn = flashcardBackContent.querySelector("#blurtSubmitBtn");
          if (input) {
            input.focus();
            input.addEventListener("input", () => {
              flashcardData.blurt = flashcardData.blurt || { submitted: false, text: "" };
              flashcardData.blurt.text = input.value;
            });
          }
          if (submitBtn) {
            submitBtn.addEventListener("click", () => {
              flashcardData.blurt = flashcardData.blurt || { submitted: false, text: "" };
              flashcardData.blurt.submitted = true;
              state.session.revealedAt = Date.now();
              renderUI();
            });
          }
        } else {
          // Show comparison
          const userText = flashcardData.blurt?.text || "";
          const targetText = back.targetContent || "";
          const isQuoteTarget = back.targetKind === "quote";
          const formattedTarget = isQuoteTarget
            ? `<div class="quote">${escapeHtml(targetText)}</div>            ${back.targetRecord?.meta?.tags?.includes("custom-deck") ? "" : `<div class="quote-meta">From: ${escapeHtml(back.targetRecord.section || "unknown source")}</div>`}`
            : `<div class="analysis">${formatAnalysisForDisplay(targetText)}</div>`;
          flashcardBackContent.innerHTML = `
            <div class="blurt-comparison">
              <div class="blurt-user-section">
                <div class="blurt-label">Your Recall:</div>
                <div class="blurt-text">${escapeHtml(userText) || '<i style="color:var(--text-muted)">Nothing entered</i>'}</div>
              </div>
              <div class="blurt-target-section">
                <div class="blurt-label">${isQuoteTarget ? "The Quote:" : "The Analysis:"}</div>
                <div class="blurt-text">${formattedTarget}</div>
              </div>
            </div>
            <div class="instruction">Grade your recall based on accuracy.</div>
          `;
        }
      } else if (back.isInstruction) {
        flashcardBackContent.innerHTML = `<div class="instruction">${escapeHtml(back.content || "")}</div>`;
      } else {
        flashcardBackContent.textContent = back.content || "";
      }
    } else {
      // Clear back content when not flipped to ensure no spoilers during animations
      flashcardBackContent.innerHTML = "";
    }

    // Update flip state
    if (flashcardElement && flashcardElement.classList) {
      flashcardElement.classList.toggle("flipped", state.isFlipped);
    }

    // Update navigation buttons
    const requiresGrade = !!flashcardData?.review?.required && !flashcardData.review.graded;
    const hasNextInHistory = state.currentIndex < state.flashcards.length - 1;
    const hasNextInHeap = !!state.session.heap && state.session.heap.size() > 0;

  }

  async function updateQuotePriority(quoteId, newPriority) {
    if (!quoteId || !addQuote) return;
    const quote = await getQuote(quoteId);
    if (!quote) return;

    quote.priority = clampNumber(newPriority, 1, 5);
    quote.updatedAt = Date.now();

    state.session.suppressDBChange++;
    await addQuote(quote);

    // Update the current card if it's the same quote
    const currentCard = state.flashcards[state.currentIndex];
    if (currentCard?.record?.id === quoteId) {
      currentCard.record.priority = quote.priority;
    }

    // Update toggle button text
    const priorityToggleBtn = document.getElementById("priorityToggle");
    if (priorityToggleBtn && currentCard?.record?.id === quoteId) {
      priorityToggleBtn.textContent = `Priority: ${"★".repeat(quote.priority)}${"☆".repeat(5 - quote.priority)}`;
    }

    renderUI();
    console.log(`Quote ${quoteId} priority updated to ${newPriority}`);
  }

  function formatAnalysisForDisplay(text) {
    return escapeHtml(text).replace(/\n/g, "<br>");
  }

  function renderEvidenceMatchingUI() {
    if (!evidencePrompt || !quoteOptions || !evidenceFeedback) return;
    if (!state.evidenceMatching.currentAnalysis) return;

    evidencePrompt.innerHTML = `<div class="analysis">${formatAnalysisForDisplay(state.evidenceMatching.currentAnalysis.analysis)}</div>`;

    quoteOptions.innerHTML = "";
    state.evidenceMatching.quoteOptions.forEach((quote, index) => {
      const isSelected = state.evidenceMatching.selectedOption === index;
      const isAnswered = state.evidenceMatching.answered;
      const isCorrect = state.evidenceMatching.correctOption?.includes(quote.id);

      let className = "quote-option";
      if (isSelected) className += " selected";
      if (isAnswered && isCorrect) className += " correct";
      if (isAnswered && isSelected && !isCorrect) className += " incorrect";

      const optionDiv = document.createElement("div");
      optionDiv.className = className;
      optionDiv.innerHTML = `
        <div class="quote-text">${escapeHtml(quote.quote)}</div>
        ${quote.section ? `<div class="quote-source">${escapeHtml(quote.section)}</div>` : ""}
      `;
      optionDiv.onclick = () => selectQuoteOption(index);
      quoteOptions.appendChild(optionDiv);
    });

    if (!state.evidenceMatching.answered) {
      evidenceFeedback.textContent = "";
      evidenceFeedback.className = "";
    }
  }

  function selectQuoteOption(index) {
    if (state.evidenceMatching.answered) return;
    state.evidenceMatching.selectedOption = index;
    renderEvidenceMatchingUI();
  }

  function checkEvidenceMatchingAnswer() {
    if (state.evidenceMatching.selectedOption === null || state.evidenceMatching.answered) return false;

    const selectedQuoteId = state.evidenceMatching.quoteOptions[state.evidenceMatching.selectedOption].id;
    const isCorrect = state.evidenceMatching.correctOption?.includes(selectedQuoteId) || false;
    state.evidenceMatching.answered = true;
    state.evidenceMatching.wasCorrect = isCorrect;

    if (evidenceFeedback) {
      if (isCorrect) {
        evidenceFeedback.textContent = "Correct! Press Next for another.";
        evidenceFeedback.className = "feedback-correct";
      } else {
        const correctQuote = state.evidenceMatching.quoteOptions.find(
          q => state.evidenceMatching.correctOption.includes(q.id)
        );
        evidenceFeedback.innerHTML = `Incorrect. The correct answer was:<br>"${escapeHtml(correctQuote?.quote || "")}"<br><br>Press Next for another.`;
        evidenceFeedback.className = "feedback-incorrect";
      }
    }

    state.stats.totalStudied++;
    if (isCorrect) {
      state.stats.correctAnswers++;
      state.stats.streak++;
      if (state.stats.streak > state.stats.bestStreak) {
        state.stats.bestStreak = state.stats.streak;
      }
    } else {
      state.stats.streak = 0;
    }

    return isCorrect;
  }

  function renderStats() {
    if (!statsContent) return;

    const nowMs = Date.now();
    const heapItems = state.session.heap?.items
      ? [...state.session.heap.items].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      : [];

    const gradeIcon = g => g === "easy" ? "🟢" : g === "kinda" ? "🟡" : g === "didnt_know" ? "🔴" : "⚪";
    const fmtInterval = ms => {
      if (!ms) return "–";
      const days = Math.round(ms / 86400000);
      return days < 1 ? "<1d" : `${days}d`;
    };
    const fmtDate = ms => ms ? new Date(ms).toLocaleDateString() : "never";
    const fmtPriority = p => typeof p === "number" ? p.toFixed(2) : "–";

    const cardLabel = (card) => {
      if (!card) return "?";
      if (card.type === "blurt") return (card.cue?.cue || "Blurt").substring(0, 60);
      if (card.type === "analysis-learning") return ((card.record?.analysis || "").replace(/[#*`]/g,"").trim().substring(0, 60) + "...");
      return ((card?.record?.quote || card?.front?.content || "?").substring(0, 60) + "...");
    };

    const renderCardRow = (card, priority, rank, isCurrent = false) => {
      const ms = card?.memoryState || {};
      const label = cardLabel(card);
      const due = ms.nextReview ? fmtDate(ms.nextReview) : "new";
      const grade = gradeIcon(ms.lastGrade);
      // Get quote priority if available
      const quotePriority = card?.record?.priority ?? card?.targetRecord?.priority ?? null;
      const priorityStars = quotePriority ? [1,2,3,4,5].map(v => v <= quotePriority ? "★" : "☆").join("") : null;

      return `
        <div class="heap-item${isCurrent ? " heap-item-current" : ""}">
          <div class="heap-item-rank">${isCurrent ? "▶" : `#${rank}`}</div>
          <div class="heap-item-body">
            <div class="heap-item-label">${escapeHtml(label)}${isCurrent ? " <span class=\"heap-current-tag\">on screen</span>" : ""}</div>
            <div class="heap-item-meta">
              <span title="Priority">⬆ ${fmtPriority(priority)}</span>
              ${priorityStars ? `<span title="Quote Priority" style="color:${getPriorityColor(quotePriority)};">${priorityStars}</span>` : ""}
              <span title="Next review">📅 ${due}</span>
              <span title="Interval">⏱ ${fmtInterval((ms.interval || 0) * 86400000)}</span>
              <span title="Last grade">${grade} ${ms.lastGrade || "new"}</span>
              <span title="Reviews">✓ ${ms.reviewCount || 0}x</span>
            </div>
          </div>
        </div>`;
    };

    const currentCard = state.flashcards[state.currentIndex];
    const currentQuotePriority = currentCard?.record?.priority ?? null;
    const currentPriority = currentCard ? computePriority(currentCard.memoryState || {}, nowMs, currentQuotePriority) : null;
    const currentCardHTML = currentCard
      ? renderCardRow(currentCard, currentPriority, 0, true)
      : "";

    // Priority distribution summary
    const allCards = [...state.flashcards, ...heapItems.map(i => i.card)];
    const priorityCounts = {1:0, 2:0, 3:0, 4:0, 5:0};
    let totalQuotes = 0;
    allCards.forEach(c => {
      const p = c?.record?.priority ?? c?.targetRecord?.priority ?? null;
      if (p !== null && p !== undefined) {
        priorityCounts[p] = (priorityCounts[p] || 0) + 1;
        totalQuotes++;
      }
    });

    const prioritySummary = totalQuotes > 0 ? `
      <div class="heap-section" style="margin-bottom: 12px;">
        <div class="heap-section-title">Priority Distribution</div>
        <div class="priority-distribution" style="display:flex; gap:8px; flex-wrap:wrap;">
          ${[1,2,3,4,5].map(p => `
            <div style="flex:1; min-width:40px; text-align:center; padding:6px; background:rgba(255,255,255,0.03); border-radius:8px; border:1px solid rgba(255,255,255,0.06);">
              <div style="font-size:0.65rem; color:var(--text-muted); margin-bottom:4px;">P${p}</div>
              <div style="font-size:1rem; font-weight:700; color:${getPriorityColor(p)};">${priorityCounts[p] || 0}</div>
            </div>
          `).join("")}
        </div>
      </div>
    ` : "";

    const heapHTML = heapItems.length === 0 && !currentCard
      ? `<div style="color:var(--text-muted);padding:12px 0;">Heap is empty — all cards are in history.</div>`
      : currentCardHTML + heapItems.map((item, i) => renderCardRow(item.card, item.priority, i + 1, false)).join("");

    statsContent.innerHTML = `
      <div class="stats-grid">
        <div class="stat-item"><span class="stat-label">Studied</span><span class="stat-value">${state.stats.totalStudied}</span></div>
        <div class="stat-item"><span class="stat-label">Correct</span><span class="stat-value">${state.stats.correctAnswers}</span></div>
        <div class="stat-item"><span class="stat-label">Streak</span><span class="stat-value">${state.stats.streak}</span></div>
        <div class="stat-item"><span class="stat-label">Best</span><span class="stat-value">${state.stats.bestStreak}</span></div>
        <div class="stat-item"><span class="stat-label">Accuracy</span><span class="stat-value">${state.stats.totalStudied > 0 ? Math.round((state.stats.correctAnswers / state.stats.totalStudied) * 100) : 0}%</span></div>
      </div>
      ${prioritySummary}
      <div class="heap-section">
        <div class="heap-section-title">Heap Queue (${heapItems.length} cards)</div>
        <div class="heap-list">${heapHTML}</div>
      </div>
    `;
  }

  // ─── System Thinking Panel ───────────────────────────────────────────────

  let _typewriterTimer = null;
  let _lastThoughtMsg = "";

  function generateSystemThought(manualGrade = null) {
    const lastGrade = manualGrade || state.session.lastGradeReaction;
    // Consume the grade reaction so it doesn't repeat on unrelated refreshes
    state.session.lastGradeReaction = null;

    const card = state.flashcards[state.currentIndex];
    const ms = card?.memoryState || {};
    const heapSize = (state.session.heap?.items?.length || 0);
    const reviewCount = ms.reviewCount || 0;
    const U = ms.U ?? 0.5;
    const S = ms.S ?? 1;
    const D = ms.D ?? 1;
    const interval = ms.interval || 0;
    const mode = state.currentMode;
    const isNew = reviewCount === 0;

    // Build a pool of contextual messages based on state
    const pool = [];

    // --- Post-grade reactions ---
    if (lastGrade === "easy") {
      pool.push("Strong recall. Stability increased — scheduling this further out.");
      pool.push("Memory trace consolidated. Interval extended based on response time.");
      pool.push(`Confidence rising. Next review in ~${Math.round(interval)} day${interval !== 1 ? "s" : ""}.`);
      if (U < 0.3) pool.push("Low uncertainty detected. This item is well anchored.");
    } else if (lastGrade === "kinda") {
      pool.push("Partial recall. Interval kept short to reinforce the trace.");
      pool.push("Uncertainty remains. This card will resurface sooner than average.");
      pool.push("Consolidation incomplete — scheduling a prompt review.");
    } else if (lastGrade === "didnt_know") {
      pool.push("Recall failed. Difficulty increased, stability reset. Prioritising this card.");
      pool.push("Memory gap detected. This item returns to the top of the queue.");
      pool.push("High uncertainty. Spaced repetition will retry this shortly.");
    }

    // --- Card state observations ---
    if (isNew) {
      pool.push("First encounter. Baseline memory state initialised.");
      pool.push("New item. No prior review data — using default SRS parameters.");
    } else if (reviewCount === 1) {
      pool.push("Second review. Building early stability from the first pass.");
    } else if (reviewCount >= 10) {
      pool.push(`Mature memory. ${reviewCount} reviews logged — long-term retention forming.`);
    } else if (reviewCount >= 5) {
      pool.push(`${reviewCount} reviews in. Stability trend is ${S > 2 ? "positive" : "developing"}.`);
    }

    // --- Uncertainty / difficulty insights ---
    if (U > 0.75) {
      pool.push("Uncertainty is high — this card has inconsistent recall patterns.");
    } else if (U < 0.2 && reviewCount > 3) {
      pool.push("Uncertainty is very low. This item is well-established in long-term memory.");
    }
    if (D > 3) {
      pool.push("Difficulty signal is elevated. This may need more frequent reinforcement.");
    } else if (D < 0.5 && reviewCount > 2) {
      pool.push("Low difficulty score. The algorithm is easing the schedule for this item.");
    }

    // --- Heap / session observations ---
    if (heapSize === 0 && state.flashcards.length > 0) {
      pool.push("Heap is empty — all items are in session history.");
    } else if (heapSize > 10) {
      pool.push(`${heapSize} items queued. Prioritising highest-urgency cards first.`);
    }
    if (state.stats.streak >= 5) {
      pool.push(`${state.stats.streak}-card streak. Recall quality is strong this session.`);
    }
    if (state.stats.totalStudied > 0 && state.stats.correctAnswers / state.stats.totalStudied < 0.4) {
      pool.push("Session accuracy is low. Consider shorter intervals or a review break.");
    }

    // --- Mode-specific ---
    if (mode === "blurt") {
      pool.push("Blurt mode active. Free recall is the strongest consolidation method.");
      pool.push("Active retrieval engaged — the effort itself strengthens the memory trace.");
    } else if (mode === "evidence-matching") {
      pool.push("Evidence matching active. Testing associative linkage between ideas.");
    } else if (mode === "analysis-learning") {
      pool.push("Analysis mode. Tracking conceptual memory separate from quote recall.");
    }

    // --- Fallback ---
    if (pool.length === 0) {
      pool.push("Monitoring memory state. Heap sorted by urgency score.");
      pool.push("SRS algorithm running. Cards scheduled by stability and difficulty.");
    }

    // Pick randomly, avoid repeating the last message
    let candidates = pool.filter(m => m !== _lastThoughtMsg);
    if (candidates.length === 0) candidates = pool;
    let msg = candidates[Math.floor(Math.random() * candidates.length)];

    // If we had a grade reaction, potentially combine it with an observation for a 'smart' synthesis
    if (lastGrade && pool.length > 1) {
      const observation = pool.filter(m => !m.includes("recall") && !m.includes("Grade") && !m.includes("Trace") && !m.includes("Stability"))[0];
      if (observation && Math.random() > 0.5) {
        msg = `${msg} ${observation}`;
      }
    }

    _lastThoughtMsg = msg;
    return msg;
  }

  function typewriteThought(text) {
    if (!systemThinkingText) return;
    clearTimeout(_typewriterTimer);
    systemThinkingText.innerHTML = '<span class="cursor"></span>';
    let i = 0;
    const cursor = systemThinkingText.querySelector(".cursor");

    const tick = () => {
      if (i >= text.length) {
        if (cursor) cursor.remove();
        systemThinkingText.innerHTML = text;
        return;
      }
      const chunk = text.slice(0, i + 1);
      systemThinkingText.innerHTML = `${chunk}<span class="cursor"></span>`;
      i++;
      // Faster, 'alien' speed
      const delay = 5 + Math.random() * 8;
      _typewriterTimer = setTimeout(tick, delay);
    };
    tick();
  }

  function updateSystemThought(lastGrade = null) {
    const thought = generateSystemThought(lastGrade);
    typewriteThought(thought);

    // Trigger reactive background canvas impulses
    if (window.__neuronetCanvas) {
      // Update background "buzz" based on streak - brain on fire!
      const baseBuzz = 0.004;
      const streakIntensity = (state.stats.streak || 0) * 0.0015;
      window.__neuronetCanvas.setBuzz(Math.min(baseBuzz + streakIntensity, 0.04));

      if (lastGrade === "easy") {
        const streakBonus = Math.min((state.stats.streak || 0) * 0.2, 2.0);
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;

        // Choose ONE prominent impulse type appropriately
        if (state.stats.streak > 0 && state.stats.streak % 5 === 0) {
          // Milestone reward
          window.__neuronetCanvas.triggerVerticalWave(1.8 + streakBonus);
        } else if (Math.random() > 0.5) {
          window.__neuronetCanvas.triggerRadialPulse(cx, cy, 2.2 + streakBonus);
        } else {
          window.__neuronetCanvas.triggerSweep(1.4 + streakBonus);
        }
      } else if (lastGrade === "didnt_know") {
        // Failed recall - "confused" random node firings
        window.__neuronetCanvas.triggerRandomNodes(15, 0.7);
        // Reset buzz on mistake
        window.__neuronetCanvas.setBuzz(baseBuzz);
      } else if (lastGrade === "kinda") {
        // In-between - radial pulse from center
        window.__neuronetCanvas.triggerRadialPulse(window.innerWidth / 2, window.innerHeight / 2, 1.3);
      } else if (lastGrade === null) {
        // General observation / new card - subtle random nodes
        window.__neuronetCanvas.triggerRandomNodes(3, 0.4);
      }
    }
  }

  // ========== DECK BUILDER FUNCTIONS ==========

  function openDeckBuilder() {
    resetDeckBuilderState();
    if (builderTitle) builderTitle.textContent = "Create New Deck";
    if (deckBuilderModal) deckBuilderModal.style.display = "flex";
    showDeckBuilderStep(1);
  }

  async function openDeckEditor(subject) {
    resetDeckBuilderState();
    if (builderTitle) builderTitle.textContent = "Edit Deck";

    deckBuilderState.deckName = subject;
    deckBuilderState.editingSubject = subject;

    if (deckNameInput) deckNameInput.value = subject;

    const quotes = await getQuotesForSubject(subject) || [];
    const cues = await getCuesForSubject(subject) || [];

    for (const quote of quotes) {
      const cardCues = cues.filter(c => c.quoteId === quote.id);
      const cue = cardCues.length > 0 ? cardCues[0] : null;

      // Get layer info from quote's hierarchyPath, convert to layers array
      const path = quote.meta?.hierarchyPath || [];
      const layers = path.filter(Boolean).slice(1, 4); // layers only (skip subject at index 0)

      deckBuilderState.cards.push({
        cueId: cue ? cue.id : crypto.randomUUID(),
        cueFront: cue ? cue.cue : "",
        quoteId: quote.id,
        quoteBack: quote.quote,
        priority: quote.priority || 3,
        layers,
        isExisting: true
      });
    }

    renderFlashcardList();
    if (finishDeckBtn) finishDeckBtn.textContent = "Save Changes";
    if (deckBuilderModal) deckBuilderModal.style.display = "flex";
    showDeckBuilderStep(2);
  }

  function closeDeckBuilder() {
    if (deckBuilderModal) deckBuilderModal.style.display = "none";
    resetDeckBuilderState();
  }

  function resetDeckBuilderState() {
    deckBuilderState.cards = [];
    deckBuilderState.deckName = "";
    deckBuilderState.deckDescription = "";
    deckBuilderState.currentCardIndex = -1;
    deckBuilderState.isEditingCard = false;
    deckBuilderState.editingSubject = null;
    deckBuilderState.deletedCardIds = [];
    deckBuilderState.layerPillState = {
      selectedLayers: []
    };
    if (deckNameInput) deckNameInput.value = "";
    if (deckDescriptionInput) deckDescriptionInput.value = "";
    if (finishDeckBtn) finishDeckBtn.textContent = "Finish Deck";
  }

  function showDeckBuilderStep(step) {
    if (step1DeckInfo) step1DeckInfo.style.display = step === 1 ? "block" : "none";
    if (step2Flashcards) {
      step2Flashcards.style.display = step === 2 ? "flex" : "none";
      if (step === 2) {
        step2Flashcards.style.flexDirection = "column";
        step2Flashcards.style.minHeight = "0";
        // Ensure deck-builder-body is row layout
        const body = step2Flashcards.querySelector(".deck-builder-body");
        if (body) body.style.flexDirection = "row";
      }
    }
    if (step3Success) step3Success.style.display = step === 3 ? "block" : "none";
    // Reset form on step 2
    if (step === 2) {
      deckBuilderState.layerPillState.selectedLayers = [];
      renderPriorityPills();
      renderLayerRows();
      setupNewLayerButtons();
      clearForm();
    }
  }

  function renderPriorityPills() {
    if (!priorityPills) return;
    const labels = ["Very Low", "Low", "Medium", "High", "Very High"];
    priorityPills.innerHTML = labels.map((label, i) => {
      const p = i + 1;
      const color = getPriorityColor(p);
      const isActive = p === 3; // Default to Medium
      return `<button type="button" class="priority-pill ${isActive ? 'active' : ''}"
        data-priority="${p}"
        style="color: ${isActive ? color : 'var(--text-muted)'}; border-color: ${isActive ? color : 'rgba(255,255,255,0.15)'};"
        title="Set priority to ${label}">${label}</button>`;
    }).join("");

    priorityPills.querySelectorAll(".priority-pill").forEach(btn => {
      btn.addEventListener("click", () => {
        priorityPills.querySelectorAll(".priority-pill").forEach(b => {
          const p = parseInt(b.dataset.priority);
          b.classList.remove("active");
          b.style.color = "var(--text-muted)";
          b.style.borderColor = "rgba(255,255,255,0.15)";
        });
        btn.classList.add("active");
        const p = parseInt(btn.dataset.priority);
        btn.style.color = getPriorityColor(p);
        btn.style.borderColor = getPriorityColor(p);
      });
    });
  }

  // ========== LAYER ROWS SYSTEM ==========

  function renderLayerRows() {
    renderLayerRow(1);
    renderLayerRow(2);
    renderLayerRow(3);
    updateLayerRowStates();
  }

  function getLayersForLevel(level) {
    // L1: all unique L1 names from all cards
    // L2: L2 names only if L1 is selected
    // L3: L3 names only if L1 and L2 are selected
    const cards = deckBuilderState.cards;
    const selected = deckBuilderState.layerPillState.selectedLayers; // [l1, l2, l3] (may be shorter)

    if (level === 1) {
      const set = new Set();
      cards.forEach(c => { if (c.layers && c.layers[0]) set.add(c.layers[0]); });
      // Include currently selected L1 even if not in any card yet
      if (selected[0]) set.add(selected[0]);
      return Array.from(set).sort();
    }

    if (level === 2) {
      const l1 = selected[0];
      if (!l1) return [];
      const set = new Set();
      cards.forEach(c => {
        if (c.layers && c.layers[0] === l1 && c.layers[1]) set.add(c.layers[1]);
      });
      if (selected[1]) set.add(selected[1]);
      return Array.from(set).sort();
    }

    if (level === 3) {
      const l1 = selected[0];
      const l2 = selected[1];
      if (!l1 || !l2) return [];
      const set = new Set();
      cards.forEach(c => {
        if (c.layers && c.layers[0] === l1 && c.layers[1] === l2 && c.layers[2]) {
          set.add(c.layers[2]);
        }
      });
      if (selected[2]) set.add(selected[2]);
      return Array.from(set).sort();
    }

    return [];
  }

  function renderLayerRow(level) {
    const container = document.getElementById(`layer${level}Pills`);
    if (!container) return;

    const layers = getLayersForLevel(level);
    const selected = deckBuilderState.layerPillState.selectedLayers;
    const selectedForLevel = selected[level - 1] || null;

    let html = layers.map(name => {
      const isActive = name === selectedForLevel;
      return `<button type="button" class="layer-pill ${isActive ? 'active' : ''}" data-level="${level}" data-layer="${escapeHtml(name)}">${escapeHtml(name)}</button>`;
    }).join("");

    container.innerHTML = html;

    // Attach click events
    container.querySelectorAll(".layer-pill").forEach(btn => {
      btn.addEventListener("click", () => {
        selectLayerPill(parseInt(btn.dataset.level), btn.dataset.layer);
      });
    });
  }

  function selectLayerPill(level, layerName) {
    const selected = deckBuilderState.layerPillState.selectedLayers;
    // Pad array to length (level-1) with undefined
    while (selected.length < level - 1) selected.push(undefined);
    const current = selected[level - 1];

    if (current === layerName) {
      // Deselect this level and all levels below
      selected.splice(level - 1);
    } else {
      // Set this level, clear all below
      selected[level - 1] = layerName;
      selected.length = level; // truncate anything below
    }

    renderLayerRows();
  }

  function updateLayerRowStates() {
    const selected = deckBuilderState.layerPillState.selectedLayers;
    const l1Row = document.getElementById("layer1Row");
    const l2Row = document.getElementById("layer2Row");
    const l3Row = document.getElementById("layer3Row");
    const l2Btn = document.querySelector('#layer2Row .layer-new-pill');
    const l3Btn = document.querySelector('#layer3Row .layer-new-pill');

    // L1 always enabled
    if (l1Row) l1Row.classList.remove("disabled");

    // L2 enabled only if L1 selected
    if (l2Row) {
      if (selected[0]) {
        l2Row.classList.remove("disabled");
        if (l2Btn) l2Btn.disabled = false;
      } else {
        l2Row.classList.add("disabled");
        if (l2Btn) l2Btn.disabled = true;
      }
    }

    // L3 enabled only if L1 and L2 selected
    if (l3Row) {
      if (selected[0] && selected[1]) {
        l3Row.classList.remove("disabled");
        if (l3Btn) l3Btn.disabled = false;
      } else {
        l3Row.classList.add("disabled");
        if (l3Btn) l3Btn.disabled = true;
      }
    }
  }

  function setupNewLayerButtons() {
    document.querySelectorAll(".layer-new-pill").forEach(btn => {
      btn.addEventListener("click", () => {
        const level = parseInt(btn.dataset.level);
        const row = btn.closest(".layer-row");
        if (row && row.classList.contains("disabled")) return;
        showNewLayerInput(level);
      });
    });
  }

  function showNewLayerInput(level) {
    const container = document.getElementById(`layer${level}Pills`);
    const newBtn = document.querySelector(`#layer${level}Row .layer-new-pill`);
    if (!container || !newBtn) return;

    const existingInput = document.getElementById(`newLayerInput${level}`);
    if (existingInput) return; // already open

    const wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.gap = "6px";
    wrapper.id = `newLayerWrapper${level}`;

    wrapper.innerHTML = `
      <input type="text" id="newLayerInput${level}" class="layer-input-inline" placeholder="Layer name...">
      <button type="button" id="confirmLayerBtn${level}" class="layer-confirm-btn">Add</button>
    `;

    newBtn.style.display = "none";
    container.parentNode.insertBefore(wrapper, container.nextSibling);

    const input = document.getElementById(`newLayerInput${level}`);
    const confirmBtn = document.getElementById(`confirmLayerBtn${level}`);

    if (input) {
      input.focus();
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          confirmNewLayer(level);
        }
        if (e.key === "Escape") {
          cancelNewLayer(level);
        }
      });
    }

    if (confirmBtn) {
      confirmBtn.addEventListener("click", () => confirmNewLayer(level));
    }
  }

  function confirmNewLayer(level) {
    const input = document.getElementById(`newLayerInput${level}`);
    if (!input) return;
    const newLayer = input.value.trim();
    if (!newLayer) return;

    // Select it directly — it will appear in the row via getLayersForLevel
    // since getLayersForLevel scans cards, we just need to set selected state
    const selected = deckBuilderState.layerPillState.selectedLayers;
    while (selected.length < level - 1) selected.push(undefined);
    selected[level - 1] = newLayer;
    selected.length = level;

    cancelNewLayer(level);
    renderLayerRows();
  }

  function cancelNewLayer(level) {
    const wrapper = document.getElementById(`newLayerWrapper${level}`);
    const newBtn = document.querySelector(`#layer${level}Row .layer-new-pill`);
    if (wrapper) wrapper.remove();
    if (newBtn) newBtn.style.display = "";
  }

  function startEditingCard(index) {
    deckBuilderState.currentCardIndex = index;
    deckBuilderState.isEditingCard = true;

    // Show form, hide import view
    const importView = document.getElementById("importView");
    const cardEditForm = document.getElementById("cardEditForm");
    if (importView) importView.style.display = "none";
    if (cardEditForm) cardEditForm.style.display = "block";

    if (index >= 0 && index < deckBuilderState.cards.length) {
      const card = deckBuilderState.cards[index];
      if (cueInput) cueInput.value = card.cueFront;
      if (quoteInput) quoteInput.value = card.quoteBack;
      // Set priority pill
      if (priorityPills) {
        priorityPills.querySelectorAll(".priority-pill").forEach(b => {
          const p = parseInt(b.dataset.priority);
          const isActive = p === card.priority;
          b.classList.toggle("active", isActive);
          b.style.color = isActive ? getPriorityColor(p) : "var(--text-muted)";
          b.style.borderColor = isActive ? getPriorityColor(p) : "rgba(255,255,255,0.15)";
        });
      }
      // Set layer rows state: populate selectedLayers from card.layers
      deckBuilderState.layerPillState.selectedLayers = [...(card.layers || [])];
      renderLayerRows();
      // Show delete button
      if (deleteCardBtn) deleteCardBtn.style.display = "inline-block";
      // Update form title
      const formTitle = document.getElementById("formTitle");
      if (formTitle) formTitle.textContent = "Edit Card";
    } else {
      // New card
      if (cueInput) cueInput.value = "";
      if (quoteInput) quoteInput.value = "";
      deckBuilderState.layerPillState.selectedLayers = [];
      renderLayerRows();
      if (deleteCardBtn) deleteCardBtn.style.display = "none";
      // Reset priority to default (Medium)
      if (priorityPills) {
        priorityPills.querySelectorAll(".priority-pill").forEach(b => {
          const p = parseInt(b.dataset.priority);
          const isActive = p === 3;
          b.classList.toggle("active", isActive);
          b.style.color = isActive ? getPriorityColor(p) : "var(--text-muted)";
          b.style.borderColor = isActive ? getPriorityColor(p) : "rgba(255,255,255,0.15)";
        });
      }
      // Update form title
      const formTitle = document.getElementById("formTitle");
      if (formTitle) formTitle.textContent = "Add New Card";
    }

    if (cueInput) cueInput.focus();

    // Update save button state
    if (saveCardBtn && cueInput && quoteInput) {
      const hasContent = cueInput.value.trim() && quoteInput.value.trim();
      saveCardBtn.disabled = !hasContent;
      saveCardBtn.style.opacity = hasContent ? "1" : "0.4";
      saveCardBtn.style.pointerEvents = hasContent ? "auto" : "none";
    }
  }

  function finishEditingCard() {
    deckBuilderState.isEditingCard = false;
    deckBuilderState.currentCardIndex = -1;
    clearForm();
    renderFlashcardList();
  }

  function clearForm() {
    if (cueInput) cueInput.value = "";
    if (quoteInput) quoteInput.value = "";
    // Reset layer rows
    deckBuilderState.layerPillState.selectedLayers = [];
    renderLayerRows();
    // Reset priority to default (Medium)
    if (priorityPills) {
      priorityPills.querySelectorAll(".priority-pill").forEach(b => {
        const p = parseInt(b.dataset.priority);
        const isActive = p === 3;
        b.classList.toggle("active", isActive);
        b.style.color = isActive ? getPriorityColor(p) : "var(--text-muted)";
        b.style.borderColor = isActive ? getPriorityColor(p) : "rgba(255,255,255,0.15)";
      });
    }
    if (deleteCardBtn) deleteCardBtn.style.display = "none";
    // Update form title
    const formTitle = document.getElementById("formTitle");
    if (formTitle) formTitle.textContent = "Add New Card";
    // Update save button state
    if (saveCardBtn) {
      saveCardBtn.disabled = true;
      saveCardBtn.style.opacity = "0.4";
      saveCardBtn.style.pointerEvents = "none";
    }
  }

  function saveFlashcard(cueFront, quoteBack, priority) {
    // Build layers array from selectedLayers, filtering out undefined
    const layers = deckBuilderState.layerPillState.selectedLayers
      .filter(Boolean)
      .map(s => s.trim())
      .filter(Boolean);
    const card = {
      cueId: crypto.randomUUID(),
      cueFront,
      quoteId: crypto.randomUUID(),
      quoteBack,
      priority,
      layers, // array of up to 3 layer names [l1, l2, l3]
      isExisting: false
    };

    if (deckBuilderState.currentCardIndex >= 0) {
      // Update existing card
      deckBuilderState.cards[deckBuilderState.currentCardIndex] = {
        ...deckBuilderState.cards[deckBuilderState.currentCardIndex],
        ...card,
        isExisting: deckBuilderState.cards[deckBuilderState.currentCardIndex].isExisting
      };
    } else {
      // Add new card
      deckBuilderState.cards.push(card);
    }

    finishEditingCard();
    // Update card count
    if (cardCount) cardCount.textContent = deckBuilderState.cards.length;
    // After save: clear inputs and focus cue
    if (cueInput) cueInput.focus();
  }

  function deleteFlashcard(index) {
    if (index >= 0 && index < deckBuilderState.cards.length) {
      const card = deckBuilderState.cards[index];
      if (card.isExisting) {
        deckBuilderState.deletedCardIds.push({ quoteId: card.quoteId, cueId: card.cueId });
      }
      deckBuilderState.cards.splice(index, 1);
      renderFlashcardList();
    }
  }

  function renderFlashcardList() {
    if (!flashcardList) return;

    // Update card count
    if (cardCount) cardCount.textContent = deckBuilderState.cards.length;

    // Filter cards based on selected layer filters
    const filters = deckBuilderState.layerPillState.selectedLayers.filter(Boolean);
    const filteredCards = filters.length === 0 ? deckBuilderState.cards : deckBuilderState.cards.filter(card => {
      for (let i = 0; i < filters.length; i++) {
        if (!card.layers || card.layers[i] !== filters[i]) return false;
      }
      return true;
    });

    flashcardList.innerHTML = "";

    filteredCards.forEach((card, filteredIndex) => {
      // Find the real index in the full cards array
      const realIndex = deckBuilderState.cards.indexOf(card);

      const item = document.createElement("div");
      item.className = "flashcard-item";
      if (realIndex === deckBuilderState.currentCardIndex) {
        item.classList.add("active");
      }

      const title = document.createElement("div");
      title.className = "flashcard-item-title";
      title.textContent = `${realIndex + 1}. ${(card.cueFront || "").substring(0, 50)}`;

      // Show layers as subtle text below title
      if (card.layers && card.layers.length > 0) {
        const layersDiv = document.createElement("div");
        layersDiv.className = "flashcard-item-layers";
        layersDiv.textContent = card.layers.join(" > ");
        title.appendChild(document.createElement("br"));
        title.appendChild(layersDiv);
      }

      const actions = document.createElement("div");
      actions.className = "flashcard-item-actions";

      const editBtn = document.createElement("button");
      editBtn.className = "flashcard-item-btn";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        startEditingCard(realIndex);
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "flashcard-item-btn";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteFlashcard(realIndex);
      });

      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);

      item.appendChild(title);
      item.appendChild(actions);
      flashcardList.appendChild(item);
    });

    // Show filter indicator
    if (filters.length > 0) {
      const indicator = document.createElement("div");
      indicator.className = "flashcard-item-layers";
      indicator.style.padding = "8px 12px";
      indicator.style.fontStyle = "italic";
      indicator.textContent = `Filtering by: ${filters.join(" > ")} (${filteredCards.length} of ${deckBuilderState.cards.length})`;
      flashcardList.prepend(indicator);
    }
  }

  async function saveDeckToDB() {
    if (!deckBuilderState.deckName) {
      alert("Deck name is required");
      return;
    }

    if (deckBuilderState.cards.length === 0) {
      alert("Add at least one card to the deck");
      return;
    }

     try {
        const subjectName = deckBuilderState.deckName;
        const isEditing = !!deckBuilderState.editingSubject;

        // Handle subject rename
        if (isEditing && deckBuilderState.editingSubject !== subjectName) {
          await renameSubject(deckBuilderState.editingSubject, subjectName);
        }

        // Delete removed cards
        for (const deleted of deckBuilderState.deletedCardIds) {
          await deleteCue(deleted.cueId);
          await deleteQuote(deleted.quoteId);
        }

        // Save all cards (update existing, add new)
        for (const card of deckBuilderState.cards) {
           // Build hierarchyPath from layers array [l1, l2, l3]
          const hierarchyPath = [
            subjectName,
            ...(card.layers || [])
          ].filter(Boolean);

          const quote = {
            id: card.quoteId,
            type: "quote",
            subject: subjectName,
            quote: card.quoteBack,
            title: subjectName,
            priority: card.priority,
            meta: {
              tags: ["custom-deck"],
              hierarchyPath: hierarchyPath,
              confidence: 0.8,
              nextReview: Date.now(),
              interval: 1,
              ease: 2.5,
              repetitions: 0
            }
          };
          await addQuote(quote);

          const cue = {
            id: card.cueId,
            subject: subjectName,
            quoteId: card.quoteId,
            cue: card.cueFront,
            priority: card.priority,
            type: "cue",
            createdAt: card.isExisting ? (await getCue(card.cueId))?.createdAt || Date.now() : Date.now(),
            updatedAt: Date.now(),
            meta: {
              nextReview: Date.now(),
              interval: 1,
              ease: 2.5,
              repetitions: 0
            }
          };
          await addCue(cue);
        }

       // Show success screen (or close modal if editing)
       if (isEditing) {
         closeDeckBuilder();
         state.editMode = false;
         if (editDecksBtn) editDecksBtn.classList.remove("active");
       } else {
         if (deckNameDisplay) deckNameDisplay.textContent = deckBuilderState.deckName;
         if (cardCountDisplay) cardCountDisplay.textContent = deckBuilderState.cards.length;
         showDeckBuilderStep(3);
       }

       await loadLaunchpad();
       renderUI();

      } catch (error) {
        console.error("Error saving deck:", error);
        alert("Error saving deck: " + error.message);
      }
   }

  // ========== ANKI IMPORT ==========

  function processAnkiImport() {
    if (!ankiImportInput || !importFeedback) return;

    const text = ankiImportInput.value.trim();
    if (!text) {
      importFeedback.textContent = "Please paste some cards first.";
      importFeedback.style.color = "#ff4d4d";
      return;
    }

    const lines = text.split("\n");
    let imported = 0;
    let skipped = 0;

    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const tabIndex = trimmed.indexOf("\t");
      if (tabIndex === -1) {
        skipped++;
        return;
      }

      const front = trimmed.substring(0, tabIndex).trim();
      const back = trimmed.substring(tabIndex + 1).trim();

      if (!front || !back) {
        skipped++;
        return;
      }

        deckBuilderState.cards.push({
          cueId: crypto.randomUUID(),
          cueFront: front,
          quoteId: crypto.randomUUID(),
          quoteBack: back,
          priority: 3, // Default to Medium
          layers: [], // populated via layer rows after import
          isExisting: false
        });

      imported++;
    });

    // Clear import area
    ankiImportInput.value = "";

    // Switch back to card form
    const importView = document.getElementById("importView");
    const cardEditForm = document.getElementById("cardEditForm");
    if (importView) importView.style.display = "none";
    if (cardEditForm) cardEditForm.style.display = "block";

    // Update UI
    renderFlashcardList();
    clearForm();

    importFeedback.textContent = `${imported} cards imported${skipped > 0 ? `, ${skipped} lines skipped (no tab separator)` : ''}.`;
    importFeedback.style.color = "#3fd07d";
  }

  // ========== MIDDLE UI FUNCTIONS ==========

  async function loadMiddleUIData() {
    if (!state.currentSubject) return;

    // Get all quotes and analyses for this subject
    const [quotes, analyses, allCues] = await Promise.all([
      getQuotesForSubject(state.currentSubject),
      getAnalysisNodesForSubject(state.currentSubject),
      getAllCues()
    ]);

    // Priority counts
    const priorityCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let totalWithPriority = 0;
    (quotes || []).forEach(q => {
      if (q.priority !== undefined && q.priority !== null) {
        priorityCounts[q.priority] = (priorityCounts[q.priority] || 0) + 1;
        totalWithPriority++;
      }
    });

    // Tags - collect from quotes and analyses
    const tagSet = new Set();
    (quotes || []).forEach(q => {
      (q.meta?.tags || []).forEach(t => tagSet.add(t));
    });
    (analyses || []).forEach(a => {
      (a.tags || []).forEach(t => tagSet.add(t));
    });
    const tags = Array.from(tagSet).sort().map(tag => {
      // Count items with this tag
      const quoteCount = (quotes || []).filter(q => (q.meta?.tags || []).includes(tag)).length;
      const analysisCount = (analyses || []).filter(a => (a.tags || []).includes(tag)).length;
      return { name: tag, count: quoteCount + analysisCount };
    });

    // Layers - collect from quotes' hierarchyPath
    const layerMap = new Map(); // layer1 -> { count, children: Map(layer2 -> { count, children: Map(layer3 -> count) }) }

    (quotes || []).forEach(q => {
      const path = q.meta?.hierarchyPath || [];
      const l1 = path[1] || "(None)";
      const l2 = path[2] || "";
      const l3 = path[3] || "";

      if (!layerMap.has(l1)) {
        layerMap.set(l1, { count: 0, children: new Map() });
      }
      const l1Entry = layerMap.get(l1);
      l1Entry.count++;

      if (l2) {
        if (!l1Entry.children.has(l2)) {
          l1Entry.children.set(l2, { count: 0, children: new Map() });
        }
        const l2Entry = l1Entry.children.get(l2);
        l2Entry.count++;

        if (l3) {
          l2Entry.children.set(l3, (l2Entry.children.get(l3) || 0) + 1);
        }
      }
    });

    // Also add sources as leaf nodes
    // We need to get sources for this subject
    // For now, we'll use the layer structure from quotes

    state.middleUIData = {
      priorities: [1, 2, 3, 4, 5].map(p => ({ value: p, count: priorityCounts[p] })),
      tags,
      layers: Array.from(layerMap.entries()).map(([name, data]) => ({
        name,
        count: data.count,
        children: Array.from(data.children.entries()).map(([l2name, l2data]) => ({
          name: l2name,
          count: l2data.count,
          children: Array.from(l2data.children.entries()).map(([l3name, l3count]) => ({
            name: l3name,
            count: l3count
          }))
        }))
      }))
    };
  }

  function renderMiddleUI() {
    if (!middleSubjectName) return;

    middleSubjectName.textContent = state.currentSubject;

    // Render priority checkboxes
    if (priorityCheckboxes) {
      priorityCheckboxes.innerHTML = state.middleUIData.priorities.map(p => `
        <div class="filter-row ${state.selectedPriorities.includes(p.value) ? 'selected' : ''}" data-priority="${p.value}">
          <input type="checkbox" class="filter-row-checkbox" ${state.selectedPriorities.includes(p.value) ? 'checked' : ''}>
          <span class="filter-row-label" style="color: ${getPriorityColor(p.value)};">${['Very Low', 'Low', 'Medium', 'High', 'Very High'][p.value - 1]}</span>
          <span class="filter-row-count">${p.count}</span>
        </div>
      `).join("");

      priorityCheckboxes.querySelectorAll(".filter-row").forEach(row => {
        row.addEventListener("click", (e) => {
          if (e.target.tagName === "INPUT") return;
          const priority = parseInt(row.dataset.priority);
          togglePriority(priority);
        });
        const checkbox = row.querySelector("input");
        if (checkbox) {
          checkbox.addEventListener("change", () => {
            const priority = parseInt(row.dataset.priority);
            togglePriority(priority);
          });
        }
      });
    }

    // Render tag checkboxes
    if (tagsCheckboxes) {
      tagsCheckboxes.innerHTML = state.middleUIData.tags.length > 0
        ? state.middleUIData.tags.map(tag => `
          <div class="filter-row ${state.selectedTags.includes(tag.name) ? 'selected' : ''}" data-tag="${tag.name}">
            <input type="checkbox" class="filter-row-checkbox" ${state.selectedTags.includes(tag.name) ? 'checked' : ''}>
            <span class="filter-row-label">${escapeHtml(tag.name)}</span>
            <span class="filter-row-count">${tag.count}</span>
            <button class="filter-row-study-btn" data-tag="${tag.name}">Study</button>
          </div>
        `).join("")
        : '<div style="color: var(--text-muted); font-size: 0.85rem;">No tags found in this subject.</div>';

      tagsCheckboxes.querySelectorAll(".filter-row").forEach(row => {
        row.addEventListener("click", (e) => {
          if (e.target.tagName === "INPUT" || e.target.classList.contains("filter-row-study-btn")) return;
          const tag = row.dataset.tag;
          toggleTag(tag);
        });
        const checkbox = row.querySelector("input");
        if (checkbox) {
          checkbox.addEventListener("change", () => {
            const tag = row.dataset.tag;
            toggleTag(tag);
          });
        }
        const studyBtn = row.querySelector(".filter-row-study-btn");
        if (studyBtn) {
          studyBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const tag = studyBtn.dataset.tag;
            state.sessionFilter = {
              mode: state.currentMode,
              filterMode: state.filterMode,
              priorities: [...state.selectedPriorities],
              tags: [tag],
              layers: [...state.selectedLayers]
            };
            state.view = "study";
            loadFlashcards().then(renderUI);
          });
        }
      });
    }

    // Render layer checkboxes (tree structure)
    if (layersCheckboxes) {
      layersCheckboxes.innerHTML = state.middleUIData.layers.length > 0
        ? state.middleUIData.layers.map(layer => renderLayerTree(layer, 0)).join("")
        : '<div style="color: var(--text-muted); font-size: 0.85rem;">No layers found in this subject.</div>';

      // Attach event listeners to all layer rows
      layersCheckboxes.querySelectorAll(".filter-row").forEach(row => {
        row.addEventListener("click", (e) => {
          if (e.target.tagName === "INPUT" || e.target.classList.contains("filter-row-study-btn")) return;
          const layer = row.dataset.layer;
          if (layer) toggleLayer(layer);
        });
        const checkbox = row.querySelector("input");
        if (checkbox) {
          checkbox.addEventListener("change", () => {
            const layer = row.dataset.layer;
            if (layer) toggleLayer(layer);
          });
        }
        const studyBtn = row.querySelector(".filter-row-study-btn");
        if (studyBtn) {
          studyBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const layer = studyBtn.dataset.layer;
            state.sessionFilter = {
              mode: state.currentMode,
              filterMode: state.filterMode,
              priorities: [...state.selectedPriorities],
              tags: [...state.selectedTags],
              layers: layer ? [layer] : []
            };
            state.view = "study";
            loadFlashcards().then(renderUI);
          });
        }
      });
    }
  }

  function renderLayerTree(layer, depth) {
    const isSelected = state.selectedLayers.includes(layer.name);
    let html = `
      <div class="filter-row ${isSelected ? 'selected' : ''}" data-layer="${layer.name}" style="margin-left: ${depth * 20}px;">
        <input type="checkbox" class="filter-row-checkbox" ${isSelected ? 'checked' : ''}>
        <span class="filter-row-label">${escapeHtml(layer.name)}</span>
        <span class="filter-row-count">${layer.count}</span>
        <button class="filter-row-study-btn" data-layer="${layer.name}">Study</button>
      </div>
    `;

    if (layer.children && layer.children.length > 0) {
      html += '<div class="layer-tree">';
      layer.children.forEach(child => {
        html += renderLayerTree(child, depth + 1);
      });
      html += '</div>';
    }

    return html;
  }

  function togglePriority(priority) {
    const index = state.selectedPriorities.indexOf(priority);
    if (index === -1) {
      state.selectedPriorities.push(priority);
    } else {
      state.selectedPriorities.splice(index, 1);
    }
    renderMiddleUI();
  }

  function toggleTag(tag) {
    const index = state.selectedTags.indexOf(tag);
    if (index === -1) {
      state.selectedTags.push(tag);
    } else {
      state.selectedTags.splice(index, 1);
    }
    renderMiddleUI();
  }

  function toggleLayer(layer) {
    const index = state.selectedLayers.indexOf(layer);
    if (index === -1) {
      state.selectedLayers.push(layer);
    } else {
      state.selectedLayers.splice(index, 1);
    }
    renderMiddleUI();
  }

  function passesFilter(card, filter) {
    const isAND = filter.filterMode === "AND";

    // Priority check
    if (filter.priorities.length > 0) {
      const cardPriority = card.record?.priority ?? card.targetRecord?.priority;
      const priorityMatch = filter.priorities.includes(cardPriority);
      if (isAND && !priorityMatch) return false;
      if (!isAND && priorityMatch) return true;
      if (!isAND && !priorityMatch) { /* continue checking other filters */ }
    }

    // Tag check
    if (filter.tags.length > 0) {
      const cardTags = card.record?.meta?.tags || card.record?.tags || [];
      const hasTag = filter.tags.some(t => cardTags.includes(t));
      if (isAND && !hasTag) return false;
      if (!isAND && hasTag) return true;
    }

    // Layer check
    if (filter.layers.length > 0) {
      const path = card.record?.meta?.hierarchyPath || [];
      const inLayer = filter.layers.some(l => path.includes(l));
      if (isAND && !inLayer) return false;
      if (!isAND && inLayer) return true;
    }

    // For AND mode: if we got here, all selected filters passed
    // For OR mode: if we got here and no match found yet, return false
    if (isAND) {
      return filter.priorities.length > 0 || filter.tags.length > 0 || filter.layers.length > 0;
    } else {
      return false; // No matching filter found
    }
  }

  window.__neuronetMemoryCleanup = () => {
    document.removeEventListener("db-change", handleDBChange);
    document.removeEventListener("keydown", handleKeyDown);
    if (window.__neuronetStatsCleanup) window.__neuronetStatsCleanup();
  };

  await initialize();
}
