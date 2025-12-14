// ReadToMe - Audiobook Player
// Paragraph-level TTS with pause/resume and document splitting

// Global state
let currentDocument = null;
let paragraphs = [];
let currentParagraphIndex = 0;
let currentSentenceIndex = 0; // Track sentence position for better pause/resume
let isPaused = false;
let isPlaying = false;
let ttsSettings = {
    speed: 1.0,
    pitch: 1.0,
    volume: 1.0,
    voice: null
};

// Check if running in Flutter WebView
const isFlutter = typeof window.flutter_inappwebview !== 'undefined';

// Simple language detection based on common words
function detectLanguage(text) {
    const sample = text.substring(0, 1000).toLowerCase();

    // Dutch indicators
    const dutchWords = ['het', 'van', 'een', 'de', 'en', 'is', 'zijn', 'voor', 'met', 'op', 'aan', 'worden'];
    const dutchCount = dutchWords.filter(word => sample.includes(' ' + word + ' ')).length;

    // English indicators
    const englishWords = ['the', 'and', 'is', 'in', 'to', 'of', 'for', 'with', 'on', 'that', 'this', 'are'];
    const englishCount = englishWords.filter(word => sample.includes(' ' + word + ' ')).length;

    // German indicators
    const germanWords = ['der', 'die', 'das', 'und', 'ist', 'für', 'mit', 'auf', 'werden', 'sich'];
    const germanCount = germanWords.filter(word => sample.includes(' ' + word + ' ')).length;

    // French indicators
    const frenchWords = ['le', 'la', 'les', 'de', 'un', 'une', 'est', 'pour', 'dans', 'avec', 'sur'];
    const frenchCount = frenchWords.filter(word => sample.includes(' ' + word + ' ')).length;

    const scores = {
        'nl-NL': dutchCount,
        'en-US': englishCount,
        'de-DE': germanCount,
        'fr-FR': frenchCount
    };

    const detected = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    console.log('[Language Detection] Scores:', scores, '→ Detected:', detected[0]);

    return detected[0];
}

// Wait for voices to load
async function waitForVoices() {
    return new Promise((resolve) => {
        if (!('speechSynthesis' in window)) {
            resolve([]);
            return;
        }

        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
            console.log('[Voice Loading] Voices already available:', voices.length);
            resolve(voices);
            return;
        }

        console.log('[Voice Loading] Waiting for voices to load...');
        window.speechSynthesis.onvoiceschanged = () => {
            const loadedVoices = window.speechSynthesis.getVoices();
            console.log('[Voice Loading] Voices loaded:', loadedVoices.length);
            resolve(loadedVoices);
        };

        // Fallback timeout - some browsers might not fire the event
        setTimeout(() => {
            const voices = window.speechSynthesis.getVoices();
            console.log('[Voice Loading] Timeout fallback, voices:', voices.length);
            resolve(voices);
        }, 2000);
    });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    await initializeStorage();

    // Wait for voices to be ready before loading UI
    await waitForVoices();
    await loadVoices();

    loadSavedSettings();
    setupDragAndDrop();
    await loadStoredDocuments();
});

// ===== File Upload =====

async function handleFileUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    console.log('[File Upload]', files.length, 'file(s) selected');

    // Process all files one by one
    for (let i = 0; i < files.length; i++) {
        console.log('[File Upload] Processing file', i + 1, 'of', files.length);
        await processFile(files[i]);
    }
}

function setupDragAndDrop() {
    const uploadZone = document.getElementById('uploadZone');

    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });

    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
    });

    uploadZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');

        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            console.log('[Drag & Drop]', files.length, 'file(s) dropped');

            // Process all files one by one
            for (let i = 0; i < files.length; i++) {
                console.log('[Drag & Drop] Processing file', i + 1, 'of', files.length);
                await processFile(files[i]);
            }
        }
    });
}

