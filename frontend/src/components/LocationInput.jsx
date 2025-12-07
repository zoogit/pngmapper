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

    for (let line of lines) {
      const trimmed = line.trim()
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
      <p className="input-help">
        Enter addresses, cities, or locations (one per line):
        <br />
        <code>New York, NY</code>
        <br />
        <code>1600 Pennsylvania Ave, Washington DC</code>
      </p>

      <textarea
        value={inputText}
        onChange={(e) => setInputText(e.target.value)}
        onPaste={handlePaste}
        placeholder="Enter locations (one per line):&#10;New York, NY&#10;Los Angeles, CA&#10;Chicago, IL&#10;&#10;Or paste from Excel!"
        rows={6}
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
