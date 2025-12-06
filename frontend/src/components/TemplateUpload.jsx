import { useState } from 'react'
import { uploadTemplate } from '../services/api'
import './TemplateUpload.css'

function TemplateUpload() {
  const [uploading, setUploading] = useState(false)
  const [uploaded, setUploaded] = useState(false)
  const [error, setError] = useState(null)

  const handleFileChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    if (!file.name.endsWith('.pptx')) {
      setError('Please upload a PowerPoint (.pptx) file')
      return
    }

    setUploading(true)
    setError(null)

    try {
      await uploadTemplate(file)
      setUploaded(true)
      setError(null)
    } catch (err) {
      setError(err.message || 'Failed to upload template')
      console.error('Template upload error:', err)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="template-upload">
      <h3>Map Template</h3>
      <p className="template-help">
        Upload a PowerPoint with a map on the first slide for best results.
      </p>

      <label htmlFor="template-input" className="template-label">
        {uploading ? 'Uploading...' : uploaded ? 'Template Uploaded ✓' : 'Upload Template (.pptx)'}
      </label>
      <input
        id="template-input"
        type="file"
        accept=".pptx"
        onChange={handleFileChange}
        disabled={uploading}
        className="file-input"
      />

      {uploaded && (
        <p className="success-text">
          Template uploaded! Markers will now appear on your map background.
        </p>
      )}

      {error && <p className="error-text">{error}</p>}
    </div>
  )
}

export default TemplateUpload
