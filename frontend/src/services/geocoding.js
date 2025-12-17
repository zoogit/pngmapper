/**
 * Client-side geocoding service using Nominatim
 * Handles large batches without server timeout
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const DELAY_MS = 1000 // 1 second delay between requests (Nominatim usage policy)
const MAX_RETRIES = 2 // Retry 503 errors up to 2 times
const RETRY_DELAY_MS = 2000 // Wait 2 seconds before retrying

/**
 * Geocode a single address using Nominatim
 */
async function geocodeSingleAddress(address, retryCount = 0) {
  try {
    // Normalize address format:
    // - Replace tabs and multiple spaces with comma+space
    // - "Phoenix    AZ" → "Phoenix, AZ"
    // - "Phoenix\tAZ" → "Phoenix, AZ"
    const normalizedAddress = address.replace(/[\t\s]{2,}/g, ', ').trim()

    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(normalizedAddress)}&format=json&limit=1`

    console.log(`[GEOCODE] Original: "${address}"`)
    if (address !== normalizedAddress) {
      console.log(`[GEOCODE] Normalized: "${normalizedAddress}"`)
    }
    console.log(`[GEOCODE] URL: ${url}`)

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'PNGMapper/1.0' // Required by Nominatim usage policy
      }
    })

    if (!response.ok) {
      // If 503 (Service Unavailable) and we have retries left, retry after delay
      if (response.status === 503 && retryCount < MAX_RETRIES) {
        console.warn(`[GEOCODE] ⚠ HTTP 503 for "${normalizedAddress}" - retrying in ${RETRY_DELAY_MS/1000}s (attempt ${retryCount + 1}/${MAX_RETRIES})`)
        await delay(RETRY_DELAY_MS)
        return geocodeSingleAddress(address, retryCount + 1)
      }

      console.error(`[GEOCODE] ❌ HTTP ${response.status} for "${normalizedAddress}"`)
      throw new Error(`HTTP ${response.status}`)
    }

    const data = await response.json()
    console.log(`[GEOCODE] Response for "${address}":`, data)

    if (data && data.length > 0) {
      console.log(`[GEOCODE] ✓ Success: "${normalizedAddress}" → ${data[0].display_name}`)
      console.log(`[GEOCODE] ✓ Coords: ${data[0].lat}, ${data[0].lon}`)
      return {
        address,
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        name: address,
        success: true,
        displayName: data[0].display_name
      }
    } else {
      console.warn(`[GEOCODE] ⚠ No results for "${normalizedAddress}"`)
      return {
        address,
        success: false,
        error: 'Address not found'
      }
    }
  } catch (error) {
    console.error(`[GEOCODE] ❌ Error for "${normalizedAddress}":`, error.message)
    return {
      address,
      success: false,
      error: error.message || 'Geocoding failed'
    }
  }
}

/**
 * Add delay between requests
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Geocode multiple addresses with progress callback
 *
 * @param {string[]} addresses - Array of addresses to geocode
 * @param {function} onProgress - Callback function(current, total, result)
 * @returns {Promise<Array>} Array of geocoding results
 */
export async function geocodeAddresses(addresses, onProgress = null) {
  const results = []

  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i]

    // Geocode this address
    const result = await geocodeSingleAddress(address)
    results.push(result)

    // Call progress callback if provided
    if (onProgress) {
      onProgress(i + 1, addresses.length, result)
    }

    // Respect Nominatim rate limit (1 request per second)
    // Don't delay after the last request
    if (i < addresses.length - 1) {
      await delay(DELAY_MS)
    }
  }

  return results
}

/**
 * Estimate time to geocode addresses
 */
export function estimateGeocodingTime(count) {
  const seconds = count * (DELAY_MS / 1000)
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

// Make test function available globally for debugging
if (typeof window !== 'undefined') {
  window.testGeocode = testGeocode
}
