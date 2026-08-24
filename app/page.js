'use client';
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import './globals.css';

const PIN = '1472';

function money(n) {
  n = Number(n) || 0;
  const neg = n < 0;
  const v = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (neg ? '-$' : '$') + v;
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function Home() {
  const [unlocked, setUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinErr, setPinErr] = useState('');
  const [tab, setTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState('');

  const [products, setProducts] = useState([]);
  const [weeks, setWeeks] = useState([]); // each: {...week, items:[{product_id, qty_cod, qty_paid, unit_price, unit_cost}]}
  const [legacy, setLegacy] = useState([]);
  const [ads, setAds] = useState([]);
  const [orders, setOrders] = useState([]); // individual real orders, for the Performance report
  const [settings, setSettings] = useState({ employee: 0, stock: 0, other: 0, bank: 0 });

  const [fromDate, setFromDate] = useState('2026-01-01');
  const [toDate, setToDate] = useState(todayStr());

  useEffect(() => {
    if (unlocked) loadAll();
  }, [unlocked]);

  async function loadAll() {
    setLoading(true);
    setDbError('');
    try {
      const [{ data: prod, error: e1 }, { data: wk, error: e2 }, { data: items, error: e3 },
             { data: lg, error: e4 }, { data: adRows, error: e5 }, { data: st, error: e6 },
             { data: ordRows, error: e7 }] =
        await Promise.all([
          supabase.from('products').select('*').order('name'),
          supabase.from('weeks').select('*').order('week_date', { ascending: false }),
          supabase.from('week_items').select('*'),
          supabase.from('legacy_batches').select('*'),
          supabase.from('ads').select('*').order('ad_date', { ascending: false }),
          supabase.from('settings').select('*').eq('id', 1).single(),
          supabase.from('orders').select('*').order('placed_at', { ascending: false }),
        ]);
      if (e1 || e2 || e3 || e4 || e5 || e6 || e7) throw (e1 || e2 || e3 || e4 || e5 || e6 || e7);

      const weeksWithItems = (wk || []).map(w => ({
        ...w,
        items: (items || []).filter(i => i.week_id === w.id),
      }));

      setProducts(prod || []);
      setWeeks(weeksWithItems);
      setLegacy(lg || []);
      setAds(adRows || []);
      setOrders(ordRows || []);
      setSettings(st || { employee: 0, stock: 0, other: 0, bank: 0 });

      // default date range: earliest known date to today
      const allDates = weeksWithItems.map(w => w.week_date).filter(Boolean);
      if (allDates.length) {
        const min = allDates.reduce((a, b) => (a < b ? a : b));
        setFromDate(min);
      }
    } catch (err) {
      console.error(err);
      setDbError('Could not reach the database. Check your internet connection, or the app may not be set up yet.');
    }
    setLoading(false);
  }

  function handleKey(k) {
    if (k === '⌫') { setPinInput(p => p.slice(0, -1)); setPinErr(''); return; }
    setPinInput(p => {
      const next = p.length < 4 ? p + k : p;
      if (next.length === 4) {
        if (next === PIN) { setUnlocked(true); setPinErr(''); return ''; }
        setPinErr('Wrong PIN. Try again.');
        return '';
      }
      return next;
    });
  }

  const weekTotals = (w) => {
    let capCod = 0, capPaid = 0;
    (w.items || []).forEach(it => {
      capCod += (Number(it.qty_cod) || 0) * Number(it.unit_cost);
      capPaid += (Number(it.qty_paid) || 0) * Number(it.unit_cost);
    });
    const revCod = Number(w.revenue_cod) || 0;   // already net - what Topspeed actually pays you
    const revPaid = Number(w.revenue_paid) || 0; // already net - prepaid cash received
    const shippedOrders = (Number(w.delivered) || 0) + (Number(w.paid_orders) || 0);
    const packaging = shippedOrders * 1;
    return {
      revenue: revCod + revPaid, capital: capCod + capPaid, packaging,
      cashTopspeed: revCod, cashPaid: revPaid, cash: revCod + revPaid,
    };
  };

  const inRange = (dateStr) => {
    if (!dateStr) return true;
    return dateStr >= fromDate && dateStr <= toDate;
  };
  const rangeOverlaps = (start, end) => {
    const s = start || end, e = end || start;
    if (!s) return true;
    return s <= toDate && e >= fromDate;
  };

  const totals = useMemo(() => {
    let topspeedCash = 0, capitalTotal = 0, packagingTotal = 0, deliveredTotal = 0, cancelledTotal = 0, revenueTotal = 0;
    weeks.forEach(w => {
      if (!inRange(w.week_date)) return;
      const t = weekTotals(w);
      topspeedCash += t.cash;
      capitalTotal += t.capital;
      packagingTotal += t.packaging;
      deliveredTotal += Number(w.delivered) || 0;
      cancelledTotal += Number(w.cancelled) || 0;
      revenueTotal += t.revenue;
    });
    legacy.forEach(b => {
      topspeedCash += Number(b.revenue) || 0;
      capitalTotal += Number(b.capital) || 0;
      deliveredTotal += Number(b.delivered) || 0;
      cancelledTotal += Number(b.cancelled) || 0;
      revenueTotal += Number(b.revenue) || 0;
    });
    let adsTotal = 0;
    ads.forEach(a => { if (rangeOverlaps(a.ad_date, a.ad_date_to)) adsTotal += Number(a.amount) || 0; });
    legacy.forEach(b => { adsTotal += Number(b.ads) || 0; });

    const cashIn = topspeedCash;
    const cashOut = adsTotal + (Number(settings.employee) || 0) + (Number(settings.stock) || 0) + (Number(settings.other) || 0);
    const cashOnHand = cashIn - cashOut;
    const net = cashOnHand - capitalTotal - packagingTotal;
    return { topspeedCash, capitalTotal, packagingTotal, adsTotal, deliveredTotal, cancelledTotal, revenueTotal, cashIn, cashOut, cashOnHand, net };
  }, [weeks, legacy, ads, settings, fromDate, toDate]);

  if (!unlocked) {
    const dots = Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className={`pin-dot ${i < pinInput.length ? 'filled' : ''}`} />
    ));
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
    return (
      <div className="gate">
        <div className="gate-card">
          <div className="gate-mark">HJ</div>
          <h1 className="serif">HerJewels Money</h1>
          <p>Enter the shared PIN</p>
          <div className="pin-dots">{dots}</div>
          <div className="keypad">
            {keys.map((k, i) =>
              k === '' ? <div key={i} /> : (
                <button key={i} className={`key ${k === '⌫' ? 'ghost' : ''}`} onClick={() => handleKey(k)}>{k}</button>
              )
            )}
          </div>
          <div className="gate-err">{pinErr}</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {dbError && <div className="banner">⚠ {dbError}</div>}
      <div className="header">
        <div className="brand">
          <div className="brand-mark">HJ</div>
          <div><h1>HerJewels</h1><span>Money & Capital Tracker</span></div>
        </div>
        <div className="tabs">
          {['dashboard', 'weeks', 'prepaid', 'performance', 'products', 'ads', 'settings'].map(t => (
            <div key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </div>
          ))}
        </div>
      </div>
      <div className="body">
        {loading ? <div className="loading">Loading...</div> : (
          <>
            {tab === 'dashboard' && <Dashboard totals={totals} settings={settings} fromDate={fromDate} toDate={toDate} setFromDate={setFromDate} setToDate={setToDate} weeksCount={weeks.length} />}
            {tab === 'weeks' && <Weeks weeks={weeks} legacy={legacy} products={products} weekTotals={weekTotals} reload={loadAll} />}
            {tab === 'prepaid' && <Prepaid weeks={weeks} products={products} weekTotals={weekTotals} reload={loadAll} />}
            {tab === 'performance' && <Performance orders={orders} ads={ads} />}
            {tab === 'products' && <Products products={products} reload={loadAll} />}
            {tab === 'ads' && <Ads ads={ads} legacy={legacy} reload={loadAll} />}
            {tab === 'settings' && <Settings settings={settings} reload={loadAll} />}
          </>
        )}
        <div className="signature mono">shared with your employee &middot; saves to your own database</div>
      </div>
    </div>
  );
}

function Dashboard({ totals: c, settings, fromDate, toDate, setFromDate, setToDate, weeksCount }) {
  const diff = (Number(settings.bank) || 0) - c.cashOnHand;
  const diffOk = Math.abs(diff) < 1;

  function setPreset(days) {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (days - 1));
    setFromDate(start.toISOString().slice(0, 10));
    setToDate(end.toISOString().slice(0, 10));
  }
  function setLastWeek() {
    const end = new Date();
    end.setDate(end.getDate() - 7);
    const start = new Date();
    start.setDate(end.getDate() - 6);
    setFromDate(start.toISOString().slice(0, 10));
    setToDate(end.toISOString().slice(0, 10));
  }
  function setAllTime() {
    setFromDate('2020-01-01');
    setToDate(todayStr());
  }

  return (
    <>
      <div className="daterange" style={{ flexWrap: 'wrap' }}>
        <div className="field"><label>From</label><input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} /></div>
        <div className="field"><label>To</label><input type="date" value={toDate} onChange={e => setToDate(e.target.value)} /></div>
        <button className="btn ghost2" onClick={() => setPreset(7)}>This week</button>
        <button className="btn ghost2" onClick={setLastWeek}>Last week</button>
        <button className="btn ghost2" onClick={setAllTime}>All time</button>
      </div>
      <div className="kpis">
        <div className="kpi accent"><div className="lbl">Cash In</div><div className="val">{money(c.cashIn)}</div></div>
        <div className="kpi"><div className="lbl">Cash Out</div><div className="val">{money(c.cashOut)}</div></div>
        <div className="kpi good"><div className="lbl">Cash On Hand</div><div className="val">{money(c.cashOnHand)}</div></div>
        <div className="kpi warn"><div className="lbl">Capital (stock)</div><div className="val">{money(c.capitalTotal)}</div></div>
        <div className="kpi warn"><div className="lbl">Packaging to rebuy</div><div className="val">{money(c.packagingTotal)}</div></div>
        <div className="kpi good"><div className="lbl">Net - spendable</div><div className="val">{money(c.net)}</div></div>
      </div>
      <div className="panel">
        <h2>Business in this range <small>{c.deliveredTotal} delivered &middot; {c.cancelledTotal} cancelled &middot; {weeksCount} weeks logged total</small></h2>
        <table className="tbl">
          <tbody>
            <tr><td>Revenue (COD + prepaid, already net of Topspeed fees)</td><td>{money(c.revenueTotal)}</td></tr>
            <tr><td>Cash Topspeed + prepaid handed you</td><td>{money(c.topspeedCash)}</td></tr>
            <tr><td>Ads spent</td><td className="neg">-{money(c.adsTotal)}</td></tr>
            <tr><td>Product capital tied up in stock</td><td className="neg">-{money(c.capitalTotal)}</td></tr>
            <tr><td>Packaging cost to set aside for rebuying supplies</td><td className="neg">-{money(c.packagingTotal)}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="panel">
        <h2>Bank check</h2>
        <table className="tbl">
          <tbody>
            <tr><td>Cash On Hand (calculated)</td><td>{money(c.cashOnHand)}</td></tr>
            <tr><td>Your real bank balance</td><td>{money(settings.bank)}</td></tr>
          </tbody>
        </table>
        <div className={`flag ${diffOk ? 'ok' : ''}`}>
          {diffOk ? 'Matches. Good.' : `Off by ${money(Math.abs(diff))} - ${diff > 0 ? 'you have more than expected' : 'check recent spend'}.`}
        </div>
      </div>
    </>
  );
}

