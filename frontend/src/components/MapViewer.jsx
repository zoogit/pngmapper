import { MapContainer, ImageOverlay, Marker, Popup } from 'react-leaflet'
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

// Standard US bounds (matching backend)
const US_BOUNDS = {
  north: 49.5,
  south: 24.5,
  west: -125.0,
  east: -66.0
}

function MapViewer({ locations }) {
  const [mapBounds, setMapBounds] = useState(null)
  const [mapImageUrl, setMapImageUrl] = useState(null)

  useEffect(() => {
    // Fetch map bounds and image URL
    const fetchMapData = async () => {
      try {
        const boundsResponse = await axios.get(`${API_URL}/api/map-bounds`)
        const bounds = boundsResponse.data
        setMapBounds([[bounds.south, bounds.west], [bounds.north, bounds.east]])
        setMapImageUrl(`${API_URL}/api/map-image?t=${Date.now()}`)
      } catch (error) {
        console.error('Error fetching map data:', error)
        // Fallback to default bounds
        setMapBounds([[US_BOUNDS.south, US_BOUNDS.west], [US_BOUNDS.north, US_BOUNDS.east]])
      }
    }
    fetchMapData()
  }, [])

  if (!mapBounds) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      Loading map...
    </div>
  }

  const center = [
    (US_BOUNDS.north + US_BOUNDS.south) / 2,
    (US_BOUNDS.east + US_BOUNDS.west) / 2
  ]

  return (
    <MapContainer
      center={center}
      zoom={5}
      style={{ height: '100%', width: '100%' }}
      maxBounds={mapBounds}
      maxBoundsViscosity={1.0}
    >
      {mapImageUrl && (
        <ImageOverlay
          url={mapImageUrl}
          bounds={mapBounds}
          opacity={1}
          zIndex={1}
        />
      )}
      {locations.map((location, idx) => (
        <Marker key={idx} position={[location.lat, location.lng]}>
          <Popup>
            {location.name || `Location ${idx + 1}`}
            <br />
            Lat: {location.lat}, Lng: {location.lng}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}

export default MapViewer