async function processFile(file) {
    console.log('[File Upload] Processing new file:', file.name);

    // Check file type
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx', 'txt'].includes(ext)) {
        alert('Unsupported file type. Please upload PDF, DOCX, or TXT files.');
        return;
    }

    // Check file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
        alert('File too large. Maximum size is 10MB.');
        return;
    }

    try {
        // Extract text from document
        console.log('[File Upload] Extracting text...');
        const result = await extractDocumentText(file);
        const text = result.text; // Extract the text property from the result object
        console.log('[File Upload] Extracted', text.length, 'characters');

        if (!text || text.trim().length < 100) {
            alert('Document appears to be empty or too short.');
            return;
        }

        // Split into paragraphs
        paragraphs = splitIntoParagraphs(text);

        // Detect language
        const detectedLanguage = detectLanguage(text);
        console.log('[Document] Detected language:', detectedLanguage);

        // Store document
        currentDocument = {
            id: generateId(),
            name: file.name,
            text: text,
            paragraphs: paragraphs,
            language: detectedLanguage,
            uploadDate: new Date().toISOString(),
            size: file.size
        };

        // Save to IndexedDB
        await saveDocument(currentDocument);

        // Update UI
        displayDocumentInfo();
        await loadStoredDocuments();

    } catch (error) {
        console.error('Error processing file:', error);
        alert('Failed to process document. Please try again.');
    }
}

function splitIntoParagraphs(text) {
    // Split on double newlines (paragraphs)
    const paraTexts = text.split(/\n\s*\n/)
        .map(p => p.trim())
        .filter(p => p.length > 0);

    return paraTexts.map((paraText, index) => {
        // Split paragraph into sentences for smoother TTS
        const sentences = splitIntoSentences(paraText);

        return {
            number: index + 1,
            text: paraText,
            sentences: sentences,
            wordCount: paraText.split(/\s+/).length
        };
    });
}

function splitIntoSentences(text) {
    // Split on sentence boundaries (.!?)
    const sentences = text.split(/([.!?]+\s+)/)
        .reduce((acc, curr, i, arr) => {
            // Combine sentence with its punctuation
            if (i % 2 === 0 && curr.trim()) {
                const punct = arr[i + 1] || '';
                acc.push((curr + punct).trim());
            }
            return acc;
        }, [])
        .filter(s => s.length > 0);

    return sentences.length > 0 ? sentences : [text];
}

function displayDocumentInfo() {
    if (!currentDocument) return;

    const totalWords = paragraphs.reduce((sum, p) => sum + p.wordCount, 0);
    const estimatedMinutes = Math.ceil(totalWords / 150); // ~150 words per minute

    document.getElementById('documentName').textContent = currentDocument.name;
    document.getElementById('documentStats').innerHTML = `
        ${paragraphs.length} paragraphs • ${totalWords.toLocaleString()} words • ~${estimatedMinutes} min read
    `;

    document.getElementById('documentInfo').classList.add('active');
    document.getElementById('controls').classList.add('active');
    document.getElementById('playBtn').style.display = 'block';
}

// ===== TTS Playback =====

async function playDocument() {
    if (!currentDocument || paragraphs.length === 0) {
        alert('No document loaded');
        return;
    }

    // Cancel any existing speech first
    if (!isFlutter && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        console.log('[TTS] Cancelled any existing speech');
    }

    // Reset to beginning if not paused
    if (!isPaused) {
        currentParagraphIndex = 0;
        currentSentenceIndex = 0;
    }

    isPlaying = true;
    isPaused = false;

    // Update UI
    document.getElementById('playBtn').style.display = 'none';
    document.getElementById('pauseResumeBtn').style.display = 'block';
    document.getElementById('pauseResumeBtn').innerHTML = '⏸️ Pause';
    document.getElementById('stopBtn').style.display = 'block';
    document.getElementById('skipControls').style.display = 'flex';
    document.getElementById('progress').classList.add('active');

    // Small delay to ensure cancel completes
    await new Promise(resolve => setTimeout(resolve, 100));

    // Start speaking from current paragraph
    await speakParagraph(currentParagraphIndex);
}

async function speakParagraph(index) {
    console.log('[TTS] speakParagraph called, index:', index, 'total:', paragraphs.length);

    if (index >= paragraphs.length) {
        // Finished all paragraphs
        console.log('[TTS] Finished all paragraphs');
        stopReading();
        alert('Finished reading document!');
        return;
    }

    if (!isPlaying || isPaused) {
        console.log('[TTS] Not playing or paused, stopping');
        return; // Stopped or paused
    }

    currentParagraphIndex = index;
    const paragraph = paragraphs[index];

    // Update progress
    updateProgress();

    console.log('[TTS] Using', isFlutter ? 'Flutter' : 'Browser', 'TTS');

    // Speak using browser TTS or Flutter TTS
    if (isFlutter) {
        await speakParagraphFlutter(paragraph);
    } else {
        await speakParagraphBrowser(paragraph);
    }

    // Continue to next paragraph
    if (isPlaying && !isPaused) {
        await speakParagraph(index + 1);
    }
}

