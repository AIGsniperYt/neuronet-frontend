const modeToggle = document.getElementById('toggleMode');
const studyMode = document.getElementById('study-mode');
const modifyMode = document.getElementById('modify-mode');

// Study mode elements
const questionCard = document.getElementById('question-card');
const markSchemeCard = document.getElementById('markscheme-card');
const userAnswer = document.getElementById('user-answer');
const markInput = document.getElementById('mark-input');
const submitBtn = document.getElementById('submit-btn');
const nextBtn = document.getElementById('next-btn');

// Modify mode elements
const modifyQuestion = document.getElementById('modify-question');
const modifyMarkscheme = document.getElementById('modify-markscheme');
const ms = document.getElementById("ms");
const modifySubject = document.getElementById('modify-subject');
const modifyTopic = document.getElementById('modify-topic');
const modifyDifficulty = document.getElementById('modify-difficulty');
const modifyMaxMarks = document.getElementById('modify-maxmarks');
const saveFlashcardBtn = document.getElementById('save-flashcard-btn');
const clearFormBtn = document.getElementById('clear-form-btn');
const modifyMessage = document.getElementById('modify-message');

const modifyQuestionType = document.getElementById('modify-question-type');
const multipleChoiceOptionsContainer = document.getElementById('multiple-choice-options-container');
const multipleChoiceOptionsList = document.getElementById('multiple-choice-options-list');
const addMultipleChoiceOptionBtn = document.getElementById('add-multiple-choice-option');

// Import/export elements
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');

let mode = 'study';
let submittedAnswer = false;
let submittedMark = false;
let currentIndex = 0;
let db;
let questions = [];

// Define subjects and their common topics
const SUBJECTS_AND_TOPICS = {
  'English Language': [
    'Explorations in Creative Reading & Writing (Paper 1)',
    'Writers’ Viewpoints & Perspectives (Paper 2)',
    'Unseen 19th/20th/21st-century texts – reading skills',
    'Descriptive/narrative writing',
    'Writing to present a viewpoint',
  ],
  'English Literature': [
    'Macbeth',
    'A Christmas Carol',
    'Power & Conflict anthology',
    'Unseen poetry',
    'Princess and the Hustler'
  ],
  'Biology': [
    'Cell Biology',
    'Organisation',
    'Infection & Response',
    'Bioenergetics',
    'Homeostasis & Response',
    'Inheritance, Variation & Evolution',
    'Ecology'
  ],
  'Chemistry': [
    'Atomic Structure & Periodic Table',
    'Bonding, Structure & Properties',
    'Quantitative Chemistry',
    'Chemical Changes',
    'Energy Changes',
    'Rates & Equilibrium',
    'Organic Chemistry',
    'Chemical Analysis',
    'Chemistry in the Atmosphere',
    'Using Resources'
  ],
  'Physics': [
    'Energy',
    'Electricity',
    'Particle Model of Matter',
    'Atomic Structure',
    'Forces',
    'Waves',
    'Magnetism & Electromagnetism',
    'Space Physics'
  ],
  'Maths': [
    'Number',
    'Algebra',
    'Graphs',
    'Geometry & Measures',
    'Statistics & Probability',
    'Ratio, Proportion & Rates of Change'
  ],
  'Computer Science': [
    'Computational thinking (decomposition, abstraction, algorithms)',
    'Data (binary, representation, compression)',
    'Computers (hardware, software, architectures)',
    'Networks (types, protocols, security)',
    'Issues & impact (ethical, legal, environmental, cybersecurity)',
    'Problem-solving with programming (constructs, data types, subprograms)'
  ],
  'Geography B': [
    'Component 1 – Global Issues: Hazardous Earth; Development Dynamics; Challenges of an Urbanising World',
    'Component 2 – UK Issues: UK’s Evolving Physical & Human Landscapes; Fieldwork in coastal/rural/urban',
    'Component 3 – Making Geographical Decisions: People & the Biosphere; Forests Under Threat; Consuming Energy Resources'
  ]
};