function Weeks({ weeks, legacy, products, weekTotals, reload }) {
  const topspeedWeeks = weeks.filter(w => (w.kind || 'topspeed') === 'topspeed');
  const [expanded, setExpanded] = useState({});
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [label, setLabel] = useState('');
  const [date, setDate] = useState(todayStr());
  const [delivered, setDelivered] = useState('');
  const [cancelled, setCancelled] = useState('');
  const [revenueCod, setRevenueCod] = useState('');
  const [revenuePaid, setRevenuePaid] = useState(''); // unused for topspeed weeks, kept 0
  const [paidOrders, setPaidOrders] = useState(''); // unused for topspeed weeks, kept 0
  const [filter, setFilter] = useState('');
  const [qty, setQty] = useState({}); // productId -> {cod, paid}
  const [saving, setSaving] = useState(false);
  const [trackingText, setTrackingText] = useState('');
  const [looking, setLooking] = useState(false);
  const [lookupResult, setLookupResult] = useState(null); // {matchedCount, notFound, unmatchedProducts}
  const [matchedOrders, setMatchedOrders] = useState([]); // raw orders from last lookup, for saving into `orders` table

  function matchProduct(title, variant) {
    const t = (title || '').trim().toLowerCase();
    const v = (variant || '').trim().toLowerCase();
    let hit = products.find(p => p.name.trim().toLowerCase() === t && (p.variant || '').trim().toLowerCase() === v);
    if (hit) return hit;
    hit = products.find(p => p.name.trim().toLowerCase() === t);
    if (hit) return hit;
    hit = products.find(p => t.includes(p.name.trim().toLowerCase()) || p.name.trim().toLowerCase().includes(t));
    return hit || null;
  }

  async function lookupTracking() {
    const list = trackingText.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (!list.length) return;
    setLooking(true);
    setLookupResult(null);
    try {
      const res = await fetch('/api/shopify-lookup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingNumbers: list }),
      });
      const data = await res.json();
      if (data.error) { alert('Lookup failed: ' + data.error); setLooking(false); return; }

      const newQty = { ...qty };
      let unmatchedProducts = new Set();
      data.matched.forEach(order => {
        order.lineItems.forEach(li => {
          const p = matchProduct(li.title, li.variant);
          if (!p) { unmatchedProducts.add(li.title + (li.variant ? ' - ' + li.variant : '')); return; }
          const existing = newQty[p.id] || {};
          newQty[p.id] = { ...existing, cod: (Number(existing.cod) || 0) + li.quantity };
        });
      });
      setQty(newQty);
      setMatchedOrders(data.matched);
      setLookupResult({
        matchedCount: data.matched.length,
        notFound: data.notFound,
        unmatchedProducts: [...unmatchedProducts],
      });
    } catch (err) {
      alert('Lookup failed: ' + err.message);
    }
    setLooking(false);
  }

  const filtered = products.filter(p =>
    !filter || (p.name + ' ' + (p.variant || '')).toLowerCase().includes(filter.toLowerCase())
  );

  const liveCapital = useMemo(() => {
    let capital = 0;
    products.forEach(p => {
      const q = qty[p.id] || {};
      const cod = Number(q.cod) || 0, paid = Number(q.paid) || 0;
      capital += (cod + paid) * Number(p.cost);
    });
    return capital;
  }, [qty, products]);

  function startAdd() {
    setAdding(true); setEditingId(null);
    setLabel(''); setDate(todayStr()); setDelivered(''); setCancelled('');
    setRevenueCod(''); setRevenuePaid(''); setPaidOrders(''); setFilter(''); setQty({});
    setTrackingText(''); setLookupResult(null); setMatchedOrders([]);
  }

  function startEditWeek(w) {
    setAdding(true); setEditingId(w.id);
    setLabel(w.label); setDate(w.week_date);
    setDelivered(String(w.delivered ?? '')); setCancelled(String(w.cancelled ?? ''));
    setRevenueCod(String(w.revenue_cod ?? '')); setRevenuePaid(String(w.revenue_paid ?? ''));
    setPaidOrders(String(w.paid_orders ?? ''));
    setFilter('');
    const q = {};
    (w.items || []).forEach(it => {
      q[it.product_id] = { cod: it.qty_cod || '', paid: it.qty_paid || '' };
    });
    setQty(q);
    setExpanded(e => ({ ...e, [w.id]: false }));
  }

  async function saveWeek() {
    setSaving(true);
    try {
      const payload = {
        label: label || `Week ${date}`, week_date: date, kind: 'topspeed',
        delivered: Number(delivered) || 0, cancelled: Number(cancelled) || 0,
        revenue_cod: Number(revenueCod) || 0, revenue_paid: 0, paid_orders: 0,
      };

      let weekId = editingId;
      if (editingId) {
        const { error: uerr } = await supabase.from('weeks').update(payload).eq('id', editingId);
        if (uerr) throw uerr;
        // clear old items, we'll re-insert the current set
        const { error: derr } = await supabase.from('week_items').delete().eq('week_id', editingId);
        if (derr) throw derr;
      } else {
        const { data: weekRow, error: werr } = await supabase.from('weeks').insert(payload).select().single();
        if (werr) throw werr;
        weekId = weekRow.id;
      }

      const itemsToInsert = [];
      products.forEach(p => {
        const q = qty[p.id] || {};
        const cod = Number(q.cod) || 0, paid = Number(q.paid) || 0;
        if (cod > 0 || paid > 0) {
          itemsToInsert.push({
            week_id: weekId, product_id: p.id,
            qty_cod: cod, qty_paid: paid,
            unit_price: p.price, unit_cost: p.cost,
          });
        }
      });
      if (itemsToInsert.length) {
        const { error: ierr } = await supabase.from('week_items').insert(itemsToInsert);
        if (ierr) throw ierr;
      }

      await supabase.from('orders').delete().eq('week_id', weekId);
      if (matchedOrders.length) {
        const orderRows = matchedOrders.map(o => {
          let capital = 0;
          o.lineItems.forEach(li => {
            const p = matchProduct(li.title, li.variant);
            if (p) capital += li.quantity * p.cost;
          });
          return {
            order_name: o.name, tracking_number: o.trackingNumber,
            placed_at: (o.createdAt || '').slice(0, 10) || date,
            total: o.total, capital, kind: 'topspeed', week_id: weekId,
          };
        });
        const { error: oerr } = await supabase.from('orders').insert(orderRows);
        if (oerr) throw oerr;
      }

      setAdding(false); setEditingId(null);
      await reload();
    } catch (err) {
      alert('Could not save: ' + (err.message || JSON.stringify(err)));
    }
    setSaving(false);
  }

  async function deleteWeek(id) {
    if (!confirm('Delete this week?')) return;
    await supabase.from('week_items').delete().eq('week_id', id);
    await supabase.from('weeks').delete().eq('id', id);
    await reload();
  }

  return (
    <div className="panel">
      <h2>Weeks <small>one row per Topspeed paper - COD orders only</small></h2>
      <table className="tbl">
        <thead>
          <tr><th>Week</th><th>Delivered</th><th>Cancelled</th><th>Revenue</th><th>Cash</th><th>Capital</th><th>Packaging</th><th></th></tr>
        </thead>
        <tbody>
          {legacy.map(b => {
            return (
              <tr key={'lg' + b.id} style={{ opacity: .65 }}>
                <td>{b.label} <span className="mini">(legacy)</span></td>
                <td>{b.delivered}</td><td>{b.cancelled}</td>
                <td>{money(b.revenue)}</td><td>{money(b.revenue)}</td><td>{money(b.capital)}</td><td>-</td><td></td>
              </tr>
            );
          })}
          {topspeedWeeks.map(w => {
            const t = weekTotals(w);
            const isOpen = expanded[w.id];
            const nonZero = (w.items || []).filter(it => it.qty_cod > 0);
            return (
              <>
                <tr key={w.id}>
                  <td>
                    <button className="expand" onClick={() => setExpanded(e => ({ ...e, [w.id]: !e[w.id] }))}>{isOpen ? '▾' : '▸'}</button>
                    {w.label} <span className="mini">({w.week_date})</span>
                  </td>
                  <td>{w.delivered}</td><td>{w.cancelled}</td>
                  <td>{money(t.revenue)}</td><td>{money(t.cash)}</td><td>{money(t.capital)}</td><td>{money(t.packaging)}</td>
                  <td>
                    <button className="expand" onClick={() => startEditWeek(w)}>Edit</button>
                    <button className="del" onClick={() => deleteWeek(w.id)}>✕</button>
                  </td>
                </tr>
                {isOpen && (
                  <tr><td colSpan={8}>
                    <div className="week-detail">
                      {nonZero.length ? nonZero.map((it, idx) => {
                        const p = products.find(pp => pp.id === it.product_id);
                        return (
                          <div key={idx} className="mini">
                            {p ? p.name + (p.variant ? ' - ' + p.variant : '') : 'Unknown product'}:
                            {' '}COD <b>{it.qty_cod}</b> &middot; capital {money(it.qty_cod * it.unit_cost)}
                          </div>
                        );
                      }) : <div className="mini">No products logged.</div>}
                    </div>
                  </td></tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>

      {!adding && <div style={{ marginTop: 14 }}><button className="btn gold" onClick={startAdd}>+ Add this week's paper</button></div>}

      {adding && (
        <div className="week-detail" style={{ borderTop: '2px solid var(--gold)', marginTop: 16, paddingTop: 16 }}>
          <div className="newweek-grid">
            <div className="field"><label>Week label</label><input value={label} onChange={e => setLabel(e.target.value)} placeholder="19 Aug paper" /></div>
            <div className="field"><label>Paper date - the Dashboard filters by THIS</label><input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ border: '2px solid var(--gold)' }} /></div>
            <div className="field"><label>Delivered orders (COD)</label><input type="number" value={delivered} onChange={e => setDelivered(e.target.value)} /></div>
            <div className="field"><label>Cancelled orders</label><input type="number" value={cancelled} onChange={e => setCancelled(e.target.value)} /></div>
          </div>
          <div className="note" style={{marginBottom:10}}>Packaging cost is $1 per delivered order. Prepaid/Whish orders are tracked separately in the Prepaid tab.</div>

          <div className="week-detail" style={{ background: '#f4f0e2', marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>
              Paste every barcode from the paper (one per line or comma-separated) - looks them up in Shopify automatically
            </label>
            <textarea
              value={trackingText}
              onChange={e => setTrackingText(e.target.value)}
              rows={3}
              style={{ width: '100%', padding: 8, border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5, fontFamily: 'IBM Plex Mono, monospace' }}
              placeholder={'SS0033487 34\nSS0033487 33\n...'}
            />
            <div style={{ marginTop: 8 }}>
              <button className="btn gold" onClick={lookupTracking} disabled={looking}>{looking ? 'Looking up...' : 'Look up in Shopify'}</button>
            </div>
            {lookupResult && (
              <div className="note" style={{ marginTop: 8 }}>
                Matched {lookupResult.matchedCount} orders. Product quantities and Paid orders/Revenue filled in below - check before saving.
                {lookupResult.notFound.length > 0 && (
                  <div style={{ color: 'var(--bad)', marginTop: 4 }}>
                    Not found in Shopify ({lookupResult.notFound.length}): {lookupResult.notFound.join(', ')} - likely WhatsApp orders not entered yet, or cancelled.
                  </div>
                )}
                {lookupResult.unmatchedProducts.length > 0 && (
                  <div style={{ color: 'var(--warn)', marginTop: 4 }}>
                    Product name not in your Products tab ({lookupResult.unmatchedProducts.length}): {lookupResult.unmatchedProducts.join(', ')} - add it there, then look up again.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="newweek-grid">
            <div className="field"><label>Revenue - COD (Topspeed's "Amount To Be Paid", already net)</label><input type="number" step="0.01" value={revenueCod} onChange={e => setRevenueCod(e.target.value)} /></div>
          </div>
          <div className="note" style={{ marginBottom: 10 }}>Type the exact "Amount To Be Paid" total from the paper's summary box - already net of Topspeed's delivery fee, no further deduction happens. The product grid below only sets Capital, not revenue.</div>
          <input className="search" placeholder="Search a product..." value={filter} onChange={e => setFilter(e.target.value)} />
          <div className="qtyhead" style={{gridTemplateColumns:'1fr 70px 90px'}}><div>Product</div><div>Qty</div><div>Capital</div></div>
          <div className="qtygrid">
            {filtered.map(p => {
              const q = qty[p.id] || {};
              const lineCap = (Number(q.cod) || 0) * p.cost;
              return (
                <div key={p.id} className="qtyrow" style={{gridTemplateColumns:'1fr 70px 90px'}}>
                  <div><span className="pname">{p.name}</span>{p.variant ? <span className="pvariant"> - {p.variant}</span> : null}</div>
                  <input type="number" min="0" value={q.cod || ''} onChange={e => setQty(s => ({ ...s, [p.id]: { ...s[p.id], cod: e.target.value } }))} />
                  <div className="lineval">{money(lineCap)}</div>
                </div>
              );
            })}
          </div>
          <div className="livebar"><span>Revenue: <b>{money(Number(revenueCod) || 0)}</b></span><span>Capital: <b>{money(liveCapital)}</b></span></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn gold" onClick={saveWeek} disabled={saving}>{saving ? 'Saving...' : editingId ? 'Update week' : 'Save week'}</button>
            <button className="btn ghost2" onClick={() => { setAdding(false); setEditingId(null); }}>Cancel</button>
          </div>
          <div className="note">COD = delivered via Topspeed, charged the delivery fee. Prepaid orders are tracked in the Prepaid tab.</div>
        </div>
      )}
    </div>
  );
}

function Prepaid({ weeks, products, weekTotals, reload }) {
  const prepaidWeeks = weeks.filter(w => w.kind === 'prepaid');
  const [expanded, setExpanded] = useState({});
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [label, setLabel] = useState('');
  const [date, setDate] = useState(todayStr());
  const [filter, setFilter] = useState('');
  const [qty, setQty] = useState({});
  const [saving, setSaving] = useState(false);
  const [trackingText, setTrackingText] = useState('');
  const [looking, setLooking] = useState(false);
  const [lookupResult, setLookupResult] = useState(null);
  const [matchedOrders, setMatchedOrders] = useState([]);

  const filtered = products.filter(p =>
    !filter || (p.name + ' ' + (p.variant || '')).toLowerCase().includes(filter.toLowerCase())
  );

  const live = useMemo(() => {
    let revenue = 0, capital = 0;
    products.forEach(p => {
      const q = Number((qty[p.id] || {}).paid) || 0;
      revenue += q * Number(p.price);
      capital += q * Number(p.cost);
    });
    return { revenue, capital };
  }, [qty, products]);

  function matchProduct(title, variant) {
    const t = (title || '').trim().toLowerCase();
    const v = (variant || '').trim().toLowerCase();
    let hit = products.find(p => p.name.trim().toLowerCase() === t && (p.variant || '').trim().toLowerCase() === v);
    if (hit) return hit;
    hit = products.find(p => p.name.trim().toLowerCase() === t);
    if (hit) return hit;
    hit = products.find(p => t.includes(p.name.trim().toLowerCase()) || p.name.trim().toLowerCase().includes(t));
    return hit || null;
  }

  async function lookupTracking() {
    const list = trackingText.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (!list.length) return;
    setLooking(true);
    setLookupResult(null);
    try {
      const res = await fetch('/api/shopify-lookup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingNumbers: list }),
      });
      const data = await res.json();
      if (data.error) { alert('Lookup failed: ' + data.error); setLooking(false); return; }

      const newQty = { ...qty };
      let unmatchedProducts = new Set();
      data.matched.forEach(order => {
        order.lineItems.forEach(li => {
          const p = matchProduct(li.title, li.variant);
          if (!p) { unmatchedProducts.add(li.title + (li.variant ? ' - ' + li.variant : '')); return; }
          const existing = newQty[p.id] || {};
          newQty[p.id] = { ...existing, paid: (Number(existing.paid) || 0) + li.quantity };
        });
      });
      setQty(newQty);
      setMatchedOrders(data.matched);
      const revenueSum = data.matched.reduce((s, o) => s + o.total, 0);
      setLookupResult({
        matchedCount: data.matched.length,
        totalRevenue: revenueSum,
        notFound: data.notFound,
        unmatchedProducts: [...unmatchedProducts],
      });
    } catch (err) {
      alert('Lookup failed: ' + err.message);
    }
    setLooking(false);
  }

  function startAdd() {
    setAdding(true); setEditingId(null);
    setLabel(''); setDate(todayStr()); setFilter(''); setQty({});
    setTrackingText(''); setLookupResult(null); setMatchedOrders([]);
  }

  function startEditWeek(w) {
    setAdding(true); setEditingId(w.id);
    setLabel(w.label); setDate(w.week_date);
    setFilter('');
    const q = {};
    (w.items || []).forEach(it => { q[it.product_id] = { paid: it.qty_paid || '' }; });
    setQty(q);
    setTrackingText(''); setLookupResult(null); setMatchedOrders([]);
    setExpanded(e => ({ ...e, [w.id]: false }));
  }

  async function saveWeek() {
    setSaving(true);
    try {
      const matchedOrderCount = lookupResult ? lookupResult.matchedCount : 0;
      const revenuePaid = lookupResult ? lookupResult.totalRevenue : 0;
      const payload = {
        label: label || `Prepaid ${date}`, week_date: date, kind: 'prepaid',
        delivered: 0, cancelled: 0, revenue_cod: 0,
        revenue_paid: revenuePaid, paid_orders: matchedOrderCount,
      };

      let weekId = editingId;
      if (editingId) {
        const { error: uerr } = await supabase.from('weeks').update(payload).eq('id', editingId);
        if (uerr) throw uerr;
        const { error: derr } = await supabase.from('week_items').delete().eq('week_id', editingId);
        if (derr) throw derr;
      } else {
        const { data: weekRow, error: werr } = await supabase.from('weeks').insert(payload).select().single();
        if (werr) throw werr;
        weekId = weekRow.id;
      }

      const itemsToInsert = [];
      products.forEach(p => {
        const paid = Number((qty[p.id] || {}).paid) || 0;
        if (paid > 0) {
          itemsToInsert.push({ week_id: weekId, product_id: p.id, qty_cod: 0, qty_paid: paid, unit_price: p.price, unit_cost: p.cost });
        }
      });
      if (itemsToInsert.length) {
        const { error: ierr } = await supabase.from('week_items').insert(itemsToInsert);
        if (ierr) throw ierr;
      }

      await supabase.from('orders').delete().eq('week_id', weekId);
      if (matchedOrders.length) {
        const orderRows = matchedOrders.map(o => {
          let capital = 0;
          o.lineItems.forEach(li => {
            const p = matchProduct(li.title, li.variant);
            if (p) capital += li.quantity * p.cost;
          });
          return {
            order_name: o.name, tracking_number: o.trackingNumber,
            placed_at: (o.createdAt || '').slice(0, 10) || date,
            total: o.total, capital, kind: 'prepaid', week_id: weekId,
          };
        });
        const { error: oerr } = await supabase.from('orders').insert(orderRows);
        if (oerr) throw oerr;
      }

      setAdding(false); setEditingId(null);
      await reload();
    } catch (err) {
      alert('Could not save: ' + (err.message || JSON.stringify(err)));
    }
    setSaving(false);
  }

  async function deleteWeek(id) {
    if (!confirm('Delete this prepaid entry?')) return;
    await supabase.from('week_items').delete().eq('week_id', id);
    await supabase.from('weeks').delete().eq('id', id);
    await reload();
  }

  return (
    <div className="panel">
      <h2>Prepaid <small>Whish Pay / manual - add as often as they come in, daily is fine</small></h2>
      <table className="tbl">
        <thead>
          <tr><th>Entry</th><th>Orders</th><th>Revenue</th><th>Capital</th><th>Packaging</th><th></th></tr>
        </thead>
        <tbody>
          {prepaidWeeks.map(w => {
            const t = weekTotals(w);
            const isOpen = expanded[w.id];
            const nonZero = (w.items || []).filter(it => it.qty_paid > 0);
            return (
              <>
                <tr key={w.id}>
                  <td>
                    <button className="expand" onClick={() => setExpanded(e => ({ ...e, [w.id]: !e[w.id] }))}>{isOpen ? '▾' : '▸'}</button>
                    {w.label} <span className="mini">({w.week_date})</span>
                  </td>
                  <td>{w.paid_orders}</td>
                  <td>{money(t.revenue)}</td><td>{money(t.capital)}</td><td>{money(t.packaging)}</td>
                  <td>
                    <button className="expand" onClick={() => startEditWeek(w)}>Edit</button>
                    <button className="del" onClick={() => deleteWeek(w.id)}>✕</button>
                  </td>
                </tr>
                {isOpen && (
                  <tr><td colSpan={6}>
                    <div className="week-detail">
                      {nonZero.length ? nonZero.map((it, idx) => {
                        const p = products.find(pp => pp.id === it.product_id);
                        return (
                          <div key={idx} className="mini">
                            {p ? p.name + (p.variant ? ' - ' + p.variant : '') : 'Unknown product'}: <b>{it.qty_paid}</b> &middot; capital {money(it.qty_paid * it.unit_cost)}
                          </div>
                        );
                      }) : <div className="mini">No products logged.</div>}
                    </div>
                  </td></tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>

      {!adding && <div style={{ marginTop: 14 }}><button className="btn gold" onClick={startAdd}>+ Add prepaid orders</button></div>}

      {adding && (
        <div className="week-detail" style={{ borderTop: '2px solid var(--gold)', marginTop: 16, paddingTop: 16 }}>
          <div className="newweek-grid" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
            <div className="field"><label>Entry label</label><input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Whish - 24 Aug" /></div>
            <div className="field"><label>Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ border: '2px solid var(--gold)' }} /></div>
          </div>

          <div className="week-detail" style={{ background: '#f4f0e2', marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>
              Paste the tracking number(s) for the prepaid order(s) - looks them up in Shopify automatically
            </label>
            <textarea
              value={trackingText}
              onChange={e => setTrackingText(e.target.value)}
              rows={2}
              style={{ width: '100%', padding: 8, border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5, fontFamily: 'IBM Plex Mono, monospace' }}
              placeholder={'SS0033487 21'}
            />
            <div style={{ marginTop: 8 }}>
              <button className="btn gold" onClick={lookupTracking} disabled={looking}>{looking ? 'Looking up...' : 'Look up in Shopify'}</button>
            </div>
            {lookupResult && (
              <div className="note" style={{ marginTop: 8 }}>
                Matched {lookupResult.matchedCount} orders, revenue {money(lookupResult.totalRevenue)}. Product quantities filled in below.
                {lookupResult.notFound.length > 0 && (
                  <div style={{ color: 'var(--bad)', marginTop: 4 }}>Not found: {lookupResult.notFound.join(', ')}</div>
                )}
                {lookupResult.unmatchedProducts.length > 0 && (
                  <div style={{ color: 'var(--warn)', marginTop: 4 }}>Product not in your Products tab: {lookupResult.unmatchedProducts.join(', ')}</div>
                )}
              </div>
            )}
          </div>

          <input className="search" placeholder="Search a product..." value={filter} onChange={e => setFilter(e.target.value)} />
          <div className="qtyhead" style={{gridTemplateColumns:'1fr 70px 90px'}}><div>Product</div><div>Qty</div><div>Capital</div></div>
          <div className="qtygrid">
            {filtered.map(p => {
              const q = qty[p.id] || {};
              const lineCap = (Number(q.paid) || 0) * p.cost;
              return (
                <div key={p.id} className="qtyrow" style={{gridTemplateColumns:'1fr 70px 90px'}}>
                  <div><span className="pname">{p.name}</span>{p.variant ? <span className="pvariant"> - {p.variant}</span> : null}</div>
                  <input type="number" min="0" value={q.paid || ''} onChange={e => setQty(s => ({ ...s, [p.id]: { paid: e.target.value } }))} />
                  <div className="lineval">{money(lineCap)}</div>
                </div>
              );
            })}
          </div>
          <div className="livebar"><span>Revenue: <b>{money(lookupResult ? lookupResult.totalRevenue : live.revenue)}</b></span><span>Capital: <b>{money(live.capital)}</b></span></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn gold" onClick={saveWeek} disabled={saving}>{saving ? 'Saving...' : editingId ? 'Update entry' : 'Save entry'}</button>
            <button className="btn ghost2" onClick={() => { setAdding(false); setEditingId(null); }}>Cancel</button>
          </div>
          <div className="note">Revenue and order count come from the Shopify lookup automatically. Packaging ($1/order) is included in Cash Out same as Topspeed orders.</div>
        </div>
      )}
    </div>
  );
}

function Products({ products, reload }) {
  const [editing, setEditing] = useState({}); // id -> {price, cost}
  const [adding, setAdding] = useState(false);
  const [newP, setNewP] = useState({ name: '', variant: '', price: '', cost: '' });

  function startEdit(p) { setEditing(e => ({ ...e, [p.id]: { price: p.price, cost: p.cost } })); }

  async function saveEdit(id) {
    const v = editing[id];
    const { error } = await supabase.from('products').update({ price: Number(v.price), cost: Number(v.cost) }).eq('id', id);
    if (error) { alert('Could not save: ' + error.message); return; }
    setEditing(e => { const c = { ...e }; delete c[id]; return c; });
    await reload();
  }

  async function deleteProduct(id) {
    if (!confirm('Delete this product? Past weeks that used it keep their numbers (snapshot), but you will not be able to log new sales of it.')) return;
    await supabase.from('products').delete().eq('id', id);
    await reload();
  }

  async function addProduct() {
    if (!newP.name) return;
    const { error } = await supabase.from('products').insert({
      name: newP.name, variant: newP.variant, price: Number(newP.price) || 0, cost: Number(newP.cost) || 0,
    });
    if (error) { alert('Could not add: ' + error.message); return; }
    setAdding(false); setNewP({ name: '', variant: '', price: '', cost: '' });
    await reload();
  }

  return (
    <div className="panel">
      <h2>Products <small>edit price/cost anytime - only future weeks use the new numbers, past weeks stay locked</small></h2>
      <table className="tbl">
        <thead><tr><th>Product</th><th>Price</th><th>Cost</th><th>Margin</th><th></th></tr></thead>
        <tbody>
          {products.map(p => {
            const isEd = editing[p.id];
            const margin = p.price > 0 ? ((p.price - p.cost) / p.price * 100) : 0;
            return (
              <tr key={p.id}>
                <td>{p.name}{p.variant ? <span className="mini"> - {p.variant}</span> : null}</td>
                {isEd ? (
                  <>
                    <td className="prod-row-edit"><input type="number" step="0.01" value={isEd.price} onChange={e => setEditing(s => ({ ...s, [p.id]: { ...s[p.id], price: e.target.value } }))} /></td>
                    <td className="prod-row-edit"><input type="number" step="0.01" value={isEd.cost} onChange={e => setEditing(s => ({ ...s, [p.id]: { ...s[p.id], cost: e.target.value } }))} /></td>
                    <td>{margin.toFixed(0)}%</td>
                    <td><button className="btn gold" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => saveEdit(p.id)}>Save</button></td>
                  </>
                ) : (
                  <>
                    <td>{money(p.price)}</td><td>{money(p.cost)}</td>
                    <td className={margin < 30 ? 'neg' : ''}>{margin.toFixed(0)}%</td>
                    <td>
                      <button className="expand" onClick={() => startEdit(p)}>Edit</button>
                      <button className="del" onClick={() => deleteProduct(p.id)}>✕</button>
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!adding && <div style={{ marginTop: 14 }}><button className="btn gold" onClick={() => setAdding(true)}>+ Add product</button></div>}
      {adding && (
        <div className="newweek-grid" style={{ marginTop: 14 }}>
          <div className="field"><label>Name</label><input value={newP.name} onChange={e => setNewP(s => ({ ...s, name: e.target.value }))} /></div>
          <div className="field"><label>Variant (optional)</label><input value={newP.variant} onChange={e => setNewP(s => ({ ...s, variant: e.target.value }))} /></div>
          <div className="field"><label>Price $</label><input type="number" step="0.01" value={newP.price} onChange={e => setNewP(s => ({ ...s, price: e.target.value }))} /></div>
          <div className="field"><label>Cost $</label><input type="number" step="0.01" value={newP.cost} onChange={e => setNewP(s => ({ ...s, cost: e.target.value }))} /></div>
          <button className="btn gold" onClick={addProduct}>Add</button>
          <button className="btn ghost2" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function Ads({ ads, legacy, reload }) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [platform, setPlatform] = useState('Meta');
  const [dateFrom, setDateFrom] = useState(todayStr());
  const [dateTo, setDateTo] = useState(todayStr());

  async function addAd() {
    if (!amount) return;
    const finalLabel = label || `${platform}, ${dateFrom} to ${dateTo}`;
    const { error } = await supabase.from('ads').insert({
      label: finalLabel, amount: Number(amount), platform,
      ad_date: dateFrom, ad_date_to: dateTo,
    });
    if (error) { alert('Could not add: ' + error.message); return; }
    setLabel(''); setAmount('');
    await reload();
  }
  async function deleteAd(id) {
    await supabase.from('ads').delete().eq('id', id);
    await reload();
  }

  return (
    <div className="panel">
      <h2>Ads <small>log spend per platform, for whatever date range you're looking at</small></h2>
      <table className="tbl">
        <thead><tr><th>Period</th><th>Platform</th><th>Amount</th><th></th></tr></thead>
        <tbody>
          {legacy.filter(b => b.ads).map(b => (
            <tr key={'lg' + b.id} style={{ opacity: .65 }}><td>{b.label} <span className="mini">(legacy)</span></td><td>-</td><td>{money(b.ads)}</td><td></td></tr>
          ))}
          {ads.map(a => (
            <tr key={a.id}>
              <td>{a.label} <span className="mini">({a.ad_date}{a.ad_date_to && a.ad_date_to !== a.ad_date ? ` to ${a.ad_date_to}` : ''})</span></td>
              <td>{a.platform}</td><td>{money(a.amount)}</td>
              <td><button className="del" onClick={() => deleteAd(a.id)}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="newweek-grid" style={{ marginTop: 14, gridTemplateColumns: '1fr 1fr 1fr 1fr auto' }}>
        <div className="field">
          <label>Platform</label>
          <select value={platform} onChange={e => setPlatform(e.target.value)} style={{width:'100%',padding:'8px 9px',border:'1px solid var(--line)',borderRadius:8,fontSize:13,background:'#fbfaf6'}}>
            <option>Meta</option><option>TikTok</option><option>Other</option>
          </select>
        </div>
        <div className="field"><label>From</label><input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></div>
        <div className="field"><label>To</label><input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></div>
        <div className="field"><label>Amount $</label><input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></div>
        <button className="btn gold" onClick={addAd}>Add</button>
      </div>
      <div className="note">Add one entry per platform - so for the same week you'll add a Meta row, then a TikTok row. Both feed Cash Out and the Performance report.</div>
    </div>
  );
}

function Performance({ orders, ads }) {
  const earliest = orders.length ? orders.map(o => o.placed_at).reduce((a, b) => (a < b ? a : b)) : todayStr();
  const [from, setFrom] = useState(earliest);
  const [to, setTo] = useState(todayStr());

  function overlaps(start, end) {
    const s = start || end, e = end || start;
    if (!s) return true;
    return s <= to && e >= from;
  }

  const filteredOrders = orders.filter(o => o.placed_at >= from && o.placed_at <= to);
  const revenue = filteredOrders.reduce((s, o) => s + Number(o.total), 0);
  const capital = filteredOrders.reduce((s, o) => s + Number(o.capital), 0);
  const packaging = filteredOrders.length * 1;

  const filteredAds = ads.filter(a => overlaps(a.ad_date, a.ad_date_to));
  const adSpend = filteredAds.reduce((s, a) => s + Number(a.amount), 0);
  const byPlatform = {};
  filteredAds.forEach(a => { byPlatform[a.platform] = (byPlatform[a.platform] || 0) + Number(a.amount); });

  const profit = revenue - capital - packaging - adSpend;
  const codCount = filteredOrders.filter(o => o.kind === 'topspeed').length;
  const prepaidCount = filteredOrders.filter(o => o.kind === 'prepaid').length;

  return (
    <>
      <div className="daterange">
        <div className="field"><label>Orders placed from</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ border: '2px solid var(--gold)' }} /></div>
        <div className="field"><label>to</label><input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ border: '2px solid var(--gold)' }} /></div>
        <div className="mini" style={{ paddingBottom: 9 }}>Filters by the date each order was PLACED, not when Topspeed paid for it</div>
      </div>

      <div className="kpis">
        <div className="kpi accent"><div className="lbl">Revenue</div><div className="val">{money(revenue)}</div></div>
        <div className="kpi warn"><div className="lbl">Ad spend</div><div className="val">{money(adSpend)}</div></div>
        <div className="kpi warn"><div className="lbl">Capital + packaging</div><div className="val">{money(capital + packaging)}</div></div>
        <div className={`kpi ${profit >= 0 ? 'good' : 'bad'}`}><div className="lbl">Profit</div><div className="val">{money(profit)}</div></div>
      </div>

      <div className="panel">
        <h2>Orders placed in this window <small>{filteredOrders.length} orders - {codCount} via Topspeed, {prepaidCount} prepaid</small></h2>
        <table className="tbl">
          <tbody>
            <tr><td>Revenue (real, already collected)</td><td>{money(revenue)}</td></tr>
            <tr><td>Product capital</td><td className="neg">-{money(capital)}</td></tr>
            <tr><td>Packaging ({filteredOrders.length} x $1)</td><td className="neg">-{money(packaging)}</td></tr>
            <tr><td>Ad spend</td><td className="neg">-{money(adSpend)}</td></tr>
            <tr><td><b>PROFIT</b></td><td><b>{money(profit)}</b></td></tr>
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Ad spend by platform, this window</h2>
        <table className="tbl">
          <tbody>
            {Object.keys(byPlatform).length === 0 && <tr><td colSpan={2} className="mini">No ads logged for this window.</td></tr>}
            {Object.entries(byPlatform).map(([p, amt]) => (
              <tr key={p}><td>{p}</td><td>{money(amt)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="note" style={{ marginBottom: 8 }}>
        Only orders already looked up in Weeks or Prepaid appear here - meaning revenue shown is real, collected money, not a guess about pending orders.
      </div>
    </>
  );
}

function Settings({ settings, reload }) {
  const [form, setForm] = useState(settings);
  useEffect(() => setForm(settings), [settings]);

  async function save() {
    const { error } = await supabase.from('settings').update({
      employee: Number(form.employee) || 0, stock: Number(form.stock) || 0,
      other: Number(form.other) || 0, bank: Number(form.bank) || 0,
    }).eq('id', 1);
    if (error) { alert('Could not save: ' + error.message); return; }
    await reload();
  }

  return (
    <div className="panel">
      <h2>Money not from weekly batches</h2>
      <div className="settings-grid">
        <div className="field"><label>Employee wages</label><input type="number" step="0.01" value={form.employee} onChange={e => setForm(s => ({ ...s, employee: e.target.value }))} /></div>
        <div className="field"><label>Stock purchases</label><input type="number" step="0.01" value={form.stock} onChange={e => setForm(s => ({ ...s, stock: e.target.value }))} /></div>
        <div className="field"><label>Other costs</label><input type="number" step="0.01" value={form.other} onChange={e => setForm(s => ({ ...s, other: e.target.value }))} /></div>
        <div className="field"><label>Real bank balance</label><input type="number" step="0.01" value={form.bank} onChange={e => setForm(s => ({ ...s, bank: e.target.value }))} /></div>
      </div>
      <div style={{ marginTop: 16 }}><button className="btn gold" onClick={save}>Save</button></div>
      <div className="note">These are running totals-to-date, not filtered by the dashboard date range.</div>
    </div>
  );
}
