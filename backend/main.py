from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
import pandas as pd
import json
import os
from typing import List
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderServiceError
import time
from services.map_generator import generate_map_image
from services.pptx_builder import create_presentation, create_presentation_with_shapes
from services.standard_map import get_standard_map_path, get_map_bounds

app = FastAPI(title="PNGMap API")

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://pngmapper.netlify.app",
        "http://localhost:3000",
        "http://localhost:3001"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Location(BaseModel):
    lat: float
    lng: float
    name: str = None

class MarkerStyles(BaseModel):
    markerColor: str = "#dc3545"
    markerShape: str = "circle"
    markerSize: float = 0.2
    showFill: bool = True
    outlineColor: str = "#ffffff"
    outlineWidth: float = 1.0
    showOutline: bool = True
    showShadow: bool = False
    showLabels: bool = True
    labelFontSize: int = 10
    labelTextColor: str = "#000000"
    labelBgColor: str = "#ffffff"
    labelBold: bool = True

class AddressRequest(BaseModel):
    addresses: List[str]

class MapConfig(BaseModel):
    locations: List[Location]
    center: List[float]
    zoom: int
    markerColor: str = "#3388ff"
    markerStyles: MarkerStyles = None

# Initialize geocoder
geolocator = Nominatim(user_agent="pngmap_app")

@app.get("/")
def read_root():
    return {"message": "PNGMap API is running"}

@app.get("/api/map-image")
async def get_map_image():
    """
    Get the standard map image
    """
    try:
        map_path = get_standard_map_path()
        return FileResponse(map_path, media_type="image/png")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/map-bounds")
async def get_bounds():
    """
    Get the standard map bounds
    """
    return get_map_bounds()

@app.post("/api/upload-template")
async def upload_template(file: UploadFile = File(...)):
    """
    Upload PowerPoint template with map background
    """
    try:
        if not file.filename.endswith('.pptx'):
            raise HTTPException(
                status_code=400,
                detail="File must be a PowerPoint (.pptx)"
            )

        # Save template
        template_path = 'template.pptx'
        contents = await file.read()
        with open(template_path, 'wb') as f:
            f.write(contents)

        return {"message": "Template uploaded successfully", "path": template_path}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/geocode")
async def geocode_addresses(request: AddressRequest):
    """
    Geocode addresses to lat/lng coordinates
    """
    results = []

    for address in request.addresses:
        try:
            # Add delay to respect Nominatim usage policy (1 request per second)
            time.sleep(1)

            # Normalize address format: replace multiple spaces with comma
            # This allows "Los Angeles    CA" to become "Los Angeles, CA"
            import re
            normalized_address = re.sub(r'\s{2,}', ', ', address.strip())

            location = geolocator.geocode(normalized_address, timeout=10)

            if location:
                results.append({
                    'address': address,
                    'lat': location.latitude,
                    'lng': location.longitude,
                    'name': address,
                    'success': True
                })
            else:
                results.append({
                    'address': address,
                    'success': False,
                    'error': 'Address not found'
                })

        except (GeocoderTimedOut, GeocoderServiceError) as e:
            results.append({
                'address': address,
                'success': False,
                'error': str(e)
            })

    return results

@app.post("/api/upload")
async def upload_data(file: UploadFile = File(...)):
    """
    Upload location data (CSV or GeoJSON) and return parsed locations
    """
    try:
        contents = await file.read()

        if file.filename.endswith('.csv'):
            # Parse CSV
            df = pd.read_csv(pd.io.common.BytesIO(contents))

            # Expected columns: lat, lng, name (optional)
            required_cols = ['lat', 'lng']
            if not all(col in df.columns for col in required_cols):
                raise HTTPException(
                    status_code=400,
                    detail=f"CSV must contain columns: {required_cols}"
                )

            locations = df.to_dict('records')

        elif file.filename.endswith(('.geojson', '.json')):
            # Parse GeoJSON
            data = json.loads(contents)

            locations = []
            if data.get('type') == 'FeatureCollection':
                for feature in data.get('features', []):
                    coords = feature['geometry']['coordinates']
                    properties = feature.get('properties', {})
                    locations.append({
                        'lng': coords[0],
                        'lat': coords[1],
                        'name': properties.get('name', '')
                    })
            else:
                raise HTTPException(
                    status_code=400,
                    detail="GeoJSON must be a FeatureCollection"
                )
        else:
            raise HTTPException(
                status_code=400,
                detail="File must be CSV or GeoJSON"
            )

        return locations

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/generate-pptx")
async def generate_pptx(config: MapConfig):
    """
    Generate PowerPoint with map visualization using shapes
    """
    try:
        # Convert locations to list of dicts
        locations = [loc.dict() for loc in config.locations]

        # Get marker styles or use defaults
        marker_styles = config.markerStyles.dict() if config.markerStyles else None
        print(f"DEBUG: Received marker styles: {marker_styles}")
        print(f"DEBUG: Has markerShape? {marker_styles.get('markerShape') if marker_styles else 'N/A'}")
        print(f"DEBUG: Has showShadow? {marker_styles.get('showShadow') if marker_styles else 'N/A'}")
        print(f"DEBUG: Has showFill? {marker_styles.get('showFill') if marker_styles else 'N/A'}")
        print(f"DEBUG: Has showOutline? {marker_styles.get('showOutline') if marker_styles else 'N/A'}")

        # Check if template exists
        template_path = 'template.pptx' if os.path.exists('template.pptx') else None

        # Create PowerPoint with shapes instead of images
        pptx_path = create_presentation_with_shapes(
            locations,
            template_path=template_path,
            marker_styles=marker_styles
        )

        # Return file
        return FileResponse(
            pptx_path,
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            filename="map_presentation.pptx"
        )

    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        print(f"ERROR: {error_details}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Cleanup temporary files
        if os.path.exists('output.pptx'):
            pass  # Don't delete until after response is sent
