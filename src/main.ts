// src/main.ts
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import maplibregl from 'maplibre-gl';

// ---- OSM raster basemap (glyphs harmless) ----
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

const map = new maplibregl.Map({
  container: 'map',
  style: rasterStyle,
  center: [-1.8, 54.5],
  zoom: 5.5,
  renderWorldCopies: false,
  attributionControl: { compact: true }
});

;(window as any).map = map;
map.addControl(new maplibregl.NavigationControl(), 'top-right');

const nf = new Intl.NumberFormat('en-GB');
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const AtoZ = LETTERS.split('');

// Utility to fetch JSON (returns undefined on 404)
async function fetchJson<T = any>(url: string): Promise<T | undefined> {
  try {
    const r = await fetch(url);
    if (!r.ok) return undefined;
    return await r.json();
  } catch { return undefined; }
}

map.on('style.load', async () => {
  const GB_BOUNDS: [[number, number], [number, number]] = [[-8.7, 49.8], [1.9, 60.9]];
  map.fitBounds(GB_BOUNDS, { padding: 8, animate: false });

  // ---- 1) Load postcode areas dynamically via manifest ----
  const manifest = await fetchJson<string[]>('/postcodes/_index.json');
  // Sensible fallback if manifest is missing
  const areas = manifest && manifest.length > 0
    ? manifest
    : ['E','EC','N','NW','SE','SW','W','WC'];

  const codeProp = 'name'; // district code property in your GeoJSONs
  const pcdFillLayerIds: string[] = [];

  for (const a of areas) {
    const srcId = `pcd_${a}`;
    const url = `/postcodes/${a}.geojson`;
    try {
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

      map.on('mouseenter', fillId, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', fillId, () => (map.getCanvas().style.cursor = ''));
    } catch (e) {
      console.warn(`Skipped postcode area ${a}:`, e);
    }
  }

  // ---- 2) Territories: parse CSV (with status), colour + opacity, popup on click ----
  try {
    const resp = await fetch('/territories.csv');
    if (!resp.ok) { console.warn('territories.csv not found; keeping default grey.'); wireCodeOnlyPopups(); return; }

    const text = await resp.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) { wireCodeOnlyPopups(); return; }

    // Header-aware parsing (tolerant of column order; expects required fields exist)
    const header = lines.shift()!;
    const cols = header.split(',').map(h => h.trim().toLowerCase());

    const idx = (names: string[], fallback = -1) =>
      names.map(n => cols.indexOf(n)).find(i => i >= 0) ?? fallback;

    const iId   = idx(['territory_id','id']);
    const iReg  = idx(['region']);
    const iPfx  = idx(['postcode_prefixes','postcodes','prefixes']);
    const iPop  = idx(['estimated_population','population','pop']);
    const iBiz  = idx(['indicative_business_count','businesses','biz','business_count']);
    const iInc  = idx(['average_household_income','income','avg_income']);
    const iStat = idx(['status']);

    if (iId < 0 || iPfx < 0) {
      console.error('CSV is missing required columns (territory_id and postcode_prefixes).');
      wireCodeOnlyPopups(); return;
    }

    type Terr = {
      id: string; region: string;
      exacts: string[]; letterPrefixes: string[]; anyPrefixes: string[];
      pop: number; biz: number; income: string;
      tokens: string[]; status: 'available'|'taken'|string;
    };

    const territories: Terr[] = [];
    const codeToTidExact: Record<string, string> = {};
    const letterPrefixToTid: Array<{ prefix: string; tid: string }> = [];
    const anyPrefixToTid: Array<{ prefix: string; tid: string }> = [];
    const tidToMetrics: Record<string, { title: string; region: string; pop: number; biz: number; income: string; status: string }> = {};
    const tidToTokens: Record<string, string[]> = {};
    const tidToStatus: Record<string, string> = {};

    for (const raw of lines) {
      const parts = raw.split(',');
      const id  = (parts[iId]  ?? '').trim();
      if (!id) continue;

      const region = (parts[iReg] ?? '').trim();
      const pfxRaw = (parts[iPfx] ?? '').trim();

      // Because income often has commas, treat "everything after iBiz" as tail, then split last for status
      const popStr = iPop >= 0 ? (parts[iPop] ?? '').trim() : '';
      const bizStr = iBiz >= 0 ? (parts[iBiz] ?? '').trim() : '';
      let incomeAndStatus = '';
      if (iInc >= 0) {
        incomeAndStatus = parts.slice(iInc).join(',').trim();
      } else if (iBiz >= 0) {
        incomeAndStatus = parts.slice(iBiz + 1).join(',').trim();
      }

      let income = '';
      let status = (iStat >= 0 ? (parts[iStat] ?? '').trim() : '');
      if (!status && incomeAndStatus) {
        const lastComma = incomeAndStatus.lastIndexOf(',');
        if (iStat >= 0 && lastComma >= 0) {
          income = incomeAndStatus.slice(0, lastComma).trim();
          status = incomeAndStatus.slice(lastComma + 1).trim();
        } else {
          income = incomeAndStatus;
        }
      } else if (!income && iInc >= 0) {
        income = (parts[iInc] ?? '').trim();
      }

      if (!status) status = 'available';
      const statusNorm = status.toLowerCase();

      // Strip optional quotes around tokens and split on |
      const pfx = pfxRaw.replace(/^"(.*)"$/, '$1');
      const tokens = pfx.split('|').map(s => s.trim().toUpperCase()).filter(Boolean);

      const exacts: string[] = [];
      const letterPrefixes: string[] = [];
      const anyPrefixes: string[] = [];

      for (const tok of tokens) {
        if (tok.endsWith('+'))       letterPrefixes.push(tok.slice(0, -1));  // 'W1+'=> 'W1' (letters-only incl. base)
        else if (tok.endsWith('*'))  anyPrefixes.push(tok.slice(0, -1));     // 'EC1*'=>'EC1' (any continuation)
        else                         exacts.push(tok);                        // exact district
      }

      const t: Terr = {
        id, region, exacts, letterPrefixes, anyPrefixes,
        pop: Number(popStr), biz: Number(bizStr), income, tokens, status: statusNorm
      };
      territories.push(t);

      tidToMetrics[id] = { title: `Territory ${id}`, region, pop: t.pop, biz: t.biz, income: t.income, status: t.status };
      tidToTokens[id] = tokens.slice();
      tidToStatus[id] = t.status;

      for (const c of exacts) codeToTidExact[c] = id;
      for (const p of letterPrefixes) letterPrefixToTid.push({ prefix: p, tid: id });
      for (const p of anyPrefixes)    anyPrefixToTid.push({ prefix: p, tid: id });
    }

    // --- Colour palette ---
    const palette = [
      '#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f',
      '#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ab'
    ];
    const colourByTid: Record<string, string> = {};
    territories.forEach((t, i) => { colourByTid[t.id] = palette[i % palette.length]; });

    // ===== Colour expression (always returns a colour) =====
    const CODE_U: any = ['upcase', ['get', codeProp]];

    function makeAnyExpr(): any {
      if (anyPrefixToTid.length === 0) return '#dddddd';
      const expr: any[] = ['case'];
      for (const { prefix, tid } of anyPrefixToTid) {
        expr.push(['==', ['slice', CODE_U, 0, prefix.length], prefix], colourByTid[tid] ?? '#cccccc');
      }
      expr.push('#dddddd');
      return expr;
    }

    function makeLetterExpr(anyExpr: any): any {
      if (letterPrefixToTid.length === 0) return anyExpr;
      const expr: any[] = ['case'];
      for (const { prefix, tid } of letterPrefixToTid) {
        expr.push(
          ['all',
            ['==', ['slice', CODE_U, 0, prefix.length], prefix],
            ['any',
              ['==', ['length', CODE_U], prefix.length], // base (e.g. N1)
              ['in', ['slice', CODE_U, prefix.length, prefix.length + 1], ['literal', AtoZ]] // next letter (N1A…)
            ]
          ],
          colourByTid[tid] ?? '#cccccc'
        );
      }
      expr.push(anyExpr);
      return expr;
    }

    const anyExpr = makeAnyExpr();
    const letterExpr = makeLetterExpr(anyExpr);

    const exactPairs: any[] = [];
    for (const [code, tid] of Object.entries(codeToTidExact)) {
      exactPairs.push(code, colourByTid[tid] ?? '#cccccc');
    }
    const colorExpr: any[] =
      exactPairs.length > 0 ? (['match', CODE_U, ...exactPairs, letterExpr] as any[]) : (letterExpr as any[]);

    // ===== Opacity expression (dim taken territories) =====
    // Build boolean “is taken?” using the same precedence, then map to opacities.
    function makeAnyTakenExpr(): any {
      if (anyPrefixToTid.length === 0) return false;
      const expr: any[] = ['case'];
      for (const { prefix, tid } of anyPrefixToTid) {
        expr.push(
          ['==', ['slice', CODE_U, 0, prefix.length], prefix],
          (tidToStatus[tid] === 'taken')
        );
      }
      expr.push(false);
      return expr;
    }
    function makeLetterTakenExpr(anyTakenExpr: any): any {
      if (letterPrefixToTid.length === 0) return anyTakenExpr;
      const expr: any[] = ['case'];
      for (const { prefix, tid } of letterPrefixToTid) {
        expr.push(
          ['all',
            ['==', ['slice', CODE_U, 0, prefix.length], prefix],
            ['any',
              ['==', ['length', CODE_U], prefix.length],
              ['in', ['slice', CODE_U, prefix.length, prefix.length + 1], ['literal', AtoZ]]
            ]
          ],
          (tidToStatus[tid] === 'taken')
        );
      }
      expr.push(anyTakenExpr);
      return expr;
    }
    const anyTakenExpr = makeAnyTakenExpr();
    const letterTakenExpr = makeLetterTakenExpr(anyTakenExpr);

    const exactTakenPairs: any[] = [];
    for (const [code, tid] of Object.entries(codeToTidExact)) {
      exactTakenPairs.push(code, (tidToStatus[tid] === 'taken'));
    }
    const isTakenExpr: any[] =
      exactTakenPairs.length > 0 ? (['match', CODE_U, ...exactTakenPairs, letterTakenExpr] as any[]) : (letterTakenExpr as any[]);

    const opacityExpr: any = ['case', isTakenExpr, 0.28, 0.68]; // taken => dim

    // Apply to all postcode fill layers
    for (const id of pcdFillLayerIds) {
      try {
        map.setPaintProperty(id, 'fill-color', colorExpr);
        map.setPaintProperty(id, 'fill-opacity', opacityExpr);
      } catch (err) {
        console.error(`Failed to set paint on ${id}`, err);
      }
    }

    // ---- Click-only popup ----
    const popup = new maplibregl.Popup({ closeOnClick: true, closeButton: true });
    for (const id of pcdFillLayerIds) {
      map.on('click', id, (e: any) => {
        const f = e.features?.[0]; if (!f) return;
        const code = (f.properties as any)?.[codeProp]?.toUpperCase();
        if (!code) return;

        const tid =
          codeToTidExact[code] ??
          letterPrefixToTid.find(({ prefix }) =>
            code.startsWith(prefix) && (code.length === prefix.length || LETTERS.includes(code[prefix.length] ?? ''))
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
        const postcodesLine = `Postcodes: ${shown.join(', ')}${more > 0 ? ` +${more} more` : ''}`;

        popup.setLngLat(e.lngLat).setHTML(
          `<strong>${m.title}</strong><br>
           Region: ${m.region}<br>
           ${postcodesLine}<br>
           Population: ${nf.format(m.pop)}<br>
           Number of businesses: ${nf.format(m.biz)}<br>
           Income: ${m.income}<br>
           Status: ${m.status}`
        ).addTo(map);
      });
    }

  } catch (e) {
    console.error('Territory loading/colouring failed:', e);
    wireCodeOnlyPopups();
  }
});

// Fallback popups if CSV missing
function wireCodeOnlyPopups() {
  const popup = new maplibregl.Popup({ closeOnClick: true, closeButton: true });
  const layerIds = map.getStyle().layers?.map(l => l.id)?.filter(id => id.startsWith('pcd_') && id.endsWith('-fill')) ?? [];
  for (const id of layerIds) {
    map.on('click', id, (e: any) => {
      const f = e.features?.[0]; if (!f) return;
      const code = (f.properties as any)?.name ?? '(unknown)';
      popup.setLngLat(e.lngLat).setHTML(`<strong>${code}</strong>`).addTo(map);
    });
  }
}

map.once('load', () => { map.resize(); requestAnimationFrame(() => map.resize()); });
window.addEventListener('resize', () => map.resize());
map.on('error', (e) => console.error('Map error:', (e as any).error || e));

