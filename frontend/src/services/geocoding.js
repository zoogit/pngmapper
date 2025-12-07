/**
 * Client-side geocoding service using Nominatim
 * Handles large batches without server timeout
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const DELAY_MS = 1000 // 1 second delay between requests (Nominatim usage policy)

/**
 * Geocode a single address using Nominatim
 */
async function geocodeSingleAddress(address) {
  try {
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(address)}&format=json&limit=1`

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'PNGMapper/1.0' // Required by Nominatim usage policy
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = await response.json()

    if (data && data.length > 0) {
      return {
        address,
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        name: address,
        success: true
      }
    } else {
      return {
        address,
        success: false,
        error: 'Address not found'
      }
    }
  } catch (error) {
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