async function speakParagraphBrowser(paragraph) {
    // Use Web Speech API with QUEUE_ADD for smooth playback
    if (!('speechSynthesis' in window)) {
        alert('Speech synthesis not supported in this browser');
        return;
    }

    const language = currentDocument?.language || 'en-US';
    console.log('[Browser TTS] Speaking paragraph with', paragraph.sentences.length, 'sentences in', language);

    return new Promise((resolve) => {
        let sentencesSpoken = 0;
        const totalSentences = paragraph.sentences.length;
        let isSpeaking = false; // Guard against duplicate calls

        const speakNextSentence = () => {
            if (sentencesSpoken >= totalSentences || !isPlaying || isPaused) {
                console.log('[Browser TTS] Finished paragraph');
                resolve();
                return;
            }

            if (isSpeaking) {
                console.log('[Browser TTS] Already speaking, ignoring duplicate call');
                return;
            }

            isSpeaking = true;
            const sentence = paragraph.sentences[sentencesSpoken];
            console.log('[Browser TTS] Speaking sentence', sentencesSpoken + 1, ':', sentence.substring(0, 50) + '...');

            const utterance = new SpeechSynthesisUtterance(sentence);
            utterance.rate = ttsSettings.speed;
            utterance.pitch = ttsSettings.pitch;
            utterance.volume = ttsSettings.volume;
            utterance.lang = language; // Set language

            // Get language code (e.g., 'en' from 'en-US')
            const langCode = language.substring(0, 2);

            // Check for saved voice preference for this language
            const savedVoiceName = localStorage.getItem(`readtome_voice_${langCode}`);
            const voices = window.speechSynthesis.getVoices();

            if (savedVoiceName) {
                // User has selected a preference for this language
                const savedVoice = voices.find(v => v.name === savedVoiceName);
                if (savedVoice) {
                    utterance.voice = savedVoice;
                    console.log('[Browser TTS] Using saved voice for', langCode, ':', savedVoice.name);
                } else {
                    console.warn('[Browser TTS] Saved voice not found:', savedVoiceName);
                    // Fallback to first matching language
                    const fallbackVoice = voices.find(v => v.lang.startsWith(langCode));
                    if (fallbackVoice) {
                        utterance.voice = fallbackVoice;
                        console.log('[Browser TTS] Fallback to first voice for', langCode, ':', fallbackVoice.name);
                    }
                }
            } else {
                // No preference - use first voice matching the language
                const matchingVoice = voices.find(v => v.lang.startsWith(langCode));
                if (matchingVoice) {
                    utterance.voice = matchingVoice;
                    console.log('[Browser TTS] Auto-selected first voice for', langCode, ':', matchingVoice.name);
                } else {
                    console.log('[Browser TTS] No matching voice for', langCode, 'using default');
                }
            }

            let hasStarted = false;
            let hasEnded = false;

            utterance.onstart = () => {
                if (hasStarted) {
                    console.log('[Browser TTS] Duplicate onstart event, ignoring');
                    return;
                }
                hasStarted = true;
                console.log('[Browser TTS] Utterance started');
            };

            utterance.onend = () => {
                if (hasEnded) {
                    console.log('[Browser TTS] Duplicate onend event, ignoring');
                    return;
                }
                hasEnded = true;
                console.log('[Browser TTS] Utterance ended');
                isSpeaking = false;
                sentencesSpoken++;
                // Small delay to ensure smooth transition
                setTimeout(() => speakNextSentence(), 50);
            };

            utterance.onerror = (e) => {
                console.error('[Browser TTS] error:', e);
                isSpeaking = false;
                resolve();
            };

            window.speechSynthesis.speak(utterance);
        };

        speakNextSentence();
    });
}

