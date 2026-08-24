// This runs on the server only. Your Shopify credentials never reach the browser.

async function getAccessToken(domain, clientId, clientSecret) {
  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Could not get Shopify access token: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data.access_token;
}

export async function POST(request) {
  try {
    const { trackingNumbers } = await request.json();
    if (!Array.isArray(trackingNumbers) || trackingNumbers.length === 0) {
      return Response.json({ error: 'No tracking numbers provided' }, { status: 400 });
    }
    const wanted = new Set(trackingNumbers.map(t => String(t).replace(/\s+/g, '').toUpperCase()));

    const domain = process.env.SHOPIFY_STORE_DOMAIN;
    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
    if (!domain || !clientId || !clientSecret) {
      return Response.json({ error: 'Shopify is not connected yet - missing credentials on the server.' }, { status: 500 });
    }

    const token = await getAccessToken(domain, clientId, clientSecret);

    // Look back 60 days - plenty for a weekly workflow, keeps each request fast.
    const since = new Date();
    since.setDate(since.getDate() - 60);
    const createdMin = since.toISOString();

    let url = `https://${domain}/admin/api/2024-10/orders.json?status=any&created_at_min=${encodeURIComponent(createdMin)}&limit=250&fields=id,name,total_price,created_at,financial_status,payment_gateway_names,line_items,fulfillments`;

    const matched = [];
    let guard = 0;
    while (url && guard < 20) {
      guard++;
      const res = await fetch(url, {
        headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const text = await res.text();
        return Response.json({ error: `Shopify error: ${res.status} ${text}` }, { status: 502 });
      }
      const data = await res.json();
      const orders = data.orders || [];

      for (const o of orders) {
        const trackNums = (o.fulfillments || [])
          .flatMap(f => (f.tracking_numbers && f.tracking_numbers.length ? f.tracking_numbers : (f.tracking_number ? [f.tracking_number] : [])))
          .map(t => String(t).replace(/\s+/g, '').toUpperCase());
        const hit = trackNums.find(t => wanted.has(t));
        if (hit) {
          const gateways = (o.payment_gateway_names || []).join(',').toLowerCase();
          const isPrepaid = gateways.includes('whish');
          matched.push({
            name: o.name,
            trackingNumber: hit,
            total: parseFloat(o.total_price),
            financialStatus: o.financial_status,
            isPrepaid,
            createdAt: o.created_at,
            lineItems: (o.line_items || []).map(li => ({
              title: li.title,
              variant: li.variant_title || '',
              quantity: li.quantity,
            })),
          });
        }
      }

      // Shopify pagination via Link header
      const link = res.headers.get('link') || res.headers.get('Link');
      const nextMatch = link && link.match(/<([^>]+)>;\s*rel="next"/);
      url = nextMatch ? nextMatch[1] : null;
    }

    const foundTracking = new Set(matched.map(m => m.trackingNumber));
    const notFound = [...wanted].filter(t => !foundTracking.has(t));

    return Response.json({ matched, notFound });
  } catch (err) {
    return Response.json({ error: err.message || 'Unknown error' }, { status: 500 });
  }
}
