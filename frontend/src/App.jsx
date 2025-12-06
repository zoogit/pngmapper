import { useState } from 'react'
import MapViewer from './components/MapViewer'
import FileUpload from './components/FileUpload'
import LocationInput from './components/LocationInput'
import ExportButton from './components/ExportButton'
import MarkerSettings from './components/MarkerSettings'
import './App.css'

function App() {
  const [locations, setLocations] = useState([])
  const [mapConfig, setMapConfig] = useState({
    center: [39.8283, -98.5795], // Center of USA
    zoom: 4,
    markerColor: '#3388ff'
  })
  const [markerStyles, setMarkerStyles] = useState({
    markerColor: '#dc3545',
    markerShape: 'circle',
    markerSize: 0.2,
    showFill: true,
    outlineColor: '#ffffff',
    outlineWidth: 1,
    showOutline: true,
    showShadow: false,
    showLabels: true,
    labelFontSize: 10,
    labelTextColor: '#000000',
    labelBgColor: '#ffffff',
    labelBold: true
  })

  // Debug: Log markerStyles whenever they change
  console.log('APP.JSX - Current markerStyles state:', markerStyles)

  const handleDataUploaded = (data) => {
    setLocations(data)

    // Auto-center map on first location if available
    if (data.length > 0) {
      setMapConfig(prev => ({
        ...prev,
        center: [data[0].lat, data[0].lng]
      }))
    }
  }

  const handleLocationsAdded = (newLocations) => {
    setLocations(prev => [...prev, ...newLocations])

    // Auto-center map on first new location if no locations existed
    if (locations.length === 0 && newLocations.length > 0) {
      setMapConfig(prev => ({
        ...prev,
        center: [newLocations[0].lat, newLocations[0].lng]
      }))
    }
  }

  const handleClearAll = () => {
    setLocations([])
    setMapConfig(prev => ({
      ...prev,
      center: [39.8283, -98.5795],
      zoom: 4
    }))
  }

  return (
    <div className="app">
      <div className="sidebar">
        <h1>PNGMap</h1>
        <p className="subtitle">Map your locations to PowerPoint</p>

        <LocationInput onLocationsAdded={handleLocationsAdded} />

        <FileUpload onDataUploaded={handleDataUploaded} />

        {locations.length > 0 && (
          <div className="info">
            <p><strong>{locations.length}</strong> locations loaded</p>
            <button onClick={handleClearAll} className="clear-all-button">
              Clear All
            </button>
          </div>
        )}

        <MarkerSettings
          markerStyles={markerStyles}
          onStylesChange={setMarkerStyles}
        />

        <ExportButton
          locations={locations}
          mapConfig={mapConfig}
          markerStyles={markerStyles}
          disabled={locations.length === 0}
        />
      </div>

      <div className="map-container">
        <MapViewer
          locations={locations}
        />
      </div>
    </div>
  )
}

export default App
