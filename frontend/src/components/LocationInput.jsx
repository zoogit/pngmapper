import { useState } from 'react'
import { geocodeAddresses, estimateGeocodingTime } from '../services/geocoding'
import './LocationInput.css'

function LocationInput({ onLocationsAdded }) {
  const [inputText, setInputText] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [estimatedTime, setEstimatedTime] = useState('')

  const parseAddresses = (text) => {
    const lines = text.trim().split('\n')
    const addresses = []

    // State name to abbreviation mapping
    const stateMap = {
      'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA',
      'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA',
      'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA',
      'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
      'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS', 'missouri': 'MO',
      'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
      'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH',
      'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
      'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT', 'vermont': 'VT',
      'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY',
      // Canadian provinces
      'ontario': 'ON', 'quebec': 'QC', 'british columbia': 'BC', 'alberta': 'AB', 'manitoba': 'MB',
      'saskatchewan': 'SK', 'nova scotia': 'NS', 'new brunswick': 'NB', 'newfoundland': 'NL',
      'prince edward island': 'PE', 'northwest territories': 'NT', 'yukon': 'YT', 'nunavut': 'NU'
    }

    // Always treat first line as headers
    if (lines.length > 1) {
      // Parse structured data with headers
      const headers = lines[0].split('\t').map(h => h.trim().toLowerCase())

      // Find column indices
      const streetIdx = headers.findIndex(h => h.includes('street') || h.includes('address'))
      const cityIdx = headers.findIndex(h => h.includes('city'))
      const stateIdx = headers.findIndex(h => h.includes('state') || h.includes('province'))
      const zipIdx = headers.findIndex(h => h.includes('zip') || h.includes('postal'))
      const countryIdx = headers.findIndex(h => h.includes('country'))

      // Parse each data row
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue

        const fields = line.split('\t').map(f => f.trim())

        // Build structured address
        const parts = []
        if (streetIdx >= 0 && fields[streetIdx]) parts.push(fields[streetIdx])
        if (cityIdx >= 0 && fields[cityIdx]) parts.push(fields[cityIdx])

        // Add state/province with proper abbreviation conversion
        if (stateIdx >= 0 && fields[stateIdx]) {
          const stateInput = fields[stateIdx].trim().toLowerCase()
          // Check if it's a full state name in our map
          const stateAbbr = stateMap[stateInput] || fields[stateIdx].toUpperCase()
          parts.push(stateAbbr)
        }

        // Add ZIP with leading zero fix
        if (zipIdx >= 0 && fields[zipIdx]) {
          let zip = fields[zipIdx].replace(/\D/g, '') // Remove non-digits
          // Add leading zero for 4-digit US ZIP codes
          if (zip.length === 4) zip = '0' + zip
          parts.push(zip)
        }

        if (countryIdx >= 0 && fields[countryIdx]) parts.push(fields[countryIdx])

        if (parts.length > 0) {
          addresses.push(parts.join(', '))
        }
      }
    } else {
      // Single line - treat as address without header
      const trimmed = lines[0]?.trim()
      if (trimmed) {
        addresses.push(trimmed)
      }
    }

    return addresses
  }

  const handlePaste = (e) => {
    e.preventDefault()
    const pastedText = e.clipboardData.getData('text')
    setInputText(pastedText)
  }

  const handleAddLocations = async () => {
    setError(null)
    setLoading(true)
    setProgress({ current: 0, total: 0 })

    if (!inputText.trim()) {
      setError('Please enter some addresses')
      setLoading(false)
      return
    }

    try {
      const addresses = parseAddresses(inputText)

      if (addresses.length === 0) {
        setError('No addresses found')
        setLoading(false)
        return
      }

      // Show estimated time
      const estimate = estimateGeocodingTime(addresses.length)
      setEstimatedTime(estimate)

      // Geocode addresses with progress callback
      const results = await geocodeAddresses(addresses, (current, total, result) => {
        setProgress({ current, total })
      })

      // Filter successful results
      const successful = results.filter(r => r.success)
      const failed = results.filter(r => !r.success)

      if (successful.length === 0) {
        setError('Could not geocode any addresses. Please check the format.')
        setLoading(false)
        setProgress({ current: 0, total: 0 })
        return
      }

      // Add successful locations
      onLocationsAdded(successful)

      // Show warning if some failed
      if (failed.length > 0) {
        setError(`Warning: ${failed.length} address(es) could not be found: ${failed.map(f => f.address).join(', ')}`)
      } else {
        setInputText('')
      }

    } catch (err) {
      setError(err.message || 'Failed to geocode addresses')
      console.error('Geocoding error:', err)
    } finally {
      setLoading(false)
      setProgress({ current: 0, total: 0 })
      setEstimatedTime('')
    }
  }

  const handleClear = () => {
    setInputText('')
    setError(null)
  }

  return (
    <div className="location-input">
      <h3>Manual Entry</h3>

      <div className="input-help">
        Paste from Excel or enter tab-separated data. First row should be headers (Street, City, State, ZIP, Country).
      </div>

      <textarea
        value={inputText}
        onChange={(e) => setInputText(e.target.value)}
        onPaste={handlePaste}
        placeholder="Street	City	State	ZIP	Country
123 Main St	Boston	MA	02101	USA
456 Oak Ave	Portland	OR	97201	USA"
        rows={10}
        className="location-textarea"
        disabled={loading}
      />

      {error && <p className="error-text">{error}</p>}

      <div className="button-group">
        <button
          onClick={handleAddLocations}
          className="add-button"
          disabled={loading}
        >
          {loading ? 'Geocoding...' : 'Add Locations'}
        </button>
        <button
          onClick={handleClear}
          className="clear-button"
          disabled={loading}
        >
          Clear
        </button>
      </div>

      {loading && progress.total > 0 && (
        <div className="progress-container">
          <p className="info-text">
            Geocoding {progress.current}/{progress.total} addresses... {estimatedTime}
          </p>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default LocationInput
