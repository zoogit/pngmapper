from pptx.util import Inches
from pyproj import Transformer
from services.standard_map import get_region_bounds, ASPECT_RATIOS, PROJECTIONS

class MapCoordinateConverter:
    """
    Converts lat/lng coordinates to PowerPoint slide positions using specified projection
    """

    def __init__(self, map_bounds=None, slide_bounds=None, projection='web_mercator',
                 region='us', aspect_ratio='widescreen', locations=None):
        """
        Args:
            map_bounds: dict with 'north', 'south', 'east', 'west' lat/lng bounds (optional)
            slide_bounds: dict with 'left', 'top', 'width', 'height' in inches (optional)
            projection: Projection type ('web_mercator', 'robinson', 'equal_earth')
            region: Region code for auto-bounds ('us', 'europe', etc.)
            aspect_ratio: 'widescreen' (16:9) or 'standard' (4:3)
            locations: Optional locations for smart US bounds detection
        """
        # Get map bounds (from parameter or region)
        if map_bounds:
            self.map_bounds = map_bounds
        else:
            self.map_bounds = get_region_bounds(region, locations)

        # Get slide bounds (from parameter or aspect ratio)
        if slide_bounds:
            self.slide_bounds = slide_bounds
        else:
            aspect = ASPECT_RATIOS.get(aspect_ratio, ASPECT_RATIOS['widescreen'])
            self.slide_bounds = {
                'left': 0,
                'top': 0,
                'width': aspect['width'],
                'height': aspect['height']
            }

        # Get projection EPSG code
        self.projection = projection
        proj = PROJECTIONS.get(projection, PROJECTIONS['web_mercator'])
        self.projection_epsg = proj['epsg']

        # Create transformer for the specified projection
        self.transformer = Transformer.from_crs("EPSG:4326", self.projection_epsg, always_xy=True)

        # Pre-calculate projected bounds
        self.west_proj, self.south_proj = self.transformer.transform(
            self.map_bounds['west'], self.map_bounds['south']
        )
        self.east_proj, self.north_proj = self.transformer.transform(
            self.map_bounds['east'], self.map_bounds['north']
        )

        print(f"DEBUG: MapCoordinateConverter initialized with bounds:")
        print(f"DEBUG:   N={self.map_bounds['north']:.2f}°, S={self.map_bounds['south']:.2f}°")
        print(f"DEBUG:   E={self.map_bounds['east']:.2f}°, W={self.map_bounds['west']:.2f}°")
        print(f"DEBUG:   Slide area: {self.slide_bounds['width']:.2f}\" x {self.slide_bounds['height']:.2f}\"")

    def lat_lng_to_slide(self, lat, lng):
        """
        Convert latitude/longitude to PowerPoint slide position using specified projection

        Args:
            lat: Latitude
            lng: Longitude

        Returns:
            tuple: (left, top) position in Inches
        """
        # Convert lat/lng to projected coordinates
        x_proj, y_proj = self.transformer.transform(lng, lat)

        # Calculate relative position in projected space (0 to 1)
        proj_x_range = self.east_proj - self.west_proj
        proj_y_range = self.north_proj - self.south_proj

        # Normalize to 0-1
        x_relative = (x_proj - self.west_proj) / proj_x_range
        y_relative = (self.north_proj - y_proj) / proj_y_range  # Inverted because slide Y goes down

        # Convert to slide coordinates
        left = self.slide_bounds['left'] + (x_relative * self.slide_bounds['width'])
        top = self.slide_bounds['top'] + (y_relative * self.slide_bounds['height'])

        print(f"DEBUG MARKER: ({lat:.2f}, {lng:.2f}) -> x_rel={x_relative:.3f}, y_rel={y_relative:.3f} -> ({left:.2f}\", {top:.2f}\")")

        return (Inches(left), Inches(top))

    def set_custom_bounds(self, north, south, east, west):
        """Set custom map bounds"""
        self.map_bounds = {
            'north': north,
            'south': south,
            'east': east,
            'west': west
        }

    def set_slide_area(self, left, top, width, height):
        """Set custom slide area for map (in inches)"""
        self.slide_bounds = {
            'left': left,
            'top': top,
            'width': width,
            'height': height
        }
