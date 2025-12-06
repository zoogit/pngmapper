import { useState } from 'react'
import { uploadData } from '../services/api'
import './FileUpload.css'

function FileUpload({ onDataUploaded }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)

  const handleFileChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    setUploading(true)
    setError(null)

    try {
      const data = await uploadData(file)
      onDataUploaded(data)
    } catch (err) {
      setError(err.message || 'Failed to upload file')
      console.error('Upload error:', err)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="file-upload">
      <label htmlFor="file-input" className="upload-label">
        {uploading ? 'Uploading...' : 'Upload Location Data'}
      </label>
      <input
        id="file-input"
        type="file"
        accept=".csv,.geojson,.json"
        onChange={handleFileChange}
        disabled={uploading}
        className="file-input"
      />
      <p className="help-text">Accepts CSV, GeoJSON files</p>
      {error && <p className="error-text">{error}</p>}
    </div>
  )
}

export default FileUpload
