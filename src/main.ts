import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import maplibregl from 'maplibre-gl';
import * as pmtiles from 'pmtiles';

const protocol = new pmtiles.Protocol();
(maplibregl as any).addProtocol('pmtiles', protocol.tile);

// OS Vector Tile API (Web Mercator) – requires your VITE_OS_API_KEY
const osStyle =
  `https://api.os.uk/maps/vector/v1/vts/resources/styles?srs=3857&key=${import.meta.env.VITE_OS_API_KEY}`;

const map = new maplibregl.Map({
  container: 'map',
  style: osStyle,                 // or your dev raster style
  attributionControl: { compact: true }
});

// Great Britain bounds (W,S & E,N)
const GB_BOUNDS: [[number, number], [number, number]] = [
  [-8.7, 49.8],
  [ 1.9, 60.9]
];

map.on('load', () => {
  // Fill the screen neatly with GB and avoid any halo
  map.fitBounds(GB_BOUNDS, { padding: { top: 0, right: 0, bottom: 0, left: 0 }, animate: false });
  map.setMaxBounds(GB_BOUNDS); // optional, stops panning into the Atlantic
  map.resize(); 
                // belt-and-braces after initial layout
});

map.on('load', () => {
  // 1) Source
  map.addSource('lad', {
    type: 'geojson',
    data: '/lad_2024_bgc.geojson' // served from Vite 'public' at site root
  });

  // 2) Fill layer (soft tint)
  map.addLayer({
    id: 'lad-fill',
    type: 'fill',
    source: 'lad',
    paint: {
      'fill-color': '#e6f2ff',
      'fill-opacity': 0.35
    }
  });

  // 3) Outline layer
  map.addLayer({
    id: 'lad-line',
    type: 'line',
    source: 'lad',
    paint: {
      'line-color': '#2f5597',
      'line-width': 1
    }
  });

  // 4) Cursor + popup on click
  map.on('mouseenter', 'lad-fill', () => map.getCanvas().style.cursor = 'pointer');
  map.on('mouseleave', 'lad-fill', () => map.getCanvas().style.cursor = '');

  map.on('click', 'lad-fill', (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = f.properties as Record<string, any>;
    const name = p.LAD24NM ?? 'Unknown name';
    const code = p.LAD24CD ?? 'Unknown code';
    new maplibregl.Popup()
      .setLngLat(e.lngLat)
      .setHTML(`<strong>${name}</strong><br/>Code: ${code}`)
      .addTo(map);
  });
});


map.addControl(new maplibregl.NavigationControl(), 'top-right');




// Option B (alternative): if TS complains, disable above and use an explicit control
// map.addControl(new maplibregl.AttributionControl({ compact: true }));
