// Finds Shopify orders from a pasted list. Each line can be:
//   an order number  -> 1558, #1558
//   a Net label      -> herjewels-1558
//   a tracking no.   -> SS003199115 (Topspeed) or any fulfillment tracking number

async function getAccessToken(domain, clientId, clientSecret) {
  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
  });
  if (!res.ok) throw new Error(`Could not get Shopify access token: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();

function orderNumberOf(input) {
  const t = norm(input);
  let m = t.match(/^herjewels-?(\d+)$/);
  if (m) return m[1];
  m = t.match(/^#?(\d{3,6})$/);
  return m ? m[1] : null;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const inputs = (body.trackingNumbers || []).map(s => String(s).trim()).filter(Boolean);
    if (!inputs.length) return Response.json({ error: 'Nothing to look up' }, { status: 400 });

    const domain = process.env.SHOPIFY_STORE_DOMAIN;
    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
    if (!domain || !clientId || !clientSecret) {
      return Response.json({ error: 'Shopify is not connected yet - missing credentials on the server.' }, { status: 500 });
    }
    const token = await getAccessToken(domain, clientId, clientSecret);

    const since = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString();
    let url = `https://${domain}/admin/api/2024-10/orders.json?status=any&created_at_min=${encodeURIComponent(since)}&limit=250&fields=id,name,order_number,total_price,created_at,cancelled_at,financial_status,fulfillment_status,fulfillments,line_items,payment_gateway_names`;

    const byNumber = new Map(); // "1558" -> order
    const byTracking = new Map(); // normalized tracking -> order
    let guard = 0;
    while (url && guard < 40) {
      guard++;
      const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' } });
      if (!res.ok) return Response.json({ error: `Shopify error: ${res.status} ${await res.text()}` }, { status: 502 });
      const data = await res.json();
      (data.orders || []).forEach(o => {
        byNumber.set(String(o.order_number), o);
        (o.fulfillments || []).filter(f => f.status !== 'cancelled').forEach(f => {
          const nums = [f.tracking_number, ...(f.tracking_numbers || [])].filter(Boolean);
          nums.forEach(n => byTracking.set(norm(n), o));
        });
      });
      const link = res.headers.get('link') || res.headers.get('Link');
      const next = link && link.match(/<([^>]+)>;\s*rel="next"/);
      url = next ? next[1] : null;
    }

    const matched = [], notFound = [], seen = new Set();
    inputs.forEach(input => {
      const num = orderNumberOf(input);
      const o = (num && byNumber.get(num)) || byTracking.get(norm(input));
      if (!o) { notFound.push(input); return; }
      if (seen.has(o.id)) return; // same order typed twice
      seen.add(o.id);
      const allTracking = (o.fulfillments || []).filter(f => f.status !== 'cancelled').map(f => f.tracking_number).filter(Boolean);
      // If the order has more than one fulfillment, show the one that was typed, else the Net label, else the first.
      const tracking = allTracking.find(t => norm(t) === norm(input)) || allTracking.find(t => /^herjewels-/i.test(t)) || allTracking[0] || '';
      matched.push({
        name: o.name,
        trackingNumber: tracking || input,
        matchedInput: input,
        allTracking,
        total: parseFloat(o.total_price),
        createdAt: o.created_at,
        financialStatus: o.financial_status,
        fulfillmentStatus: o.fulfillment_status,
        cancelledAt: o.cancelled_at || null,
        gateways: o.payment_gateway_names || [],
        lineItems: (o.line_items || []).map(li => ({ title: li.title, variant: li.variant_title || '', quantity: li.quantity })),
      });
    });

    return Response.json({ matched, notFound });
  } catch (err) {
    return Response.json({ error: err.message || 'Unknown error' }, { status: 500 });
  }
}
