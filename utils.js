/**
 * utils.js - Utility Functions
 *
 * Common utility functions used across the application.
 * Functions are exported to window.* for global access.
 */

/**
 * Escape HTML entities to prevent XSS attacks
 * @param {string} str - String to escape
 * @returns {string} - Escaped HTML string
 */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Escape text for use in HTML attributes (data-* attributes)
 * Handles quotes, newlines, and special characters properly
 * @param {string} str - String to escape
 * @returns {string} - Escaped attribute string
 */
function escapeAttribute(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '&#10;')  // Preserve newlines
        .replace(/\r/g, '');       // Remove carriage returns
}

// detectTextLanguage() REMOVED - LLM now returns language code in JSON response

/**
 * Convert base64 string to Blob object
 * @param {string} base64 - Base64 encoded data
 * @param {string} mimeType - MIME type (e.g. 'audio/webm')
 * @returns {Blob|null} - Blob object or null on error
 */
function base64ToBlob(base64, mimeType) {
    try {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: mimeType });
    } catch (error) {
        console.error('❌ Failed to convert base64 to blob:', error);
        return null;
    }
}

/**
 * Format Brave Search results into human-readable text
 * @param {Object} searchResults - Search results from Brave API
 * @returns {string} - Formatted search results text
 */
function formatSearchResults(searchResults) {
    if (!searchResults.results || searchResults.results.length === 0) {
        return 'No search results found.';
    }

    return searchResults.results.map((result, index) =>
        `${index + 1}. ${result.title}\n   ${result.description}\n   Source: ${result.url}`
    ).join('\n\n');
}

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy string matching
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Edit distance
 */
function levenshteinDistance(str1, str2) {
    if (!str1 || !str2) return Math.max(str1?.length || 0, str2?.length || 0);
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();
    const len1 = s1.length;
    const len2 = s2.length;

    // Create 2D array for dynamic programming
    const matrix = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));

    // Initialize first row and column
    for (let i = 0; i <= len1; i++) matrix[i][0] = i;
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;

    // Fill matrix
    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,      // deletion
                matrix[i][j - 1] + 1,      // insertion
                matrix[i - 1][j - 1] + cost // substitution
            );
        }
    }

    return matrix[len1][len2];
}

/**
 * Calculate similarity percentage between two strings
 * Returns 0-100, where 100 is exact match
 * Used for fuzzy contact matching (e.g., "Aki" vs "Akki" = 75%)
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Similarity percentage (0-100)
 */
function calculateSimilarity(str1, str2) {
    const maxLen = Math.max(str1.length, str2.length);
    if (maxLen === 0) return 100; // Both empty strings
    const distance = levenshteinDistance(str1, str2);
    return Math.round((1 - distance / maxLen) * 100);
}

/**
 * Find best matching contacts with similarity scores
 * Always returns top matches - never fails even if similarity is low
 *
 * @param {string} searchName - Name to search for
 * @param {Array} contacts - Array of contact objects
 * @param {string} requireField - 'email' | 'phone' | null (filter by required field)
 * @returns {Array} - Top 10 contacts sorted by similarity, with similarity scores added
 */
function findBestContactMatches(searchName, contacts, requireField = null) {
    console.log('[ContactMatcher] Searching for:', searchName, 'in', contacts.length, 'contacts (require:', requireField || 'any', ')');

    /**
     * Calculate contact similarity with smart scoring
     * Prioritizes: exact match > starts with > word match > fuzzy match
     */
    function calculateContactSimilarity(searchTerm, contactName) {
        const search = searchTerm.toLowerCase().trim();
        const name = contactName.toLowerCase().trim();

        if (search === name) return 100; // Exact match
        if (name.startsWith(search + ' ') || name.startsWith(search)) {
            return 95; // Name starts with search
        }

        const words = name.split(/\s+/);
        if (words.some(word => word === search || word.startsWith(search))) {
            return 90; // Word-level match
        }

        return calculateSimilarity(search, name); // Fuzzy Levenshtein match
    }

    // Filter by required field if specified
    let filteredContacts = contacts;
    if (requireField === 'email') {
        filteredContacts = contacts.filter(c => c.email && c.email.trim() !== '');
    } else if (requireField === 'phone') {
        filteredContacts = contacts.filter(c => c.phone && c.phone.trim() !== '');
    }

    console.log('[ContactMatcher] Filtered to', filteredContacts.length, 'contacts with', requireField || 'any field');

    // Calculate similarity for all contacts
    const contactsWithScores = filteredContacts.map(c => ({
        ...c,
        similarity: calculateContactSimilarity(searchName, c.name)
    }));

    // Sort by similarity (highest first) and take top 10
    const topMatches = contactsWithScores
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 10);

    console.log('[ContactMatcher] Top matches:', topMatches.map(c => `${c.name} (${c.similarity}%)`));

    return topMatches;
}

/**
 * Get today's messages from IndexedDB
 * @returns {Promise<Array>} - Array of today's messages
 */
async function getTodayMessages() {
    const today = new Date().toISOString().split('T')[0];
    const allMessages = await window.getChatHistory(1000);
    return allMessages.filter(m => m.timestamp && m.timestamp.startsWith(today));
}

// Export functions to window object for global access
window.escapeHtml = escapeHtml;
window.escapeAttribute = escapeAttribute;
// detectTextLanguage REMOVED - LLM now returns language in JSON response
window.base64ToBlob = base64ToBlob;
window.formatSearchResults = formatSearchResults;
window.levenshteinDistance = levenshteinDistance;
window.calculateSimilarity = calculateSimilarity;
window.findBestContactMatches = findBestContactMatches;
window.getTodayMessages = getTodayMessages;

console.log('[utils.js] Utility functions loaded');
