/**
 * Client-side geocoding service using LocationIQ
 * Handles large batches without server timeout
 * Features cascading fallback strategies for better success rate
 */

// LocationIQ API (2 requests/sec, 5000 requests/day free tier)
const LOCATIONIQ_URL = 'https://us1.locationiq.com/v1/search.php'
const LOCATIONIQ_API_KEY = import.meta.env.VITE_LOCATIONIQ_API_KEY || 'pk.4da8ea4760ce54b5a9ce0fc0e64d2486' // Default free tier key
const DELAY_MS = 500 // 500ms delay between requests (LocationIQ allows 2 req/sec)
const STRATEGY_DELAY_MS = 600 // 600ms delay between fallback strategies for same address
const MAX_RETRIES = 3 // Retry 503/429 errors up to 3 times
const RETRY_DELAY_MS = 2000 // Base wait time before retrying (will increase exponentially)
const RATE_LIMIT_RETRY_MS = 5000 // Wait 5 seconds on rate limit errors before retrying

// Cache config
const CACHE_MAX_SIZE = 500
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

// Precision levels for geocoding results
const PRECISION = {
  EXACT: 'exact',           // Full address matched
  SIMPLIFIED: 'simplified', // Address simplified (building/suite removed)
  STREET: 'street',        // Street level only
  CITY: 'city',            // City/region level only
  ZIPCODE: 'zipcode'       // ZIP/postal code area only (very broad)
}

// ---------------------------------------------------------------------------
// LRU Cache (browser-compatible, no external deps)
// ---------------------------------------------------------------------------
class LRUCache {
  constructor(maxSize, ttlMs) {
    this._maxSize = maxSize
    this._ttlMs = ttlMs
    this._cache = new Map() // key -> { value, expiresAt }
    this.hits = 0
    this.misses = 0
  }

  _normalize(key) {
    return key.toLowerCase().trim().replace(/\s+/g, ' ')
  }

  get(key) {
    const k = this._normalize(key)
    const entry = this._cache.get(k)
    if (!entry) {
      this.misses++
      return null
    }
    if (Date.now() > entry.expiresAt) {
      this._cache.delete(k)
      this.misses++
      return null
    }
    // Refresh position (most recently used → end of Map)
    this._cache.delete(k)
    this._cache.set(k, entry)
    this.hits++
    return entry.value
  }

  set(key, value) {
    const k = this._normalize(key)
    if (this._cache.has(k)) this._cache.delete(k)
    if (this._cache.size >= this._maxSize) {
      // Evict oldest (first) entry
      this._cache.delete(this._cache.keys().next().value)
    }
    this._cache.set(k, { value, expiresAt: Date.now() + this._ttlMs })
  }

  get size() { return this._cache.size }

  get stats() {
    const total = this.hits + this.misses
    return {
      size: this.size,
      maxSize: this._maxSize,
      ttlHours: this._ttlMs / 3600000,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? (this.hits / total).toFixed(3) : 'n/a'
    }
  }
}

const geocodeCache = new LRUCache(CACHE_MAX_SIZE, CACHE_TTL_MS)

// Expose stats globally for debugging
if (typeof window !== 'undefined') {
  window.geocodeStats = () => geocodeCache.stats
}

// ---------------------------------------------------------------------------
// Structured logging
// ---------------------------------------------------------------------------
function structuredLog(fields) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: 'geocoding', ...fields }))
}

// ---------------------------------------------------------------------------
// Request ID
// ---------------------------------------------------------------------------
function generateRequestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

// ---------------------------------------------------------------------------
// Address normalization helpers
// ---------------------------------------------------------------------------

/**
 * Fix ZIP code formatting - add leading zeros to 4-digit ZIP codes
 */
function fixZipCode(address) {
  // Match 4-digit ZIP codes and add leading zero
  // Handles: "City, ST 1234" → "City, ST 01234"
  return address.replace(/\b([A-Z]{2})\s+(\d{4})\b/g, '$1 0$2')
}

/**
 * Remove building/suite/unit designations that often cause geocoding failures
 */