// Initialize database with schema for all metadata
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('FlashcardDB', 1); // Version set to 1 as requested

    request.onerror = (event) => {
      console.error('Database error:', event.target.error);
      reject('Database error');
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('flashcards')) {
        const store = db.createObjectStore('flashcards', { 
          keyPath: 'id', 
          autoIncrement: true 
        });
        // Create indexes for all metadata fields
        store.createIndex('subject', 'subject', { unique: false });
        store.createIndex('topic', 'topic', { unique: false });
        store.createIndex('questionType', 'questionType', { unique: false });
        store.createIndex('difficulty', 'difficulty', { unique: false });
        store.createIndex('lastReviewed', 'lastReviewed', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      loadAllFlashcards().then(resolve).catch(reject);
    };
  });
}

function loadAllFlashcards() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['flashcards'], 'readonly');
    const store = transaction.objectStore('flashcards');
    const request = store.getAll();

    request.onerror = (event) => {
      console.error('Error loading flashcards:', event.target.error);
      reject('Error loading flashcards');
    };

    request.onsuccess = (event) => {
      questions = event.target.result || [];
      resolve();
    };
  });
}

// Populate subject dropdown
function populateSubjects() {
  modifySubject.innerHTML = '';
  Object.keys(SUBJECTS_AND_TOPICS).forEach(subject => {
    const option = document.createElement('option');
    option.value = subject;
    option.textContent = subject;
    modifySubject.appendChild(option);
  });
}

// Update topics when subject changes
modifySubject.addEventListener('change', () => {
  const selectedSubject = modifySubject.value;
  modifyTopic.innerHTML = '<option value="">Select a topic</option>';
  
  if (selectedSubject && SUBJECTS_AND_TOPICS[selectedSubject]) {
    SUBJECTS_AND_TOPICS[selectedSubject].forEach(topic => {
      const option = document.createElement('option');
      option.value = topic;
      option.textContent = topic;
      modifyTopic.appendChild(option);
    });
  }
});

// Initialize form
function initForm() {
  populateSubjects();
  modifySubject.dispatchEvent(new Event('change'));
}

// Updated flashcard saving with all metadata
async function saveFlashcard() {
  const newCard = {
    question: modifyQuestion.value.trim(),
    // Remove markScheme from required fields for multiple-choice
    markScheme: modifyQuestionType.value === 'multiple-choice' 
      ? "Multiple-choice answer" 
      : modifyMarkscheme.value.trim(),
    subject: modifySubject.value,
    topic: modifyTopic.value,
    questionType: modifyQuestionType.value,
    options: modifyQuestionType.value === 'multiple-choice' ? getMultipleChoiceOptions() : [],
    correctOptions: modifyQuestionType.value === 'multiple-choice' ? getCorrectMultipleChoiceOptions() : [],
    difficulty: parseInt(modifyDifficulty.value),
    maxMarks: parseInt(modifyMaxMarks.value),
    attempts: [],
    createdAt: new Date().toISOString(),
    lastReviewed: null
  };

  // Update validation logic
  if (!newCard.question) {
    showMessage("Question is required", "error");
    return;
  }

  if (modifyQuestionType.value !== 'multiple-choice' && !modifyMarkscheme.value.trim()) {
    showMessage("Mark scheme is required for standard questions", "error");
    return;
  }

  if (modifyQuestionType.value === 'multiple-choice') {
    if (newCard.options.length < 2) {
      showMessage("Multiple-choice questions need at least 2 options", "error");
      return;
    }
    if (newCard.correctOptions.length === 0) {
      showMessage("Please select at least one correct answer", "error");
      return;
    }
  }

  if (!newCard.topic) {
    showMessage("Please select a topic", "error");
    return;
  }

  try {
    const transaction = db.transaction(['flashcards'], 'readwrite');
    const store = transaction.objectStore('flashcards');
    
    await new Promise((resolve, reject) => {
      const request = store.add(newCard);
      request.onsuccess = resolve;
      request.onerror = () => reject(new Error("Failed to save card"));
    });

    showMessage("Flashcard saved successfully!", "success");
    clearForm();
    await loadAllFlashcards();
  } catch (error) {
    showMessage("Error saving: " + error.message, "error");
  }
}

