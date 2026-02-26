import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import { useEffect, useState, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import axios from 'axios'
import html2canvas from 'html2canvas'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Fix for default marker icon
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

// Component to update map view when region changes
function MapUpdater({ center, bounds }) {
  const map = useMap()

  useEffect(() => {
    if (bounds) {
      // Smoothly fit the map to new bounds
      map.fitBounds(bounds, { animate: true, duration: 0.5 })
    }
  }, [map, bounds, center])

  return null
}

// Screenshot control component
function ScreenshotControl() {
  const map = useMap()
  const controlRef = useRef(null)

  useEffect(() => {
    // Create custom Leaflet control
    const ScreenshotButton = L.Control.extend({
      options: {
        position: 'topleft'
      },
      onAdd: function() {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control')
        const button = L.DomUtil.create('a', 'screenshot-control-btn', container)
        button.href = '#'
        button.title = 'Take Screenshot'
        button.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
        `
        button.style.display = 'flex'
        button.style.alignItems = 'center'
        button.style.justifyContent = 'center'
        button.style.width = '30px'
        button.style.height = '30px'
        button.style.color = '#333'

        L.DomEvent.on(button, 'click', function(e) {
          L.DomEvent.preventDefault(e)
          L.DomEvent.stopPropagation(e)
          takeScreenshot()
        })

        controlRef.current = container
        return container
      }
    })

    const takeScreenshot = async () => {
      const mapContainer = map.getContainer()

      // Find and hide all controls
      const controls = mapContainer.querySelectorAll('.leaflet-control-container')
      const attribution = mapContainer.querySelectorAll('.leaflet-control-attribution')

      controls.forEach(el => el.style.visibility = 'hidden')
      attribution.forEach(el => el.style.visibility = 'hidden')

      try {
        // Wait for tiles to load
        await new Promise(resolve => setTimeout(resolve, 100))

        const canvas = await html2canvas(mapContainer, {
          useCORS: true,
          allowTaint: true,
          logging: false,
          backgroundColor: null
        })

        // Create download link
        const link = document.createElement('a')
        link.download = `map-screenshot-${Date.now()}.png`
        link.href = canvas.toDataURL('image/png')
        link.click()
      } catch (error) {
        console.error('Screenshot failed:', error)
        alert('Failed to take screenshot. Please try again.')
      } finally {
        // Restore controls
        controls.forEach(el => el.style.visibility = 'visible')
        attribution.forEach(el => el.style.visibility = 'visible')
      }
    }

    const control = new ScreenshotButton()
    map.addControl(control)

    return () => {
      map.removeControl(control)
    }
  }, [map])

  return null
}

// Standard US bounds (matching backend)
const US_BOUNDS = {
  north: 49.5,
  south: 24.5,
  west: -125.0,
  east: -66.0
}

function MapViewer({ locationSets = [], region = 'us', aspectRatio = 'widescreen', projection = 'web_mercator' }) {
  const [mapBounds, setMapBounds] = useState([[US_BOUNDS.south, US_BOUNDS.west], [US_BOUNDS.north, US_BOUNDS.east]])
  const [center, setCenter] = useState([
    (US_BOUNDS.north + US_BOUNDS.south) / 2,
    (US_BOUNDS.east + US_BOUNDS.west) / 2
  ])

  useEffect(() => {
    // Fetch region bounds when region changes (instant, no image loading)
    const fetchBounds = async () => {
      try {
        const boundsResponse = await axios.get(`${API_URL}/api/map-bounds`, {
          params: { region }
        })
        const bounds = boundsResponse.data
        const leafletBounds = [[bounds.south, bounds.west], [bounds.north, bounds.east]]
        const newCenter = [
          (bounds.north + bounds.south) / 2,
          (bounds.east + bounds.west) / 2
        ]

        setMapBounds(leafletBounds)
        setCenter(newCenter)
      } catch (error) {
        console.error('Error fetching map bounds:', error)
      }
    }
    fetchBounds()
  }, [region])

  // Create custom colored marker icons for each set
  const createMarkerIcon = (color) => {
    // Create a colored circle marker
    const svg = `
      <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
        <circle cx="10" cy="10" r="8" fill="${color}" stroke="#fff" stroke-width="2"/>
      </svg>
    `
    const iconUrl = 'data:image/svg+xml;base64,' + btoa(svg)

    return L.icon({
      iconUrl,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      popupAnchor: [0, -10]
    })
  }

  // Filter to only visible sets
  const visibleSets = locationSets.filter(set => set.visible)

  return (
    <MapContainer
      center={center}
      zoom={4}
      style={{ height: '100%', width: '100%' }}
      scrollWheelZoom={true}
      zoomControl={true}
      zoomSnap={0.25}
      zoomDelta={0.5}
      wheelPxPerZoomLevel={120}
    >
      {/* Live OpenStreetMap tiles - fully interactive */}
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />

      {/* Update map bounds when region changes */}
      <MapUpdater center={center} bounds={mapBounds} />

      {/* Screenshot button control */}
      <ScreenshotControl />

      {/* Location markers for each visible set */}
      {visibleSets.map(set =>
        set.locations.map((location, idx) => (
          <Marker
            key={`${set.id}-${idx}`}
            position={[location.lat, location.lng]}
            icon={createMarkerIcon(set.markerStyles.markerColor)}
          >
            <Popup>
              <strong>{location.name || `Location ${idx + 1}`}</strong>
              <br />
              <em>Set: {set.name}</em>
              <br />
              Lat: {location.lat.toFixed(4)}, Lng: {location.lng.toFixed(4)}
            </Popup>
          </Marker>
        ))
      )}
    </MapContainer>
  )
}

export default MapViewer