async function speakParagraphFlutter(paragraph) {
    // Use Flutter TTS via JavaScript bridge - sentence by sentence for better pause/resume
    try {
        const language = currentDocument?.language || 'en-US';
        console.log('[Flutter TTS] Using language:', language);

        // Start from current sentence index (for resume support)
        for (let i = currentSentenceIndex; i < paragraph.sentences.length; i++) {
            if (!isPlaying || isPaused) {
                // Save position and stop
                currentSentenceIndex = i;
                return;
            }

            currentSentenceIndex = i;
            const sentence = paragraph.sentences[i];

            const result = await window.flutter_inappwebview.callHandler('ttsSpeak', sentence, language);

            if (!result || !result.success) {
                console.error('Flutter TTS failed:', result?.error);
            }

            // Small delay between sentences
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Finished all sentences in paragraph
        currentSentenceIndex = 0;

    } catch (error) {
        console.error('Flutter TTS error:', error);
    }
}

function togglePauseResume() {
    if (isPaused) {
        // Resume
        isPaused = false;
        document.getElementById('pauseResumeBtn').innerHTML = '⏸️ Pause';

        if (isFlutter) {
            // Continue from current sentence in current paragraph
            // The speakParagraphFlutter function will resume from currentSentenceIndex
        } else {
            if (window.speechSynthesis.paused) {
                window.speechSynthesis.resume();
            }
        }

        // Continue from current paragraph (and current sentence for Flutter)
        playDocument();

    } else {
        // Pause
        isPaused = true;
        document.getElementById('pauseResumeBtn').innerHTML = '▶️ Resume';

        if (isFlutter) {
            // Stop current speech - position already saved in currentSentenceIndex
            window.flutter_inappwebview.callHandler('ttsStop');
        } else {
            if (window.speechSynthesis.speaking) {
                window.speechSynthesis.pause();
            }
        }

        // Save position (paragraph + sentence)
        saveReadingPosition();
    }
}

function stopReading() {
    isPlaying = false;
    isPaused = false;
    currentParagraphIndex = 0;
    currentSentenceIndex = 0; // Reset sentence position

    // Stop TTS
    if (isFlutter) {
        window.flutter_inappwebview.callHandler('ttsStop');
    } else {
        window.speechSynthesis.cancel();
    }

    // Update UI
    document.getElementById('playBtn').style.display = 'block';
    document.getElementById('pauseResumeBtn').style.display = 'none';
    document.getElementById('stopBtn').style.display = 'none';
    document.getElementById('skipControls').style.display = 'none';
    document.getElementById('progress').classList.remove('active');

    // Clear saved position
    clearReadingPosition();
}

// Skip to next/previous paragraph
async function skipParagraph(direction) {
    if (!isPlaying || paragraphs.length === 0) {
        return;
    }

    console.log('[Skip] Skipping', direction > 0 ? 'forward' : 'backward');

    // Stop current speech
    if (isFlutter) {
        window.flutter_inappwebview.callHandler('ttsStop');
    } else {
        window.speechSynthesis.cancel();
    }

    // Calculate new paragraph index
    let newIndex = currentParagraphIndex + direction;

    // Clamp to valid range
    if (newIndex < 0) {
        newIndex = 0;
    } else if (newIndex >= paragraphs.length) {
        // Reached end
        stopReading();
        alert('Finished reading document!');
        return;
    }

    // Update index and reset sentence position
    currentParagraphIndex = newIndex;
    currentSentenceIndex = 0;

    // Small delay to ensure cancel completes
    await new Promise(resolve => setTimeout(resolve, 100));

    // Continue playing from new position
    await speakParagraph(currentParagraphIndex);
}

function updateProgress() {
    const progressText = `Reading paragraph ${currentParagraphIndex + 1} of ${paragraphs.length}`;
    const progressPercent = ((currentParagraphIndex + 1) / paragraphs.length) * 100;

    document.getElementById('progressText').textContent = progressText;
    document.getElementById('progressBar').style.width = progressPercent + '%';
}

// ===== TTS Settings =====

async function loadVoices() {
    const voiceSelect = document.getElementById('voiceSelect');

    console.log('[Voice Loading] isFlutter:', isFlutter);

    // In Flutter app, voice selection is handled natively
    if (isFlutter) {
        console.log('[Voice Loading] Flutter detected, using native voice');
        voiceSelect.innerHTML = '<option>Voice managed by system</option>';
        voiceSelect.disabled = true;
        return;
    }

    if (!('speechSynthesis' in window)) {
        console.log('[Voice Loading] speechSynthesis not supported');
        voiceSelect.innerHTML = '<option>Speech not supported</option>';
        return;
    }

    const voices = window.speechSynthesis.getVoices();
    console.log('[Voice Loading] Found', voices.length, 'voices');

    if (voices.length === 0) {
        // Voices not loaded yet, will trigger onvoiceschanged
        console.log('[Voice Loading] No voices yet, waiting for onvoiceschanged');
        return;
    }

    voiceSelect.innerHTML = '';

    // Add default option
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Default Voice';
    voiceSelect.appendChild(defaultOption);

    // Add available voices
    voices.forEach((voice, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = `${voice.name} (${voice.lang})`;
        voiceSelect.appendChild(option);
    });

    // Load saved voice
    const savedVoiceIndex = localStorage.getItem('readtome_voice');
    if (savedVoiceIndex && voices[savedVoiceIndex]) {
        voiceSelect.value = savedVoiceIndex;
        ttsSettings.voice = voices[savedVoiceIndex];
    }
}

function updateVoice() {
    const voiceSelect = document.getElementById('voiceSelect');
    const voices = window.speechSynthesis.getVoices();

    if (voiceSelect.value) {
        const selectedVoice = voices[voiceSelect.value];
        ttsSettings.voice = selectedVoice;

        // Save voice preference per language
        const langCode = selectedVoice.lang.substring(0, 2);
        localStorage.setItem(`readtome_voice_${langCode}`, selectedVoice.name);
        console.log('[Voice Selection] Saved', selectedVoice.name, 'for language', langCode);
    } else {
        ttsSettings.voice = null;
    }
}

function updateSpeed(value) {
    ttsSettings.speed = parseFloat(value);
    document.getElementById('speedValue').textContent = value + 'x';
    localStorage.setItem('readtome_speed', value);

    // Update Flutter TTS if available
    if (isFlutter) {
        window.flutter_inappwebview.callHandler('ttsSetSpeed', value);
    }
}

function updatePitch(value) {
    ttsSettings.pitch = parseFloat(value);
    document.getElementById('pitchValue').textContent = value;
    localStorage.setItem('readtome_pitch', value);

    // Update Flutter TTS if available
    if (isFlutter) {
        window.flutter_inappwebview.callHandler('ttsSetPitch', value);
    }
}

function updateVolume(value) {
    ttsSettings.volume = parseFloat(value) / 100;
    document.getElementById('volumeValue').textContent = value + '%';
    localStorage.setItem('readtome_volume', value);

    // Update Flutter TTS if available
    if (isFlutter) {
        window.flutter_inappwebview.callHandler('ttsSetVolume', ttsSettings.volume);
    }
}

function loadSavedSettings() {
    // Load speed
    const savedSpeed = localStorage.getItem('readtome_speed');
    if (savedSpeed) {
        document.getElementById('speedRange').value = savedSpeed;
        updateSpeed(savedSpeed);
    }

    // Load pitch
    const savedPitch = localStorage.getItem('readtome_pitch');
    if (savedPitch) {
        document.getElementById('pitchRange').value = savedPitch;
        updatePitch(savedPitch);
    }

    // Load volume
    const savedVolume = localStorage.getItem('readtome_volume');
    if (savedVolume) {
        document.getElementById('volumeRange').value = savedVolume;
        updateVolume(savedVolume);
    }
}

// ===== Storage =====

async function initializeStorage() {
    // Initialize IndexedDB for document storage
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('ReadToMeDB', 1);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // Create documents store
            if (!db.objectStoreNames.contains('documents')) {
                const objectStore = db.createObjectStore('documents', { keyPath: 'id' });
                objectStore.createIndex('uploadDate', 'uploadDate', { unique: false });
            }

            // Create positions store for saving reading progress
            if (!db.objectStoreNames.contains('positions')) {
                const posStore = db.createObjectStore('positions', { keyPath: 'documentId' });
                posStore.createIndex('lastPlayed', 'lastPlayed', { unique: false });
            }
        };
    });
}

