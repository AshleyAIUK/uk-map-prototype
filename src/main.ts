// src/main.ts
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import maplibregl from 'maplibre-gl';

// ------- Base raster style (simple, reliable) -------
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

// ------- Small utils -------
const nf = new Intl.NumberFormat('en-GB');
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const AtoZ = LETTERS.split('');

// fetch JSON (undefined if 404)
async function fetchJson<T = any>(url: string): Promise<T | undefined> {
  try {
    const r = await fetch(url);
    if (!r.ok) return undefined;
    return await r.json();
  } catch { return undefined; }
}

// Detect CSV delimiter in first non-empty line (comma/semicolon/tab)
function detectDelimiter(text: string): string {
  const line = (text.replace(/^\uFEFF/, '').split(/\r?\n/).find(Boolean) || '');
  let inQ = false;
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { i++; continue; }
      inQ = !inQ; continue;
    }
    if (!inQ && (ch in counts)) counts[ch]++;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : ',';
}

// Robust CSV parser (quotes, embedded commas, UTF-8 BOM, \r\n)
function parseCSV(text: string): string[][] {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const d = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQ = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQ && text[i + 1] === '"') { field += '"'; i++; }
      else { inQ = !inQ; }
      continue;
    }
    if (!inQ && ch === d) { row.push(field); field = ''; continue; }
    if (!inQ && ch === '\n') {
      if (field.endsWith('\r')) field = field.slice(0, -1);
      row.push(field); rows.push(row);
      row = []; field = ''; continue;
    }
    field += ch;
  }
  if (field.endsWith('\r')) field = field.slice(0, -1);
  row.push(field);
  if (!(row.length === 1 && row[0] === '')) rows.push(row);
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

