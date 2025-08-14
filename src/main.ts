import 'maplibre-gl/dist/maplibre-gl.css';   // styles controls/popups
import maplibregl from 'maplibre-gl';
import * as pmtiles from 'pmtiles';

// Register pmtiles:// protocol (we’ll use it later)
const protocol = new pmtiles.Protocol();
// Cast to any to keep TS happy with addProtocol’s typing
(maplibregl as any).addProtocol('pmtiles', protocol.tile);

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8 as const,
    sources: {
      // Dev-only basemap; we’ll replace with OS vector tiles next
      osm: {
        type: 'raster' as const,
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256
      }
    },
    layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' }]
  },
  center: [-1.5, 53.8] as [number, number],
  zoom: 6,
  // Option A: leave attribution on (default false in MapLibre, we’ll add explicitly)
  attributionControl: true
});

// Option B (alternative): if TS complains, disable above and use an explicit control
// map.addControl(new maplibregl.AttributionControl({ compact: true }));
