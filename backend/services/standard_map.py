import matplotlib.pyplot as plt
import contextily as ctx
import os

# Standard US map bounds
US_BOUNDS = {
    'north': 49.5,
    'south': 24.5,
    'west': -125.0,
    'east': -66.0
}

def generate_standard_us_map(output_path='static_us_map.png', dpi=300):
    """
    Generate a standard US map image with consistent bounds using Web Mercator

    Args:
        output_path: Where to save the map image
        dpi: Resolution of the output image

    Returns:
        dict: Map bounds used in Web Mercator coordinates
    """
    # Convert lat/lng bounds to Web Mercator
    import contextily as ctx
    from pyproj import Transformer

    # Transformer from WGS84 (EPSG:4326) to Web Mercator (EPSG:3857)
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)

    # Transform corners
    west_merc, south_merc = transformer.transform(US_BOUNDS['west'], US_BOUNDS['south'])
    east_merc, north_merc = transformer.transform(US_BOUNDS['east'], US_BOUNDS['north'])

    # Create figure with specific size (16:9 aspect ratio)
    fig, ax = plt.subplots(figsize=(13.333, 7.5))

    # Set the extent in Web Mercator coordinates
    ax.set_xlim(west_merc, east_merc)
    ax.set_ylim(south_merc, north_merc)

    # Add basemap
    try:
        ctx.add_basemap(
            ax,
            source=ctx.providers.OpenStreetMap.Mapnik,
            zoom=5,
            attribution=False
        )
    except Exception as e:
        print(f"Warning: Could not add basemap: {e}")

    # Remove axes and margins
    ax.set_axis_off()
    plt.tight_layout(pad=0)
    plt.subplots_adjust(left=0, right=1, top=1, bottom=0)

    # Save the map
    plt.savefig(
        output_path,
        dpi=dpi,
        bbox_inches='tight',
        pad_inches=0,
        facecolor='white'
    )
    plt.close()

    # Return both lat/lng bounds and Web Mercator bounds
    return {
        'lat_lng': US_BOUNDS,
        'web_mercator': {
            'west': west_merc,
            'east': east_merc,
            'south': south_merc,
            'north': north_merc
        }
    }


def extract_slide_from_pptx(pptx_path, output_path='static_us_map.png'):
    """
    Extract the first slide from a PowerPoint as an image

    Args:
        pptx_path: Path to PowerPoint file
        output_path: Where to save the extracted image

    Returns:
        bool: True if successful
    """
    try:
        from pptx import Presentation
        from PIL import Image
        import io

        prs = Presentation(pptx_path)
        if len(prs.slides) == 0:
            return False

        # For now, we'll use a different approach - just copy any background image
        # Or generate from the slide using a more complex method
        # Since extracting slides to images is complex, we'll use the generated map as fallback
        print(f"Note: Using map from {pptx_path} (markers will be added on first slide)")
        return False  # Will use generated map for preview, but pptx for output

    except Exception as e:
        print(f"Could not extract slide from {pptx_path}: {e}")
        return False


def get_standard_map_path():
    """
    Get or create the standard US map

    Returns:
        str: Path to the standard map image
    """
    map_path = 'static_us_map.png'

    # Check if map3.pptx exists (in current dir or parent dir)
    if os.path.exists('map3.pptx') or os.path.exists('../map3.pptx'):
        map_location = 'map3.pptx' if os.path.exists('map3.pptx') else '../map3.pptx'
        print(f"Found {map_location} - will use for PowerPoint output")
        # Still generate a preview map for the web interface
        if not os.path.exists(map_path):
            print("Generating preview map for web interface...")
            generate_standard_us_map(map_path)
            print(f"Preview map saved to {map_path}")
    else:
        # Generate if doesn't exist
        if not os.path.exists(map_path):
            print("Generating standard US map...")
            generate_standard_us_map(map_path)
            print(f"Map saved to {map_path}")

    return map_path


def get_map_bounds():
    """Get the standard map bounds"""
    return US_BOUNDS
