/**
 * Document Extraction Module
 *
 * Client-side text extraction from PDF and DOCX files
 * - PDF: Uses pdf.js (Mozilla)
 * - DOCX: Uses mammoth.js
 *
 * All functions are async and return extracted text as strings
 */

// File size limits (in bytes)
const MAX_PDF_SIZE = 5 * 1024 * 1024;  // 5MB
const MAX_DOCX_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_TEXT_LENGTH = 100000;        // 100KB characters (~20,000 words)

/**
 * Extract text from PDF file using pdf.js
 * @param {File|Blob} fileBlob - The PDF file to extract text from
 * @returns {Promise<string>} - Extracted text content
 */
async function extractTextFromPDF(fileBlob) {
    try {
        console.log('[PDF Extraction] Starting extraction for file:', fileBlob.name || 'blob');

        // Validate file size
        if (fileBlob.size > MAX_PDF_SIZE) {
            throw new Error(`PDF file too large. Maximum size: ${MAX_PDF_SIZE / 1024 / 1024}MB`);
        }

        // Configure pdf.js worker
        if (typeof pdfjsLib !== 'undefined') {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdf.worker.min.js';
        } else {
            throw new Error('pdf.js library not loaded');
        }

        // Convert file to ArrayBuffer
        const arrayBuffer = await fileBlob.arrayBuffer();

        // Load PDF document
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        console.log(`[PDF Extraction] Loaded PDF with ${pdf.numPages} pages`);

        // Extract text from all pages
        let fullText = '';
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();

            // Concatenate text items with spaces
            const pageText = textContent.items
                .map(item => item.str)
                .join(' ');

            fullText += pageText + '\n\n';  // Add page break
        }

        console.log(`[PDF Extraction] Extracted ${fullText.length} characters from ${pdf.numPages} pages`);
        return fullText.trim();

    } catch (error) {
        console.error('[PDF Extraction] Error:', error);
        throw new Error(`Failed to extract text from PDF: ${error.message}`);
    }
}

/**
 * Extract text from DOCX file using mammoth.js
 * @param {File|Blob} fileBlob - The DOCX file to extract text from
 * @returns {Promise<string>} - Extracted text content
 */
async function extractTextFromDOCX(fileBlob) {
    try {
        console.log('[DOCX Extraction] Starting extraction for file:', fileBlob.name || 'blob');

        // Validate file size
        if (fileBlob.size > MAX_DOCX_SIZE) {
            throw new Error(`DOCX file too large. Maximum size: ${MAX_DOCX_SIZE / 1024 / 1024}MB`);
        }

        // Check if mammoth.js is loaded
        if (typeof mammoth === 'undefined') {
            throw new Error('mammoth.js library not loaded');
        }

        // Convert file to ArrayBuffer
        const arrayBuffer = await fileBlob.arrayBuffer();

        // Extract text using mammoth
        const result = await mammoth.extractRawText({ arrayBuffer });

        if (result.messages && result.messages.length > 0) {
            console.warn('[DOCX Extraction] Warnings:', result.messages);
        }

        console.log(`[DOCX Extraction] Extracted ${result.value.length} characters`);
        return result.value.trim();

    } catch (error) {
        console.error('[DOCX Extraction] Error:', error);
        throw new Error(`Failed to extract text from DOCX: ${error.message}`);
    }
}

/**
 * Extract text from TXT file (simple read)
 * @param {File|Blob} fileBlob - The TXT file to read
 * @returns {Promise<string>} - File content
 */
async function extractTextFromTXT(fileBlob) {
    try {
        console.log('[TXT Extraction] Reading text file:', fileBlob.name || 'blob');

        const text = await fileBlob.text();
        console.log(`[TXT Extraction] Read ${text.length} characters`);

        return text.trim();

    } catch (error) {
        console.error('[TXT Extraction] Error:', error);
        throw new Error(`Failed to read TXT file: ${error.message}`);
    }
}

/**
 * Validate extracted text meets requirements
 * @param {string} text - Extracted text to validate
 * @param {string} filename - Original filename (for error messages)
 * @returns {Object} - Validation result { valid: boolean, error: string|null }
 */
function validateDocument(text, filename) {
    // Check if text is empty
    if (!text || text.trim().length === 0) {
        return {
            valid: false,
            error: `No text could be extracted from "${filename}". The file may be empty or corrupted.`
        };
    }

    // Check text length
    if (text.length > MAX_TEXT_LENGTH) {
        return {
            valid: false,
            error: `Document too large. Extracted text is ${text.length} characters, maximum is ${MAX_TEXT_LENGTH} characters (~20,000 words).`
        };
    }

    // Check minimum text length (at least 10 characters to be useful)
    if (text.length < 10) {
        return {
            valid: false,
            error: `Document too short. Extracted text is only ${text.length} characters.`
        };
    }

    return {
        valid: true,
        error: null
    };
}

/**
 * Main extraction function - auto-detects file type and extracts text
 * @param {File} file - The file to extract text from
 * @returns {Promise<Object>} - { text: string, fileType: string }
 */
async function extractTextFromFile(file) {
    const filename = file.name.toLowerCase();
    let text = '';
    let fileType = '';

    try {
        if (filename.endsWith('.pdf')) {
            text = await extractTextFromPDF(file);
            fileType = 'pdf';
        } else if (filename.endsWith('.docx')) {
            text = await extractTextFromDOCX(file);
            fileType = 'docx';
        } else if (filename.endsWith('.txt')) {
            text = await extractTextFromTXT(file);
            fileType = 'txt';
        } else {
            throw new Error(`Unsupported file type. Please upload PDF, DOCX, or TXT files.`);
        }

        // Validate extracted text
        const validation = validateDocument(text, file.name);
        if (!validation.valid) {
            throw new Error(validation.error);
        }

        return { text, fileType };

    } catch (error) {
        console.error('[Document Extraction] Error:', error);
        throw error;
    }
}

// Export all functions to window object for use in index.html
window.extractTextFromPDF = extractTextFromPDF;
window.extractTextFromDOCX = extractTextFromDOCX;
window.extractTextFromTXT = extractTextFromTXT;
window.validateDocument = validateDocument;
window.extractTextFromFile = extractTextFromFile;

console.log('[Document Extraction] Module loaded successfully');
