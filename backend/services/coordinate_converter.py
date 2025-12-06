from pptx.util import Inches
from pyproj import Transformer

class MapCoordinateConverter:
    """
    Converts lat/lng coordinates to PowerPoint slide positions using Web Mercator projection
    """

    def __init__(self, map_bounds=None, slide_bounds=None):
        """
        Args:
            map_bounds: dict with 'north', 'south', 'east', 'west' lat/lng bounds
            slide_bounds: dict with 'left', 'top', 'width', 'height' in inches
        """
        # Default to US map bounds (matching standard_map.py)
        self.map_bounds = map_bounds or {
            'north': 49.5,
            'south': 24.5,
            'west': -125.0,
            'east': -66.0
        }

        # Default to full slide (16:9)
        self.slide_bounds = slide_bounds or {
            'left': 0,
            'top': 0,
            'width': 13.333,
            'height': 7.5
        }

        # Create transformer for Web Mercator projection
        self.transformer = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)

        # Pre-calculate Web Mercator bounds
        self.west_merc, self.south_merc = self.transformer.transform(
            self.map_bounds['west'], self.map_bounds['south']
        )
        self.east_merc, self.north_merc = self.transformer.transform(
            self.map_bounds['east'], self.map_bounds['north']
        )

    def lat_lng_to_slide(self, lat, lng):
        """
        Convert latitude/longitude to PowerPoint slide position using Web Mercator projection

        Args:
            lat: Latitude
            lng: Longitude

        Returns:
            tuple: (left, top) position in Inches
        """
        # Convert lat/lng to Web Mercator
        x_merc, y_merc = self.transformer.transform(lng, lat)

        # Calculate relative position in Web Mercator space (0 to 1)
        merc_x_range = self.east_merc - self.west_merc
        merc_y_range = self.north_merc - self.south_merc

        # Normalize to 0-1
        x_relative = (x_merc - self.west_merc) / merc_x_range
        y_relative = (self.north_merc - y_merc) / merc_y_range  # Inverted because slide Y goes down

        # Convert to slide coordinates
        left = self.slide_bounds['left'] + (x_relative * self.slide_bounds['width'])
        top = self.slide_bounds['top'] + (y_relative * self.slide_bounds['height'])

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
