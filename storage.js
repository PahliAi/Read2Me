/**
 * IndexedDB Storage for Local User Preferences and Chat History
 * Stores first-time user flag, beep test results, and chat conversation history
 */

const DB_NAME = 'MilaAppDB';
const DB_VERSION = 7;  // ✨ v7: Add documents + summaries stores for "Summarize & Read" feature
const STORE_NAME = 'userPreferences';
const CHAT_HISTORY_STORE = 'chatHistory';  // ✨ NEW: Chat history store
const CONTACTS_STORE = 'contacts';  // ✨ v4: Email contacts store (v5: added phone field, v6: email non-unique)
const DOCUMENTS_STORE = 'documents';  // ✨ v7: Uploaded documents (PDF/DOCX/TXT)
const SUMMARIES_STORE = 'summaries';  // ✨ v7: Cached summaries (many-to-one with documents)

let db = null;

/**
 * Initialize IndexedDB
 */
async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('IndexedDB error:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      console.log('IndexedDB initialized');
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const oldVersion = event.oldVersion;

      console.log(`[IndexedDB] Upgrading from version ${oldVersion} to ${DB_VERSION}`);

      // Create userPreferences object store if it doesn't exist (v1)
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        console.log('[IndexedDB] Created object store:', STORE_NAME);
      }

      // ✨ NEW: Create chatHistory object store (v2)
      if (!db.objectStoreNames.contains(CHAT_HISTORY_STORE)) {
        const chatStore = db.createObjectStore(CHAT_HISTORY_STORE, {
          keyPath: 'id',
          autoIncrement: false  // We'll use timestamps as IDs
        });
        // Create index on timestamp for efficient sorting
        chatStore.createIndex('timestamp', 'timestamp', { unique: false });
        // Create index on role for filtering by message type
        chatStore.createIndex('role', 'role', { unique: false });
        // Create index on conversationId for grouping messages
        chatStore.createIndex('conversationId', 'conversationId', { unique: false });
        console.log('[IndexedDB] Created chat history object store with indexes');
      }

      // ✨ v3: Add conversationId index to existing chatHistory store
      if (oldVersion < 3 && db.objectStoreNames.contains(CHAT_HISTORY_STORE)) {
        const transaction = event.target.transaction;
        const chatStore = transaction.objectStore(CHAT_HISTORY_STORE);

        // Check if index already exists
        if (!chatStore.indexNames.contains('conversationId')) {
          chatStore.createIndex('conversationId', 'conversationId', { unique: false });
          console.log('[IndexedDB] Added conversationId index to chatHistory store');
        }
      }

      // ✨ v4: Create contacts object store
      if (!db.objectStoreNames.contains(CONTACTS_STORE)) {
        const contactsStore = db.createObjectStore(CONTACTS_STORE, {
          keyPath: 'id',
          autoIncrement: true  // Auto-incrementing ID for each contact
        });
        // Create index on name for searching
        contactsStore.createIndex('name', 'name', { unique: false });
        // Create index on email for duplicate checking
        contactsStore.createIndex('email', 'email', { unique: true });
        console.log('[IndexedDB] Created contacts object store with indexes');
      }

      // ✨ v5: Add phone index to contacts store
      if (oldVersion < 5 && db.objectStoreNames.contains(CONTACTS_STORE)) {
        const transaction = event.target.transaction;
        const contactsStore = transaction.objectStore(CONTACTS_STORE);

        // Add phone index if it doesn't exist (non-unique, multiple contacts can have same number)
        if (!contactsStore.indexNames.contains('phone')) {
          contactsStore.createIndex('phone', 'phone', { unique: false });
          console.log('[IndexedDB] Added phone index to contacts store (v5)');
        }
      }

      // ✨ v6: Remove unique constraint from email index (allow shared family emails)
      if (oldVersion < 6 && db.objectStoreNames.contains(CONTACTS_STORE)) {
        const transaction = event.target.transaction;
        const contactsStore = transaction.objectStore(CONTACTS_STORE);

        // Delete old unique email index
        if (contactsStore.indexNames.contains('email')) {
          contactsStore.deleteIndex('email');
          console.log('[IndexedDB] Deleted unique email index');
        }

        // Recreate as non-unique (allows multiple contacts with same email)
        contactsStore.createIndex('email', 'email', { unique: false });
        console.log('[IndexedDB] Created non-unique email index (v6) - shared emails now allowed');
      }

      // ✨ v7: Create documents object store for "Summarize & Read" feature
      if (!db.objectStoreNames.contains(DOCUMENTS_STORE)) {
        const documentsStore = db.createObjectStore(DOCUMENTS_STORE, {
          keyPath: 'id',
          autoIncrement: true
        });
        // Create index on filename for searching/sorting
        documentsStore.createIndex('filename', 'filename', { unique: false });
        // Create index on uploadedAt for sorting by date
        documentsStore.createIndex('uploadedAt', 'uploadedAt', { unique: false });
        console.log('[IndexedDB] Created documents object store with indexes (v7)');
      }

      // ✨ v7: Create summaries object store for cached document summaries
      if (!db.objectStoreNames.contains(SUMMARIES_STORE)) {
        const summariesStore = db.createObjectStore(SUMMARIES_STORE, {
          keyPath: 'id',
          autoIncrement: true
        });
        // Create index on documentId for foreign key lookups
        summariesStore.createIndex('documentId', 'documentId', { unique: false });
        // Create index on createdAt for sorting by date
        summariesStore.createIndex('createdAt', 'createdAt', { unique: false });
        // Create index on language for filtering summaries by language
        summariesStore.createIndex('language', 'language', { unique: false });
        console.log('[IndexedDB] Created summaries object store with indexes (v7)');
      }
    };
  });
}

/**
 * Get value from IndexedDB
 */
