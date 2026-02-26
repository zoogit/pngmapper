/**
 * Client-side geocoding service
 * Routes all geocoding through the backend API (which calls LocationIQ server-side).
 * Includes in-memory LRU+TTL cache, request IDs, and structured logging.
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const BATCH_SIZE = 5      // addresses per backend request
const BATCH_DELAY = 300   // ms between batches (backend handles LocationIQ rate limiting)
const CACHE_MAX_SIZE = 500
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

// ---------------------------------------------------------------------------
// LRU Cache
// ---------------------------------------------------------------------------
class LRUCache {
  constructor(maxSize, ttlMs) {
    this._maxSize = maxSize
    this._ttlMs = ttlMs
    this._cache = new Map()
    this.hits = 0
    this.misses = 0
  }

  _normalize(key) {
    return key.toLowerCase().trim().replace(/\s+/g, ' ')
  }

  get(key) {
    const k = this._normalize(key)
    const entry = this._cache.get(k)
    if (!entry) { this.misses++; return null }
    if (Date.now() > entry.expiresAt) { this._cache.delete(k); this.misses++; return null }
    this._cache.delete(k)
    this._cache.set(k, entry)
    this.hits++
    return entry.value
  }

  set(key, value) {
    const k = this._normalize(key)
    if (this._cache.has(k)) this._cache.delete(k)
    if (this._cache.size >= this._maxSize) this._cache.delete(this._cache.keys().next().value)
    this._cache.set(k, { value, expiresAt: Date.now() + this._ttlMs })
  }

  get size() { return this._cache.size }

  get stats() {
    const total = this.hits + this.misses
    return {
      size: this.size, maxSize: this._maxSize,
      hits: this.hits, misses: this.misses,
      hitRate: total > 0 ? (this.hits / total).toFixed(3) : 'n/a'
    }
  }
}

const geocodeCache = new LRUCache(CACHE_MAX_SIZE, CACHE_TTL_MS)

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function generateRequestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

function structuredLog(fields) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: 'geocoding', ...fields }))
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Core: call backend with a batch of addresses
// ---------------------------------------------------------------------------
async function geocodeBatch(addresses, requestId) {
  // Check cache first — only send uncached addresses to backend
  const cacheResults = {}
  const uncached = []

  for (const addr of addresses) {
    const cached = geocodeCache.get(addr)
    if (cached !== null) {
      cacheResults[addr] = cached
    } else {
      uncached.push(addr)
    }
  }

  let backendResults = []

  if (uncached.length > 0) {
    const t0 = performance.now()
    const response = await fetch(`${API_URL}/api/geocode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
      },
      body: JSON.stringify({ addresses: uncached }),
    })

    const t_backend_ms = Math.round(performance.now() - t0)

    if (!response.ok) {
      structuredLog({ request_id: requestId, event: 'batch_error', status: response.status, t_backend_ms })
      throw new Error(`Backend error: HTTP ${response.status}`)
    }

    backendResults = await response.json()

    structuredLog({
      request_id: requestId,
      event: 'batch_complete',
      sent: uncached.length,
      t_backend_ms,
      cache_stats: geocodeCache.stats,
    })

    // Cache successful results
    for (const result of backendResults) {
      if (result.success) {
        geocodeCache.set(result.address, result)
      }
    }
  }

  // Merge cache hits back in original order
  return addresses.map(addr => {
    if (cacheResults[addr]) {
      structuredLog({ request_id: requestId, event: 'cache_hit', address: addr })
      return { ...cacheResults[addr], _fromCache: true }
    }
    return backendResults.find(r => r.address === addr) || {
      address: addr, success: false, error: 'No result returned'
    }
  })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Geocode multiple addresses with progress callback.
 * Batches requests to the backend; backend handles LocationIQ + rate limiting.
 *
 * @param {string[]} addresses
 * @param {function} onProgress - called as (current, total, result) after each address
 * @returns {Promise<Array>}
 */
export async function geocodeAddresses(addresses, onProgress = null) {
  const requestId = generateRequestId()
  const results = []
  let completedCount = 0

  structuredLog({ request_id: requestId, event: 'geocode_start', total: addresses.length })

  // Split into batches
  const batches = []
  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    batches.push(addresses.slice(i, i + BATCH_SIZE))
  }

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx]
    const batchResults = await geocodeBatch(batch, requestId)

    for (const result of batchResults) {
      results.push(result)
      completedCount++
      if (onProgress) onProgress(completedCount, addresses.length, result)
    }

    if (batchIdx < batches.length - 1) {
      await delay(BATCH_DELAY)
    }
  }

  structuredLog({
    request_id: requestId,
    event: 'geocode_done',
    total: addresses.length,
    succeeded: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    cache_stats: geocodeCache.stats,
  })

  return results
}

/**
 * Estimate geocoding time for display purposes.
 */
export function estimateGeocodingTime(count) {
  // Backend processes addresses sequentially: ~1s per address on average
  // (300ms LocationIQ + 550ms inter-address delay, cache hits are instant)
  const seconds = Math.max(count * 1, 2)
  if (seconds < 60) return `~${Math.ceil(seconds)} seconds`
  const minutes = Math.ceil(seconds / 60)
  return `~${minutes} minute${minutes > 1 ? 's' : ''}`
}

/**
 * Test geocoding from the browser console.
 * Usage: window.testGeocode('123 Main St, Boston, MA')
 */
export async function testGeocode(address) {
  console.log('='.repeat(60))
  console.log(`Testing geocode for: "${address}"`)
  const results = await geocodeAddresses([address])
  console.log('Result:', results[0])
  console.log('='.repeat(60))
  return results[0]
}

// Expose debug helpers globally
if (typeof window !== 'undefined') {
  window.testGeocode = testGeocode
  window.geocodeStats = () => geocodeCache.stats
}
