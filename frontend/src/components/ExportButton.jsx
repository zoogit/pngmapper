import { useState } from 'react'
import { generatePPTX } from '../services/api'
import './ExportButton.css'

function ExportButton({ locationSets, mapConfig, region, aspectRatio, projection, disabled }) {
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState(null)

  const handleExport = async () => {
    setGenerating(true)
    setError(null)

    // Filter to only visible sets and prepare data for backend
    const visibleSets = locationSets
      .filter(set => set.visible && set.locations.length > 0)
      .map(set => ({
        name: set.name,
        // Strip extra geocoding fields that backend doesn't need
        locations: set.locations.map(loc => ({
          lat: loc.lat,
          lng: loc.lng,
          name: loc.name
        })),
        markerStyles: set.markerStyles
      }))

    console.log('EXPORT DEBUG - Visible sets count:', visibleSets.length)
    console.log('EXPORT DEBUG - Visible sets:', visibleSets)
    console.log('EXPORT DEBUG - Region:', region, 'Aspect:', aspectRatio, 'Projection:', projection)

    if (visibleSets.length === 0) {
      setError('No visible location sets to export')
      setGenerating(false)
      return
    }

    const exportData = {
      locationSets: visibleSets,
      region,
      aspectRatio,
      projection
    }

    console.log('EXPORT DEBUG - Full config:', exportData)

    try {
      await generatePPTX(exportData)
    } catch (err) {
      // Try to extract detailed error message from response
      let errorMessage = err.message || 'Failed to generate PowerPoint'
      if (err.response?.data) {
        try {
          // If response is a Blob (like HTML error page), convert to text
          if (err.response.data instanceof Blob) {
            const text = await err.response.data.text()
            console.error('Server error response (HTML):', text)
            errorMessage = 'Server validation error - check console for details'
          } else {
            console.error('Server error response:', err.response.data)
            errorMessage = err.response.data.detail || errorMessage
          }
        } catch (parseError) {
          console.error('Error parsing server response:', parseError)
        }
      }
      setError(errorMessage)
      console.error('Export error:', err)
      console.error('Error response:', err.response)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="export-section">
      <button
        className="export-button"
        onClick={handleExport}
        disabled={disabled || generating}
      >
        {generating ? 'Generating...' : 'Export to PowerPoint'}
      </button>
      {error && <p className="error-text">{error}</p>}
    </div>
  )
}

export default ExportButton
