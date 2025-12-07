from pptx import Presentation
from pptx.util import Inches, Pt, Cm
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE
from pptx.dml.color import RGBColor
from services.coordinate_converter import MapCoordinateConverter
from services.standard_map import get_standard_map_path, get_map_bounds
import os

def create_presentation(map_image_path, locations):
    """
    Create PowerPoint presentation with map

    Args:
        map_image_path: Path to map image
        locations: List of location dicts

    Returns:
        str: Path to created presentation
    """
    prs = Presentation()

    # Set slide size to widescreen (16:9)
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)

    # Title Slide
    title_slide_layout = prs.slide_layouts[0]
    title_slide = prs.slides.add_slide(title_slide_layout)
    title = title_slide.shapes.title
    subtitle = title_slide.placeholders[1]

    title.text = "Location Map"
    subtitle.text = f"{len(locations)} locations"

    # Map Slide
    blank_slide_layout = prs.slide_layouts[6]
    map_slide = prs.slides.add_slide(blank_slide_layout)

    # Add title
    left = Inches(0.5)
    top = Inches(0.3)
    width = Inches(12.333)
    height = Inches(0.6)

    title_box = map_slide.shapes.add_textbox(left, top, width, height)
    title_frame = title_box.text_frame
    title_frame.text = "Location Overview"
    title_para = title_frame.paragraphs[0]
    title_para.font.size = Pt(32)
    title_para.font.bold = True
    title_para.alignment = PP_ALIGN.CENTER

    # Add map image
    img_left = Inches(0.5)
    img_top = Inches(1.2)
    img_width = Inches(12.333)

    map_slide.shapes.add_picture(
        map_image_path,
        img_left,
        img_top,
        width=img_width
    )

    # Locations List Slide (if there are named locations)
    named_locations = [loc for loc in locations if loc.get('name')]
    if named_locations:
        list_slide = prs.slides.add_slide(prs.slide_layouts[1])
        list_title = list_slide.shapes.title
        list_title.text = "Locations List"

        body_shape = list_slide.placeholders[1]
        text_frame = body_shape.text_frame
        text_frame.clear()

        for i, loc in enumerate(named_locations[:10], 1):  # Limit to first 10
            p = text_frame.add_paragraph()
            p.text = f"{i}. {loc['name']}"
            p.level = 0

    # Save
    output_path = 'output.pptx'
    prs.save(output_path)

    return output_path


def create_presentation_with_shapes(locations, template_path=None, map_bounds=None, marker_styles=None):
    """
    Create PowerPoint presentation with shapes instead of images

    Args:
        locations: List of location dicts with lat, lng, name
        template_path: Optional path to template PPTX with map background
        map_bounds: Optional dict with custom map bounds
        marker_styles: Optional dict with marker styling options

    Returns:
        str: Path to created presentation
    """
    # Use standard map bounds
    if map_bounds is None:
        map_bounds = get_map_bounds()

    # Check if map3.pptx exists (in current dir or parent dir)
    user_map_path = None

    # Debug: log current directory and file search
    import os
    current_dir = os.getcwd()
    print(f"DEBUG: Current working directory: {current_dir}")
    print(f"DEBUG: Checking for map3.pptx in current dir: {os.path.exists('map3.pptx')}")
    print(f"DEBUG: Checking for ../map3.pptx: {os.path.exists('../map3.pptx')}")

    if os.path.exists('map3.pptx'):
        user_map_path = 'map3.pptx'
        print(f"DEBUG: Using map3.pptx from current directory")
    elif os.path.exists('../map3.pptx'):
        user_map_path = '../map3.pptx'
        print(f"DEBUG: Using map3.pptx from parent directory")
    else:
        print(f"DEBUG: map3.pptx not found in current or parent directory")

    # Initialize coordinate converter with standard bounds
    slide_bounds = {
        'left': 0,
        'top': 0,
        'width': 13.333,
        'height': 7.5
    }
    converter = MapCoordinateConverter(map_bounds=map_bounds, slide_bounds=slide_bounds)

    # SLIDE 1: User's map (if exists) - Start with their template
    if user_map_path and os.path.exists(user_map_path):
        # Load the user's template as base
        prs = Presentation(user_map_path)

        # Add markers to the first slide (user's map)
        if len(prs.slides) > 0:
            add_markers_to_slide(prs.slides[0], locations, converter, marker_styles)
    else:
        # No user map, create new presentation
        prs = Presentation()
        prs.slide_width = Inches(13.333)
        prs.slide_height = Inches(7.5)

    # SLIDE 2: Generated OpenStreetMap (always add this)
    standard_map_path = get_standard_map_path()

    # Create a blank slide for the generated map
    blank_layout = prs.slide_layouts[6] if prs.slide_layouts else None
    if blank_layout:
        map_slide_2 = prs.slides.add_slide(blank_layout)
    else:
        # Fallback: just add slide without layout
        from pptx.slide import Slide
        map_slide_2 = prs.slides.add_slide(prs.slide_layouts[0])

    # Add the generated map image as background
    map_slide_2.shapes.add_picture(
        standard_map_path,
        Inches(0),
        Inches(0),
        width=Inches(13.333),
        height=Inches(7.5)
    )

    # Add markers to generated map
    add_markers_to_slide(map_slide_2, locations, converter, marker_styles)

    # Save
    output_path = 'output.pptx'
    prs.save(output_path)

    return output_path