async function saveDocument(doc) {
    const db = await initializeStorage();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['documents'], 'readwrite');
        const store = transaction.objectStore('documents');
        const request = store.put(doc);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function loadStoredDocuments() {
    const db = await initializeStorage();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['documents'], 'readonly');
        const store = transaction.objectStore('documents');
        const request = store.getAll();

        request.onsuccess = () => {
            const docs = request.result;
            displayStoredDocuments(docs);
            resolve(docs);
        };
        request.onerror = () => reject(request.error);
    });
}

function displayStoredDocuments(docs) {
    const docList = document.getElementById('documentList');

    if (docs.length === 0) {
        docList.style.display = 'none';
        return;
    }

    docList.style.display = 'block';
    docList.innerHTML = '<h3 style="margin-bottom: 15px; color: #667eea;">Your Documents</h3>';

    docs.forEach(doc => {
        const item = document.createElement('div');
        item.className = 'document-item';

        const info = document.createElement('div');
        info.className = 'document-item-info';

        const name = document.createElement('div');
        name.className = 'document-item-name';
        name.textContent = doc.name;

        const meta = document.createElement('div');
        meta.className = 'document-item-meta';
        const uploadDate = new Date(doc.uploadDate).toLocaleDateString();
        const sizeKB = Math.round(doc.size / 1024);
        meta.textContent = `${doc.paragraphs.length} paragraphs • ${sizeKB} KB • Uploaded ${uploadDate}`;

        info.appendChild(name);
        info.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'document-item-actions';

        const loadBtn = document.createElement('button');
        loadBtn.className = 'btn-primary btn-small';
        loadBtn.textContent = 'Load';
        loadBtn.onclick = () => loadDocument(doc.id);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-danger btn-small';
        deleteBtn.textContent = 'Delete';
        deleteBtn.onclick = () => deleteDocument(doc.id);

        actions.appendChild(loadBtn);
        actions.appendChild(deleteBtn);

        item.appendChild(info);
        item.appendChild(actions);

        docList.appendChild(item);
    });
}

