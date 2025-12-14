/**
 * App Version - Single Source of Truth
 * Update this version for cache-busting on deployments
 * Format: YYYYMMDD-N (e.g., 20251108-1)
 *
 * Current Release: MVP v2
 * - 2x2 grid status indicators optimized for mobile
 * - Chat history UI with icon-only delete button
 * - Enhanced processing transcript with conversation flow
 * - Websearch context persistence
 * - Android Auto TTS screen behavior
 * - Hybrid audio focus (native AudioManager for Android Auto)
 * - Version tracking in debug panel
 * - Continue chat from history (20251214-5)
 * - Fixed copy button visibility (always visible, not just on hover)
 * - Document injection: always inject when files attached (system prompt, not messages)
 */

// Export for both browser and service worker contexts
const APP_VERSION = '20251214-8'; // Fix conversationId type normalization across entire app
// Browser context
if (typeof window !== 'undefined') {
    window.APP_VERSION = APP_VERSION;
}

// Service Worker context
if (typeof self !== 'undefined' && self.constructor.name === 'ServiceWorkerGlobalScope') {
    self.APP_VERSION = APP_VERSION;
}

// Node.js / ES Module context
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { APP_VERSION };
}
