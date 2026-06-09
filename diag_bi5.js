// Diagnostic: check the actual bi5 field layout
const {spawnSync} = require('child_process');
const https = require('https');
const os = require('os');
const path = require('path');
const fs = require('fs');

function fetchBi5(sym, y, m, d) {
  const mm = String(m).padStart(2,'0');
  const dd = String(d).padStart(2,'0');
  const url = 'https://datafeed.dukascopy.com/datafeed/' + sym + '/' + y + '/' + mm + '/' + dd + '/BID_candles_min_1.bi5';
  return new Promise((resolve) => {
    https.get(url, {headers:{'User-Agent':'Mozilla/5.0'}}, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', () => resolve(null));
  });
}

(async () => {
  // 2021-03-15 Monday — real trading day
  const raw = await fetchBi5('EURUSD', 2021, '02', '15');
  if (!raw || raw.length < 100) { console.log('fetch failed or no data, bytes=' + (raw ? raw.length : 0)); return; }
  console.log('compressed bytes: ' + raw.length);

  const tmp = path.join(os.tmpdir(), 'duk_diag.bi5');
  fs.writeFileSync(tmp, raw);
  const r = spawnSync('xz', ['--decompress','--keep','--format=lzma','--stdout', tmp], {maxBuffer:200*1024});
  if (r.status !== 0) { console.log('xz failed'); return; }
  const buf = r.stdout;
  console.log('decompressed bytes: ' + buf.length + ' -> ' + (buf.length/24) + ' records');

  console.log('\nFirst 8 records: f0(uint32BE), f1, f2, f3, f4');
  for (let i = 0; i < 8; i++) {
    const off = i * 24;
    const f0 = buf.readUInt32BE(off);
    const f1 = buf.readUInt32BE(off+4);
    const f2 = buf.readUInt32BE(off+8);
    const f3 = buf.readUInt32BE(off+12);
    const f4 = buf.readUInt32BE(off+16);
    const asEUR_f1 = (f1/1e5).toFixed(5);
    const asEUR_f0 = (f0/1e5).toFixed(5);
    console.log('  rec[' + i + ']  f0=' + f0 + '(EUR=' + asEUR_f0 + ') f1=' + f1 + '(EUR=' + asEUR_f1 + ')  f0_as_sec=' + (f0/60).toFixed(1) + 'min  f0_as_ms=' + (f0/60000).toFixed(1) + 'min');
  }

  console.log('\nRecords 58-62 (around hour boundary):');
  for (const i of [58,59,60,61,62]) {
    const off = i * 24;
    const f0 = buf.readUInt32BE(off);
    const f1 = buf.readUInt32BE(off+4);
    const asEUR_f1 = (f1/1e5).toFixed(5);
    console.log('  rec[' + i + ']  f0=' + f0 + '(as_sec=' + (f0/60).toFixed(1) + 'min, as_ms=' + (f0/60000).toFixed(1) + 'min) f1(EUR)=' + asEUR_f1);
  }

  // Count non-zero records
  let nonZero = 0;
  const hourBuckets_ms = new Set();
  const hourBuckets_sec = new Set();
  const dayStartMs = new Date('2021-02-15T00:00:00Z').getTime();
  const dayStartSec = dayStartMs / 1000;
  for (let i = 0; i < buf.length/24; i++) {
    const off = i * 24;
    const f0 = buf.readUInt32BE(off);
    const f1 = buf.readUInt32BE(off+4);
    if (f1 > 0) nonZero++;
    // If f0 = t_ms
    const t_ms = Math.round((dayStartMs + f0) / 1000);
    hourBuckets_ms.add(Math.floor(t_ms / 3600) * 3600);
    // If f0 = t_sec
    const t_sec = dayStartSec + f0;
    hourBuckets_sec.add(Math.floor(t_sec / 3600) * 3600);
    // If no t field, use index
    const t_idx = dayStartSec + i * 60;
    // (not tracked separately here)
  }
  console.log('\nNon-zero f1 records: ' + nonZero);
  console.log('Unique hourBuckets if f0=t_ms: ' + hourBuckets_ms.size);
  console.log('Unique hourBuckets if f0=t_sec: ' + hourBuckets_sec.size);
})();
