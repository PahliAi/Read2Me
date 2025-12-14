/**
 * document-manager-simple.js - Simplified File Picker for Document Context
 *
 * Handles:
 * - File upload and extraction (PDF/DOCX)
 * - File picker modal UI
 * - File selection/deselection for context attachment
 * - File deletion from IndexedDB
 *
 * Does NOT handle:
 * - Summarization (removed - LLM handles via voice)
 * - Separate document manager UI (removed - just file picker)
 */

// Track currently selected files in file picker (for deletion - separate from attachment)
let selectedForDeletionIds = new Set();

// ========== COST ESTIMATION ==========

// Pricing constants (must match api/config/pricing.js)
const PRICING = {
    MARGIN: 1.40,  // 40% overhead
    GPT_4O: {
        INPUT_PER_1K: 0.0023,   // €0.0023 per 1K input tokens
        OUTPUT_PER_1K: 0.0092   // €0.0092 per 1K output tokens (estimated for response)
    },
    WHISPER_PER_MINUTE: 0.006,  // €0.006 per minute of audio
    AVG_WHISPER_DURATION_SEC: 5  // Average user voice message duration (5 seconds)
};

/**
 * Estimate token count from text
 * Rough approximation: ~4 characters per token (conservative estimate)
 */
function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

/**
 * Calculate estimated cost for complete chat interaction with context
 * @param {number} contextTokens - Total tokens from attached documents
 * @returns {number} Cost in EUR (rounded up to full euro-cents)
 */
function calculateContextCost(contextTokens) {
    // === WHISPER STT COST ===
    // Average voice message duration: 5 seconds
    const whisperMinutes = PRICING.AVG_WHISPER_DURATION_SEC / 60;
    const whisperCost = whisperMinutes * PRICING.WHISPER_PER_MINUTE * PRICING.MARGIN;

    // === GPT-4O CHAT COST ===
    // Estimate:
    // - Input: context + system prompt (~100 tokens) + user message (~50 tokens)
    // - Output: ~150 tokens (average response)
    const systemTokens = 100;
    const userMessageTokens = 50;
    const outputTokens = 150;

    const totalInputTokens = contextTokens + systemTokens + userMessageTokens;

    const inputCost = (totalInputTokens / 1000) * PRICING.GPT_4O.INPUT_PER_1K;
    const outputCost = (outputTokens / 1000) * PRICING.GPT_4O.OUTPUT_PER_1K;
    const gptCost = (inputCost + outputCost) * PRICING.MARGIN;

    // === TOTAL COST ===
    const totalCost = whisperCost + gptCost;

    // Round up to full euro-cents (0.01)
    return Math.ceil(totalCost * 100) / 100;
}

/**
 * Update cost estimate display based on currently attached documents
 */