// ------- Main -------
map.on('style.load', async () => {
  // Fit Great Britain
  const GB_BOUNDS: [[number, number], [number, number]] = [[-8.7, 49.8], [1.9, 60.9]];
  map.fitBounds(GB_BOUNDS, { padding: 8, animate: false });

  // 1) Load postcode districts
  // Prefer a single combined GeoJSON if present; otherwise load per-area via manifest.
  const combined = await fetchJson<any>('/postcodes/districts.geojson');
  const pcdFillLayerIds: string[] = [];
  const codeProps = ['name','pcd','pcds','CODE','code','Postcode','Postcode_district','POSTCODE'] as const;

  if (combined) {
    if (!map.getSource('pcd_all')) {
      map.addSource('pcd_all', { type: 'geojson', data: combined });
    }
    if (!map.getLayer('pcd_all-fill')) {
      map.addLayer({
        id: 'pcd_all-fill',
        type: 'fill',
        source: 'pcd_all',
        paint: { 'fill-color': '#cccccc', 'fill-opacity': 0.68 }
      });
    }
    pcdFillLayerIds.push('pcd_all-fill');

    if (!map.getLayer('pcd_all-line')) {
      map.addLayer({
        id: 'pcd_all-line',
        type: 'line',
        source: 'pcd_all',
        paint: { 'line-color': '#555', 'line-width': 0.6 }
      });
    }

    map.on('mouseenter', 'pcd_all-fill', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'pcd_all-fill', () => (map.getCanvas().style.cursor = ''));
  } else {
    // Load many small files listed in manifest
    const manifest = await fetchJson<string[]>('/postcodes/_index.json');
    const areas = manifest && manifest.length ? manifest : ['E','EC','N','NW','SE','SW','W','WC'];
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
  }

  // 2) Territories (CSV) -> colour + opacity, popup on click
  try {
    const resp = await fetch('/territories.csv');
    if (!resp.ok) { console.error('Failed to fetch /territories.csv:', resp.status); wireCodeOnlyPopups(); return; }

    const raw = await resp.text();
    const rows = parseCSV(raw);
    if (rows.length < 2) { console.error('CSV appears empty.'); wireCodeOnlyPopups(); return; }

    // Header row (unwrap if someone quoted the whole thing)
    let headerRow = rows.shift()!;
    if (headerRow.length === 1 && /^".*"$/.test(headerRow[0]) && headerRow[0].includes(',')) {
      headerRow = headerRow[0].slice(1, -1).split(',');
    }
    const normalise = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, '');
    const cols = headerRow.map(normalise);

    const findCol = (aliases: string[], fallback = -1) =>
      aliases.map(a => cols.indexOf(a)).find(i => i >= 0) ?? fallback;

    // Required + optional columns (various aliases tolerated)
    const iId  = findCol(['territoryid','id']);
    const iPfx = findCol(['postcodeprefixes','postcodes','prefixes']);
    const iReg = findCol(['region']);
    const iPop = findCol(['estimatedpopulation','population','pop']);
    const iBiz = findCol(['indicativebusinesscount','businesses','biz','businesscount']);
    const iInc = findCol(['averagehouseholdincome','income','avgincome']);
    const iSta = findCol(['status']);

    if (iId < 0 || iPfx < 0) {
      console.error('CSV is missing required columns (territory_id and postcode_prefixes). Header seen:', headerRow);
      wireCodeOnlyPopups(); return;
    }

    type Terr = {
      id: string; region: string;
      exacts: string[]; letterPrefixes: string[]; anyPrefixes: string[];
      pop: number; biz: number; income: string; status: string; tokens: string[];
    };

    const territories: Terr[] = [];
    const codeToTidExact: Record<string, string> = {};
    const letterPrefixToTid: Array<{ prefix: string; tid: string }> = [];
    const anyPrefixToTid: Array<{ prefix: string; tid: string }> = [];
    const tidToMetrics: Record<string, { title: string; region: string; pop: number; biz: number; income: string; status: string }> = {};
    const tidToTokens: Record<string, string[]> = {};
    const tidToStatus: Record<string, string> = {};

    // helper
    const toNum = (s: string) => Number((s || '').replace(/[^\d.-]/g, '')) || 0;

    for (const parts of rows) {
      const get = (i: number) => (i >= 0 && i < parts.length ? parts[i].trim() : '');

      const id = get(iId);
      if (!id) continue;

      const region = get(iReg);
      const pfxRaw = get(iPfx);
      const popStr = get(iPop);
      const bizStr = get(iBiz);
      const income = get(iInc);
      const status = (get(iSta) || 'available').toLowerCase();

      // tokens in a single cell, pipe-separated
      const tokens = pfxRaw.replace(/^"(.*)"$/, '$1')
        .split(pfxRaw.includes('|') ? '|' : pfxRaw.includes(';') ? ';' : '|')
        .map(s => s.trim().toUpperCase()).filter(Boolean);

      const exacts: string[] = [];
      const letterPrefixes: string[] = [];
      const anyPrefixes: string[] = [];

      for (const tok of tokens) {
        if (tok.endsWith('+'))       letterPrefixes.push(tok.slice(0, -1));  // W1+  => W1 (letters-only incl. base)
        else if (tok.endsWith('*'))  anyPrefixes.push(tok.slice(0, -1));     // EC1* => EC1 (any continuation)
        else                         exacts.push(tok);                        // SE22 => exact
      }

      const t: Terr = {
        id, region,
        exacts, letterPrefixes, anyPrefixes,
        pop: toNum(popStr), biz: toNum(bizStr), income, status,
        tokens
      };
      territories.push(t);

      tidToMetrics[id] = { title: `Territory ${id}`, region, pop: t.pop, biz: t.biz, income: t.income, status: t.status };
      tidToTokens[id] = tokens.slice();
      tidToStatus[id] = t.status;

      for (const c of exacts) codeToTidExact[c] = id;
      for (const p of letterPrefixes) letterPrefixToTid.push({ prefix: p, tid: id });
      for (const p of anyPrefixes)    anyPrefixToTid.push({ prefix: p, tid: id });
    }

    // Palette
    const palette = [
      '#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f',
      '#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ab'
    ];
    const colourByTid: Record<string, string> = {};
    territories.forEach((t, i) => { colourByTid[t.id] = palette[i % palette.length]; });

    // ===== Build expressions =====
    // Coalesce several possible property names, then uppercase for matching
    const CODE_RAW: any =
      ['coalesce',
        ['get','name'],
        ['get','pcd'],
        ['get','pcds'],
        ['get','CODE'],
        ['get','code'],
        ['get','Postcode'],
        ['get','Postcode_district'],
        ['get','POSTCODE']
      ];
    const CODE_U: any = ['upcase', CODE_RAW];

    // Any-prefix: startsWith(prefix)
    function makeAnyExpr(): any {
      if (anyPrefixToTid.length === 0) return '#dddddd';
      const expr: any[] = ['case'];
      for (const { prefix, tid } of anyPrefixToTid) {
        expr.push(['==', ['slice', CODE_U, 0, prefix.length], prefix], colourByTid[tid] ?? '#cccccc');
      }
      expr.push('#dddddd');
      return expr;
    }

    // Letters-only prefixes: startsWith AND (exact base OR next char is A–Z)
    function makeLetterExpr(anyExpr: any): any {
      if (letterPrefixToTid.length === 0) return anyExpr;
      const expr: any[] = ['case'];
      for (const { prefix, tid } of letterPrefixToTid) {
        expr.push(
          ['all',
            ['==', ['slice', CODE_U, 0, prefix.length], prefix],
            ['any',
              ['==', ['length', CODE_U], prefix.length], // base district (e.g. N1)
              ['in', ['slice', CODE_U, prefix.length, prefix.length + 1], ['literal', AtoZ]] // next letter (N1A…)
            ]
          ],
          colourByTid[tid] ?? '#cccccc'
        );
      }
      expr.push(anyExpr);
      return expr;
    }

    // Exact matches
    const anyExpr = makeAnyExpr();
    const letterExpr = makeLetterExpr(anyExpr);
    const exactPairs: any[] = [];
    for (const [code, tid] of Object.entries(codeToTidExact)) {
      exactPairs.push(code, colourByTid[tid] ?? '#cccccc');
    }
    const colorExpr: any[] =
      exactPairs.length > 0 ? (['match', CODE_U, ...exactPairs, letterExpr] as any[]) : (letterExpr as any[]);

    // Opacity: dim taken
    function makeAnyTakenExpr(): any {
      if (anyPrefixToTid.length === 0) return false;
      const expr: any[] = ['case'];
      for (const { prefix, tid } of anyPrefixToTid) {
        expr.push(['==', ['slice', CODE_U, 0, prefix.length], prefix], (tidToStatus[tid] === 'taken'));
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
    const opacityExpr: any = ['case', isTakenExpr, 0.28, 0.68];

    // Apply to every postcode fill layer
    for (const id of pcdFillLayerIds) {
      try {
        map.setPaintProperty(id, 'fill-color', colorExpr);
        map.setPaintProperty(id, 'fill-opacity', opacityExpr);
      } catch (err) {
        console.error(`Failed to set paint on ${id}`, err);
      }
    }

    // Click-only popup
    const popup = new maplibregl.Popup({ closeOnClick: true, closeButton: true });
    for (const id of pcdFillLayerIds) {
      map.on('click', id, (e: any) => {
        const f = e.features?.[0]; if (!f) return;

        // Resolve the district code from whichever prop is present, uppercase it
        const props = (f.properties || {}) as Record<string, any>;
        const raw = codeProps.map(k => props[k]).find(v => v != null);
        const code = String(raw || '').toUpperCase();
        if (!code) { popup.setLngLat(e.lngLat).setHTML(`<strong>(unknown)</strong>`).addTo(map); return; }

        // Resolve territory: exact > letters-only (incl. base) > any
        const tidExact = (codeToTidExact as any)[code];
        const tidLetters = letterPrefixToTid.find(({ prefix }) =>
          code.startsWith(prefix) && (code.length === prefix.length || LETTERS.includes(code[prefix.length] ?? ''))
        )?.tid;
        const tidAny = anyPrefixToTid.find(({ prefix }) => code.startsWith(prefix))?.tid;
        const tid = tidExact ?? tidLetters ?? tidAny;

        if (!tid) {
          popup.setLngLat(e.lngLat).setHTML(`<strong>${code}</strong>`).addTo(map);
          return;
        }

        const m = tidToMetrics[tid];
        const tokens = (tidToTokens[tid] || []);
        const shown = tokens.slice(0, 12);
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

// Fallback: code-only popups if CSV absent
function wireCodeOnlyPopups() {
  const popup = new maplibregl.Popup({ closeOnClick: true, closeButton: true });
  const layerIds = map.getStyle().layers?.map(l => l.id)?.filter(id => id.endsWith('-fill')) ?? [];
  for (const id of layerIds) {
    map.on('click', id, (e: any) => {
      const f = e.features?.[0]; if (!f) return;
      const p = (f.properties || {}) as Record<string, any>;
      const code = String(p.name ?? p.pcd ?? p.pcds ?? p.code ?? p.CODE ?? p.Postcode ?? p.Postcode_district ?? p.POSTCODE ?? '(unknown)');
      popup.setLngLat(e.lngLat).setHTML(`<strong>${code.toUpperCase()}</strong>`).addTo(map);
    });
  }
}

// Resize safety
map.once('load', () => { map.resize(); requestAnimationFrame(() => map.resize()); });
window.addEventListener('resize', () => map.resize());
// Error logging
map.on('error', (e) => console.error('Map error:', (e as any).error || e));

