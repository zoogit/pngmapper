# PNGMap

Map your locations to PowerPoint presentations automatically.

## Overview

PNGMap is a web application that allows you to upload location data (CSV or GeoJSON) and generate professional PowerPoint presentations with interactive maps.

## Features

- Upload location data in CSV or GeoJSON format
- Interactive map preview with OpenStreetMap
- Automatic PowerPoint generation with maps
- Free deployment on Netlify + Render
- Clean, modern UI

## Tech Stack

**Frontend:**
- React + Vite
- React Leaflet (mapping)
- Axios (API calls)

**Backend:**
- FastAPI (Python)
- GeoPandas (spatial data processing)
- Matplotlib + Contextily (map generation)
- python-pptx (PowerPoint creation)

## Project Structure

```
pngmap/
├── frontend/              # React frontend
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── services/      # API service layer
│   │   ├── App.jsx
│   │   └── main.jsx
│   └── package.json
├── backend/               # Python FastAPI backend
│   ├── services/
│   │   ├── map_generator.py
│   │   └── pptx_builder.py
│   ├── main.py
│   └── requirements.txt
└── README.md
```

## Local Development

### Prerequisites

- Node.js 18+
- Python 3.11+
- pip

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Frontend will run on `http://localhost:3000`

### Backend Setup

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Backend will run on `http://localhost:8000`

### Environment Variables

**Frontend** (create `frontend/.env`):
```
VITE_API_URL=http://localhost:8000
```

**Backend** (create `backend/.env`):
```
PORT=8000
CORS_ORIGINS=http://localhost:3000
```

## CSV Format

Your CSV file should have at minimum these columns:

```csv
lat,lng,name
40.7128,-74.0060,New York
34.0522,-118.2437,Los Angeles
41.8781,-87.6298,Chicago
```

- `lat`: Latitude (required)
- `lng`: Longitude (required)
- `name`: Location name (optional)

## GeoJSON Format

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [-74.0060, 40.7128]
      },
      "properties": {
        "name": "New York"
      }
    }
  ]
}
```

## Deployment

### Frontend (Netlify)

1. Push code to GitHub
2. Connect repo to Netlify
3. Build settings:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Base directory: `frontend`
4. Add environment variable: `VITE_API_URL=<your-render-backend-url>`

### Backend (Render)

1. Push code to GitHub
2. Create new Web Service on Render
3. Settings:
   - Build command: `pip install -r requirements.txt`
   - Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - Root directory: `backend`
4. Update CORS in `backend/main.py` to include your Netlify URL

## Usage

1. Open the web app
2. Click "Upload Location Data"
3. Select your CSV or GeoJSON file
4. View locations on the interactive map
5. Click "Export to PowerPoint"
6. Download your presentation

## Free Tier Limits

- **Netlify**: 100GB bandwidth/month
- **Render**: 750 hours/month (sleeps after 15min inactivity)

Cold starts on Render free tier take ~20-30 seconds.

## Future Enhancements

- Multiple map styles
- Custom marker colors and sizes
- Multiple slides with different zoom levels
- Grouped locations by category
- Custom PowerPoint templates
- Batch processing

## License

MIT
