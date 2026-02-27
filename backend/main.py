from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
import pandas as pd
import json
import os
import uuid
import time
import threading
import logging
import sys
from collections import OrderedDict
from typing import List, Optional
import httpx
from services.map_generator import generate_map_image
from services.pptx_builder import create_presentation, create_presentation_with_shapes
from services.standard_map import get_standard_map_path, get_map_bounds, detect_us_bounds

# ---------------------------------------------------------------------------
# Structured JSON logging
# ---------------------------------------------------------------------------
class JsonFormatter(logging.Formatter):
    def format(self, record):
        log_obj = {
            "ts": self.formatTime(record, datefmt=None),
            "level": record.levelname,
            "msg": record.getMessage(),
        }
        if hasattr(record, "extra"):
            log_obj.update(record.extra)
        return json.dumps(log_obj)

handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(JsonFormatter())
logger = logging.getLogger("pngmap")
logger.setLevel(logging.INFO)
logger.handlers = [handler]
logger.propagate = False

def log_request(fields: dict):
    record = logging.LogRecord("pngmap", logging.INFO, "", 0, "", (), None)
    record.extra = fields
    logger.handle(record)

# ---------------------------------------------------------------------------
# In-memory LRU + TTL geocode cache
# ---------------------------------------------------------------------------
class GeocodeLRUCache:
    """Thread-safe LRU cache with TTL for geocode results."""

    def __init__(self, max_size: int = 5000, ttl_seconds: int = 86400):
        self.max_size = max_size
        self.ttl_seconds = ttl_seconds
        self._cache: OrderedDict = OrderedDict()
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    def _normalize(self, query: str) -> str:
        return " ".join(query.lower().strip().split())

    def get(self, query: str):
        """Return (value, True) on hit, (None, False) on miss/expired."""
        key = self._normalize(query)
        with self._lock:
            if key not in self._cache:
                self.misses += 1
                return None, False
            entry = self._cache[key]
            if time.time() > entry["expires_at"]:
                del self._cache[key]
                self.misses += 1
                return None, False
            # Move to end (most recently used)
            self._cache.move_to_end(key)
            self.hits += 1
            return entry["value"], True

    def set(self, query: str, value):
        key = self._normalize(query)
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
            elif len(self._cache) >= self.max_size:
                self._cache.popitem(last=False)  # Evict oldest
            self._cache[key] = {
                "value": value,
                "expires_at": time.time() + self.ttl_seconds,
            }

    @property
    def size(self) -> int:
        return len(self._cache)

    @property
    def stats(self) -> dict:
        total = self.hits + self.misses
        return {
            "size": self.size,
            "max_size": self.max_size,
            "ttl_seconds": self.ttl_seconds,
            "hits": self.hits,
            "misses": self.misses,
            "hit_rate": round(self.hits / total, 4) if total > 0 else None,
        }


geocode_cache = GeocodeLRUCache(max_size=5000, ttl_seconds=86400)
_app_start_time = time.time()

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(title="P&G Mapper API")

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

