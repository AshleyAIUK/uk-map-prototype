import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl from 'maplibre-gl';
import * as pmtiles from 'pmtiles';

// Keep PMTiles registered for later layers
const protocol = new pmtiles.Protocol();
(maplibregl as any).addProtocol('pmtiles', protocol.tile);

// If you’re using OS Vector Tiles via env var:
const osStyle = `https://api.os.uk/maps/vector/v1/vts/resources/styles?srs=3857&key=${import.meta.env.VITE_OS_API_KEY}`;

const map = new maplibregl.Map({
  container: 'map',
  // EITHER use the OS style:
  style: osStyle,
  // OR keep your dev raster style here instead of osStyle.

  center: [-1.5, 53.8] as [number, number],
  zoom: 6,

  // ✅ Pass options object, not `true`
  attributionControl: { compact: true }
});

// ✅ Actually use `map` so TS stops complaining
map.addControl(new maplibregl.NavigationControl(), 'top-right');


// Option B (alternative): if TS complains, disable above and use an explicit control
// map.addControl(new maplibregl.AttributionControl({ compact: true }));
