const qs = [
  ['aca-cutralco', 'ACA', '-69.30,-38.85,-69.10,-38.98'],
  ['aca-zapala', 'ACA', '-70.15,-38.86,-69.98,-38.95'],
  ['aca-junin', 'ACA', '-71.12,-39.90,-71.03,-39.97'],
  ['aca-sma', 'ACA', '-71.40,-40.12,-71.32,-40.18'],
  ['fuel-zapala', 'estación de servicio', '-70.15,-38.86,-69.98,-38.95'],
  ['fuel-junin', 'YPF', '-71.12,-39.90,-71.03,-39.97'],
  ['museo-huincul', 'Museo Carmen Funes', ''],
  ['huincul', 'Plaza Huincul, Neuquén', ''],
  ['costanera-junin', 'Paseo Costero, Junín de los Andes', ''],
  ['parque-junin', 'parque', '-71.10,-39.92,-71.05,-39.96'],
  ['zapala-parque', 'parque', '-70.10,-38.88,-70.02,-38.92'],
  ['sma-costanera', 'Costanera, San Martín de los Andes', ''],
  ['sma', 'San Martín de los Andes, Neuquén', ''],
  ['arroyito', 'Arroyito, Neuquén', ''],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [id, q, box] of qs) {
  const p = new URLSearchParams({ format: 'jsonv2', q, limit: '5', countrycodes: 'ar' });
  if (box) { p.set('viewbox', box); p.set('bounded', '1'); }
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?${p}`, { headers: { 'User-Agent': 'ruta-fito/1.0 (trip planner)' } });
    const j = await r.json();
    console.log(`${id}: ` + (j.map((x) => `${x.name}|${x.category}/${x.type}|${(+x.lat).toFixed(5)},${(+x.lon).toFixed(5)}|${x.display_name.slice(0, 70)}`).join(' ;; ') || '(none)'));
  } catch (e) { console.log(`${id}: ERR ${e.message}`); }
  await sleep(1500);
}
