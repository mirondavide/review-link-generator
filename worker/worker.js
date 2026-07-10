function extractPlaceInfo(url) {
  // Full Maps URL: place_id encoded as !1sChIJ... in the data param
  const placeIdMatch = url.match(/!1s(ChIJ[^!&]+)/);
  if (placeIdMatch) return { type: 'place_id', value: decodeURIComponent(placeIdMatch[1]) };

  // Full Maps URL: kgmid encoded as !16s%2Fg%2F... in the data param
  const kgmidDataMatch = url.match(/!16s(%2Fg%2F[^!&]+)/);
  if (kgmidDataMatch) return { type: 'kgmid', value: decodeURIComponent(kgmidDataMatch[1]) };

  // Sorry page continue URL: kgmid as ?kgmid=/g/...
  const kgmidParamMatch = url.match(/[?&]kgmid=(\/[a-z]\/[^&]+)/);
  if (kgmidParamMatch) return { type: 'kgmid', value: decodeURIComponent(kgmidParamMatch[1]) };

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
        const expanded = await fetch(inputUrl, { redirect: 'follow', headers: browserHeaders });
        inputUrl = expanded.url;
      } catch {
        return new Response(JSON.stringify({ error: 'Impossibile espandere il link.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // Handle /sorry/index — extract the continue URL (contains kgmid)
    if (inputUrl.includes('/sorry/index')) {
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
