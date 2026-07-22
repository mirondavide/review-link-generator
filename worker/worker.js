function hexIdsToChIJ(featureHex, cidHex) {
  const feature = BigInt('0x' + featureHex);
  const cid = BigInt('0x' + cidHex);
  const bytes = new Uint8Array(20);
  bytes[0] = 0x0A;
  bytes[1] = 0x12; // length = 18
  bytes[2] = 0x09; // field 1, fixed64
  for (let i = 0; i < 8; i++) bytes[3 + i] = Number((feature >> BigInt(i * 8)) & BigInt(0xFF));
  bytes[11] = 0x11; // field 2, fixed64
  for (let i = 0; i < 8; i++) bytes[12 + i] = Number((cid >> BigInt(i * 8)) & BigInt(0xFF));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function extractPlaceInfo(url) {
  // ChIJ place_id in !1s field
  const placeIdMatch = url.match(/!1s(ChIJ[^!&?]+)/);
  if (placeIdMatch) return { type: 'place_id', value: decodeURIComponent(placeIdMatch[1]) };

  // Hex feature_id:cid in !1s field — convert to ChIJ
  const hexMatch = url.match(/!1s0x([0-9a-f]+):0x([0-9a-f]+)/i);
  if (hexMatch) return { type: 'place_id', value: hexIdsToChIJ(hexMatch[1], hexMatch[2]) };

  // Hex feature_id:cid in ftid query param (e.g. /maps?q=...&ftid=0x..:0x..) — convert to ChIJ
  const ftidMatch = url.match(/[?&]ftid=0x([0-9a-f]+):0x([0-9a-f]+)/i);
  if (ftidMatch) return { type: 'place_id', value: hexIdsToChIJ(ftidMatch[1], ftidMatch[2]) };

  return null;
}

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    // Serve the web UI on GET
    if (request.method === 'GET') {
      return new Response(PAGE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

    let body;
    try { body = await request.json(); }
    catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

    let { url: inputUrl } = body;
    if (!inputUrl) return new Response(JSON.stringify({ error: 'Missing URL' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const browserHeaders = {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8',
    };

    // Expand short/share URLs
    if (inputUrl.includes('goo.gl') || inputUrl.includes('maps.app') || inputUrl.includes('share.google')) {
      try {
        const expanded = await fetch(inputUrl, { redirect: 'follow', headers: browserHeaders, signal: AbortSignal.timeout(8000) });
        inputUrl = expanded.url;
      } catch {
        return new Response(JSON.stringify({ error: 'Impossibile espandere il link.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // Handle interstitial pages (/sorry/index, consent.google.com) — extract the continue URL
    if (inputUrl.includes('/sorry/index') || inputUrl.includes('consent.google.com')) {
      const m = inputUrl.match(/continue=([^&]+)/);
      if (m) inputUrl = decodeURIComponent(m[1]);
    }

    const info = extractPlaceInfo(inputUrl);

    if (!info) {
      return new Response(JSON.stringify({ error: 'Impossibile estrarre l\'ID attività. Usa un link Google Maps.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const reviewLink = `https://search.google.com/local/writereview?placeid=${encodeURIComponent(info.value)}`;

    return new Response(JSON.stringify({ review_link: reviewLink }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  },
};

const PAGE_HTML = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Google Review Link Generator</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f4f8; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: white; border-radius: 16px; padding: 36px 32px; width: 100%; max-width: 540px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .logo { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; }
    h1 { font-size: 20px; font-weight: 700; color: #1a1a2e; }
    label { display: block; font-size: 13px; font-weight: 600; color: #555; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    textarea { width: 100%; border: 2px solid #e8ecf0; border-radius: 10px; padding: 14px 16px; font-size: 14px; color: #1a1a2e; resize: none; height: 90px; transition: border-color 0.2s; outline: none; font-family: inherit; }
    textarea:focus { border-color: #4285f4; }
    textarea::placeholder { color: #b0b8c4; }
    button#btn { width: 100%; margin-top: 14px; padding: 14px; background: #4285f4; color: white; border: none; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.2s, transform 0.1s; }
    button#btn:hover { background: #3071e0; }
    button#btn:active { transform: scale(0.98); }
    button#btn:disabled { background: #a8c4f5; cursor: not-allowed; }
    #result { margin-top: 24px; display: none; }
    .result-box { background: #f7f9ff; border: 2px solid #d0e0ff; border-radius: 10px; padding: 16px; }
    .result-label { font-size: 12px; font-weight: 600; color: #4285f4; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
    .result-link { font-size: 13px; color: #1a1a2e; word-break: break-all; line-height: 1.5; }
    .copy-btn { width: 100%; margin-top: 12px; padding: 11px; background: #34a853; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    .copy-btn:hover { background: #2d9249; }
    .copy-btn.copied { background: #188038; }
    #error { margin-top: 14px; padding: 12px 16px; background: #fff0f0; border: 1.5px solid #ffcdd2; border-radius: 8px; color: #c62828; font-size: 13px; display: none; }
    .spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.4); border-top-color: white; border-radius: 50%; animation: spin 0.7s linear infinite; vertical-align: middle; margin-right: 6px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
<div class="card">
  <div class="logo">
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z" fill="#4285f4"/>
    </svg>
    <h1>Review Link Generator</h1>
  </div>
  <label>Link Google Maps</label>
  <textarea id="input" placeholder="Incolla qui il link Google Maps (lungo o corto maps.app.goo.gl)..."></textarea>
  <button id="btn" onclick="generate()">Genera link recensione</button>
  <div id="error"></div>
  <div id="result">
    <div class="result-box">
      <div class="result-label">Link recensione Google</div>
      <div class="result-link" id="link-text"></div>
    </div>
    <button class="copy-btn" onclick="copyLink()">Copia link</button>
  </div>
</div>
<script>
  const WORKER_URL = '/';
  let reviewLink = '';
  async function generate() {
    const input = document.getElementById('input').value.trim();
    const btn = document.getElementById('btn');
    const errorEl = document.getElementById('error');
    const resultEl = document.getElementById('result');
    errorEl.style.display = 'none';
    resultEl.style.display = 'none';
    if (!input) { showError('Incolla un link Google Maps.'); return; }
    if (!input.includes('google.com/maps') && !input.includes('maps.app.goo.gl') && !input.includes('goo.gl/maps') && !input.includes('share.google')) {
      showError('Link non valido. Incolla un link Google Maps o maps.app.goo.gl');
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Ricerca in corso...';
    try {
      const res = await fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: input }) });
      const data = await res.json();
      if (res.ok && data.review_link) { showResult(data.review_link); }
      else { showError(data.error || 'Impossibile generare il link. Riprova con un link più preciso.'); }
    } catch (e) { showError('Errore di connessione. Riprova.'); }
    finally { btn.disabled = false; btn.innerHTML = 'Genera link recensione'; }
  }
  function showResult(link) { reviewLink = link; document.getElementById('link-text').textContent = reviewLink; document.getElementById('result').style.display = 'block'; }
  function copyLink() {
    if (!reviewLink) return;
    navigator.clipboard.writeText(reviewLink).then(() => {
      const btn = document.querySelector('.copy-btn');
      btn.textContent = 'Copiato!'; btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copia link'; btn.classList.remove('copied'); }, 2000);
    });
  }
  function showError(msg) { const el = document.getElementById('error'); el.textContent = msg; el.style.display = 'block'; }
</script>
</body>
</html>`;