function simplifyAddress(address) {
  let simplified = address

  // Remove building designations: "Building C, " or "Bldg A, "
  simplified = simplified.replace(/\b(Building|Bldg\.?)\s+[A-Z0-9]+,?\s*/gi, '')

  // Remove suite/unit designations: "Suite B" or "Unit A" or "#2"
  simplified = simplified.replace(/,?\s*(Suite|Unit|Ste\.?|#)\s+[A-Z0-9]+/gi, '')

  // Remove complex industrial park identifiers
  simplified = simplified.replace(/,?\s*[A-Z][a-z]+\s+(Gate|Ward)\s+Industrial\s+Park,?\s*/gi, '')

  // Clean up multiple commas and spaces
  simplified = simplified.replace(/,\s*,/g, ',').replace(/\s+,/g, ',').replace(/,\s+/g, ', ')

  return simplified.trim()
}

/**
 * Extract city and state/province from address for broad fallback
 */
function extractCityState(address) {
  // US pattern: Match city right before state code
  // Example: "123 Main St Chicago, IL 60601" -> "Chicago, IL"
  // Use negative lookbehind-like approach: find last occurrence of "Word(s), ST ZIP"
  const usPattern = /([A-Za-z\s]+?),?\s+([A-Z]{2})\s+\d{5}(?:-\d{4})?/
  const usMatch = address.match(usPattern)
  if (usMatch) {
    // Extract just the city name (last word or words before state)
    // Split by comma to isolate the city part
    const beforeState = usMatch[1].trim()
    const cityWords = beforeState.split(/\s+/)

    // Take last 1-3 words as city name (handles multi-word cities)
    // "123 Main Street South Portland" -> "South Portland"
    const cityName = cityWords.slice(-3).join(' ')
    return `${cityName}, ${usMatch[2]}`
  }

  // Canadian pattern: Match city right before province code
  // Example: "123 Road Regina SK S4N 2C6" -> "Regina, SK"
  const caPattern = /([A-Za-z\s]+?)\s+(ON|AB|BC|MB|NB|NL|NS|NT|NU|PE|QC|SK|YT)\s+[A-Z0-9]{3}\s*[A-Z0-9]{3}/
  const caMatch = address.match(caPattern)
  if (caMatch) {
    const beforeProvince = caMatch[1].trim()
    const cityWords = beforeProvince.split(/\s+/)

    // Take last 1-3 words as city name
    const cityName = cityWords.slice(-3).join(' ')
    return `${cityName}, ${caMatch[2]}`
  }

  // Fallback: try to get last two comma-separated parts
  const parts = address.split(',').map(p => p.trim())
  if (parts.length >= 2) {
    // Get second-to-last part and extract just the city (remove ZIP if present)
    let cityPart = parts[parts.length - 2].replace(/\d{5}(-\d{4})?/, '').trim()
    let statePart = parts[parts.length - 1].replace(/\d{5}(-\d{4})?/, '').trim()

    // Extract just state/province code if present
    const stateMatch = statePart.match(/\b([A-Z]{2})\b/)
    if (stateMatch) {
      return `${cityPart}, ${stateMatch[1]}`
    }

    return `${cityPart}, ${statePart}`
  }

  return null
}

/**
 * Extract street address + city for intermediate fallback
 */
function extractStreetCity(address) {
  // Try to extract: "123 Street Name City, ST ZIP" → "123 Street Name City, ST"
  const parts = address.split(',').map(p => p.trim())
  if (parts.length >= 2) {
    // Remove ZIP code from last part
    const lastPart = parts[parts.length - 1].replace(/\d{5}(-\d{4})?/, '').trim()
    if (parts.length >= 3) {
      return `${parts[parts.length - 2]}, ${lastPart}`
    }
  }
  return null
}

/**
 * Extract just ZIP/postal code for very broad fallback
 */
function extractZipCode(address) {
  // US ZIP code
  const usZipMatch = address.match(/\b(\d{5})(?:-\d{4})?\b/)
  if (usZipMatch) {
    return usZipMatch[1]
  }

  // Canadian postal code
  const caPostalMatch = address.match(/\b([A-Z]\d[A-Z]\s*\d[A-Z]\d)\b/)
  if (caPostalMatch) {
    return caPostalMatch[1]
  }

  return null
}

// ---------------------------------------------------------------------------
// Core geocode call — with cache + timing
// ---------------------------------------------------------------------------

/**
 * Build a cache key from the query and any bias params (extensible)
 */
function buildCacheKey(query, params = {}) {
  const normalized = query.toLowerCase().trim().replace(/\s+/g, ' ')
  const paramStr = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('|')
  return paramStr ? `${normalized}|${paramStr}` : normalized
}

/**
 * Attempt to geocode with a specific query string.
 * Checks the in-memory LRU cache first; on miss calls LocationIQ and caches success.
 */
async function attemptGeocode(query, retryCount = 0, requestId = null) {
  const cacheKey = buildCacheKey(query)
  const cached = geocodeCache.get(cacheKey)

  if (cached !== null) {
    structuredLog({
      request_id: requestId,
      event: 'geocode_attempt',
      query,
      cache_hit: true,
      t_locationiq_ms: 0
    })
    return cached
  }

  const t0 = performance.now()
  const url = `${LOCATIONIQ_URL}?key=${LOCATIONIQ_API_KEY}&q=${encodeURIComponent(query)}&format=json&limit=1`

  console.log(`[GEOCODE] URL: ${url.replace(LOCATIONIQ_API_KEY, 'API_KEY')}`) // Hide API key in logs

  let response
  let locationiqStatus
  let errorType = null

  try {
    response = await fetch(url)
    locationiqStatus = response.status
  } catch (err) {
    const t_locationiq_ms = Math.round(performance.now() - t0)
    errorType = err.name === 'AbortError' ? 'timeout' : 'network_error'
    structuredLog({
      request_id: requestId,
      event: 'geocode_attempt',
      query,
      cache_hit: false,
      locationiq_status: null,
      error_type: errorType,
      t_locationiq_ms
    })
    throw err
  }

  const t_locationiq_ms = Math.round(performance.now() - t0)

  if (!response.ok) {
    if (response.status === 429) errorType = 'rate_limit_429'
    else if (response.status >= 500) errorType = `locationiq_${response.status}`
    else errorType = `http_${response.status}`

    structuredLog({
      request_id: requestId,
      event: 'geocode_attempt',
      query,
      cache_hit: false,
      locationiq_status: response.status,
      error_type: errorType,
      t_locationiq_ms
    })

    // If 429 (Rate Limited) and we have retries left, retry with longer delay
    if (response.status === 429 && retryCount < MAX_RETRIES) {
      const waitTime = RATE_LIMIT_RETRY_MS * Math.pow(2, retryCount)
      console.warn(`[GEOCODE] ⚠ HTTP 429 (Rate Limited) for "${query}" - waiting ${waitTime/1000}s before retry (attempt ${retryCount + 1}/${MAX_RETRIES})`)
      await delay(waitTime)
      return attemptGeocode(query, retryCount + 1, requestId)
    }

    // If 503 (Service Unavailable) and we have retries left, retry after delay
    if (response.status === 503 && retryCount < MAX_RETRIES) {
      const waitTime = RETRY_DELAY_MS * Math.pow(2, retryCount)
      console.warn(`[GEOCODE] ⚠ HTTP 503 for "${query}" - retrying in ${waitTime/1000}s (attempt ${retryCount + 1}/${MAX_RETRIES})`)
      await delay(waitTime)
      return attemptGeocode(query, retryCount + 1, requestId)
    }

    console.error(`[GEOCODE] ❌ HTTP ${response.status} for "${query}"`)
    throw new Error(`HTTP ${response.status}`)
  }

  const data = await response.json()
  const result = data && data.length > 0 ? data[0] : null

  structuredLog({
    request_id: requestId,
    event: 'geocode_attempt',
    query,
    cache_hit: false,
    locationiq_status: response.status,
    found: result !== null,
    t_locationiq_ms
  })

  // Cache successful (non-null) results only
  if (result !== null) {
    geocodeCache.set(cacheKey, result)
  }

  console.log(`[GEOCODE] Response:`, data)
  return result
}

// ---------------------------------------------------------------------------
// Single address geocoding with cascading fallback strategies
// ---------------------------------------------------------------------------

/**
 * Geocode a single address using cascading fallback strategies
 */
async function geocodeSingleAddress(address, retryCount = 0) {
  const requestId = generateRequestId()
  const t0 = performance.now()

  try {
    console.log(`[GEOCODE] Original: "${address}"`)

    // Normalize address format:
    // - Replace tabs and multiple spaces with comma+space
    // - Fix ZIP codes (4-digit → 5-digit with leading zero)
    let normalized = address.replace(/[\t\s]{2,}/g, ', ').trim()
    normalized = fixZipCode(normalized)

    if (address !== normalized) {
      console.log(`[GEOCODE] Normalized: "${normalized}"`)
    }

    // Strategy 1: Try exact address (with ZIP fix)
    console.log(`[GEOCODE] Strategy 1: Exact address`)
    let result = await attemptGeocode(normalized, 0, requestId)
    if (result) {
      const t_total_ms = Math.round(performance.now() - t0)
      console.log(`[GEOCODE] ✓ Success (exact): "${normalized}" → ${result.display_name}`)
      console.log(`[GEOCODE] ✓ Coords: ${result.lat}, ${result.lon}`)
      structuredLog({ request_id: requestId, event: 'geocode_result', address, strategy: 'exact', precision: PRECISION.EXACT, success: true, t_total_ms, cache_stats: geocodeCache.stats })
      return {
        address,
        lat: parseFloat(result.lat),
        lng: parseFloat(result.lon),
        name: normalized,
        success: true,
        displayName: result.display_name,
        precision: PRECISION.EXACT
      }
    }
    console.log(`[GEOCODE] ⚠ Strategy 1 failed`)
    await delay(STRATEGY_DELAY_MS) // Wait before trying next strategy

    // Strategy 2: Try simplified address (remove building/suite)
    const simplified = simplifyAddress(normalized)
    if (simplified !== normalized) {
      console.log(`[GEOCODE] Strategy 2: Simplified "${simplified}"`)
      result = await attemptGeocode(simplified, 0, requestId)
      if (result) {
        const t_total_ms = Math.round(performance.now() - t0)
        console.log(`[GEOCODE] ✓ Success (simplified): "${simplified}" → ${result.display_name}`)
        console.log(`[GEOCODE] ✓ Coords: ${result.lat}, ${result.lon}`)
        structuredLog({ request_id: requestId, event: 'geocode_result', address, strategy: 'simplified', precision: PRECISION.SIMPLIFIED, success: true, t_total_ms, cache_stats: geocodeCache.stats })
        return {
          address,
          lat: parseFloat(result.lat),
          lng: parseFloat(result.lon),
          name: normalized,
          success: true,
          displayName: result.display_name,
          precision: PRECISION.SIMPLIFIED,
          note: 'Building/suite designation removed for successful geocoding'
        }
      }
      console.log(`[GEOCODE] ⚠ Strategy 2 failed`)
      await delay(STRATEGY_DELAY_MS) // Wait before trying next strategy
    }

    // Strategy 3: Try street + city (remove specific building number details)
    const streetCity = extractStreetCity(normalized)
    if (streetCity && streetCity !== normalized && streetCity !== simplified) {
      console.log(`[GEOCODE] Strategy 3: Street+City "${streetCity}"`)
      result = await attemptGeocode(streetCity, 0, requestId)
      if (result) {
        const t_total_ms = Math.round(performance.now() - t0)
        console.log(`[GEOCODE] ✓ Success (street): "${streetCity}" → ${result.display_name}`)
        console.log(`[GEOCODE] ✓ Coords: ${result.lat}, ${result.lon}`)
        structuredLog({ request_id: requestId, event: 'geocode_result', address, strategy: 'street_city', precision: PRECISION.STREET, success: true, t_total_ms, cache_stats: geocodeCache.stats })
        return {
          address,
          lat: parseFloat(result.lat),
          lng: parseFloat(result.lon),
          name: normalized,
          success: true,
          displayName: result.display_name,
          precision: PRECISION.STREET,
          note: 'Matched to street/area level (less precise)'
        }
      }
      console.log(`[GEOCODE] ⚠ Strategy 3 failed`)
      await delay(STRATEGY_DELAY_MS) // Wait before trying next strategy
    }

    // Strategy 4: Try city + state only (broadest fallback)
    const cityState = extractCityState(normalized)
    if (cityState) {
      console.log(`[GEOCODE] Strategy 4: City+State "${cityState}"`)
      result = await attemptGeocode(cityState, 0, requestId)
      if (result) {
        const t_total_ms = Math.round(performance.now() - t0)
        console.log(`[GEOCODE] ✓ Success (city): "${cityState}" → ${result.display_name}`)
        console.log(`[GEOCODE] ✓ Coords: ${result.lat}, ${result.lon}`)
        structuredLog({ request_id: requestId, event: 'geocode_result', address, strategy: 'city_state', precision: PRECISION.CITY, success: true, t_total_ms, cache_stats: geocodeCache.stats })
        return {
          address,
          lat: parseFloat(result.lat),
          lng: parseFloat(result.lon),
          name: normalized,
          success: true,
          displayName: result.display_name,
          precision: PRECISION.CITY,
          note: 'Matched to city/region only (approximate location)'
        }
      }
      console.log(`[GEOCODE] ⚠ Strategy 4 failed`)
      await delay(STRATEGY_DELAY_MS) // Wait before trying next strategy
    }

    // Strategy 5: Try ZIP/postal code only (very broad fallback)
    const zipCode = extractZipCode(normalized)
    if (zipCode) {
      console.log(`[GEOCODE] Strategy 5: ZIP/Postal "${zipCode}"`)
      result = await attemptGeocode(zipCode, 0, requestId)
      if (result) {
        const t_total_ms = Math.round(performance.now() - t0)
        console.log(`[GEOCODE] ✓ Success (zipcode): "${zipCode}" → ${result.display_name}`)
        console.log(`[GEOCODE] ✓ Coords: ${result.lat}, ${result.lon}`)
        structuredLog({ request_id: requestId, event: 'geocode_result', address, strategy: 'zipcode', precision: PRECISION.ZIPCODE, success: true, t_total_ms, cache_stats: geocodeCache.stats })
        return {
          address,
          lat: parseFloat(result.lat),
          lng: parseFloat(result.lon),
          name: normalized,
          success: true,
          displayName: result.display_name,
          precision: PRECISION.ZIPCODE,
          note: 'Matched to ZIP/postal code area only (very approximate location)'
        }
      }
      console.log(`[GEOCODE] ⚠ Strategy 5 failed`)
    }

    // All strategies failed
    const t_total_ms = Math.round(performance.now() - t0)
    console.warn(`[GEOCODE] ❌ All strategies failed for "${address}"`)
    structuredLog({ request_id: requestId, event: 'geocode_result', address, success: false, error: 'all_strategies_failed', t_total_ms, cache_stats: geocodeCache.stats })
    return {
      address,
      success: false,
      error: 'Address not found after trying all fallback strategies'
    }

  } catch (error) {
    const t_total_ms = Math.round(performance.now() - t0)
    console.error(`[GEOCODE] ❌ Error for "${address}":`, error.message)
    structuredLog({ request_id: requestId, event: 'geocode_result', address, success: false, error: error.message, t_total_ms, cache_stats: geocodeCache.stats })
    return {
      address,
      success: false,
      error: error.message || 'Geocoding failed'
    }
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Add delay between requests
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Geocode multiple addresses with progress callback using parallel batch processing
 *
 * @param {string[]} addresses - Array of addresses to geocode
 * @param {function} onProgress - Callback function(current, total, result)
 * @returns {Promise<Array>} Array of geocoding results
 */
export async function geocodeAddresses(addresses, onProgress = null) {
  const results = []
  const BATCH_SIZE = 2 // Process 2 addresses in parallel (LocationIQ free tier limit)
  const BATCH_DELAY = 2000 // Wait 2 seconds between batches to avoid rate limiting

  // Split addresses into batches
  const batches = []
  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    batches.push(addresses.slice(i, i + BATCH_SIZE))
  }

  let completedCount = 0

  // Process each batch
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex]

    // Process all addresses in this batch in parallel
    const batchPromises = batch.map(address => geocodeSingleAddress(address))
    const batchResults = await Promise.all(batchPromises)

    // Add results and call progress callback
    for (const result of batchResults) {
      results.push(result)
      completedCount++

      if (onProgress) {
        onProgress(completedCount, addresses.length, result)
      }
    }

    // Delay between batches (except after the last batch)
    if (batchIndex < batches.length - 1) {
      await delay(BATCH_DELAY)
    }
  }

  return results
}

/**
 * Estimate time to geocode addresses with parallel batch processing
 */
export function estimateGeocodingTime(count) {
  const BATCH_SIZE = 2
  const BATCH_DELAY_SECONDS = 2 // Updated to match new BATCH_DELAY

  // Calculate number of batches
  const numBatches = Math.ceil(count / BATCH_SIZE)

  // Time = (number of batches - 1) * delay between batches
  // We subtract 1 because there's no delay after the last batch
  const seconds = Math.max(numBatches - 1, 0) * BATCH_DELAY_SECONDS + 2 // +2 for first batch processing with strategy delays

  if (seconds < 60) {
    return `~${Math.ceil(seconds)} seconds`
  } else {
    const minutes = Math.ceil(seconds / 60)
    return `~${minutes} minute${minutes > 1 ? 's' : ''}`
  }
}

/**
 * Test function - call from browser console to debug geocoding
 * Usage: window.testGeocode('New York')
 */
export async function testGeocode(address) {
  console.log('='.repeat(60))
  console.log(`Testing geocode for: "${address}"`)
  console.log('='.repeat(60))
  const result = await geocodeSingleAddress(address)
  console.log('Final result:', result)
  console.log('='.repeat(60))
  return result
}

// Make test/debug functions available globally for debugging
if (typeof window !== 'undefined') {
  window.testGeocode = testGeocode
  window.geocodeStats = () => geocodeCache.stats
}
