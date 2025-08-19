// src/main.ts
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import maplibregl from 'maplibre-gl';
import * as pmtiles from 'pmtiles';

// 0) Register the PMTiles protocol (so 'pmtiles://...' URLs work)
const protocol = new pmtiles.Protocol();
(maplibregl as any).addProtocol('pmtiles', protocol.tile);

// 1) OS basemap if the key exists; otherwise a safe raster fallback
const osKey = import.meta.env.VITE_OS_API_KEY as string | undefined;
const osStyle = osKey
  ? `https://api.os.uk/maps/vector/v1/vts/resources/styles?srs=3857&key=${osKey}`
  : null;

const rasterFallbackStyle = {
  version: 8 as const,
  sources: {
    osm: { type: 'raster' as const, tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256 }
  },
  layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' }]
};

const styleToUse = osStyle ?? rasterFallbackStyle;

// 2) Create the map with a sensible initial view (avoid “wallpaper world”)
const map = new maplibregl.Map({
  container: 'map',
  style: styleToUse,            // your OS style or raster fallback
  center: [-1.8, 54.5],         // UK-ish centre
  zoom: 5.5,                    // avoids the “tiny world tile” at zoom 0
  renderWorldCopies: false,     // no repeated worlds at the edges
  bearing: 0,
  pitch: 0,
  attributionControl: { compact: true }
});


map.addControl(new maplibregl.NavigationControl(), 'top-right');

map.once('style.load', () => {
  const GB_BOUNDS: [[number, number], [number, number]] = [
    [-8.7, 49.8],  // SW
    [ 1.9, 60.9]   // NE
  ];
  map.fitBounds(GB_BOUNDS, { padding: 8, animate: false });
});

/ 3) Add the Local Authority layer from PMTiles (vector tiles)

map.once('style.load', async () => {
  try {
    // Set this to your actual PMTiles location:
    // - For a quick test if you upload to /public: 'pmtiles://https://YOUR-APP.vercel.app/lad_2024.pmtiles'
    // - For S3/R2/CDN: 'pmtiles://https://YOUR-BUCKET/lad_2024.pmtiles'
    // use the current site origin for dev (localhost) and prod (vercel.app)
    const pmtilesUrl = `pmtiles://${window.location.origin}/lad_2024.pmtiles`;


    // Add the vector tile source
    if (!map.getSource('lad')) {
      map.addSource('lad', { type: 'vector', url: pmtilesUrl });
    }

    // Draw outline then fill (note the 'source-layer' = layer name you set during creation, e.g. -nln lad)
    if (!map.getLayer('lad-line')) {
      map.addLayer({
        id: 'lad-line',
        type: 'line',
        source: 'lad',
        'source-layer': 'lad',
        paint: { 'line-color': '#ff0050', 'line-width': 2 }
      });
    }

    if (!map.getLayer('lad-fill')) {
      map.addLayer({
        id: 'lad-fill',
        type: 'fill',
        source: 'lad',
        'source-layer': 'lad',
        paint: { 'fill-color': '#ffd54f', 'fill-opacity': 0.18 }
      }, 'lad-line'); // insert under the outline
    }

    // Click popup (properties come through from your tiles)
    map.on('click', 'lad-fill', (e) => {
      const f = e.features?.[0]; if (!f) return;
      const p = f.properties as Record<string, any>;
      new maplibregl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(`<strong>${p.LAD24NM ?? 'Unknown'}</strong><br/>Code: ${p.LAD24CD ?? 'Unknown'}`)
        .addTo(map);
    });

    map.on('mouseenter', 'lad-fill', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'lad-fill', () => (map.getCanvas().style.cursor = ''));
  } catch (err) {
    console.error('Failed to load LAD PMTiles:', err);
  }
});

// Helpful errors in the console (especially on Vercel)
map.on('error', (e) => console.error('Map error:', (e as any).error || e));

