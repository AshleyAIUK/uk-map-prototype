// ===== C) Colour postcode districts by your CSV groups (supports exact and prefix*) =====
try {
  const resp = await fetch('/postcode_groups.csv');
  if (!resp.ok) {
    console.warn('postcode_groups.csv not found; using default fill colour');
  } else {
    const txt = await resp.text();
    const lines = txt.trim().split(/\r?\n/);
    lines.shift(); // header

    // Build two lookups: exact codes, and prefixes (ending with '*')
    const exact: Record<string, string> = {};
    const prefixes: Array<{prefix: string; gid: string}> = [];
    const groupToLabel: Record<string, string> = {};

    for (const line of lines) {
      const [rawCode, gidRaw, labelRaw] = line.split(',');
      if (!rawCode || !gidRaw) continue;
      const code = rawCode.trim();
      const gid = gidRaw.trim();
      const label = (labelRaw ?? '').trim();
      if (label) groupToLabel[gid] = label;

      if (code.endsWith('*')) {
        prefixes.push({ prefix: code.slice(0, -1), gid });
      } else {
        exact[code] = gid;
      }
    }

    // Palette per group id (extend to taste)
    const palette: Record<string, string> = {
      A: '#4e79a7', // blue
      B: '#f28e2b', // orange
      C: '#e15759',
      D: '#76b7b2',
      E: '#59a14f',
      F: '#edc948',
      G: '#b07aa1',
      H: '#ff9da7',
    };

    const codeProp = 'name'; // property holding the district code in your GeoJSON

    // 1) Exact matches: build a 'match' expression code -> colour
    const exactExpr: any[] = ['match', ['get', codeProp]];
    for (const [code, gid] of Object.entries(exact)) {
      exactExpr.push(code, palette[gid] ?? '#cccccc');
    }
    exactExpr.push('__NO_MATCH__'); // sentinel if no exact match

    // 2) Prefix matches: build a chained 'case' expression
    // e.g. if name starts with 'WC2' then colourA; else if starts with 'EC1' then colourB; else default
    const prefixExpr: any[] = ['case'];
    for (const { prefix, gid } of prefixes) {
      prefixExpr.push(
        ['==', ['slice', ['get', codeProp], 0, prefix.length], prefix],
        palette[gid] ?? '#cccccc'
      );
    }
    prefixExpr.push('#dddddd'); // default if no prefix matched

    // 3) Combine: if exactExpr produced a colour, use it; else fall back to prefixExpr
    // We do this by checking whether exactExpr returned our sentinel.
    const combinedExpr: any[] = [
      'case',
      ['!=', exactExpr, '__NO_MATCH__'],
      exactExpr,
      prefixExpr
    ];

    // Apply to all postcode fill layers
    for (const id of pcdFillLayerIds) {
      map.setPaintProperty(id, 'fill-color', combinedExpr);
    }

    // Tiny legend (optional)
    const legend = document.getElementById('pc-legend') ?? document.createElement('div');
    legend.id = 'pc-legend';
    legend.innerHTML = `
      <div class="panel__title">Postcode groups</div>
      <div class="panel__content">
        ${Object.entries(groupToLabel).map(([gid, label]) => {
          const colour = palette[gid] ?? '#ccc';
          return `<div class="legend-item"><span class="swatch" style="background:${colour}"></span>${gid}: ${label}</div>`;
        }).join('') || '<p class="muted">No groups yet</p>'}
      </div>`;
    if (!legend.parentElement) document.body.appendChild(legend);
  }
} catch (e) {
  console.error('Failed to load postcode_groups.csv', e);
}