# ---------------------------------------------------------------------------
# Request ID + timing middleware
# ---------------------------------------------------------------------------
@app.middleware("http")
async def request_instrumentation(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    t0 = time.time()

    # Stash on request state so endpoints can access it
    request.state.request_id = request_id
    request.state.t0 = t0
    request.state.locationiq_status = None
    request.state.t_locationiq_ms = None
    request.state.cache_hit = None

    response = await call_next(request)

    t_total_ms = round((time.time() - t0) * 1000)

    log_request({
        "event": "request",
        "request_id": request_id,
        "method": request.method,
        "route": str(request.url.path),
        "status_code": response.status_code,
        "t_total_ms": t_total_ms,
        "cache_hit": request.state.cache_hit,
        "t_locationiq_ms": request.state.t_locationiq_ms,
        "locationiq_status": request.state.locationiq_status,
    })

    response.headers["X-Request-Id"] = request_id
    return response

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class Location(BaseModel):
    lat: float
    lng: float
    name: str = None
    # Optional fields from enhanced geocoding (ignored by backend, used by frontend)
    displayName: Optional[str] = None
    precision: Optional[str] = None
    note: Optional[str] = None
    success: Optional[bool] = None
    address: Optional[str] = None

    class Config:
        extra = "ignore"  # Ignore any extra fields not defined in model

class MarkerStyles(BaseModel):
    markerColor: str = "#dc3545"
    markerShape: str = "circle"
    markerSize: float = 0.1
    showFill: bool = True
    outlineColor: str = "#ffffff"
    outlineWidth: float = 1.0
    showOutline: bool = True
    showShadow: bool = False
    showLabels: bool = False
    labelFontSize: int = 10
    labelTextColor: str = "#000000"
    labelBold: bool = True

class LocationSet(BaseModel):
    name: str
    locations: List[Location]
    markerStyles: MarkerStyles

class AddressRequest(BaseModel):
    addresses: List[str]

class MapConfig(BaseModel):
    # Support both old single-set format and new multi-set format for backward compatibility
    locations: Optional[List[Location]] = Field(default=None)
    markerStyles: Optional[MarkerStyles] = Field(default=None)
    locationSets: Optional[List[LocationSet]] = Field(default=None)
    center: Optional[List[float]] = Field(default=None)
    zoom: Optional[int] = Field(default=None)
    markerColor: str = Field(default="#3388ff")
    region: str = Field(default="us")
    aspectRatio: str = Field(default="widescreen")
    projection: str = Field(default="web_mercator")

# Geocodio — US + Canada
GEOCODIO_API_KEY = os.getenv('GEOCODIO_API_KEY', 'c664e76745a669b76174a414b7761eac9e4b4c9')
GEOCODIO_URL = 'https://api.geocod.io/v1.7/geocode'
GEOCODIO_TIMEOUT = 10.0

# Nominatim (OpenStreetMap) — international fallback, no key required
NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
NOMINATIM_TIMEOUT = 10.0
NOMINATIM_HEADERS = {"User-Agent": "PNGMapper/1.0 (pngmapper.netlify.app)"}

# US + Canadian province codes for routing
US_CA_CODES = {
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
    'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
    'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
    'VA','WA','WV','WI','WY','DC',
    'ON','QC','BC','AB','MB','SK','NS','NB','NL','PE','NT','NU','YT',
}

def is_us_canada(addr: str) -> bool:
    """Return True if any comma-separated part matches a US state or Canadian province code."""
    return any(p.strip().upper() in US_CA_CODES for p in addr.split(','))

# ---------------------------------------------------------------------------
# Dual-provider geocoder: Geocodio (US/Canada) + Nominatim (international)
# ---------------------------------------------------------------------------
async def call_locationiq(client: httpx.AsyncClient, query: str, request: Request = None) -> dict:
    """
    Route to Geocodio (US/Canada) or Nominatim (international).
    Geocodio response is normalised to Nominatim-style list:
      [{"lat": "...", "lon": "...", "display_name": "..."}]
    Returns: data, status_code, duration_ms, error_type, cache_hit, provider
    """
    import re
    normalized_query = re.sub(r'\s{2,}', ', ', query.strip())
    use_geocodio = is_us_canada(normalized_query)

    # Cache check
    cached_data, hit = geocode_cache.get(normalized_query)
    if hit:
        if request is not None:
            request.state.cache_hit = True
            request.state.t_locationiq_ms = 0
            request.state.locationiq_status = 200
        return {
            "data": cached_data,
            "status_code": 200,
            "duration_ms": 0,
            "error_type": None,
            "cache_hit": True,
            "normalized_query": normalized_query,
            "provider": "cache",
        }

    t_liq = time.time()
    error_type = None
    status_code = None
    data = None

    try:
        if use_geocodio:
            # ---- Geocodio (US + Canada) ----
            response = await client.get(
                GEOCODIO_URL,
                params={"q": normalized_query, "api_key": GEOCODIO_API_KEY},
                timeout=GEOCODIO_TIMEOUT,
            )
            duration_ms = round((time.time() - t_liq) * 1000)
            status_code = response.status_code

            if response.status_code == 200:
                body = response.json()
                results = body.get("results", [])
                if results:
                    # Normalise to Nominatim-style so downstream code is unchanged
                    data = [
                        {
                            "lat": str(r["location"]["lat"]),
                            "lon": str(r["location"]["lng"]),
                            "display_name": r.get("formatted_address", normalized_query),
                        }
                        for r in results
                    ]
                    geocode_cache.set(normalized_query, data)
                else:
                    data = []
            elif response.status_code == 422:
                error_type = "geocodio_unprocessable"
            elif response.status_code == 403:
                error_type = "geocodio_auth"
            elif response.status_code >= 500:
                error_type = f"geocodio_{response.status_code}"
            else:
                error_type = f"http_{response.status_code}"

        else:
            # ---- Nominatim (international) ----
            response = await client.get(
                NOMINATIM_URL,
                params={"q": normalized_query, "format": "json", "limit": 1},
                headers=NOMINATIM_HEADERS,
                timeout=NOMINATIM_TIMEOUT,
            )
            duration_ms = round((time.time() - t_liq) * 1000)
            status_code = response.status_code

            if response.status_code == 200:
                data = response.json()
                if data and len(data) > 0:
                    geocode_cache.set(normalized_query, data)
            elif response.status_code == 429:
                error_type = "rate_limit_429"
            elif response.status_code >= 500:
                error_type = f"nominatim_{response.status_code}"
            else:
                error_type = f"http_{response.status_code}"

    except httpx.TimeoutException:
        duration_ms = round((time.time() - t_liq) * 1000)
        error_type = "timeout"
    except Exception:
        duration_ms = round((time.time() - t_liq) * 1000)
        error_type = "network_error"

    if request is not None:
        request.state.cache_hit = False
        request.state.t_locationiq_ms = duration_ms
        request.state.locationiq_status = status_code

    return {
        "data": data,
        "status_code": status_code,
        "duration_ms": duration_ms,
        "error_type": error_type,
        "cache_hit": False,
        "normalized_query": normalized_query,
        "provider": "geocodio" if use_geocodio else "nominatim",
    }

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/")
def read_root():
    return {"message": "P&G Mapper API is running"}

@app.get("/debug-geocode")
async def debug_geocode(q: str = "500 Main St, Fairless Hills, PA 19067"):
    """Test geocoding provider and return the raw response for debugging."""
    use_geocodio = is_us_canada(q)
    async with httpx.AsyncClient() as client:
        try:
            if use_geocodio:
                response = await client.get(
                    GEOCODIO_URL,
                    params={"q": q, "api_key": GEOCODIO_API_KEY},
                    timeout=10.0,
                )
            else:
                response = await client.get(
                    NOMINATIM_URL,
                    params={"q": q, "format": "json", "limit": 1},
                    headers=NOMINATIM_HEADERS,
                    timeout=10.0,
                )
            try:
                body = response.json()
            except Exception:
                body = response.text
            return {
                "status_code": response.status_code,
                "service": "Geocodio" if use_geocodio else "Nominatim (OpenStreetMap)",
                "query": q,
                "response_body": body,
            }
        except Exception as e:
            return {"error": str(e)}

@app.get("/health")
def health():
    """Returns uptime and geocode cache stats."""
    return {
        "status": "ok",
        "uptime_seconds": round(time.time() - _app_start_time),
        "geocode_cache": geocode_cache.stats,
    }

@app.get("/api/map-image")
async def get_map_image(
    region: str = "us",
    aspect_ratio: str = "widescreen",
    projection: str = "web_mercator"
):
    """
    Get a map image for the specified region, aspect ratio, and projection
    """
    try:
        map_path = get_standard_map_path(
            region=region,
            aspect_ratio=aspect_ratio,
            projection=projection
        )
        return FileResponse(map_path, media_type="image/png")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/map-bounds")
async def get_bounds(region: str = "us"):
    """
    Get map bounds for the specified region
    """
    return get_map_bounds(region=region)

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
async def geocode_addresses(request_body: AddressRequest, request: Request):
    """
    Geocode addresses using multi-strategy fallback (mirrors frontend logic).
    Strategies: exact → simplified → street+city → city+state → zip only.
    All LocationIQ calls go through the in-memory LRU cache.
    """
    import asyncio
    import re as _re

    NOMINATIM_DELAY = 1.1   # Nominatim enforces 1 req/sec; respect it
    GEOCODIO_DELAY  = 0.05  # Geocodio is bulk-friendly; tiny delay avoids hammering

    request_id = getattr(request.state, "request_id", str(uuid.uuid4()))

    # ---- address manipulation helpers ----

    def fix_zip(addr: str) -> str:
        return _re.sub(r'\b([A-Z]{2})\s+(\d{4})\b', r'\1 0\2', addr)

    def simplify(addr: str) -> str:
        s = addr
        s = _re.sub(r'\b(Building|Bldg\.?)\s+[A-Z0-9]+,?\s*', '', s, flags=_re.IGNORECASE)
        s = _re.sub(r',?\s*(Suite|Unit|Ste\.?|#)\s+[A-Z0-9]+', '', s, flags=_re.IGNORECASE)
        s = _re.sub(r',?\s*[A-Z][a-z]+\s+(Gate|Ward)\s+Industrial\s+Park,?\s*', '', s, flags=_re.IGNORECASE)
        s = _re.sub(r',\s*,', ',', s)
        s = _re.sub(r'\s+,', ',', s)
        s = _re.sub(r',\s+', ', ', s)
        return s.strip()

    def extract_city_state(addr: str):
        # Works on comma-separated addresses: "street, city, ST, zip" → "city, ST"
        parts = [p.strip() for p in addr.split(',')]
        if len(parts) >= 3:
            # state is parts[-2], city is parts[-3] (strip any digits)
            state = _re.sub(r'\d+', '', parts[-2]).strip()
            city  = _re.sub(r'\d+', '', parts[-3]).strip()
            if city and state:
                return f"{city}, {state}"
        # Canadian postal: "street, city, ON, A1B 2C3" handled same way above
        return None

    def extract_street_city(addr: str):
        # "street, city, ST, zip" → "street, city"  (drop state + zip)
        parts = [p.strip() for p in addr.split(',')]
        if len(parts) >= 3:
            return ', '.join(parts[:-2])
        return None

    def extract_zip(addr: str):
        parts = [p.strip() for p in addr.split(',')]
        # US zip: pair with state for specificity → "19067, PA" not just "19067"
        m = _re.search(r'\b(\d{5})(?:-\d{4})?\b', addr)
        if m:
            zip_code = m.group(1)
            state = _re.sub(r'\d+', '', parts[-2]).strip() if len(parts) >= 3 else ''
            return f"{zip_code}, {state}" if state else zip_code
        # Canadian postal code
        m = _re.search(r'\b([A-Z]\d[A-Z]\s*\d[A-Z]\d)\b', addr)
        if m: return m.group(1)
        return None

    def normalize(addr: str) -> str:
        n = _re.sub(r'[\t\s]{2,}', ', ', addr.strip())
        return fix_zip(n)

    # ---- single address with 5-strategy fallback ----

    async def geocode_with_fallback(client: httpx.AsyncClient, address: str) -> dict:
        normalized = normalize(address)
        strategies = []

        # Build strategy list (deduplicated, preserving order)
        seen = set()
        def add(q, precision, note=None):
            if q and q not in seen:
                seen.add(q)
                strategies.append((q, precision, note))

        add(normalized,                        'exact',      None)
        add(simplify(normalized),              'simplified', 'Building/suite removed')
        add(extract_street_city(normalized),   'street',     'Street+city only')
        add(extract_city_state(normalized),    'city',       'City/region only')
        add(extract_zip(normalized),           'zipcode',    'ZIP code area only')

        for i, (query, precision, note) in enumerate(strategies):
            if i > 0:
                delay_s = GEOCODIO_DELAY if is_us_canada(query) else NOMINATIM_DELAY
                await asyncio.sleep(delay_s)

            liq = await call_locationiq(client, query)
            log_request({
                "event": "geocode_strategy",
                "request_id": request_id,
                "address": address,
                "query": query,
                "strategy": precision,
                "cache_hit": liq["cache_hit"],
                "locationiq_status": liq["status_code"],
                "error_type": liq["error_type"],
                "t_locationiq_ms": liq["duration_ms"],
            })

            data = liq["data"]
            if liq["status_code"] == 200 and data and len(data) > 0:
                loc = data[0]
                result = {
                    "address":     address,
                    "lat":         float(loc["lat"]),
                    "lng":         float(loc["lon"]),
                    "name":        normalized,
                    "success":     True,
                    "displayName": loc.get("display_name", ""),
                    "precision":   precision,
                }
                if note:
                    result["note"] = note
                return result

        return {"address": address, "success": False,
                "error": "Address not found after trying all fallback strategies"}

    # ---- process all addresses sequentially ----
    results = []
    cache_hits = 0
    cache_misses = 0
    t_liq_total = 0

    async with httpx.AsyncClient() as client:
        for idx, address in enumerate(request_body.addresses):
            result = await geocode_with_fallback(client, address)
            results.append(result)
            if idx < len(request_body.addresses) - 1:
                delay_s = GEOCODIO_DELAY if is_us_canada(normalize(address)) else NOMINATIM_DELAY
                await asyncio.sleep(delay_s)

    request.state.cache_hit = None
    request.state.t_locationiq_ms = None
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
        # Handle both old single-set format and new multi-set format
        if config.locationSets:
            # New multi-set format
            location_sets = [
                {
                    'name': loc_set.name,
                    'locations': [loc.dict() for loc in loc_set.locations],
                    'markerStyles': loc_set.markerStyles.dict()
                }
                for loc_set in config.locationSets
            ]
            print(f"DEBUG: Received {len(location_sets)} location sets")
            for i, loc_set in enumerate(location_sets):
                print(f"  Set {i+1}: {loc_set['name']} with {len(loc_set['locations'])} locations")
        else:
            # Old single-set format - convert to new format for compatibility
            locations = [loc.dict() for loc in config.locations]
            marker_styles = config.markerStyles.dict() if config.markerStyles else None
            location_sets = [
                {
                    'name': 'Set 1',
                    'locations': locations,
                    'markerStyles': marker_styles or {
                        'markerColor': '#dc3545',
                        'markerShape': 'circle',
                        'markerSize': 0.1,
                        'showFill': True,
                        'outlineColor': '#ffffff',
                        'outlineWidth': 1.0,
                        'showOutline': True,
                        'showShadow': False,
                        'showLabels': False,
                        'labelFontSize': 10,
                        'labelTextColor': '#000000',
                        'labelBold': True
                    }
                }
            ]
            print(f"DEBUG: Using legacy single-set format")

        print(f"DEBUG: Region: {config.region}, Aspect: {config.aspectRatio}, Projection: {config.projection}")

        # Flatten all locations for bounds detection
        all_locations_flat = []
        for loc_set in location_sets:
            all_locations_flat.extend(loc_set['locations'])

        # Check for region-specific template
        template_map = {
            'world': 'world_map v1.pptx',
            'china': 'China_map v1.pptx',
            'north_america': 'North America_map v1.pptx',
            'south_america': 'South America_map v1.pptx',
            'europe': 'Europe_map v1.pptx',
            'brazil': 'Brazil_map v2.pptx',
            'uk': 'UK_map v1.pptx',
            'asia': 'Asia_map v1.pptx'
        }

        # For US region, detect which variant template to use
        us_template_map = {
            'continental': 'US_map v1.pptx',
            'with_alaska': 'US_map AKHI v1.pptx',  # Use AKHI template when Alaska detected
            'with_hawaii': 'US_map AKHI v1.pptx',  # Use AKHI template when Hawaii detected
            'full': 'US_map AKHI v1.pptx'          # Use AKHI template when both detected
        }

        # Try region-specific template first
        template_path = None
        region_template = None

        if config.region == 'us':
            # Detect US bounds variant
            us_variant = detect_us_bounds(all_locations_flat)
            region_template = us_template_map.get(us_variant, 'US_map v1.pptx')
            print(f"DEBUG: Detected US variant: {us_variant}, using template: {region_template}")
            # Check if template exists and set template_path
            print(f"DEBUG: Checking {region_template}: {os.path.exists(region_template)}")
            print(f"DEBUG: Checking ../{region_template}: {os.path.exists(f'../{region_template}')}")
            print(f"DEBUG: Checking Regional Templates/{region_template}: {os.path.exists(f'Regional Templates/{region_template}')}")
            if os.path.exists(region_template):
                template_path = region_template
                print(f"Using US template: {region_template}")
            elif os.path.exists(f'../{region_template}'):
                template_path = f'../{region_template}'
                print(f"Using US template from parent: {template_path}")
            elif os.path.exists(f'Regional Templates/{region_template}'):
                template_path = f'Regional Templates/{region_template}'
                print(f"Using US template from Regional Templates: {template_path}")
        elif config.region in template_map:
            region_template = template_map[config.region]
            print(f"DEBUG: Looking for region template: {region_template}")
            print(f"DEBUG: Checking {region_template}: {os.path.exists(region_template)}")
            print(f"DEBUG: Checking ../{region_template}: {os.path.exists(f'../{region_template}')}")
            if os.path.exists(region_template):
                template_path = region_template
                print(f"Using region-specific template: {region_template}")
            elif os.path.exists(f'../{region_template}'):
                template_path = f'../{region_template}'
                print(f"Using region-specific template from parent: {template_path}")

        # Fall back to generic template
        if not template_path:
            if os.path.exists('template.pptx'):
                template_path = 'template.pptx'
                print(f"Using generic template: template.pptx")
            else:
                print("No template found, generating map only")

        # Create PowerPoint with shapes for multiple location sets
        pptx_path = create_presentation_with_shapes(
            location_sets=location_sets,
            template_path=template_path,
            region=config.region,
            aspect_ratio=config.aspectRatio,
            projection=config.projection
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