async function getStorageItem(key) {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const objectStore = transaction.objectStore(STORE_NAME);
    const request = objectStore.get(key);

    request.onsuccess = () => {
      resolve(request.result ? request.result.value : null);
    };

    request.onerror = () => {
      console.error('Error getting item:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Set value in IndexedDB
 */
async function setStorageItem(key, value) {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const objectStore = transaction.objectStore(STORE_NAME);
    const request = objectStore.put({ key, value });

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      console.error('Error setting item:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Check if this is first time user
 */
async function isFirstTimeUser() {
  const hasCompletedSetup = await getStorageItem('hasCompletedSetup');
  return !hasCompletedSetup;
}

/**
 * Mark setup as completed
 */
async function markSetupCompleted(beepsDetected, selectedEngine) {
  await setStorageItem('hasCompletedSetup', true);
  await setStorageItem('beepsDetected', beepsDetected);
  await setStorageItem('selectedWakeWordEngine', selectedEngine);
  await setStorageItem('setupCompletedAt', new Date().toISOString());
}

/**
 * Get stored preferences
 */
async function getStoredPreferences() {
  return {
    hasCompletedSetup: await getStorageItem('hasCompletedSetup'),
    beepsDetected: await getStorageItem('beepsDetected'),
    selectedWakeWordEngine: await getStorageItem('selectedWakeWordEngine'),
    setupCompletedAt: await getStorageItem('setupCompletedAt')
  };
}

// ========== ✨ NEW: Chat History Functions ==========

/**
 * Save a chat message to IndexedDB
 * @param {Object} message - The message object
 * @param {string} message.role - 'user' | 'assistant' | 'search_query' | 'search_results'
 * @param {string} message.content - The message content
 * @param {string} [message.searchQuery] - Optional search query (for search_query role)
 * @param {Array} [message.searchResults] - Optional search results (for search_results role)
 * @param {Array} [message.attachedFiles] - Optional attached file metadata (for user role)
 * @returns {Promise<number>} The message ID
 */
async function saveChatMessage(message) {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CHAT_HISTORY_STORE], 'readwrite');
    const objectStore = transaction.objectStore(CHAT_HISTORY_STORE);

    // Create message with timestamp ID
    const messageWithId = {
      id: Date.now(),
      timestamp: Date.now(),
      role: message.role,
      content: message.content,
      // Always include conversationId field (even if undefined) to ensure proper grouping
      conversationId: message.conversationId,
      ...(message.searchQuery && { searchQuery: message.searchQuery }),
      ...(message.searchResults && { searchResults: message.searchResults }),
      ...(message.attachedFiles && { attachedFiles: message.attachedFiles })
    };

    const request = objectStore.add(messageWithId);

    request.onsuccess = () => {
      console.log('[ChatHistory] Message saved:', messageWithId.role, messageWithId.id);
      resolve(messageWithId.id);
    };

    request.onerror = () => {
      console.error('[ChatHistory] Error saving message:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Get chat history from IndexedDB
 * @param {number} [limit] - Maximum number of messages to retrieve (default: 100)
 * @returns {Promise<Array>} Array of messages sorted by timestamp (newest first)
 */
async function getChatHistory(limit = 100) {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CHAT_HISTORY_STORE], 'readonly');
    const objectStore = transaction.objectStore(CHAT_HISTORY_STORE);
    const index = objectStore.index('timestamp');

    // Get all messages (sorted by timestamp, descending)
    const request = index.openCursor(null, 'prev'); // 'prev' for descending order
    const messages = [];
    let count = 0;

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor && count < limit) {
        messages.push(cursor.value);
        count++;
        cursor.continue();
      } else {
        console.log(`[ChatHistory] Retrieved ${messages.length} messages`);
        resolve(messages);
      }
    };

    request.onerror = () => {
      console.error('[ChatHistory] Error retrieving history:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Delete a specific chat message
 * @param {number} messageId - The message ID to delete
 * @returns {Promise<void>}
 */
async function deleteChatMessage(messageId) {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CHAT_HISTORY_STORE], 'readwrite');
    const objectStore = transaction.objectStore(CHAT_HISTORY_STORE);
    const request = objectStore.delete(messageId);

    request.onsuccess = () => {
      console.log('[ChatHistory] Message deleted:', messageId);
      resolve();
    };

    request.onerror = () => {
      console.error('[ChatHistory] Error deleting message:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Delete all messages in a conversation
 * @param {string|number} conversationId - The conversation ID
 * @returns {Promise<void>}
 */
async function deleteChatConversation(conversationId) {
  if (!db) await initDB();

  // Normalize conversationId: convert numeric strings to numbers for IndexedDB comparison
  // (timestamps are stored as numbers, but may be passed as strings from HTML onclick)
  const normalizedId = typeof conversationId === 'string' && /^\d+$/.test(conversationId)
    ? Number(conversationId)
    : conversationId;

  console.log('[ChatHistory] deleteChatConversation called with:', conversationId, '→ normalized to:', normalizedId, '(type:', typeof normalizedId + ')');

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CHAT_HISTORY_STORE], 'readwrite');
    const objectStore = transaction.objectStore(CHAT_HISTORY_STORE);

    // Check if conversationId index exists (backwards compatibility)
    const hasIndex = objectStore.indexNames.contains('conversationId');
    const messagesToDelete = [];

    if (hasIndex) {
      // Use index for fast lookup (preferred method)
      // Try both number and string versions since IndexedDB requires exact type match
      const index = objectStore.index('conversationId');

      // First, scan with cursor to handle type mismatches
      const request = index.openCursor();

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const msgConvId = cursor.value.conversationId;
          // Use loose equality to handle number/string mismatches
          if (msgConvId == normalizedId) {
            messagesToDelete.push(cursor.value.id);
          }
          cursor.continue();
        } else {
          // All messages collected, now delete them
          console.log('[ChatHistory] Found', messagesToDelete.length, 'messages to delete for conversation:', normalizedId);
          deleteMessages(objectStore, messagesToDelete, normalizedId, resolve);
        }
      };

      request.onerror = () => {
        console.error('[ChatHistory] Error reading conversation:', request.error);
        reject(request.error);
      };
    } else {
      // Fallback: Scan all messages (for old databases without index)
      console.warn('[ChatHistory] conversationId index not found, using fallback scan');
      const request = objectStore.openCursor();

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const msg = cursor.value;
          const msgConvId = msg.conversationId || `legacy_${msg.id}`;
          // Use loose equality to handle number/string mismatches
          if (msgConvId == normalizedId || msgConvId === normalizedId) {
            messagesToDelete.push(msg.id);
          }
          cursor.continue();
        } else {
          // All messages scanned, now delete matches
          deleteMessages(objectStore, messagesToDelete, normalizedId, resolve);
        }
      };

      request.onerror = () => {
        console.error('[ChatHistory] Error scanning messages:', request.error);
        reject(request.error);
      };
    }
  });
}

