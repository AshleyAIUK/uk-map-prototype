// src/main.ts
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import maplibregl from 'maplibre-gl';
import * as pmtiles from 'pmtiles';

// -- PMTiles protocol so `pmtiles://https://…` works
const protocol = new pmtiles.Protocol();
(maplibregl as any).addProtocol('pmtiles', protocol.tile);

// -- Basemap: OS Vector Tiles if key is present, else OSM raster fallback
const osKey = import.meta.env.VITE_OS_API_KEY as string | undefined;
const osStyle = osKey
  ? `https://api.os.uk/maps/vector/v1/vts/resources/styles?srs=3857&key=${osKey}`
  : null;

const rasterFallbackStyle = {
  version: 8 as const,
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256
    }
  },
  layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' }]
};

const styleToUse = osStyle ?? rasterFallbackStyle;

// -- Create the map with a sensible initial camera (avoid “tiny world tile”)
const map = new maplibregl.Map({
  container: 'map',
  style: styleToUse,
  center: [-1.8, 54.5],   // UK-ish centre
  zoom: 5.5,              // not zoom 0
  renderWorldCopies: false,
  bearing: 0,
  pitch: 0,
  attributionControl: { compact: true }
});

// expose for DevTools
;(window as any).map = map;

map.addControl(new maplibregl.NavigationControl(), 'top-right');

// -- When the style is ready, fit GB and add overlays
map.on('style.load', async () => {
  // Fit Great Britain
  const GB_BOUNDS: [[number, number], [number, number]] = [
    [-8.7, 49.8], // SW
    [ 1.9, 60.9]  // NE
  ];
  map.fitBounds(GB_BOUNDS, { padding: 8, animate: false });

  // ======  A) Local Authority overlay from PMTiles  ======
  const ladUrl = `pmtiles://${window.location.origin}/lad_2024.pmtiles`;

  try {
    if (!map.getSource('lad')) {
      map.addSource('lad', { type: 'vector', url: ladUrl });
    }

    if (!map.getLayer('lad-line')) {
      map.addLayer({
        id: 'lad-line',
        type: 'line',
        source: 'lad',
        'source-layer': 'lad', // must match internal layer name
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
      }, 'lad-line'); // insert beneath the outline
    }

    // LAD interaction
    map.on('mouseenter', 'lad-fill', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'lad-fill', () => (map.getCanvas().style.cursor = ''));
    map.on('click', 'lad-fill', (e) => {
      const f = e.features?.[0]; if (!f) return;
      const p = f.properties as Record<string, any>;
      new maplibregl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(`<strong>${p.LAD24NM ?? 'Unknown'}</strong><br/>Code: ${p.LAD24CD ?? 'Unknown'}`)
        .addTo(map);
    });
  } catch (err) {
    console.error('Failed to load LAD PMTiles:', err);
  }

  // ======  B) London postcode districts overlay from GeoJSON  ======
  // Place these files in: /public/postcodes/E.geojson, EC.geojson, N.geojson, NW.geojson, SE.geojson, SW.geojson, W.geojson, WC.geojson
  const areas = ['E','EC','N','NW','SE','SW','W','WC'] as const;
  const pcdFillLayerIds: string[] = [];

  for (const a of areas) {
    const srcId = `pcd_${a}`;
    const url = `/postcodes/${a}.geojson`; // Vite serves /public at the site root

    if (!map.getSource(srcId)) {
      map.addSource(srcId, { type: 'geojson', data: url });
    }

    // Fill (insert under LAD outline so LAD borders remain prominent)
    const fillId = `${srcId}-fill`;
    if (!map.getLayer(fillId)) {
      map.addLayer({
        id: fillId,
        type: 'fill',
        source: srcId,
        paint: { 'fill-color': '#eeeeee', 'fill-opacity': 0.45 }
      }, 'lad-line');
    }
    pcdFillLayerIds.push(fillId);

    // Outline
    const lineId = `${srcId}-line`;
    if (!map.getLayer(lineId)) {
      map.addLayer({
        id: lineId,
        type: 'line',
        source: srcId,
        paint: { 'line-color': '#555', 'line-width': 0.6 }
      });
    }
  }

  // Simple popup on click: show the district code (property name is usually 'name', e.g. 'SW1')
  map.on('click', (e) => {
    const f = map.queryRenderedFeatures(e.point, { layers: pcdFillLayerIds })[0];
    if (!f) return;
    const code = (f.properties as any)?.name ?? '(unknown)';
    new maplibregl.Popup().setLngLat(e.lngLat).setHTML(`<strong>${code}</strong>`).addTo(map);
  });
});

// Ensure canvas matches container after first paint + on resize
map.once('load', () => {
  map.resize();
  requestAnimationFrame(() => map.resize());
});
window.addEventListener('resize', () => map.resize());

// Helpful error logging
map.on('error', (e) => console.error('Map error:', (e as any).error || e));