async function updateCostEstimate() {
    const costContainer = document.getElementById('contextCostEstimate');
    if (!costContainer) {
        console.warn('[FilePicker] Cost estimate container not found');
        return;
    }

    try {
        const attachedDocs = await window.getAttachedDocuments();

        if (!attachedDocs || attachedDocs.length === 0) {
            costContainer.classList.add('hidden');
            return;
        }

        // Calculate total tokens from attached documents
        const totalTokens = attachedDocs.reduce((sum, doc) => {
            return sum + estimateTokens(doc.extractedText);
        }, 0);

        // Check if exceeds 80% of model limit
        const MODEL_MAX_TOKENS = 128000;  // GPT-4o and GPT-4o-mini
        const SAFE_LIMIT = MODEL_MAX_TOKENS * 0.8;  // 80% = 102,400 tokens
        const exceedsLimit = totalTokens > SAFE_LIMIT;

        // Calculate cost
        const estimatedCost = calculateContextCost(totalTokens);
        const formattedCost = estimatedCost.toFixed(2);

        // Update UI with warning if exceeds limit
        costContainer.innerHTML = `
            <div style="background: ${exceedsLimit ? '#3d1a1a' : '#2a2a2a'};
                        border: 1px solid ${exceedsLimit ? '#ff4444' : '#666'};
                        border-radius: 8px; padding: 12px; margin-bottom: 15px;">
                <div style="color: ${exceedsLimit ? '#ff4444' : '#FFD700'}; font-size: 14px; margin-bottom: 4px;">
                    ${exceedsLimit ? '🚫 Token Limit Warning' : '⚠️ Cost Information'}
                </div>
                <div style="color: #ccc; font-size: 13px; line-height: 1.5;">
                    ${exceedsLimit
                        ? `Your attached documents contain approximately <strong style="color: #ff4444;">${totalTokens.toLocaleString()} tokens</strong>, which exceeds the safe limit of ${SAFE_LIMIT.toLocaleString()} tokens (80% of model capacity). Please remove some documents or the AI may not be able to process all content.`
                        : `Adding context to a chat with AI adds cost. A single chat with the current context (including voice input and AI response) is estimated at <strong style="color: #fff;">€${formattedCost}</strong>.`
                    }
                </div>
                ${exceedsLimit ? '' : `
                    <div style="color: #888; font-size: 11px; margin-top: 8px;">
                        Document tokens: ${totalTokens.toLocaleString()} / ${SAFE_LIMIT.toLocaleString()} (${Math.round(totalTokens / SAFE_LIMIT * 100)}% of safe limit)
                    </div>
                `}
            </div>
        `;
        costContainer.classList.remove('hidden');

        console.log('[FilePicker] Cost estimate updated:', attachedDocs.length, 'files,', totalTokens, 'tokens, €' + formattedCost, exceedsLimit ? '(EXCEEDS LIMIT)' : '');
    } catch (error) {
        console.error('[FilePicker] Error updating cost estimate:', error);
        costContainer.classList.add('hidden');
    }
}

// ========== FILE PICKER MODAL ==========

/**
 * Open file picker modal
 */
async function openFilePicker() {
    console.log('[FilePicker] Opening file picker modal');
    const modal = document.getElementById('filePickerModal');
    if (!modal) {
        console.error('[FilePicker] Modal not found');
        return;
    }

    modal.classList.remove('hidden');
    await refreshFilePickerList(); // This will also update cost estimate
}

/**
 * Close file picker modal
 */
async function closeFilePicker() {
    console.log('[FilePicker] Closing file picker modal');
    const modal = document.getElementById('filePickerModal');
    if (modal) {
        modal.classList.add('hidden');
    }
    selectedForDeletionIds.clear();

    // Refresh DRIVE mode UI to show updated attachment count
    if (typeof window.renderMode === 'function' && typeof MODE !== 'undefined') {
        await window.renderMode(MODE.DRIVE);
    }
}

/**
 * Refresh file picker list
 */