/**
 * Helper function to delete messages by ID
 * @private
 */
function deleteMessages(objectStore, messageIds, conversationId, resolve) {
  console.log('[ChatHistory] Deleting', messageIds.length, 'messages from conversation:', conversationId);

  if (messageIds.length === 0) {
    console.log('[ChatHistory] No messages found for conversation:', conversationId);
    resolve();
    return;
  }

  let deleteCount = 0;
  messageIds.forEach(messageId => {
    const deleteRequest = objectStore.delete(messageId);
    deleteRequest.onsuccess = () => {
      deleteCount++;
      if (deleteCount === messageIds.length) {
        console.log('[ChatHistory] Conversation deleted:', conversationId);
        resolve();
      }
    };
    deleteRequest.onerror = () => {
      console.error('[ChatHistory] Error deleting message:', messageId);
      // Continue even if one fails
      deleteCount++;
      if (deleteCount === messageIds.length) {
        resolve();
      }
    };
  });
}

/**
 * Clear all chat history
 * @returns {Promise<void>}
 */
async function clearChatHistory() {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CHAT_HISTORY_STORE], 'readwrite');
    const objectStore = transaction.objectStore(CHAT_HISTORY_STORE);
    const request = objectStore.clear();

    request.onsuccess = () => {
      console.log('[ChatHistory] All chat history cleared');
      resolve();
    };

    request.onerror = () => {
      console.error('[ChatHistory] Error clearing history:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Clean up orphaned websearch messages (search_query/search_results without user/assistant messages)
 * @returns {Promise<number>} Number of orphaned messages deleted
 */
async function cleanupOrphanedWebsearchMessages() {
  if (!db) await initDB();

  return new Promise(async (resolve, reject) => {
    try {
      const transaction = db.transaction([CHAT_HISTORY_STORE], 'readwrite');
      const objectStore = transaction.objectStore(CHAT_HISTORY_STORE);
      const request = objectStore.getAll();

      request.onsuccess = async () => {
        const allMessages = request.result;
        console.log('[ChatHistory] Checking', allMessages.length, 'messages for orphans');

        // Group messages by conversationId
        const conversationMap = new Map();
        allMessages.forEach(msg => {
          const convId = msg.conversationId || msg.id;
          if (!conversationMap.has(convId)) {
            conversationMap.set(convId, []);
          }
          conversationMap.get(convId).push(msg);
        });

        // Find orphaned websearch data:
        // 1. Conversations with ONLY search_query/search_results (no user/assistant)
        // 2. User messages that start with "[LIVE WEB SEARCH COMPLETED]" (buggy enhanced messages)
        const orphanedIds = [];
        conversationMap.forEach((messages, convId) => {
          const hasUserOrAssistant = messages.some(m => m.role === 'user' || m.role === 'assistant');
          const hasWebsearchOnly = messages.every(m => m.role === 'search_query' || m.role === 'search_results');

          // Orphaned websearch metadata (search_query/search_results without conversation)
          if (!hasUserOrAssistant && hasWebsearchOnly) {
            console.log('[ChatHistory] Found orphaned websearch metadata:', convId, messages.map(m => m.role));
            messages.forEach(m => orphanedIds.push(m.id));
          }

          // Buggy enhanced user messages (should have been sent to LLM only, NEVER saved to DB)
          // Delete ALL of them - they're bugs regardless of having assistant responses
          const enhancedUserMsgs = messages.filter(m =>
            m.role === 'user' && m.content && m.content.startsWith('[LIVE WEB SEARCH COMPLETED]')
          );

          if (enhancedUserMsgs.length > 0) {
            console.log('[ChatHistory] Found', enhancedUserMsgs.length, 'buggy enhanced user messages in conv:', convId);
            enhancedUserMsgs.forEach(m => {
              console.log('[ChatHistory] Deleting enhanced message:', m.id, m.content.substring(0, 50) + '...');
              orphanedIds.push(m.id);
            });
          }
        });

        if (orphanedIds.length === 0) {
          console.log('[ChatHistory] No orphaned websearch messages found');
          resolve(0);
          return;
        }

        // Delete orphaned messages
        const deleteTransaction = db.transaction([CHAT_HISTORY_STORE], 'readwrite');
        const deleteStore = deleteTransaction.objectStore(CHAT_HISTORY_STORE);
        let deletedCount = 0;

        orphanedIds.forEach(id => {
          deleteStore.delete(id);
          deletedCount++;
        });

        deleteTransaction.oncomplete = () => {
          console.log('[ChatHistory] Deleted', deletedCount, 'orphaned websearch messages');
          resolve(deletedCount);
        };

        deleteTransaction.onerror = () => {
          console.error('[ChatHistory] Error deleting orphaned messages:', deleteTransaction.error);
          reject(deleteTransaction.error);
        };
      };

      request.onerror = () => {
        console.error('[ChatHistory] Error loading messages for cleanup:', request.error);
        reject(request.error);
      };
    } catch (error) {
      console.error('[ChatHistory] Cleanup error:', error);
      reject(error);
    }
  });
}

/**
 * Get chat history count
 * @returns {Promise<number>}
 */
async function getChatHistoryCount() {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CHAT_HISTORY_STORE], 'readonly');
    const objectStore = transaction.objectStore(CHAT_HISTORY_STORE);
    const request = objectStore.count();

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      console.error('[ChatHistory] Error counting messages:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Create example conversations on first startup to help users understand app capabilities
 * @returns {Promise<void>}
 */
async function createExampleConversations() {
  if (!db) await initDB();

  // Check if examples have EVER been created (using a flag in MilaAppDB)
  const examplesCreated = await getStorageItem('examplesCreated');
  if (examplesCreated === true) {
    console.log('[ChatHistory] Example conversations skipped - already created on first startup');
    return;
  }

  console.log('[ChatHistory] Creating example conversations for first-time users...');

  const now = Date.now();
  const oneHourAgo = now - (1 * 60 * 60 * 1000);
  const twoHoursAgo = now - (2 * 60 * 60 * 1000);
  const threeDaysAgo = now - (3 * 24 * 60 * 60 * 1000);
  const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000);

  // Example conversations array (reverse chronological order - newest first)
  const examples = [
    // 1. SMS example (MOST RECENT - 30 min ago)
    {
      conversationId: now - (30 * 60 * 1000),
      title: 'EXAMPLE FEATURE: SMS',  // Custom title for this example
      messages: [
        {
          id: now - (30 * 60 * 1000),
          timestamp: now - (30 * 60 * 1000),
          role: 'user',
          content: 'Find the lyrics to Lady In Red, translate into French and send it to my friend Marie-Antoinette.'
        },
        {
          id: now - (29 * 60 * 1000),
          timestamp: now - (29 * 60 * 1000),
          role: 'assistant',
          content: `📱 SMS message composed:
To: Marie-Antoinette

**Lady in Red (Chris de Burgh) - French Translation**
La Dame en Rouge

Je ne t'ai jamais vue aussi belle qu'aujourd'hui...
(Lyrics abbreviated for SMS)`
        }
      ]
    },

    // 2. WhatsApp example (1 hour ago)
    {
      conversationId: oneHourAgo,
      title: 'EXAMPLE FEATURE: WhatsApp (to self)',
      messages: [
        {
          id: oneHourAgo,
          timestamp: oneHourAgo,
          role: 'user',
          content: 'Grocery list: 2 apples, butter, fabric softener, bananas, chocolate milk, never mind about the bananas I still have them. Whatsapp this to myself. Oh yeah, also add some kiwi\'s, the yellow ones'
        },
        {
          id: oneHourAgo + 1,
          timestamp: oneHourAgo + 1,
          role: 'assistant',
          content: `💬 WhatsApp message composed:
To: Myself

Shopping list:
• 2 apples
• Butter
• Fabric softener
• Chocolate milk
• Yellow kiwis`
        }
      ]
    },

    // 3. Email example (2 hours ago)
    {
      conversationId: twoHoursAgo,
      title: 'EXAMPLE FEATURE: Email',
      messages: [
        {
          id: twoHoursAgo,
          timestamp: twoHoursAgo,
          role: 'user',
          content: 'Find the winners of all F1 races in 2020 and list them Country, Trackname, Winner and send them to my wife Angela'
        },
        {
          id: twoHoursAgo + 1,
          timestamp: twoHoursAgo + 1,
          role: 'assistant',
          content: `📧 Email composed:
To: Angela
Subject: 2020 F1 Race Winners

Hi,

**2020 F1 Race Winners**
1. Austria - Red Bull Ring - Valtteri Bottas
2. Austria - Red Bull Ring - Lewis Hamilton (Styrian GP)
3. Hungary - Hungaroring - Lewis Hamilton
... (17 races total - abbreviated for example)`
        }
      ]
    },

    // 4. Web search example (3 days ago)
    {
      conversationId: threeDaysAgo,
      title: 'EXAMPLE FEATURE: Chat with Websearch',
      messages: [
        {
          id: threeDaysAgo,
          timestamp: threeDaysAgo,
          role: 'user',
          content: 'What is the current price of bitcoin in the national currency of Japan?'
        },
        {
          id: threeDaysAgo + 1,
          timestamp: threeDaysAgo + 1,
          role: 'search_query',
          content: 'Web search performed',
          searchQuery: 'current bitcoin price JPY Japanese Yen'
        },
        {
          id: threeDaysAgo + 2,
          timestamp: threeDaysAgo + 2,
          role: 'search_results',
          content: 'Search results retrieved',
          searchResults: [
            {
              title: 'Bitcoin Price in Japanese Yen - Live Chart',
              url: 'https://example.com/btc-jpy',
              description: 'Track Bitcoin price in real-time against Japanese Yen (JPY). Current rate, historical data, and market analysis.'
            }
          ]
        },
        {
          id: threeDaysAgo + 3,
          timestamp: threeDaysAgo + 3,
          role: 'assistant',
          content: `Based on current market data, Bitcoin is trading at approximately ¥14,500,000 JPY (Japanese Yen).

The Japanese Yen (¥, JPY) is Japan's official currency. Cryptocurrency prices are highly volatile and can change significantly within minutes.`
        }
      ]
    },

    // 5. Simple chat example (1 week ago - OLDEST)
    {
      conversationId: oneWeekAgo,
      title: 'EXAMPLE FEATURE: Chat',
      messages: [
        {
          id: oneWeekAgo,
          timestamp: oneWeekAgo,
          role: 'user',
          content: 'When was the fall of the Berlin wall? Tell a short max 300 word history about it.'
        },
        {
          id: oneWeekAgo + 1,
          timestamp: oneWeekAgo + 1,
          role: 'assistant',
          content: `The Berlin Wall fell on November 9, 1989, marking one of the most significant moments in modern history.

Built in 1961, the Wall was erected by East Germany to prevent citizens from fleeing to West Berlin. For 28 years, it stood as a barrier between communist East and capitalist West during the Cold War.

By the late 1980s, reforms in the Soviet Union weakened communist control across Eastern Europe. On November 9, East German officials mistakenly announced that travel restrictions would be lifted "immediately." Thousands rushed to the Wall's checkpoints, overwhelming border guards who eventually opened the gates.

The Wall's fall triggered the collapse of communist regimes and led to German reunification on October 3, 1990.`
        }
      ]
    }
  ];

  // Insert all example conversations into IndexedDB
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CHAT_HISTORY_STORE], 'readwrite');
    const objectStore = transaction.objectStore(CHAT_HISTORY_STORE);

    let completed = 0;
    const totalMessages = examples.reduce((sum, conv) => sum + conv.messages.length, 0);

    examples.forEach(conversation => {
      conversation.messages.forEach(msg => {
        const messageWithConvId = {
          ...msg,
          conversationId: conversation.conversationId,
          // Add custom title to first message of conversation (used for display)
          customTitle: conversation.title || null
        };

        const request = objectStore.add(messageWithConvId);

        request.onsuccess = () => {
          completed++;
          if (completed === totalMessages) {
            console.log('[ChatHistory] ✅ Created', examples.length, 'example conversations with', totalMessages, 'messages');
            // Set flag to prevent creating examples again
            setStorageItem('examplesCreated', true).then(() => {
              console.log('[ChatHistory] ✅ Set examplesCreated flag');
              resolve();
            }).catch(err => {
              console.error('[ChatHistory] Failed to set examplesCreated flag:', err);
              resolve(); // Don't fail the whole operation
            });
          }
        };

        request.onerror = () => {
          console.error('[ChatHistory] Error creating example message:', request.error);
          // Continue even if one fails
          completed++;
          if (completed === totalMessages) {
            // Set flag even if some examples failed
            setStorageItem('examplesCreated', true).then(() => {
              console.log('[ChatHistory] ✅ Set examplesCreated flag (with some errors)');
              resolve();
            }).catch(err => {
              console.error('[ChatHistory] Failed to set examplesCreated flag:', err);
              resolve();
            });
          }
        };
      });
    });
  });
}