function clearForm() {
  modifyQuestion.value = "";
  modifyMarkscheme.value = "";
  modifyDifficulty.value = "2";
  modifyMaxMarks.value = "5";
  modifyTopic.value = "";
  modifyQuestionType.value = "standard";
  multipleChoiceOptionsContainer.classList.add('hidden');
  multipleChoiceOptionsList.innerHTML = "";
  modifyMarkscheme.disabled = false;
  modifyMarkscheme.placeholder = "Enter the correct answer/mark scheme...";
}

function showMessage(text, type) {
  modifyMessage.textContent = text;
  modifyMessage.style.color = type === "error" ? "#f44336" : "#4CAF50";
  modifyMessage.style.display = "block";
  setTimeout(() => modifyMessage.style.display = "none", 3000);
}

// Helper functions for formatting
function formatQuestionText(text) {
  // Add paragraph breaks where needed
  return text.split('\n').map(paragraph => 
    `<p>${paragraph}</p>`
  ).join('');
}

function getMultipleChoiceOptions() {
  const options = [];
  document.querySelectorAll('.multiple-choice-option input[type="text"]').forEach(input => {
    if (input.value.trim()) {
      options.push(input.value.trim());
    }
  });
  return options;
}

function getCorrectMultipleChoiceOptions() {
  const correctOptions = [];
  document.querySelectorAll('.multiple-choice-option').forEach((option, index) => {
    if (option.querySelector('input[type="checkbox"]').checked) {
      correctOptions.push(index);
    }
  });
  return correctOptions;
}

function formatMarkScheme(text, card) {
  if (card.questionType === 'multiple-choice') {
    const correctAnswers = card.correctOptions.map(i => card.options[i]);
    return `<p>Correct answers: ${correctAnswers.join(', ')}</p>`;
  }
  
  // Existing mark scheme formatting
  if (text.includes('\n')) {
    return `<ul>${
      text.split('\n')
        .filter(line => line.trim())
        .map(line => `<li>${line.trim()}</li>`)
        .join('')
    }</ul>`;
  }
  return `<p>${text}</p>`;
}

