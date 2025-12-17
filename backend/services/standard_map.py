import matplotlib.pyplot as plt
import contextily as ctx
import os
from pyproj import Transformer
from PIL import Image

# Region bounds definitions
REGION_BOUNDS = {
    'us': {
        'continental': {
            'north': 49.5, 'south': 24.5,
            'west': -125.0, 'east': -66.0
        },
        'with_alaska': {
            'north': 71.5, 'south': 24.5,
            'west': -168.0, 'east': -66.0
        },
        'with_hawaii': {
            'north': 49.5, 'south': 18.9,
            'west': -125.0, 'east': -66.0
        },
        'full': {  # Alaska + Hawaii
            'north': 71.5, 'south': 18.9,
            'west': -168.0, 'east': -66.0
        }
    },
    'north_america': {
        'north': 60.0, 'south': 7.0,  # Cropped arctic, USA centered, includes Central America
        'west': -168.0, 'east': -52.0
    },
    'south_america': {
        'north': 12.5, 'south': -56.0,
        'west': -81.0, 'east': -34.0
    },
    'brazil': {
        'north': 5.3, 'south': -33.8,
        'west': -85.0, 'east': -25.0  # Extended to show more ocean on both sides
    },
    'europe': {
        'north': 71.0, 'south': 36.0,
        'west': -10.0, 'east': 40.0
    },
    'uk': {  # UK & Ireland
        'north': 60.9, 'south': 49.9,
        'west': -8.2, 'east': 1.8
    },
    'china': {
        'north': 53.5, 'south': 18.0,
        'west': 73.5, 'east': 135.0
    },
    'asia': {
        'north': 55.0, 'south': -10.0,
        'west': 25.0, 'east': 150.0
    },
    'world': {
        'north': 80.0, 'south': -66.089364,
        'west': -180.0, 'east': 180.0
    }
}

# Aspect ratio definitions (for slide size)
ASPECT_RATIOS = {
    'widescreen': {  # 16:9
        'width': 13.333,
        'height': 7.5,
        'label': 'Widescreen (16:9)'
    },
    'standard': {  # 4:3
        'width': 10.0,
        'height': 7.5,
        'label': 'Standard (4:3)'
    }
}

# Projection definitions
PROJECTIONS = {
    'web_mercator': {
        'epsg': 'EPSG:3857',
        'label': 'Web Mercator'
    },
    'robinson': {
        'epsg': 'ESRI:54030',
        'label': 'Robinson'
    },
    'equal_earth': {
        'epsg': 'ESRI:54035',
        'label': 'Equal Earth'
    }
}

# Backward compatibility
US_BOUNDS = REGION_BOUNDS['us']['continental']


def detect_us_bounds(locations):
    """
    Detect which US bounds to use based on location data

    Args:
        locations: List of dicts with 'lat' and 'lng' keys

    Returns:
        str: US bounds variant ('continental', 'with_alaska', 'with_hawaii', 'full')
    """
    if not locations:
        return 'continental'

    has_alaska = any(loc['lat'] > 51.0 and loc['lng'] < -130.0 for loc in locations)
    has_hawaii = any(loc['lat'] < 22.0 and loc['lng'] < -155.0 for loc in locations)

    if has_alaska and has_hawaii:
        return 'full'
    elif has_alaska:
        return 'with_alaska'
    elif has_hawaii:
        return 'with_hawaii'
    else:
        return 'continental'


def get_region_bounds(region='us', locations=None):
    """
    Get geographic bounds for a region

    Args:
        region: Region code ('us', 'world', 'europe', etc.)
        locations: Optional location data for smart bounds detection

    Returns:
        dict: Geographic bounds with 'north', 'south', 'east', 'west'
    """
    if region == 'us' and locations:
        variant = detect_us_bounds(locations)
        return REGION_BOUNDS['us'][variant]
    elif region == 'us':
        return REGION_BOUNDS['us']['continental']
    else:
        return REGION_BOUNDS.get(region, REGION_BOUNDS['us']['continental'])


def generate_map(bounds, projection='web_mercator', output_path='map.png', dpi=300):
    """
    Generate a map image at its natural aspect ratio (no forcing)

    Args:
        bounds: Dict with 'north', 'south', 'east', 'west' geographic bounds
        projection: Projection type ('web_mercator', 'robinson', 'equal_earth')
        output_path: Where to save the map
        dpi: Image resolution

    Returns:
        dict: Geographic bounds used (unchanged from input)
    """
    # Get projection EPSG code
    proj = PROJECTIONS.get(projection, PROJECTIONS['web_mercator'])
    epsg = proj['epsg']

    # Transform to projected coordinates
    transformer = Transformer.from_crs("EPSG:4326", epsg, always_xy=True)

    west_proj, south_proj = transformer.transform(bounds['west'], bounds['south'])
    east_proj, north_proj = transformer.transform(bounds['east'], bounds['north'])

    # Calculate natural aspect ratio in projected space
    proj_width = east_proj - west_proj
    proj_height = north_proj - south_proj
    natural_aspect = proj_width / proj_height

    print(f"DEBUG: Generating map with natural aspect ratio: {natural_aspect:.2f}:1")
    print(f"DEBUG: Geographic bounds: N={bounds['north']:.2f}, S={bounds['south']:.2f}, E={bounds['east']:.2f}, W={bounds['west']:.2f}")

    # Create figure at natural aspect ratio
    # Use a reasonable base height and calculate width
    fig_height = 7.5
    fig_width = fig_height * natural_aspect

    print(f"DEBUG: Figure size: {fig_width:.2f}\" × {fig_height:.2f}\"")

    fig, ax = plt.subplots(figsize=(fig_width, fig_height))

    # Set extent in projected coordinates
    ax.set_xlim(west_proj, east_proj)
    ax.set_ylim(south_proj, north_proj)

    # Add basemap
    try:
        ctx.add_basemap(
            ax,
            source=ctx.providers.OpenStreetMap.Mapnik,
            crs=epsg,
            attribution=False
        )
    except Exception as e:
        print(f"Warning: Could not add basemap: {e}")

    # Remove axes and margins
    ax.set_axis_off()
    plt.tight_layout(pad=0)
    plt.subplots_adjust(left=0, right=1, top=1, bottom=0)

    # Save with tight bounding box (minimal whitespace trimming)
    plt.savefig(
        output_path,
        dpi=dpi,
        bbox_inches='tight',
        pad_inches=0,
        facecolor='white'
    )
    plt.close()

    print(f"DEBUG: Map saved to {output_path}")

    # Return the ORIGINAL bounds (no adjustment)
    return bounds


def get_standard_map_path(region='us', aspect_ratio='standard', projection='web_mercator', locations=None):
    """
    Get or generate a standard map for a region

    Args:
        region: Region code
        aspect_ratio: Slide aspect ratio (not used for map generation, only for slide size)
        projection: Map projection type
        locations: Optional location data

    Returns:
        tuple: (map_path, geographic_bounds)
    """
    # Get bounds for region
    bounds = get_region_bounds(region, locations)

    # Generate cache filename
    cache_name = f"static_{region}_{projection}.png"

    # Check cache
    if os.path.exists(cache_name):
        print(f"DEBUG: Using cached map: {cache_name}")
        return (cache_name, bounds)

    # Generate new map
    print(f"DEBUG: Generating new map for {region} with {projection}")
    generate_map(bounds, projection, cache_name)

    return (cache_name, bounds)


def get_map_bounds(region='us', locations=None):
    """Get map bounds for a region"""
    return get_region_bounds(region, locations)
