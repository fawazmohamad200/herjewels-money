// Fetches every real order placed in a date range - used to show which ones
// are still pending (not yet logged as collected via Weeks or Prepaid).

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
    const { fromDate, toDate } = await request.json();
    if (!fromDate || !toDate) {
      return Response.json({ error: 'Missing date range' }, { status: 400 });
    }

    const domain = process.env.SHOPIFY_STORE_DOMAIN;
    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
    if (!domain || !clientId || !clientSecret) {
      return Response.json({ error: 'Shopify is not connected yet - missing credentials on the server.' }, { status: 500 });
    }

    const token = await getAccessToken(domain, clientId, clientSecret);

    // Your store's real clock is Beirut time (UTC+3) - use that offset, not UTC,
    // or early-morning orders get cut off into the previous day by mistake.
    const createdMin = `${fromDate}T00:00:00+03:00`;
    const createdMax = `${toDate}T23:59:59+03:00`;
    let url = `https://${domain}/admin/api/2024-10/orders.json?status=any&created_at_min=${encodeURIComponent(createdMin)}&created_at_max=${encodeURIComponent(createdMax)}&limit=250&fields=id,name,total_price,created_at,financial_status,fulfillment_status`;

    const allOrders = [];
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
      (data.orders || []).forEach(o => {
        allOrders.push({
          name: o.name, total: parseFloat(o.total_price),
          placedAt: (o.created_at || '').slice(0, 10),
          financialStatus: o.financial_status, fulfillmentStatus: o.fulfillment_status,
        });
      });
      const link = res.headers.get('link') || res.headers.get('Link');
      const nextMatch = link && link.match(/<([^>]+)>;\s*rel="next"/);
      url = nextMatch ? nextMatch[1] : null;
    }

    return Response.json({ orders: allOrders });
  } catch (err) {
    return Response.json({ error: err.message || 'Unknown error' }, { status: 500 });
  }
}
