// src/main.ts
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import maplibregl from 'maplibre-gl';

// ---- OSM raster basemap (glyphs harmless even without labels) ----
const rasterStyle = {
  version: 8 as const,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256
    }
  },
  layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' }]
};

// ---- Create map ----
const map = new maplibregl.Map({
  container: 'map',
  style: rasterStyle,
  center: [-1.8, 54.5],
  zoom: 5.5,
  renderWorldCopies: false,
  attributionControl: { compact: true }
});

// Expose for Console debugging
;(window as any).map = map;
map.addControl(new maplibregl.NavigationControl(), 'top-right');

// ---- Helpers/const ----
const nf = new Intl.NumberFormat('en-GB');
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const AtoZ = LETTERS.split('');

map.on('style.load', async () => {
  // Fit Great Britain
  const GB_BOUNDS: [[number, number], [number, number]] = [[-8.7, 49.8], [1.9, 60.9]];
  map.fitBounds(GB_BOUNDS, { padding: 8, animate: false });

  // ---- Load postcode district GeoJSONs ----
  const areas = ['E','EC','N','NW','SE','SW','W','WC'] as const;
  const codeProp = 'name'; // e.g. "SE22", "W1B", "EC1A"
  const pcdFillLayerIds: string[] = [];

  for (const a of areas) {
    const srcId = `pcd_${a}`;
    const url = `/postcodes/${a}.geojson`;
    if (!map.getSource(srcId)) {
      map.addSource(srcId, { type: 'geojson', data: url });
    }

    const fillId = `${srcId}-fill`;
    if (!map.getLayer(fillId)) {
      map.addLayer({
        id: fillId,
        type: 'fill',
        source: srcId,
        paint: { 'fill-color': '#cccccc', 'fill-opacity': 0.68 }
      });
    }
    pcdFillLayerIds.push(fillId);

    const lineId = `${srcId}-line`;
    if (!map.getLayer(lineId)) {
      map.addLayer({
        id: lineId,
        type: 'line',
        source: srcId,
        paint: { 'line-color': '#555', 'line-width': 0.6 }
      });
    }

    // UX: pointer cursor over districts
    map.on('mouseenter', fillId, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', fillId, () => (map.getCanvas().style.cursor = ''));
  }

  // ---- Territories: colour by CSV; popup on click ----
  try {
    const resp = await fetch('/territories.csv');
    if (!resp.ok) {
      console.warn('territories.csv not found; keeping default grey.');
      wireCodeOnlyPopups();
      return;
    }

    const text = await resp.text();
    const lines = text.trim().split(/\r?\n/);
    lines.shift(); // header

    type Terr = {
      id: string; region: string;
      exacts: string[];           // exact districts (SE22, EC1A…)
      letterPrefixes: string[];   // tokens like W1+ (stored as 'W1')
      anyPrefixes: string[];      // tokens like EC1* (stored as 'EC1')
      pop: number; biz: number; income: string;
      tokens: string[];           // original tokens for display
    };

    const territories: Terr[] = [];
    const codeToTidExact: Record<string, string> = {};
    const letterPrefixToTid: Array<{ prefix: string; tid: string }> = [];
    const anyPrefixToTid: Array<{ prefix: string; tid: string }> = [];
    const tidToMetrics: Record<string, { title: string; region: string; pop: number; biz: number; income: string }> = {};
    const tidToTokens: Record<string, string[]> = {};

    for (const raw of lines) {
      if (!raw.trim()) continue;
      // CSV: territory_id,region,postcode_prefixes,estimated_population,indicative_business_count,average_household_income
      const parts = raw.split(',');
      const [id, region, prefixesFieldRaw, pop, biz] = [
        parts[0]?.trim(),
        parts[1]?.trim(),
        parts[2]?.trim(),
        parts[3]?.trim(),
        parts[4]?.trim()
      ];
      const income = parts.slice(5).join(',').trim(); // allow "£65,000"

      if (!id || !prefixesFieldRaw) continue;

      // Handle quoted token list, split by |
      const prefixesField = prefixesFieldRaw.replace(/^"(.*)"$/, '$1');
      const tokens = prefixesField.split('|').map(s => s.trim().toUpperCase()).filter(Boolean);

      const exacts: string[] = [];
      const letterPrefixes: string[] = [];
      const anyPrefixes: string[] = [];

      for (const tok of tokens) {
        if (tok.endsWith('+'))       letterPrefixes.push(tok.slice(0, -1)); // 'W1+'=> 'W1'
        else if (tok.endsWith('*'))  anyPrefixes.push(tok.slice(0, -1));    // 'EC1*'=>'EC1'
        else                         exacts.push(tok);                       // exact district
      }

      territories.push({
        id,
        region: region ?? '',
        exacts,
        letterPrefixes,
        anyPrefixes,
        pop: Number(pop),
        biz: Number(biz),
        income,
        tokens
      });

      tidToMetrics[id] = { title: `T${id}`, region: region ?? '', pop: Number(pop), biz: Number(biz), income };
      tidToTokens[id] = tokens.slice();

      for (const code of exacts) codeToTidExact[code] = id;
      for (const p of letterPrefixes) letterPrefixToTid.push({ prefix: p, tid: id });
      for (const p of anyPrefixes)    anyPrefixToTid.push({ prefix: p, tid: id });
    }

    // Colour palette per territory
    const palette = [
      '#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f',
      '#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ab'
    ];
    const colourByTid: Record<string, string> = {};
    territories.forEach((t, i) => { colourByTid[t.id] = palette[i % palette.length]; });

    // ===== Build colour expression (always returns a colour) =====
    const CODE_U: any = ['upcase', ['get', codeProp]]; // compare uppercase codes

    // (3) Any-prefix fallback (simple startsWith) -> default neutral grey
    function makeAnyExpr(): any {
      if (anyPrefixToTid.length === 0) return '#dddddd';
      const expr: any[] = ['case'];
      for (const { prefix, tid } of anyPrefixToTid) {
        expr.push(
          ['==', ['slice', CODE_U, 0, prefix.length], prefix],
          colourByTid[tid] ?? '#cccccc'
        );
      }
      expr.push('#dddddd'); // default
      return expr;
    }

    // (2) Letter-only prefixes: startsWith(prefix) AND (exact base OR next char is A–Z) -> fallback = anyExpr
    function makeLetterExpr(anyExpr: any): any {
      if (letterPrefixToTid.length === 0) return anyExpr;
      const expr: any[] = ['case'];
      for (const { prefix, tid } of letterPrefixToTid) {
        expr.push(
          ['all',
            ['==', ['slice', CODE_U, 0, prefix.length], prefix],
            ['any',
              ['==', ['length', CODE_U], prefix.length], // base district (e.g. "N1")
              ['in', ['slice', CODE_U, prefix.length, prefix.length + 1], ['literal', AtoZ]] // next letter (e.g. "N1A")
            ]
          ],
          colourByTid[tid] ?? '#cccccc'
        );
      }
      expr.push(anyExpr); // fallback
      return expr;
    }

    const anyExpr = makeAnyExpr();
    const letterExpr = makeLetterExpr(anyExpr);

    // (1) Exact codes via 'match' -> fallback = letterExpr
    const exactPairs: any[] = [];
    for (const [code, tid] of Object.entries(codeToTidExact)) {
      exactPairs.push(code, colourByTid[tid] ?? '#cccccc');
    }
    const colorExpr: any[] =
      exactPairs.length > 0
        ? (['match', CODE_U, ...exactPairs, letterExpr] as any[])
        : (letterExpr as any[]);

    // Apply to all postcode fill layers
    for (const id of pcdFillLayerIds) {
      try {
        map.setPaintProperty(id, 'fill-color', colorExpr);
      } catch (err) {
        console.error(`Failed to set colour on ${id}`, err);
      }
    }

    // ---- Click-only info: popup with metrics (no always-on labels) ----
    const popup = new maplibregl.Popup({ closeOnClick: true, closeButton: true });
    for (const id of pcdFillLayerIds) {
      map.on('click', id, (e: any) => {
        const f = e.features?.[0]; if (!f) return;
        const code = (f.properties as any)?.[codeProp]?.toUpperCase();
        if (!code) return;

        // Resolve territory: exact > letter+ (incl. base) > any*
        const tid =
          codeToTidExact[code] ??
          letterPrefixToTid.find(({ prefix }) =>
            code.startsWith(prefix) &&
            (code.length === prefix.length || LETTERS.includes(code[prefix.length] ?? ''))
          )?.tid ??
          anyPrefixToTid.find(({ prefix }) => code.startsWith(prefix))?.tid;

        if (!tid) {
          popup.setLngLat(e.lngLat).setHTML(`<strong>${code}</strong>`).addTo(map);
          return;
        }

        const m = tidToMetrics[tid];
        const tokens = (tidToTokens[tid] || []);
        const shown = tokens.slice(0, 10);
        const more = tokens.length - shown.length;
        const pcdLine = `PCDs: ${shown.join(', ')}${more > 0 ? ` +${more} more` : ''}`;

        popup.setLngLat(e.lngLat).setHTML(
          `<strong>${m.title}</strong><br>
           Region: ${m.region}<br>
           ${pcdLine}<br>
           Pop: ${nf.format(m.pop)}<br>
           Biz: ${nf.format(m.biz)}<br>
           Income: ${m.income}`
        ).addTo(map);
      });
    }

  } catch (e) {
    console.error('Territory loading/colouring failed:', e);
    wireCodeOnlyPopups();
  }
});

// ---- Fallback: code-only popups if CSV missing ----
function wireCodeOnlyPopups() {
  const popup = new maplibregl.Popup({ closeOnClick: true, closeButton: true });
  const layerIds = map.getStyle().layers
    ?.map(l => l.id)
    ?.filter(id => id.startsWith('pcd_') && id.endsWith('-fill')) ?? [];
  for (const id of layerIds) {
    map.on('click', id, (e: any) => {
      const f = e.features?.[0]; if (!f) return;
      const code = (f.properties as any)?.name ?? '(unknown)';
      popup.setLngLat(e.lngLat).setHTML(`<strong>${code}</strong>`).addTo(map);
    });
  }
}

// ---- Resize safety ----
map.once('load', () => { map.resize(); requestAnimationFrame(() => map.resize()); });
window.addEventListener('resize', () => map.resize());

// ---- Error logging ----
map.on('error', (e) => console.error('Map error:', (e as any).error || e));
