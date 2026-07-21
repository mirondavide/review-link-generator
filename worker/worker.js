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
