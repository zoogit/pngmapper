import geopandas as gpd
import matplotlib.pyplot as plt
import contextily as ctx
from shapely.geometry import Point
import pandas as pd

def generate_map_image(locations, center, zoom, marker_color):
    """
    Generate a map image from location data

    Args:
        locations: List of dicts with lat, lng, name
        center: [lat, lng] center of map
        zoom: Zoom level (not directly used in static map)
        marker_color: Color for markers

    Returns:
        str: Path to generated image
    """
    # Create GeoDataFrame
    df = pd.DataFrame(locations)
    geometry = [Point(xy) for xy in zip(df['lng'], df['lat'])]
    gdf = gpd.GeoDataFrame(df, geometry=geometry, crs='EPSG:4326')

    # Convert to Web Mercator for contextily basemap
    gdf = gdf.to_crs(epsg=3857)

    # Create figure
    fig, ax = plt.subplots(figsize=(12, 10))

    # Plot points
    gdf.plot(
        ax=ax,
        color=marker_color,
        markersize=100,
        edgecolor='white',
        linewidth=2,
        alpha=0.8,
        zorder=5
    )

    # Add basemap
    try:
        ctx.add_basemap(
            ax,
            crs=gdf.crs,
            source=ctx.providers.CartoDB.Voyager,
            zoom='auto'
        )
    except Exception as e:
        print(f"Warning: Could not add basemap: {e}")

    # Add labels for locations with names
    for idx, row in gdf.iterrows():
        if row.get('name'):
            ax.annotate(
                row['name'],
                xy=(row.geometry.x, row.geometry.y),
                xytext=(5, 5),
                textcoords='offset points',
                fontsize=9,
                bbox=dict(boxstyle='round,pad=0.5', facecolor='white', alpha=0.7)
            )

    # Remove axes
    ax.set_axis_off()

    # Tight layout
    plt.tight_layout()

    # Save
    output_path = 'temp_map.png'
    plt.savefig(output_path, dpi=300, bbox_inches='tight', facecolor='white')
    plt.close()

    return output_path