// Updated loadQuestion with exam-style formatting
function loadQuestion(index) {
  if (questions.length === 0) {
    questionCard.innerHTML = `
      <div class="exam-header">
        <h2>No Flashcards Available</h2>
      </div>
      <div class="exam-content">
        <p>Please add some flashcards in modify mode.</p>
      </div>
    `;
    markSchemeCard.textContent = '';
    userAnswer.disabled = true;
    submitBtn.disabled = true;
    return;
  }

  if (index >= questions.length) index = 0;
  if (index < 0) index = questions.length - 1;
  currentIndex = index;

  const card = questions[currentIndex];
  
  if (card.questionType === 'multiple-choice') {
    questionCard.innerHTML = `
      <div class="exam-header">
        <div class="exam-subject">${card.subject} - ${card.topic}</div>
        <div class="exam-meta">
          <span class="difficulty">Difficulty: ${'★'.repeat(card.difficulty)}${'☆'.repeat(5-card.difficulty)}</span>
          <span class="marks">[${card.maxMarks} marks]</span>
        </div>
      </div>
      <div class="exam-content">
        <div class="question-text">${formatQuestionText(card.question)}</div>
        <div class="multiple-choice-answer">
          ${card.options.map((option, i) => `
            <label class="multiple-choice-item">
              <input type="checkbox" name="mc-answer" value="${i}">
              ${option}
            </label>
          `).join('')}
        </div>
      </div>
    `;
    
    // Hide the text answer and show checkboxes
    userAnswer.style.display = 'none';
    document.querySelector('.multiple-choice-answer').style.display = 'block';
    
    // Update mark scheme to show correct answers
    const correctAnswers = card.correctOptions.map(i => card.options[i]).join(', ');
    markSchemeCard.innerHTML = `
      <div class="markscheme-header">
        <h3>Mark Scheme</h3>
        <div class="marks">[${card.maxMarks} marks]</div>
      </div>
      <div class="markscheme-content">
        <p>Correct answers: ${correctAnswers}</p>
      </div>
    `;
  } else {
    // Standard question handling (existing code)
    questionCard.innerHTML = `
      <div class="exam-header">
        <div class="exam-subject">${card.subject} - ${card.topic}</div>
        <div class="exam-meta">
          <span class="difficulty">Difficulty: ${'★'.repeat(card.difficulty)}${'☆'.repeat(5-card.difficulty)}</span>
          <span class="marks">[${card.maxMarks} marks]</span>
        </div>
      </div>
      <div class="exam-content">
        <div class="question-text">${formatQuestionText(card.question)}</div>
      </div>
    `;
    
    // Show text answer and hide checkboxes
    userAnswer.style.display = 'block';
    if (document.querySelector('.multiple-choice-answer')) {
      document.querySelector('.multiple-choice-answer').style.display = 'none';
    }
    
    markSchemeCard.innerHTML = `
      <div class="markscheme-header">
        <h3>Mark Scheme</h3>
        <div class="marks">[${card.maxMarks} marks]</div>
      </div>
      <div class="markscheme-content">
        ${formatMarkScheme(card.markScheme)}
      </div>
    `;
  }
  
  markSchemeCard.style.transform = 'translateX(100%)';
  markSchemeCard.style.opacity = '0';
  userAnswer.value = '';
  userAnswer.disabled = false;
  markInput.value = '';
  markInput.style.display = 'none';
  markInput.max = card.maxMarks || 5;
  submittedAnswer = false;
  submittedMark = false;
  submitBtn.textContent = 'Submit';
  submitBtn.disabled = false;
  questionCard.style.transform = 'translateX(0)';
  nextBtn.style.display = 'none';
}

// Record attempt with score
function recordAttempt(score) {
  const card = questions[currentIndex];
  const isCorrect = score >= (card.maxMarks * 0.7); // 70% threshold
  
  card.attempts.push({
    date: new Date().toISOString(),
    score: score,
    isCorrect: isCorrect
  });
  card.lastReviewed = new Date().toISOString();
  
  // Update in IndexedDB
  const transaction = db.transaction(['flashcards'], 'readwrite');
  const store = transaction.objectStore('flashcards');
  store.put(card);
}

function toggleMode() {
  if (mode === 'study') {
    mode = 'modify';
    studyMode.classList.add('hidden');
    modifyMode.classList.remove('hidden');
    modeToggle.textContent = 'Switch to Study Mode';
    initForm(); // Initialize form when switching to modify mode
  } else {
    mode = 'study';
    studyMode.classList.remove('hidden');
    modifyMode.classList.add('hidden');
    modeToggle.textContent = 'Switch to Modify Mode';
    loadQuestion(currentIndex);
  }
}

