import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import { useEffect, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import axios from 'axios'

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

// Standard US bounds (matching backend)
const US_BOUNDS = {
  north: 49.5,
  south: 24.5,
  west: -125.0,
  east: -66.0
}

function MapViewer({ locations, region = 'us', aspectRatio = 'widescreen', projection = 'web_mercator' }) {
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

  return (
    <MapContainer
      center={center}
      zoom={4}
      style={{ height: '100%', width: '100%' }}
      scrollWheelZoom={true}
      zoomControl={true}
    >
      {/* Live OpenStreetMap tiles - fully interactive */}
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />

      {/* Update map bounds when region changes */}
      <MapUpdater center={center} bounds={mapBounds} />

      {/* Location markers */}
      {locations.map((location, idx) => (
        <Marker key={idx} position={[location.lat, location.lng]}>
          <Popup>
            <strong>{location.name || `Location ${idx + 1}`}</strong>
            <br />
            Lat: {location.lat.toFixed(4)}, Lng: {location.lng.toFixed(4)}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}

export default MapViewer
