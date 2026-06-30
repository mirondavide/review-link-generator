function parseMapsUrl(url) {
  const nameMatch = url.match(/\/maps\/(?:place|search)\/([^/@?]+)/);
  const coordMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  const qMatch = url.match(/[?&]q=([^&]+)/);

  const name = nameMatch
    ? decodeURIComponent(nameMatch[1].replace(/\+/g, ' '))
    : qMatch
    ? decodeURIComponent(qMatch[1].replace(/\+/g, ' '))
    : null;

  return {
    name,
    lat: coordMatch ? parseFloat(coordMatch[1]) : null,
    lng: coordMatch ? parseFloat(coordMatch[2]) : null,
  };
}

async function shortenUrl(url) {
  try {
    const res = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
    if (res.ok) return (await res.text()).trim();
  } catch { /* ignore */ }
  return url;
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

    const { url: inputMapsUrl, place_id: confirmedPlaceId } = body;

    // Path B: user confirmed a specific place — just shorten and return
    if (confirmedPlaceId) {
      const longLink = `https://search.google.com/local/writereview?placeid=${confirmedPlaceId}`;
      const reviewLink = await shortenUrl(longLink);
      return new Response(JSON.stringify({ place_id: confirmedPlaceId, review_link: reviewLink }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!inputMapsUrl) return new Response(JSON.stringify({ error: 'Missing URL' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const browserHeaders = {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8',
    };

    let inputUrl = inputMapsUrl;

    // Expand short/share URLs
    if (inputUrl.includes('goo.gl') || inputUrl.includes('maps.app') || inputUrl.includes('share.google')) {
      try {
        const expanded = await fetch(inputUrl, { redirect: 'follow', headers: browserHeaders });
        inputUrl = expanded.url;
      } catch {
        return new Response(JSON.stringify({ error: 'Impossibile espandere il link corto.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // Handle /sorry/index — extract continue URL
    if (inputUrl.includes('/sorry/index')) {
      const m = inputUrl.match(/continue=([^&]+)/);
      if (m) inputUrl = decodeURIComponent(m[1]);
    }

    const parsed = parseMapsUrl(inputUrl);

    if (!parsed.name && !parsed.lat) {
      return new Response(JSON.stringify({ error: 'Link non valido. Usa un link Google Maps.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const listFieldMask = 'places.id,places.displayName,places.shortFormattedAddress';

    // Search up to 5 candidates
    let candidates = [];

    if (parsed.name) {
      const searchBody = { textQuery: parsed.name, pageSize: 5 };
      if (parsed.lat && parsed.lng) {
        searchBody.locationBias = {
          circle: { center: { latitude: parsed.lat, longitude: parsed.lng }, radius: 500 },
        };
      }
      try {
        const searchRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_MAPS_KEY, 'X-Goog-FieldMask': listFieldMask },
          body: JSON.stringify(searchBody),
        });
        const searchData = await searchRes.json();
        candidates = (searchData.places || []).map(p => ({
          id: p.id,
          name: p.displayName?.text || p.id,
          address: p.shortFormattedAddress || '',
        }));
      } catch { /* ignore */ }
    }

    if (candidates.length === 0 && parsed.lat) {
      try {
        const nearbyRes = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_MAPS_KEY, 'X-Goog-FieldMask': listFieldMask },
          body: JSON.stringify({
            locationRestriction: { circle: { center: { latitude: parsed.lat, longitude: parsed.lng }, radius: 50 } },
            maxResultCount: 5,
          }),
        });
        const nearbyData = await nearbyRes.json();
        candidates = (nearbyData.places || []).map(p => ({
          id: p.id,
          name: p.displayName?.text || p.id,
          address: p.shortFormattedAddress || '',
        }));
      } catch { /* ignore */ }
    }

    if (candidates.length === 0) {
      return new Response(JSON.stringify({ error: 'Attività non trovata' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Single unambiguous result — return directly
    if (candidates.length === 1) {
      const longLink = `https://search.google.com/local/writereview?placeid=${candidates[0].id}`;
      const reviewLink = await shortenUrl(longLink);
      return new Response(JSON.stringify({ place_id: candidates[0].id, review_link: reviewLink }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Multiple results — ask user to pick
    return new Response(JSON.stringify({ candidates }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  },
};