async function loadDocument(docId) {
    const db = await initializeStorage();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['documents'], 'readonly');
        const store = transaction.objectStore('documents');
        const request = store.get(docId);

        request.onsuccess = () => {
            const doc = request.result;
            if (doc) {
                currentDocument = doc;
                paragraphs = doc.paragraphs;
                displayDocumentInfo();

                // Load saved reading position
                loadReadingPosition(docId);
            }
            resolve(doc);
        };
        request.onerror = () => reject(request.error);
    });
}

async function deleteDocument(docId) {
    if (!confirm('Delete this document?')) return;

    const db = await initializeStorage();

    await new Promise((resolve, reject) => {
        const transaction = db.transaction(['documents'], 'readwrite');
        const store = transaction.objectStore('documents');
        const request = store.delete(docId);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });

    // Refresh list
    await loadStoredDocuments();

    // Clear current document if it was deleted
    if (currentDocument && currentDocument.id === docId) {
        currentDocument = null;
        paragraphs = [];
        document.getElementById('documentInfo').classList.remove('active');
        document.getElementById('controls').classList.remove('active');
    }
}

async function saveReadingPosition() {
    if (!currentDocument) return;

    const db = await initializeStorage();

    const position = {
        documentId: currentDocument.id,
        paragraphIndex: currentParagraphIndex,
        totalParagraphs: paragraphs.length,
        lastPlayed: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['positions'], 'readwrite');
        const store = transaction.objectStore('positions');
        const request = store.put(position);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function loadReadingPosition(docId) {
    const db = await initializeStorage();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['positions'], 'readonly');
        const store = transaction.objectStore('positions');
        const request = store.get(docId);

        request.onsuccess = () => {
            const position = request.result;
            if (position && position.paragraphIndex < paragraphs.length) {
                currentParagraphIndex = position.paragraphIndex;

                // Show resume option
                if (confirm(`Resume from paragraph ${position.paragraphIndex + 1}?`)) {
                    isPaused = true; // Set paused so playDocument doesn't reset index
                } else {
                    currentParagraphIndex = 0;
                }
            }
            resolve(position);
        };
        request.onerror = () => reject(request.error);
    });
}

async function clearReadingPosition() {
    if (!currentDocument) return;

    const db = await initializeStorage();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['positions'], 'readwrite');
        const store = transaction.objectStore('positions');
        const request = store.delete(currentDocument.id);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// ===== Utilities =====

function generateId() {
    return 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Extract text from document (uses document-extraction.js)
async function extractDocumentText(file) {
    // Use the extractTextFromFile function from document-extraction.js
    return await window.extractTextFromFile(file);
}