async function refreshFilePickerList() {
    console.log('[FilePicker] Refreshing file list');
    const listContainer = document.getElementById('filePickerList');
    if (!listContainer) {
        console.error('[FilePicker] List container not found');
        return;
    }

    try {
        const documents = await window.getAllDocuments();
        const attachedIds = window.getAttachedDocumentIds();

        if (documents.length === 0) {
            listContainer.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: #888;">
                    <div style="font-size: 48px; margin-bottom: 16px;">📄</div>
                    <p>No files yet. Click "Add Files" to upload PDF, DOCX, or TXT documents.</p>
                </div>
            `;
            // Hide cost estimate when no files
            updateCostEstimate();
            return;
        }

        // Render file items
        listContainer.innerHTML = documents.map(doc => renderFileItem(doc, attachedIds.includes(doc.id))).join('');

        // Update cost estimate
        await updateCostEstimate();

        console.log('[FilePicker] Rendered', documents.length, 'files');
    } catch (error) {
        console.error('[FilePicker] Error refreshing list:', error);
        listContainer.innerHTML = `
            <div style="text-align: center; padding: 20px; color: #ff4444;">
                Error loading files. Please try again.
            </div>
        `;
    }
}

/**
 * Render a single file item
 */
function renderFileItem(doc, isAttached) {
    const isSelected = selectedForDeletionIds.has(doc.id);
    const fileIcon = doc.originalFileType === 'application/pdf' ? '📕' : '📘';
    const fileSize = formatFileSize(doc.textLength);
    const uploadDate = new Date(doc.uploadedAt).toLocaleDateString();

    // Truncate filename if too long
    const displayName = doc.filename.length > 30
        ? doc.filename.substring(0, 27) + '...'
        : doc.filename;

    return `
        <div class="file-picker-item"
             style="background: ${isAttached ? '#1a3d2a' : '#2a2a2a'};
                    border: 2px solid ${isAttached ? '#4CAF50' : '#444'};
                    border-radius: 8px;
                    padding: 15px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    transition: all 0.2s;">
            <!-- Checkbox for selection -->
            <input type="checkbox"
                   data-action="toggle-file-selection"
                   data-file-id="${doc.id}"
                   ${isSelected ? 'checked' : ''}
                   style="width: 20px; height: 20px; cursor: pointer;">

            <!-- File info -->
            <div style="flex: 1; display: flex; align-items: center; gap: 12px;">
                <div style="font-size: 24px;">${fileIcon}</div>
                <div style="flex: 1;">
                    <div style="color: #fff; font-weight: bold; margin-bottom: 4px;">${displayName}</div>
                    <div style="color: #888; font-size: 12px;">${fileSize} • ${uploadDate}</div>
                </div>
                ${isAttached ? `
                    <button class="btn" data-action="detach-file" data-file-id="${doc.id}"
                            style="padding: 6px 12px; background: #ff6b6b; font-size: 12px; border: none; border-radius: 6px; color: white; cursor: pointer;">
                        Detach
                    </button>
                ` : ''}
            </div>
        </div>
    `;
}

/**
 * Format file size for display
 */
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Toggle file selection (checkbox)
 */
async function toggleFileSelection(fileId) {
    if (selectedForDeletionIds.has(fileId)) {
        selectedForDeletionIds.delete(fileId);
    } else {
        selectedForDeletionIds.add(fileId);
    }
    await refreshFilePickerList();
}

/**
 * Attach selected files to context
 */
async function attachSelectedFiles() {
    if (selectedForDeletionIds.size === 0) {
        alert('No files selected. Check the boxes next to files you want to attach.');
        return;
    }

    console.log('[FilePicker] Attaching', selectedForDeletionIds.size, 'file(s) to context');

    // Get all documents to find selected ones
    const allDocs = await window.getAllDocuments();
    const attachedIds = window.getAttachedDocumentIds();

    // Attach all selected files
    for (const fileId of selectedForDeletionIds) {
        if (!attachedIds.includes(fileId)) {
            window.attachDocument(fileId);
        }
    }

    // Clear selection after attaching
    selectedForDeletionIds.clear();

    // Refresh list to show ATTACHED label and update cost estimate
    await refreshFilePickerList();

    console.log('[FilePicker] ✅ Files attached successfully');
}

// ========== FILE UPLOAD ==========

/**
 * Trigger file input click
 */
function triggerFileInput() {
    const fileInput = document.getElementById('filePickerInput');
    if (fileInput) {
        fileInput.click();
    }
}

/**
 * Handle file input change (upload files)
 */
async function handleFileUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    console.log('[FilePicker] Uploading', files.length, 'file(s)');

    for (const file of files) {
        try {
            // Validate file type
            const validTypes = [
                'application/pdf',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'text/plain'
            ];
            const fileExtension = file.name.split('.').pop().toLowerCase();
            const isValidType = validTypes.includes(file.type) || fileExtension === 'txt';

            if (!isValidType) {
                alert(`❌ ${file.name}: Unsupported file type. Only PDF, DOCX, and TXT are supported.`);
                continue;
            }

            // Validate file size (5MB for PDF, 2MB for DOCX/TXT)
            const maxSize = file.type === 'application/pdf' ? 5 * 1024 * 1024 : 2 * 1024 * 1024;
            if (file.size > maxSize) {
                alert(`❌ ${file.name}: File too large. Max ${maxSize / (1024 * 1024)}MB.`);
                continue;
            }

            // Extract text using unified function
            console.log('[FilePicker] Extracting text from:', file.name);
            const result = await window.extractTextFromFile(file);
            const extractedText = result.text || result; // Handle both object and string return

            if (!extractedText || extractedText.trim().length === 0) {
                alert(`❌ ${file.name}: Could not extract text from file.`);
                continue;
            }

            // Store in IndexedDB
            const docId = await window.addDocument(
                file.name,                      // filename
                file.type || 'text/plain',      // fileType
                extractedText                   // extractedText
            );

            console.log('[FilePicker] ✅ Uploaded and extracted:', file.name, `(${extractedText.length} chars)`);

        } catch (error) {
            console.error('[FilePicker] Error uploading file:', file.name, error);
            alert(`❌ Error uploading ${file.name}: ${error.message}`);
        }
    }

    // Clear file input
    event.target.value = '';

    // Refresh list
    await refreshFilePickerList();
}

// ========== FILE DELETION ==========

/**
 * Delete selected files from IndexedDB
 */
async function deleteSelectedFiles() {
    if (selectedForDeletionIds.size === 0) {
        alert('No files selected. Click files to select them for deletion.');
        return;
    }

    const confirm = window.confirm(`Delete ${selectedForDeletionIds.size} file(s) permanently? This cannot be undone.`);
    if (!confirm) return;

    console.log('[FilePicker] Deleting', selectedForDeletionIds.size, 'file(s)');

    try {
        for (const fileId of selectedForDeletionIds) {
            // Remove from attachments if attached
            window.removeAttachedDocument(fileId);

            // Delete from IndexedDB
            await window.deleteDocument(fileId);
        }

        selectedForDeletionIds.clear();
        await refreshFilePickerList();

        console.log('[FilePicker] ✅ Files deleted successfully');
    } catch (error) {
        console.error('[FilePicker] Error deleting files:', error);
        alert('Error deleting files. Please try again.');
    }
}

// ========== DONE BUTTON (ATTACH SELECTED FILES) ==========

/**
 * Done - attach selected files and close modal
 */
async function doneFilePicker() {
    console.log('[FilePicker] Done clicked');

    // Note: Files are attached/detached via toggle clicks during selection
    // This just closes the modal
    closeFilePicker();

    // Refresh UI to show updated attachment count
    if (typeof window.renderMode === 'function' && typeof MODE !== 'undefined') {
        await window.renderMode(MODE.DRIVE);
    }
}

// ========== SETUP FILE INPUT LISTENER ==========

/**
 * Initialize file picker
 */
function initFilePicker() {
    console.log('[FilePicker] Initializing file picker');

    // Add file input change listener
    const fileInput = document.getElementById('filePickerInput');
    if (fileInput) {
        fileInput.addEventListener('change', handleFileUpload);
    }
}

// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFilePicker);
} else {
    initFilePicker();
}

// Export functions
window.openFilePicker = openFilePicker;
window.closeFilePicker = closeFilePicker;
window.refreshFilePickerList = refreshFilePickerList;
window.toggleFileSelection = toggleFileSelection;
window.attachSelectedFiles = attachSelectedFiles;
window.triggerFileInput = triggerFileInput;
window.deleteSelectedFiles = deleteSelectedFiles;
window.doneFilePicker = doneFilePicker;

// Note: getAttachedDocuments is exported from storage.js

console.log('[FilePicker] ✅ File picker module loaded');
