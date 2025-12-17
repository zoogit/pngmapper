import { useState } from 'react'
import { generatePPTX } from '../services/api'
import './ExportButton.css'

function ExportButton({ locations, mapConfig, markerStyles, region, aspectRatio, projection, disabled }) {
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState(null)

  const handleExport = async () => {
    setGenerating(true)
    setError(null)

    console.log('EXPORT DEBUG - markerStyles:', markerStyles)
    console.log('EXPORT DEBUG - Region:', region, 'Aspect:', aspectRatio, 'Projection:', projection)
    console.log('EXPORT DEBUG - Full config:', { locations, markerStyles, region, aspectRatio, projection, ...mapConfig })

    try {
      await generatePPTX({
        locations,
        markerStyles,
        region,
        aspectRatio,
        projection,
        ...mapConfig
      })
    } catch (err) {
      setError(err.message || 'Failed to generate PowerPoint')
      console.error('Export error:', err)
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