// Export function (updated to handle all metadata)
async function exportFlashcards() {
  try {
    await loadAllFlashcards();
    if (questions.length === 0) {
      alert("No flashcards to export!");
      return;
    }
    
    const data = JSON.stringify(questions, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `flashcards_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Export failed:", error);
    alert("Export failed: " + error.message);
  }
}

// Import function (updated to handle all metadata)
async function importFlashcards(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async (event) => {
      try {
        const importedCards = JSON.parse(event.target.result);
        
        if (!Array.isArray(importedCards)) {
          throw new Error("Invalid format: Expected array of flashcards");
        }
        
        const transaction = db.transaction(['flashcards'], 'readwrite');
        const store = transaction.objectStore('flashcards');
        
        // Clear existing cards
        await new Promise((clearResolve, clearReject) => {
          const clearReq = store.clear();
          clearReq.onsuccess = clearResolve;
          clearReq.onerror = () => clearReject(new Error("Failed to clear old cards"));
        });
        
        // Add new cards
        for (const card of importedCards) {
          // Validate required fields
          if (!card.question || !card.markScheme) {
            throw new Error("Invalid card format: Missing question or markScheme");
          }
          
          // Set defaults for missing metadata
          const completeCard = {
            ...card,
            subject: card.subject || "Other",
            topic: card.topic || "",
            questionType: card.questionType || "standard", 
            options: card.options || [],                   
            correctOptions: card.correctOptions || [],    
            subject: card.subject || "Other",
            difficulty: card.difficulty || 2,
            maxMarks: card.maxMarks || 5,
            attempts: card.attempts || [],
            createdAt: card.createdAt || new Date().toISOString(),
            lastReviewed: card.lastReviewed || null
          };
          
          await new Promise((addResolve, addReject) => {
            const addReq = store.add(completeCard);
            addReq.onsuccess = addResolve;
            addReq.onerror = () => addReject(new Error("Failed to add some cards"));
          });
        }
        
        await loadAllFlashcards();
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error("File reading failed"));
    reader.readAsText(file);
  });
}

// Clear database function (commented out by default)

function clearDatabase() {
  if (confirm("WARNING: This will delete ALL flashcards. Are you sure?")) {
    const transaction = db.transaction(['flashcards'], 'readwrite');
    const store = transaction.objectStore('flashcards');
    const request = store.clear();
    
    request.onerror = (event) => {
      console.error("Error clearing database:", event.target.error);
      alert("Failed to clear database");
    };
    
    request.onsuccess = (event) => {
      questions = [];
      loadQuestion(0);
      alert("Database cleared successfully");
    };
  }
}

// Add clear database button to DOM (commented out by default)
document.addEventListener('DOMContentLoaded', () => {
  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'CLEAR DATABASE';
  clearBtn.style.backgroundColor = '#f44336';
  clearBtn.style.color = 'white';
  clearBtn.style.border = 'none';
  clearBtn.style.padding = '10px';
  clearBtn.style.margin = '10px';
  clearBtn.style.borderRadius = '4px';
  clearBtn.style.cursor = 'pointer';
  clearBtn.style.fontWeight = 'bold';
  clearBtn.addEventListener('click', clearDatabase);
  
  // Uncomment the next line to enable the clear button
  //document.body.appendChild(clearBtn);
});
addMultipleChoiceOptionBtn.addEventListener('click', () => {
  const optionDiv = document.createElement('div');
  optionDiv.className = 'multiple-choice-option';
  optionDiv.innerHTML = `
    <input type="checkbox">
    <input type="text" placeholder="Option text">
    <button type="button" class="remove-option">×</button>
  `;
  multipleChoiceOptionsList.appendChild(optionDiv);
  
  optionDiv.querySelector('.remove-option').addEventListener('click', () => {
    optionDiv.remove();
  });
});

modifyQuestionType.addEventListener('change', () => {
  if (modifyQuestionType.value === 'multiple-choice') {
    multipleChoiceOptionsContainer.classList.remove('hidden');
    modifyMarkscheme.disabled = true;
    ms.classList.add('hidden');  // Hide the markscheme field
    modifyMarkscheme.value = "";  // Clear any existing value
  } else {
    multipleChoiceOptionsContainer.classList.add('hidden');
    ms.classList.remove('hidden');  // Hide the markscheme field
    modifyMarkscheme.disabled = false;
    modifyMarkscheme.classList.remove('hidden');  // Show the markscheme field
    modifyMarkscheme.value = ""; // Clear the value
    modifyMarkscheme.placeholder = "Enter the correct answer/mark scheme...";
  }
});

// Event Listeners
modeToggle.addEventListener('click', toggleMode);

submitBtn.addEventListener('click', () => {
  const card = questions[currentIndex];
  
  if (card.questionType === 'multiple-choice') {
    if (!submittedAnswer) {
      const checkedBoxes = document.querySelectorAll('.multiple-choice-answer input[type="checkbox"]:checked');
      if (checkedBoxes.length === 0) {
        alert('Please select at least one answer.');
        return;
      }
      
      // Store the selected options
      const selectedOptions = Array.from(checkedBoxes).map(cb => parseInt(cb.value));
      userAnswer.value = selectedOptions.join(',');
      
      userAnswer.disabled = true;
      document.querySelectorAll('.multiple-choice-answer input').forEach(input => {
        input.disabled = true;
      });
      
      questionCard.style.transform = 'translateX(-40%)';
      markSchemeCard.style.transform = 'translateX(0)';
      markSchemeCard.style.opacity = '1';
      markInput.style.display = 'inline-block';
      submitBtn.textContent = 'Submit Mark';
      submittedAnswer = true;
      nextBtn.style.display = 'none';
    } else if (!submittedMark) {
      const markValue = markInput.value.trim();
      if (markValue === '' || isNaN(markValue) || Number(markValue) < 0) {
        alert('Please enter a valid mark (number >= 0).');
        return;
      }
      
      const score = Number(markValue);
      recordAttempt(score);
      
      markInput.disabled = true;
      submitBtn.disabled = true;
      submittedMark = true;
      nextBtn.style.display = 'inline-block';
    }
  } else {
    // Existing standard question submission code
    if (!submittedAnswer) {
      if (userAnswer.value.trim() === '') {
        alert('Please enter your answer before submitting.');
        return;
      }
      userAnswer.disabled = true;
      questionCard.style.transform = 'translateX(-40%)';
      markSchemeCard.style.transform = 'translateX(0)';
      markSchemeCard.style.opacity = '1';
      markInput.style.display = 'inline-block';
      submitBtn.textContent = 'Submit Mark';
      submittedAnswer = true;
      nextBtn.style.display = 'none';
    } else if (!submittedMark) {
      const markValue = markInput.value.trim();
      if (markValue === '' || isNaN(markValue) || Number(markValue) < 0) {
        alert('Please enter a valid mark (number >= 0).');
        return;
      }
      
      const score = Number(markValue);
      recordAttempt(score);
      
      markInput.disabled = true;
      submitBtn.disabled = true;
      submittedMark = true;
      nextBtn.style.display = 'inline-block';
    }
  }
});

nextBtn.addEventListener('click', () => {
  markSchemeCard.style.transform = 'translateX(100%)';
  markSchemeCard.style.opacity = '0';
  questionCard.style.transform = 'translateX(0)';
  markInput.style.display = 'none';
  markInput.disabled = false;
  submitBtn.disabled = false;
  submitBtn.textContent = 'Submit';
  userAnswer.disabled = false;
  userAnswer.value = '';
  currentIndex++;
  loadQuestion(currentIndex);
  nextBtn.style.display = 'none';
});

exportBtn.addEventListener('click', exportFlashcards);
importBtn.addEventListener('click', () => importFile.click());

importFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  try {
    const loading = confirm("This will replace ALL current flashcards. Continue?");
    if (!loading) return;
    
    await importFlashcards(file);
    alert(`Successfully imported ${questions.length} flashcards!`);
    loadQuestion(0);
  } catch (error) {
    alert("Import failed: " + error.message);
  } finally {
    e.target.value = '';
  }
});

saveFlashcardBtn.addEventListener('click', saveFlashcard);
clearFormBtn.addEventListener('click', clearForm);

// Dynamic background effect
const bgCanvas = document.getElementById('neuronet');
const bgCtx = bgCanvas.getContext('2d');

bgCanvas.width = window.innerWidth;
bgCanvas.height = window.innerHeight;

const bgPalettes = {
  light: {
    backgroundGradientStart: '#FF4EC6',
    backgroundGradientEnd: '#00F9E3',
    nodeFill: '#FFFFFF',
    lineBase: '#FFFFFF',
    lineGradientPower: 1.5
  },
  dark: {
    backgroundGradientStart: '#111827',
    backgroundGradientEnd: '#1F2937',
    nodeFill: '#2C3345',
    lineBase: '#6C9EDB',
    lineGradientPower: 2.2
  }
};

let bgNodes = [];
const nodeCount = 60;
const maxDist = 150;
const separationStrength = 0.02;
const edgeRepulsionStrength = 0.01;
const edgeBuffer = 50;

class BgNode {
    constructor() {
        this.x = Math.random() * bgCanvas.width;
        this.y = Math.random() * bgCanvas.height;
        this.vx = (Math.random() - 0.5) * 1.2;
        this.vy = (Math.random() - 0.5) * 1.2;
        this.maxConnections = Math.floor(Math.random() * 3) + 3;
        this.radius = 2 + Math.random() * 2;
    }

    update() {
        let moveX = 0, moveY = 0;

        // Edge repulsion
        if (this.x < edgeBuffer) moveX += edgeRepulsionStrength * (1 - this.x / edgeBuffer);
        if (this.x > bgCanvas.width - edgeBuffer) moveX -= edgeRepulsionStrength * ((this.x - (bgCanvas.width - edgeBuffer)) / edgeBuffer);
        if (this.y < edgeBuffer) moveY += edgeRepulsionStrength * (1 - this.y / edgeBuffer);
        if (this.y > bgCanvas.height - edgeBuffer) moveY -= edgeRepulsionStrength * ((this.y - (bgCanvas.height - edgeBuffer)) / edgeBuffer);

        // Organic drift
        const randomDrift = 0.02;
        this.vx += moveX + (Math.random() - 0.5) * randomDrift;
        this.vy += moveY + (Math.random() - 0.5) * randomDrift;

        // Cap velocity
        const maxSpeed = 0.6;
        let speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        if (speed > maxSpeed) {
            this.vx = (this.vx / speed) * maxSpeed;
            this.vy = (this.vy / speed) * maxSpeed;
        }

        this.x += this.vx;
        this.y += this.vy;

        // Bounce edges
        if (this.x < 0) { this.x = 0; this.vx *= -0.8; }
        if (this.x > bgCanvas.width) { this.x = bgCanvas.width; this.vx *= -0.8; }
        if (this.y < 0) { this.y = 0; this.vy *= -0.8; }
        if (this.y > bgCanvas.height) { this.y = bgCanvas.height; this.vy *= -0.8; }
    }

    draw() {
        bgCtx.beginPath();
        bgCtx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        bgCtx.fillStyle = bgPalettes.dark.nodeFill;
        bgCtx.fill();
    }
}

function connectBgNodes() {
    for (let i = 0; i < bgNodes.length; i++) {
        const a = bgNodes[i];
        let neighbors = [];
        
        for (let j = 0; j < bgNodes.length; j++) {
            if (i === j) continue;
            const b = bgNodes[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist < maxDist) {
                neighbors.push({ node: b, dist });
            }
        }
        
        neighbors.sort((n1, n2) => n1.dist - n2.dist);
        neighbors = neighbors.slice(0, a.maxConnections);
        
        for (let { node: b, dist } of neighbors) {
            bgCtx.beginPath();
            bgCtx.moveTo(a.x, a.y);
            bgCtx.lineTo(b.x, b.y);
            bgCtx.strokeStyle = `rgba(108, 158, 219, ${0.5 * (1 - dist / maxDist)})`;
            bgCtx.lineWidth = 1;
            bgCtx.stroke();
        }
    }
}

function animateBackground() {
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
    
    bgNodes.forEach(node => {
        node.update();
        node.draw();
    });
    
    connectBgNodes();
    requestAnimationFrame(animateBackground);
}

function initBackground() {
    bgNodes = [];
    for (let i = 0; i < nodeCount; i++) {
        bgNodes.push(new BgNode());
    }
    animateBackground();
}

window.addEventListener('resize', () => {
    bgCanvas.width = window.innerWidth;
    bgCanvas.height = window.innerHeight;
    initBackground();
});

// Initialize the background
initBackground();

// Initialize the app
initDB().then(() => {
  loadQuestion(currentIndex);
}).catch(error => {
  console.error('Initialization error:', error);
  questionCard.innerHTML = `
    <div class="exam-header">
      <h2>Error Loading Flashcards</h2>
    </div>
    <div class="exam-content">
      <p>Please refresh the page.</p>
    </div>
  `;
});