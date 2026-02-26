import { useState, useEffect } from 'react'
import MapViewer from './components/MapViewer'
import FileUpload from './components/FileUpload'
import LocationInput from './components/LocationInput'
import ExportButton from './components/ExportButton'
import MarkerSettings from './components/MarkerSettings'
import PointSetManager from './components/PointSetManager'
import logo from './HL logo.png'
import './App.css'

const DEFAULT_MARKER_STYLES = {
  markerColor: '#0067A5',
  markerShape: 'circle',
  markerSize: 0.1,
  showFill: true,
  outlineColor: '#ffffff',
  outlineWidth: 1,
  showOutline: true,
  showShadow: false,
  showLabels: false,
  labelFontSize: 10,
  labelTextColor: '#000000',
  labelBold: true
}

function App() {
  // New multi-set state structure
  const [locationSets, setLocationSets] = useState([
    {
      id: '1',
      name: 'Set 1',
      locations: [],
      markerStyles: { ...DEFAULT_MARKER_STYLES },
      visible: true,
      expanded: true
    }
  ])
  const [activeSetId, setActiveSetId] = useState('1')

  const [mapConfig, setMapConfig] = useState({
    center: [39.8283, -98.5795], // Center of USA
    zoom: 4,
    markerColor: '#0067A5'
  })
  const [region, setRegion] = useState('us')

  // Fixed values - no longer user-configurable
  const aspectRatio = 'standard'
  const projection = 'web_mercator'

  // Get active set
  const activeSet = locationSets.find(set => set.id === activeSetId) || locationSets[0]

  // Get all locations from all sets for region detection
  const allLocations = locationSets.flatMap(set => set.locations)

  // Auto-detect multi-region locations and switch to world map
  useEffect(() => {
    if (allLocations.length === 0) return

    // Define NON-OVERLAPPING region bounds for detection
    const regionBounds = {
      us: { north: 49.5, south: 24.5, west: -125.0, east: -66.0 },
      north_america: { north: 60.0, south: 7.0, west: -168.0, east: -52.0 },  // Cropped arctic, USA centered
      south_america: { north: 12.5, south: -56.0, west: -81.0, east: -34.0 },
      brazil: { north: 5.3, south: -33.8, west: -85.0, east: -25.0 },  // Extended for more ocean
      china: { north: 53.5, south: 18.0, west: 73.5, east: 135.0 },
      asia: { north: 55.0, south: -10.0, west: 25.0, east: 150.0 },
      // Note: Removed UK and Europe to avoid overlap issues
    }

    // Check which regions contain locations
    const regionsWithLocations = new Set()
    allLocations.forEach(loc => {
      let foundRegion = false

      // Check specific regions first (smallest to largest)
      const regionOrder = ['us', 'brazil', 'china', 'south_america', 'north_america', 'asia']

      for (const regionKey of regionOrder) {
        const bounds = regionBounds[regionKey]
        if (
          loc.lat <= bounds.north &&
          loc.lat >= bounds.south &&
          loc.lng <= bounds.east &&
          loc.lng >= bounds.west
        ) {
          regionsWithLocations.add(regionKey)
          foundRegion = true
          break // Stop after first match to avoid overlaps
        }
      }
    })

    // Only auto-switch to world if locations span TRULY different regions
    // and the CURRENT region doesn't contain all locations
    const currentRegionContainsAll = regionsWithLocations.has(region) || regionsWithLocations.size === 0

    if (regionsWithLocations.size > 1 && region !== 'world' && !currentRegionContainsAll) {
      console.log(`Multi-region locations detected: ${Array.from(regionsWithLocations).join(', ')}. Switching to World view.`)
      setRegion('world')
    }
  }, [allLocations, region])

  // Set management functions
  const handleAddSet = (name) => {
    const newId = Date.now().toString()
    const newSet = {
      id: newId,
      name,
      locations: [],
      markerStyles: { ...DEFAULT_MARKER_STYLES },
      visible: true,
      expanded: true
    }

    setLocationSets(prev => {
      // Collapse all other sets
      const updatedSets = prev.map(set => ({ ...set, expanded: false }))
      return [...updatedSets, newSet]
    })
    setActiveSetId(newId)
  }

  const handleDeleteSet = (setId) => {
    setLocationSets(prev => {
      const filtered = prev.filter(set => set.id !== setId)
      // If we deleted the active set, switch to the first remaining set
      if (setId === activeSetId && filtered.length > 0) {
        setActiveSetId(filtered[0].id)
      }
      return filtered
    })
  }

  const handleToggleVisibility = (setId) => {
    setLocationSets(prev =>
      prev.map(set =>
        set.id === setId ? { ...set, visible: !set.visible } : set
      )
    )
  }

  const handleToggleExpanded = (setId) => {
    setLocationSets(prev =>
      prev.map(set =>
        set.id === setId ? { ...set, expanded: !set.expanded } : set
      )
    )
  }

  const handleUpdateSetName = (setId, name) => {
    setLocationSets(prev =>
      prev.map(set =>
        set.id === setId ? { ...set, name } : set
      )
    )
  }

  const handleSetActiveSet = (setId) => {
    setActiveSetId(setId)
  }

  // Location management functions (now for active set)
  const handleDataUploaded = (data) => {
    setLocationSets(prev =>
      prev.map(set =>
        set.id === activeSetId ? { ...set, locations: data } : set
      )
    )

    // Auto-center map on first location if available
    if (data.length > 0) {
      setMapConfig(prev => ({
        ...prev,
        center: [data[0].lat, data[0].lng]
      }))
    }
  }

  const handleLocationsAdded = (newLocations) => {
    setLocationSets(prev =>
      prev.map(set =>
        set.id === activeSetId
          ? { ...set, locations: [...set.locations, ...newLocations] }
          : set
      )
    )

    // Auto-center map on first new location if active set was empty
    if (activeSet.locations.length === 0 && newLocations.length > 0) {
      setMapConfig(prev => ({
        ...prev,
        center: [newLocations[0].lat, newLocations[0].lng]
      }))
    }
  }

  const handleMarkerStylesChange = (newStyles) => {
    setLocationSets(prev =>
      prev.map(set =>
        set.id === activeSetId ? { ...set, markerStyles: newStyles } : set
      )
    )
  }

  const handleClearAll = () => {
    setLocationSets([
      {
        id: '1',
        name: 'Set 1',
        locations: [],
        markerStyles: { ...DEFAULT_MARKER_STYLES },
        visible: true,
        expanded: true
      }
    ])
    setActiveSetId('1')
    setMapConfig(prev => ({
      ...prev,
      center: [39.8283, -98.5795],
      zoom: 4
    }))
  }

  return (
    <div className="app">
      <div className="sidebar">
        <img src={logo} alt="Company Logo" className="logo" />
        <h1>P&G Mapper</h1>
        <p className="subtitle">Map your locations to PowerPoint</p>
        <p className="screenshot-hint">Use the picture icon on the map to take a screenshot</p>

        {/* Map Configuration Selectors */}
        <div className="map-config-section">
          <div className="config-row">
            <label>
              Region:
              <select value={region} onChange={(e) => setRegion(e.target.value)}>
                <option value="us">United States</option>
                <option value="north_america">North America</option>
                <option value="south_america">South America</option>
                <option value="brazil">Brazil</option>
                <option value="europe">Europe</option>
                <option value="uk">UK & Ireland</option>
                <option value="china">China</option>
                <option value="asia">Asia</option>
                <option value="world">World</option>
              </select>
            </label>
          </div>
        </div>

        <LocationInput onLocationsAdded={handleLocationsAdded} />

        <FileUpload onDataUploaded={handleDataUploaded} />

        {/* Point Set Manager */}
        <PointSetManager
          locationSets={locationSets}
          activeSetId={activeSetId}
          onSetActiveSet={handleSetActiveSet}
          onAddSet={handleAddSet}
          onDeleteSet={handleDeleteSet}
          onToggleVisibility={handleToggleVisibility}
          onToggleExpanded={handleToggleExpanded}
          onUpdateSetName={handleUpdateSetName}
        />

        {allLocations.length > 0 && (
          <div className="info">
            <p><strong>{allLocations.length}</strong> total locations loaded</p>
            <button onClick={handleClearAll} className="clear-all-button">
              Clear All
            </button>
          </div>
        )}

        <MarkerSettings
          markerStyles={activeSet.markerStyles}
          onStylesChange={handleMarkerStylesChange}
          activeSetName={activeSet.name}
        />

        <ExportButton
          locationSets={locationSets}
          mapConfig={mapConfig}
          region={region}
          aspectRatio={aspectRatio}
          projection={projection}
          disabled={allLocations.length === 0}
        />
      </div>

      <div className="map-container">
        <MapViewer
          locationSets={locationSets}
          region={region}
          aspectRatio={aspectRatio}
          projection={projection}
        />
      </div>
    </div>
  )
}

export default App