def hex_to_rgb(hex_color):
    """Convert hex color to RGB tuple"""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def add_markers_to_slide(slide, locations, converter, marker_styles=None):
    """
    Add location markers to a slide

    Args:
        slide: PowerPoint slide object
        locations: List of location dicts
        converter: MapCoordinateConverter instance
        marker_styles: Optional dict with marker styling options
    """
    # Default styles
    default_styles = {
        'markerColor': '#dc3545',
        'markerShape': 'circle',
        'markerSize': 0.2,
        'showFill': True,
        'outlineColor': '#ffffff',
        'outlineWidth': 1.0,
        'showOutline': True,
        'showShadow': False,
        'showLabels': True,
        'labelFontSize': 10,
        'labelTextColor': '#000000',
        'labelBgColor': '#ffffff',
        'labelBold': True
    }

    # Use provided styles or defaults
    styles = marker_styles if marker_styles else default_styles

    # Convert colors from hex to RGB
    marker_rgb = hex_to_rgb(styles.get('markerColor', default_styles['markerColor']))
    outline_rgb = hex_to_rgb(styles.get('outlineColor', default_styles['outlineColor']))
    label_text_rgb = hex_to_rgb(styles.get('labelTextColor', default_styles['labelTextColor']))
    label_bg_rgb = hex_to_rgb(styles.get('labelBgColor', default_styles['labelBgColor']))

    # Add location markers as shapes
    for location in locations:
        lat = location.get('lat')
        lng = location.get('lng')
        name = location.get('name', '')

        if lat is None or lng is None:
            continue

        # Convert lat/lng to slide position
        left, top = converter.lat_lng_to_slide(lat, lng)

        # Determine shape type
        marker_shape = styles.get('markerShape', default_styles['markerShape'])
        shape_map = {
            'circle': MSO_SHAPE.OVAL,
            'square': MSO_SHAPE.RECTANGLE,
            'triangle': MSO_SHAPE.ISOSCELES_TRIANGLE,
            'star': MSO_SHAPE.STAR_5_POINT
        }
        shape_type = shape_map.get(marker_shape, MSO_SHAPE.OVAL)

        # Add shape
        marker_size = Inches(styles.get('markerSize', default_styles['markerSize']))
        shape = slide.shapes.add_shape(
            shape_type,
            left - marker_size/2,  # Center the shape
            top - marker_size/2,
            marker_size,
            marker_size
        )

        # Style the marker
        if styles.get('showFill', default_styles['showFill']):
            shape.fill.solid()
            shape.fill.fore_color.rgb = RGBColor(*marker_rgb)
        else:
            shape.fill.background()

        if styles.get('showOutline', default_styles['showOutline']):
            shape.line.color.rgb = RGBColor(*outline_rgb)
            shape.line.width = Pt(styles.get('outlineWidth', default_styles['outlineWidth']))
        else:
            shape.line.fill.background()

        # Handle shadow
        if not styles.get('showShadow', default_styles['showShadow']):
            shape.shadow.inherit = False
            shape.shadow.visible = False

        # Add label if name exists and labels are enabled
        if name and styles.get('showLabels', default_styles['showLabels']):
            label_width = Inches(2)
            label_height = Inches(0.4)
            label_box = slide.shapes.add_textbox(
                left + marker_size/2 + Inches(0.1),
                top - label_height/2,
                label_width,
                label_height
            )
            text_frame = label_box.text_frame
            text_frame.text = name
            text_frame.margin_bottom = Pt(0)
            text_frame.margin_top = Pt(0)
            text_frame.margin_left = Pt(5)
            text_frame.margin_right = Pt(5)

            paragraph = text_frame.paragraphs[0]
            paragraph.font.size = Pt(styles.get('labelFontSize', default_styles['labelFontSize']))
            paragraph.font.bold = styles.get('labelBold', default_styles['labelBold'])
            paragraph.font.color.rgb = RGBColor(*label_text_rgb)

            # Add background to label
            label_box.fill.solid()
            label_box.fill.fore_color.rgb = RGBColor(*label_bg_rgb)
            label_box.fill.fore_color.brightness = 0.9
            label_box.line.color.rgb = RGBColor(200, 200, 200)
            label_box.line.width = Pt(0.5)