/**
 * ========== CONTACTS MANAGEMENT ==========
 */

/**
 * Add a new contact
 * @param {object} contact - Contact object { name, email, phone }
 * @returns {Promise<number>} The ID of the new contact
 */
async function addContact(contact) {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CONTACTS_STORE], 'readwrite');
    const objectStore = transaction.objectStore(CONTACTS_STORE);

    const request = objectStore.add({
      name: contact.name,
      email: contact.email || null,
      phone: contact.phone || null,
      createdAt: Date.now()
    });

    request.onsuccess = () => {
      console.log('[Contacts] Added contact:', contact.name, '(ID:', request.result, ')');
      resolve(request.result);
    };

    request.onerror = () => {
      console.error('[Contacts] Error adding contact:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Get all contacts (merges device contacts + Mila app contacts)
 * @returns {Promise<Array>} Array of contact objects
 */
async function getAllContacts() {
  const allContacts = [];

  // 1. Get Mila app contacts first (stored in IndexedDB)
  if (!db) await initDB();

  const milaContacts = await new Promise((resolve, reject) => {
    const transaction = db.transaction([CONTACTS_STORE], 'readonly');
    const objectStore = transaction.objectStore(CONTACTS_STORE);
    const request = objectStore.getAll();

    request.onsuccess = () => {
      const contacts = request.result;
      console.log('[Contacts] Retrieved', contacts.length, 'Mila app contacts');
      // Mark Mila app contacts with a flag
      contacts.forEach(c => c.isIndexedDB = true);
      resolve(contacts);
    };

    request.onerror = () => {
      console.error('[Contacts] Error getting Mila app contacts:', request.error);
      reject(request.error);
    };
  });

  allContacts.push(...milaContacts);

  // 2. Try to get device contacts via Flutter bridge (Android only)
  if (typeof window.flutter_inappwebview !== 'undefined') {
    try {
      console.log('[Contacts] Attempting to retrieve device contacts via Flutter bridge...');

      // Request contacts permission first
      const hasPermission = await window.flutter_inappwebview.callHandler('requestContactsPermission');

      if (hasPermission) {
        const contactsJson = await window.flutter_inappwebview.callHandler('getAllContacts');

        if (contactsJson) {
          const deviceContacts = JSON.parse(contactsJson);
          console.log('[Contacts] ✅ Retrieved', deviceContacts.length, 'device contacts');

          // Mark device contacts with a flag
          deviceContacts.forEach(c => c.isNative = true);
          allContacts.push(...deviceContacts);
        }
      } else {
        console.warn('[Contacts] ⚠️ Device contacts permission denied');
      }
    } catch (error) {
      console.warn('[Contacts] ⚠️ Failed to retrieve device contacts:', error);
    }
  }

  console.log('[Contacts] Total merged contacts:', allContacts.length, '(Mila app:', milaContacts.length, ', Device:', allContacts.length - milaContacts.length, ')');
  return allContacts;
}

/**
 * Search contacts by name (searches BOTH Mila app AND device contacts)
 * EXTENDED: Now filters results based on required field (email/phone)
 *
 * @param {string} searchName - Name to search for
 * @param {string} [requireField] - 'email' | 'phone' | null (filter results by field presence)
 * @returns {Promise<Array>} Array of matching contact objects
 */
async function searchContactsByName(searchName, requireField = null) {
  if (!searchName) {
    console.warn('[ContactSearch] No search name provided');
    return [];
  }
  const normalizedSearch = searchName.toLowerCase().trim();
  const matches = [];

  // 1. Search Mila app contacts first
  const allContactsFromDB = await getAllContacts();
  let milaMatches = allContactsFromDB.filter(contact =>
    contact.name && contact.name.toLowerCase().includes(normalizedSearch)
  );

  // Filter by required field if specified
  if (requireField === 'email') {
    milaMatches = milaMatches.filter(c => c.email && c.email.trim() !== '');
  } else if (requireField === 'phone') {
    milaMatches = milaMatches.filter(c => c.phone && c.phone.trim() !== '');
  }

  matches.push(...milaMatches);
  console.log('[Contacts] Found', milaMatches.length, `matches in Mila app (require: ${requireField || 'any'})`);

  // 2. If running in Flutter app, also search device contacts
  const hasFlutterBridge = typeof window.flutter_inappwebview !== 'undefined';
  if (hasFlutterBridge) {
    try {
      console.log('[Contacts] Searching device contacts for:', searchName);
      const contactsJson = await window.flutter_inappwebview.callHandler('getAllContacts');
      const deviceContacts = JSON.parse(contactsJson);

      let deviceMatches = deviceContacts.filter(contact =>
        contact.name && contact.name.toLowerCase().includes(normalizedSearch)
      );

      // Filter by required field
      if (requireField === 'email') {
        deviceMatches = deviceMatches.filter(c => c.email && c.email.trim() !== '');
      } else if (requireField === 'phone') {
        deviceMatches = deviceMatches.filter(c => c.phone && c.phone.trim() !== '');
      }

      // Mark device contacts to distinguish them
      deviceMatches.forEach(contact => {
        contact.isNative = true;
      });

      matches.push(...deviceMatches);
      console.log('[Contacts] Found', deviceMatches.length, `matches in device contacts (require: ${requireField || 'any'})`);
    } catch (error) {
      console.error('[Contacts] Failed to search device contacts:', error);
    }
  }

  console.log('[Contacts] Total matches found:', matches.length);
  return matches;
}

/**
 * Find contacts by phone number
 * @param {string} phone - Phone number (international format)
 * @returns {Promise<Array>} Contacts with this phone (non-unique, can have multiple)
 */
async function findContactsByPhone(phone) {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CONTACTS_STORE], 'readonly');
    const objectStore = transaction.objectStore(CONTACTS_STORE);

    // Check if phone index exists (backwards compatibility)
    if (!objectStore.indexNames.contains('phone')) {
      console.warn('[Contacts] Phone index not found, using fallback scan');
      // Fallback: scan all contacts
      const request = objectStore.getAll();
      request.onsuccess = () => {
        const matches = request.result.filter(c => c.phone === phone);
        console.log('[Contacts] Found', matches.length, 'contacts with phone (fallback):', phone);
        resolve(matches);
      };
      request.onerror = () => reject(request.error);
      return;
    }

    const index = objectStore.index('phone');
    const request = index.getAll(phone);

    request.onsuccess = () => {
      console.log('[Contacts] Found', request.result.length, 'contacts with phone:', phone);
      resolve(request.result);
    };

    request.onerror = () => {
      console.error('[Contacts] Error finding contact by phone:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Get a single contact by ID
 * @param {number} id - Contact ID
 * @returns {Promise<object|null>} Contact object or null
 */
async function getContact(id) {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CONTACTS_STORE], 'readonly');
    const objectStore = transaction.objectStore(CONTACTS_STORE);
    const request = objectStore.get(id);

    request.onsuccess = () => {
      resolve(request.result || null);
    };

    request.onerror = () => {
      console.error('[Contacts] Error getting contact:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Update a contact
 * @param {object} contact - Contact object with id
 * @returns {Promise<void>}
 */
async function updateContact(contact) {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CONTACTS_STORE], 'readwrite');
    const objectStore = transaction.objectStore(CONTACTS_STORE);
    const request = objectStore.put(contact);

    request.onsuccess = () => {
      console.log('[Contacts] Updated contact:', contact.name);
      resolve();
    };

    request.onerror = () => {
      console.error('[Contacts] Error updating contact:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Delete a contact
 * @param {number} id - Contact ID
 * @returns {Promise<void>}
 */
async function deleteContact(id) {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CONTACTS_STORE], 'readwrite');
    const objectStore = transaction.objectStore(CONTACTS_STORE);
    const request = objectStore.delete(id);

    request.onsuccess = () => {
      console.log('[Contacts] Deleted contact ID:', id);
      resolve();
    };

    request.onerror = () => {
      console.error('[Contacts] Error deleting contact:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Find contact by email
 * @param {string} email - Email address
 * @returns {Promise<object|null>} Contact object or null
 */
async function findContactByEmail(email) {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CONTACTS_STORE], 'readonly');
    const objectStore = transaction.objectStore(CONTACTS_STORE);
    const index = objectStore.index('email');
    const request = index.get(email);

    request.onsuccess = () => {
      resolve(request.result || null);
    };

    request.onerror = () => {
      console.error('[Contacts] Error finding contact by email:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Clear all contacts
 * @returns {Promise<void>}
 */
async function clearAllContacts() {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CONTACTS_STORE], 'readwrite');
    const objectStore = transaction.objectStore(CONTACTS_STORE);
    const request = objectStore.clear();

    request.onsuccess = () => {
      console.log('[Contacts] Cleared all contacts');
      resolve();
    };

    request.onerror = () => {
      console.error('[Contacts] Error clearing contacts:', request.error);
      reject(request.error);
    };
  });
}

// ========================================
// ✨ v7: DOCUMENT MANAGEMENT FUNCTIONS
// ========================================

/**
 * Add a new document to IndexedDB
 * @param {string} filename - Document filename
 * @param {string} fileType - File type (pdf, docx, txt)
 * @param {string} extractedText - Extracted text content
 * @returns {Promise<number>} Document ID
 */
async function addDocument(filename, fileType, extractedText) {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([DOCUMENTS_STORE], 'readwrite');
    const objectStore = transaction.objectStore(DOCUMENTS_STORE);

    const document = {
      filename,
      originalFileType: fileType,
      extractedText,
      textLength: extractedText.length,
      uploadedAt: Date.now()
    };

    const request = objectStore.add(document);

    request.onsuccess = () => {
      console.log('[Documents] Added document:', filename, 'ID:', request.result);
      resolve(request.result); // Returns the auto-generated ID
    };

    request.onerror = () => {
      console.error('[Documents] Error adding document:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Get all documents from IndexedDB
 * @returns {Promise<Array>} Array of documents
 */
async function getAllDocuments() {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([DOCUMENTS_STORE], 'readonly');
    const objectStore = transaction.objectStore(DOCUMENTS_STORE);
    const request = objectStore.getAll();

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => {
      console.error('[Documents] Error getting all documents:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Get a single document by ID
 * @param {number} id - Document ID
 * @returns {Promise<Object|null>} Document object or null
 */
async function getDocument(id) {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([DOCUMENTS_STORE], 'readonly');
    const objectStore = transaction.objectStore(DOCUMENTS_STORE);
    const request = objectStore.get(id);

    request.onsuccess = () => {
      resolve(request.result || null);
    };

    request.onerror = () => {
      console.error('[Documents] Error getting document:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Delete a document and all associated summaries
 * @param {number} id - Document ID
 * @returns {Promise<void>}
 */
async function deleteDocument(id) {
  if (!db) await initDB();

  return new Promise(async (resolve, reject) => {
    try {
      // First, delete all associated summaries
      await deleteSummariesByDocument(id);

      // Then delete the document
      const transaction = db.transaction([DOCUMENTS_STORE], 'readwrite');
      const objectStore = transaction.objectStore(DOCUMENTS_STORE);
      const request = objectStore.delete(id);

      request.onsuccess = () => {
        console.log('[Documents] Deleted document ID:', id);
        resolve();
      };

      request.onerror = () => {
        console.error('[Documents] Error deleting document:', request.error);
        reject(request.error);
      };
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Get document count (for enforcing 20 document limit)
 * @returns {Promise<number>} Number of documents
 */
async function getDocumentCount() {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([DOCUMENTS_STORE], 'readonly');
    const objectStore = transaction.objectStore(DOCUMENTS_STORE);
    const request = objectStore.count();

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      console.error('[Documents] Error counting documents:', request.error);
      reject(request.error);
    };
  });
}

// ========================================
// ✨ v7: SUMMARY MANAGEMENT FUNCTIONS
// ========================================

/**
 * Add a new summary to IndexedDB
 * @param {number} documentId - Foreign key to documents.id
 * @param {string} summaryText - Generated summary text
 * @param {number} level - Summarization level (5, 15, or 25)
 * @param {string} language - Language code (nl, en, fr, etc.)
 * @param {string|null} specialInstructions - Optional special instructions
 * @returns {Promise<number>} Summary ID
 */
async function addSummary(documentId, summaryText, level, language, specialInstructions = null) {
  if (!db) await initDB();

  return new Promise(async (resolve, reject) => {
    try {
      // Get document filename for denormalization
      const document = await getDocument(documentId);
      if (!document) {
        reject(new Error('Document not found'));
        return;
      }

      const transaction = db.transaction([SUMMARIES_STORE], 'readwrite');
      const objectStore = transaction.objectStore(SUMMARIES_STORE);

      const summary = {
        documentId,
        documentFilename: document.filename,
        summaryText,
        summaryLevel: level,
        language,
        specialInstructions,
        createdAt: Date.now(),
        lastReadAt: null,
        readPosition: 0
      };

      const request = objectStore.add(summary);

      request.onsuccess = () => {
        console.log('[Summaries] Added summary for document:', documentId, 'ID:', request.result);
        resolve(request.result);
      };

      request.onerror = () => {
        console.error('[Summaries] Error adding summary:', request.error);
        reject(request.error);
      };
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Get all summaries from IndexedDB
 * @returns {Promise<Array>} Array of summaries
 */
async function getAllSummaries() {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SUMMARIES_STORE], 'readonly');
    const objectStore = transaction.objectStore(SUMMARIES_STORE);
    const request = objectStore.getAll();

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => {
      console.error('[Summaries] Error getting all summaries:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Get summaries for a specific document
 * @param {number} documentId - Document ID
 * @returns {Promise<Array>} Array of summaries
 */
async function getSummariesByDocument(documentId) {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SUMMARIES_STORE], 'readonly');
    const objectStore = transaction.objectStore(SUMMARIES_STORE);
    const index = objectStore.index('documentId');
    const request = index.getAll(documentId);

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => {
      console.error('[Summaries] Error getting summaries by document:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Get a single summary by ID
 * @param {number} id - Summary ID
 * @returns {Promise<Object|null>} Summary object or null
 */
async function getSummary(id) {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SUMMARIES_STORE], 'readonly');
    const objectStore = transaction.objectStore(SUMMARIES_STORE);
    const request = objectStore.get(id);

    request.onsuccess = () => {
      resolve(request.result || null);
    };

    request.onerror = () => {
      console.error('[Summaries] Error getting summary:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Update a summary (for readPosition, lastReadAt, etc.)
 * @param {number} id - Summary ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<void>}
 */
async function updateSummary(id, updates) {
  if (!db) await initDB();

  return new Promise(async (resolve, reject) => {
    try {
      const summary = await getSummary(id);
      if (!summary) {
        reject(new Error('Summary not found'));
        return;
      }

      const transaction = db.transaction([SUMMARIES_STORE], 'readwrite');
      const objectStore = transaction.objectStore(SUMMARIES_STORE);

      const updatedSummary = { ...summary, ...updates };
      const request = objectStore.put(updatedSummary);

      request.onsuccess = () => {
        console.log('[Summaries] Updated summary ID:', id);
        resolve();
      };

      request.onerror = () => {
        console.error('[Summaries] Error updating summary:', request.error);
        reject(request.error);
      };
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Delete a single summary
 * @param {number} id - Summary ID
 * @returns {Promise<void>}
 */
async function deleteSummary(id) {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([SUMMARIES_STORE], 'readwrite');
    const objectStore = transaction.objectStore(SUMMARIES_STORE);
    const request = objectStore.delete(id);

    request.onsuccess = () => {
      console.log('[Summaries] Deleted summary ID:', id);
      resolve();
    };

    request.onerror = () => {
      console.error('[Summaries] Error deleting summary:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Delete all summaries for a document (cascade delete helper)
 * @param {number} documentId - Document ID
 * @returns {Promise<void>}
 */
async function deleteSummariesByDocument(documentId) {
  if (!db) await initDB();

  return new Promise(async (resolve, reject) => {
    try {
      const summaries = await getSummariesByDocument(documentId);

      if (summaries.length === 0) {
        resolve();
        return;
      }

      const transaction = db.transaction([SUMMARIES_STORE], 'readwrite');
      const objectStore = transaction.objectStore(SUMMARIES_STORE);

      let deletedCount = 0;
      summaries.forEach(summary => {
        const request = objectStore.delete(summary.id);
        request.onsuccess = () => {
          deletedCount++;
          if (deletedCount === summaries.length) {
            console.log('[Summaries] Deleted', deletedCount, 'summaries for document ID:', documentId);
            resolve();
          }
        };
      });
    } catch (error) {
      reject(error);
    }
  });
}

// ========================================
// EXPORTS
// ========================================

// Export functions
window.initDB = initDB;
window.getStorageItem = getStorageItem;
window.setStorageItem = setStorageItem;
window.isFirstTimeUser = isFirstTimeUser;
window.markSetupCompleted = markSetupCompleted;
window.getStoredPreferences = getStoredPreferences;

// ✨ NEW: Export chat history functions
window.saveChatMessage = saveChatMessage;
window.getChatHistory = getChatHistory;
window.deleteChatMessage = deleteChatMessage;
window.deleteChatConversation = deleteChatConversation;
window.clearChatHistory = clearChatHistory;
window.getChatHistoryCount = getChatHistoryCount;
window.cleanupOrphanedWebsearchMessages = cleanupOrphanedWebsearchMessages;
window.createExampleConversations = createExampleConversations;

// ✨ v4: Export contact management functions
window.addContact = addContact;
window.getAllContacts = getAllContacts;
window.searchContactsByName = searchContactsByName;
window.findContactsByPhone = findContactsByPhone;  // ✨ v5: Phone search
window.getContact = getContact;
window.updateContact = updateContact;
window.deleteContact = deleteContact;
window.findContactByEmail = findContactByEmail;
window.clearAllContacts = clearAllContacts;

// ✨ v7: Export document management functions
window.addDocument = addDocument;
window.getAllDocuments = getAllDocuments;
window.getDocument = getDocument;
window.deleteDocument = deleteDocument;
window.getDocumentCount = getDocumentCount;

// ✨ v7: Export summary management functions
window.addSummary = addSummary;
window.getAllSummaries = getAllSummaries;
window.getSummariesByDocument = getSummariesByDocument;
window.getSummary = getSummary;
window.updateSummary = updateSummary;
window.deleteSummary = deleteSummary;
window.deleteSummariesByDocument = deleteSummariesByDocument;

// ========================
// File Attachment State Management
// ========================

const ATTACHMENT_STORAGE_KEY = 'mila_attached_documents';

/**
 * Get array of attached document IDs
 * @returns {Array<number>} Array of document IDs
 */
function getAttachedDocumentIds() {
  try {
    const stored = localStorage.getItem(ATTACHMENT_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('[Attachments] Error reading attached documents:', error);
    return [];
  }
}

/**
 * Get full document objects for attached documents
 * @returns {Promise<Array>} Array of document objects
 */
async function getAttachedDocuments() {
  const attachedIds = getAttachedDocumentIds();
  if (attachedIds.length === 0) {
    return [];
  }

  const documents = [];
  for (const id of attachedIds) {
    const doc = await window.getDocument(id);
    if (doc) {
      documents.push(doc);
    }
  }

  console.log('[Attachments] Retrieved', documents.length, 'attached documents');
  return documents;
}

/**
 * Attach a document by ID
 * @param {number} documentId - Document ID to attach
 */
function attachDocument(documentId) {
  try {
    const attachedIds = getAttachedDocumentIds();
    if (!attachedIds.includes(documentId)) {
      attachedIds.push(documentId);
      localStorage.setItem(ATTACHMENT_STORAGE_KEY, JSON.stringify(attachedIds));
      console.log('[Attachments] Attached document:', documentId);
    }
  } catch (error) {
    console.error('[Attachments] Error attaching document:', error);
  }
}

/**
 * Remove a document from attached list
 * @param {number} documentId - Document ID to remove
 */
function removeAttachedDocument(documentId) {
  try {
    let attachedIds = getAttachedDocumentIds();
    attachedIds = attachedIds.filter(id => id !== documentId);
    localStorage.setItem(ATTACHMENT_STORAGE_KEY, JSON.stringify(attachedIds));
    console.log('[Attachments] Removed document:', documentId);
  } catch (error) {
    console.error('[Attachments] Error removing document:', error);
  }
}

/**
 * Clear all attached documents
 */
function clearAttachedDocuments() {
  try {
    localStorage.removeItem(ATTACHMENT_STORAGE_KEY);
    console.log('[Attachments] Cleared all attached documents');
  } catch (error) {
    console.error('[Attachments] Error clearing attachments:', error);
  }
}

/**
 * Toggle document attachment (attach if not attached, remove if attached)
 * @param {number} documentId - Document ID to toggle
 * @returns {boolean} True if now attached, false if now detached
 */
function toggleDocumentAttachment(documentId) {
  const attachedIds = getAttachedDocumentIds();
  const isAttached = attachedIds.includes(documentId);

  if (isAttached) {
    removeAttachedDocument(documentId);
    return false;
  } else {
    attachDocument(documentId);
    return true;
  }
}

// Export attachment functions
window.getAttachedDocumentIds = getAttachedDocumentIds;
window.getAttachedDocuments = getAttachedDocuments;
window.attachDocument = attachDocument;
window.removeAttachedDocument = removeAttachedDocument;
window.clearAttachedDocuments = clearAttachedDocuments;
window.toggleDocumentAttachment = toggleDocumentAttachment;

// Debug: Confirm storage.js loaded completely
console.log('[STORAGE] ✅ storage.js loaded successfully - all functions exported', {
    saveChatMessage: typeof window.saveChatMessage,
    getChatHistory: typeof window.getChatHistory,
    deleteChatMessage: typeof window.deleteChatMessage,
    deleteChatConversation: typeof window.deleteChatConversation,
    addDocument: typeof window.addDocument,
    getAllDocuments: typeof window.getAllDocuments,
    addSummary: typeof window.addSummary,
    getAttachedDocuments: typeof window.getAttachedDocuments,
    toggleDocumentAttachment: typeof window.toggleDocumentAttachment
});
