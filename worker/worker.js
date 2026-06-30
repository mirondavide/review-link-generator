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

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let { url: inputUrl } = body;

    if (!inputUrl) {
      return new Response(JSON.stringify({ error: 'Missing URL' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Expand short/share URLs
    if (inputUrl.includes('goo.gl') || inputUrl.includes('maps.app') || inputUrl.includes('share.google')) {
      try {
        const expanded = await fetch(inputUrl, {
          redirect: 'follow',
          headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
        });
        inputUrl = expanded.url;
      } catch {
        return new Response(JSON.stringify({ error: 'Impossibile espandere il link corto.' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Google redirects Cloudflare Workers to /sorry/index — extract the real URL from ?continue=
    if (inputUrl.includes('/sorry/index')) {
      const continueMatch = inputUrl.match(/continue=([^&]+)/);
      if (continueMatch) {
        inputUrl = decodeURIComponent(continueMatch[1]);
      }
    }

    const parsed = parseMapsUrl(inputUrl);

    if (!parsed.name && !parsed.lat) {
      return new Response(JSON.stringify({ error: 'Link non valido. Usa un link Google Maps.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let googleRes;

    if (parsed.name) {
      const searchBody = { textQuery: parsed.name };
      if (parsed.lat && parsed.lng) {
        searchBody.locationBias = {
          circle: { center: { latitude: parsed.lat, longitude: parsed.lng }, radius: 500 },
        };
      }
      googleRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': env.GOOGLE_MAPS_KEY,
          'X-Goog-FieldMask': 'places.id,places.displayName',
        },
        body: JSON.stringify(searchBody),
      });
    } else {
      // Coordinates only — nearby search with tight radius
      googleRes = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': env.GOOGLE_MAPS_KEY,
          'X-Goog-FieldMask': 'places.id,places.displayName',
        },
        body: JSON.stringify({
          locationRestriction: {
            circle: { center: { latitude: parsed.lat, longitude: parsed.lng }, radius: 50 },
          },
          maxResultCount: 1,
        }),
      });
    }

    const data = await googleRes.json();

    if (data.places?.[0]) {
      const placeId = data.places[0].id;
      return new Response(JSON.stringify({
        place_id: placeId,
        review_link: `https://search.google.com/local/writereview?placeid=${placeId}`,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Attività non trovata' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  },
};
