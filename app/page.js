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
  const [funds, setFunds] = useState([]); // packaging/capital/employee/other ledger entries
  const [settings, setSettings] = useState({ bank: 0 });

  useEffect(() => {
    if (unlocked) loadAll();
  }, [unlocked]);

  async function loadAll() {
    setLoading(true);
    setDbError('');
    try {
      const [{ data: prod, error: e1 }, { data: wk, error: e2 }, { data: items, error: e3 },
             { data: lg, error: e4 }, { data: adRows, error: e5 }, { data: st, error: e6 },
             { data: ordRows, error: e7 }, { data: fundRows, error: e8 }] =
        await Promise.all([
          supabase.from('products').select('*').order('name'),
          supabase.from('weeks').select('*').order('week_date', { ascending: false }),
          supabase.from('week_items').select('*'),
          supabase.from('legacy_batches').select('*'),
          supabase.from('ads').select('*').order('ad_date', { ascending: false }),
          supabase.from('settings').select('*').eq('id', 1).single(),
          supabase.from('orders').select('*').order('placed_at', { ascending: false }),
          supabase.from('fund_entries').select('*').order('entry_date', { ascending: false }),
        ]);
      if (e1 || e2 || e3 || e4 || e5 || e6 || e7 || e8) throw (e1 || e2 || e3 || e4 || e5 || e6 || e7 || e8);

      const weeksWithItems = (wk || []).map(w => ({
        ...w,
        items: (items || []).filter(i => i.week_id === w.id),
      }));

      setProducts(prod || []);
      setWeeks(weeksWithItems);
      setLegacy(lg || []);
      setAds(adRows || []);
      setOrders(ordRows || []);
      setFunds(fundRows || []);
      setSettings(st || { bank: 0 });
    } catch (err) {
      console.error(err);
      setDbError('Could not reach the database. Check your internet connection, or the app may not be set up yet.');
    }
    setLoading(false);
  }

  function handleKey(k) {
    if (k === '⌫') { setPinInput(p => p.slice(0, -1)); setPinErr(''); return; }
    setPinInput(p => (p.length < 4 ? p + k : p));
  }

  useEffect(() => {
    if (pinInput.length !== 4) return;
    if (pinInput === PIN) {
      setUnlocked(true);
      setPinInput('');
      setPinErr('');
    } else {
      setPinErr('Wrong PIN. Try again.');
      setPinInput('');
    }
  }, [pinInput]);

  useEffect(() => {
    if (unlocked) return; // only listen while the PIN screen is showing
    function onKeyDown(e) {
      if (e.key >= '0' && e.key <= '9') { handleKey(e.key); return; }
      if (e.key === 'Backspace') { handleKey('⌫'); return; }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [unlocked]);

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

  // Dashboard is always ALL-TIME, no dates - this is your "what do I actually have right now" view.
  const totals = useMemo(() => {
    let topspeedCash = 0, capitalAccrued = 0, packagingAccrued = 0, deliveredTotal = 0, cancelledTotal = 0, revenueTotal = 0;
    weeks.forEach(w => {
      const t = weekTotals(w);
      topspeedCash += t.cash;
      capitalAccrued += t.capital;
      packagingAccrued += t.packaging;
      deliveredTotal += Number(w.delivered) || 0;
      cancelledTotal += Number(w.cancelled) || 0;
      revenueTotal += t.revenue;
    });
    legacy.forEach(b => {
      topspeedCash += Number(b.revenue) || 0;
      capitalAccrued += Number(b.capital) || 0;
      deliveredTotal += Number(b.delivered) || 0;
      cancelledTotal += Number(b.cancelled) || 0;
      revenueTotal += Number(b.revenue) || 0;
    });
    let adsTotal = 0;
    ads.forEach(a => { adsTotal += Number(a.amount) || 0; });
    legacy.forEach(b => { adsTotal += Number(b.ads) || 0; });

    const sumFund = (fund, type) => funds.filter(f => f.fund === fund && f.type === type).reduce((s, f) => s + Number(f.amount), 0);
    const packagingReserved = sumFund('packaging', 'reserve');
    const packagingSpent = sumFund('packaging', 'spend');
    const capitalReserved = sumFund('capital', 'reserve');
    const capitalSpent = sumFund('capital', 'spend');
    const employeeCost = funds.filter(f => f.fund === 'employee').reduce((s, f) => s + Number(f.amount), 0);
    const otherCost = funds.filter(f => f.fund === 'other').reduce((s, f) => s + Number(f.amount), 0);
    const injections = funds.filter(f => f.fund === 'injection').reduce((s, f) => s + Number(f.amount), 0);

    const packagingStillNeeded = packagingAccrued + packagingReserved - packagingSpent;
    const capitalStillNeeded = capitalAccrued + capitalReserved - capitalSpent;

    const cashIn = topspeedCash + injections;
    const cashOut = adsTotal + employeeCost + otherCost + packagingSpent + capitalSpent;
    const cashOnHand = cashIn - cashOut;
    // A surplus (already ahead on stock/packaging) should never ADD to spendable cash -
    // it just means you owe $0 right now, not that you have extra money.
    const net = cashOnHand - Math.max(0, capitalStillNeeded) - Math.max(0, packagingStillNeeded);

    return {
      topspeedCash, injections, capitalAccrued, packagingAccrued, packagingReserved, packagingSpent,
      capitalReserved, capitalSpent, packagingStillNeeded, capitalStillNeeded,
      employeeCost, otherCost, adsTotal, deliveredTotal, cancelledTotal, revenueTotal,
      cashIn, cashOut, cashOnHand, net,
    };
  }, [weeks, legacy, ads, funds]);

  if (!unlocked) {
    const dots = Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className={`pin-dot ${i < pinInput.length ? 'filled' : ''}`} />
    ));
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
    return (
      <div className="gate">
        <div className="gate-card">
          <img src="https://cdn.shopify.com/s/files/1/0823/5171/8617/files/herjewels-logo.jpg?v=1784118069" alt="HerJewels" className="gate-mark" style={{objectFit:'cover'}}/>
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

  const TAB_LIST = ['dashboard', 'weeks', 'funds', 'performance', 'products', 'ads', 'settings'];

  return (
    <div>
      {dbError && <div className="banner">⚠ {dbError}</div>}
      <div className="header">
        <div className="brand">
          <img src="https://cdn.shopify.com/s/files/1/0823/5171/8617/files/herjewels-logo.jpg?v=1784118069" alt="HerJewels" className="brand-mark" style={{objectFit:'cover'}}/>
          <div><h1>HerJewels</h1><span>Money & Capital Tracker</span></div>
        </div>
        <div className="tabs desktop-tabs">
          {TAB_LIST.map(t => (
            <div key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </div>
          ))}
        </div>
      </div>
      <div className="body">
        {loading ? <div className="loading">Loading...</div> : (
          <>
            {tab === 'dashboard' && <Dashboard totals={totals} settings={settings} weeksCount={weeks.length} />}
            {tab === 'weeks' && <Weeks weeks={weeks} legacy={legacy} products={products} orders={orders} weekTotals={weekTotals} reload={loadAll} />}
            {tab === 'funds' && <Funds funds={funds} totals={totals} reload={loadAll} />}
            {tab === 'performance' && <Performance orders={orders} ads={ads} products={products} />}
            {tab === 'products' && <Products products={products} reload={loadAll} />}
            {tab === 'ads' && <Ads ads={ads} legacy={legacy} reload={loadAll} />}
            {tab === 'settings' && <Settings settings={settings} reload={loadAll} />}
          </>
        )}
        <div className="signature mono">shared with your employee &middot; saves to your own database</div>
      </div>
      <div className="bottom-nav">
        {TAB_LIST.map(t => (
          <div key={t} className={`bottom-nav-item ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </div>
        ))}
      </div>
    </div>
  );
}

function Dashboard({ totals: c, settings, weeksCount }) {
  const diff = (Number(settings.bank) || 0) - c.cashOnHand;
  const diffOk = Math.abs(diff) < 1;
  return (
    <>
      <div className="kpis">
        <div className="kpi accent"><div className="lbl">Cash In</div><div className="val">{money(c.cashIn)}</div></div>
        <div className="kpi"><div className="lbl">Cash Out</div><div className="val">{money(c.cashOut)}</div></div>
        <div className="kpi good"><div className="lbl">Cash On Hand</div><div className="val">{money(c.cashOnHand)}</div></div>
        <div className="kpi good"><div className="lbl">Net - truly spendable</div><div className="val">{money(c.net)}</div></div>
      </div>

      <div className="panel">
        <h2>Capital <small>money you need to rebuy stock</small></h2>
        <table className="tbl">
          <tbody>
            <tr><td>Accrued (from real orders, all-time)</td><td>{money(c.capitalAccrued)}</td></tr>
            <tr><td>Extra you've reserved</td><td>{money(c.capitalReserved)}</td></tr>
            <tr><td>Already spent on stock</td><td className="neg">-{money(c.capitalSpent)}</td></tr>
            <tr><td><b>STILL NEEDED</b></td><td><b>{money(c.capitalStillNeeded)}</b></td></tr>
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Packaging <small>money you need to rebuy boxes/supplies</small></h2>
        <table className="tbl">
          <tbody>
            <tr><td>Accrued (from real orders, all-time)</td><td>{money(c.packagingAccrued)}</td></tr>
            <tr><td>Extra you've reserved</td><td>{money(c.packagingReserved)}</td></tr>
            <tr><td>Already spent on packaging</td><td className="neg">-{money(c.packagingSpent)}</td></tr>
            <tr><td><b>STILL NEEDED</b></td><td><b>{money(c.packagingStillNeeded)}</b></td></tr>
          </tbody>
        </table>
        <div className="note">Log purchases in the Funds tab whenever you actually buy stock or packaging - this updates automatically.</div>
      </div>

      <div className="panel">
        <h2>Business, all-time <small>{c.deliveredTotal} delivered &middot; {c.cancelledTotal} cancelled &middot; {weeksCount} weeks logged</small></h2>
        <table className="tbl">
          <tbody>
            <tr><td>Revenue (Topspeed + prepaid, all-time)</td><td>{money(c.revenueTotal)}</td></tr>
            <tr><td>Your own money added</td><td>{money(c.injections)}</td></tr>
            <tr><td>Ads spent, all-time</td><td className="neg">-{money(c.adsTotal)}</td></tr>
            <tr><td>Employee wages</td><td className="neg">-{money(c.employeeCost)}</td></tr>
            <tr><td>Other expenses</td><td className="neg">-{money(c.otherCost)}</td></tr>
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

function Weeks({ weeks, legacy, products, orders, weekTotals, reload }) {
  const [expanded, setExpanded] = useState({});
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [label, setLabel] = useState('');
  const [date, setDate] = useState(todayStr());
  const [delivered, setDelivered] = useState('');
  const [cancelled, setCancelled] = useState('');
  const [revenueCod, setRevenueCod] = useState('');
  const [filter, setFilter] = useState('');
  const [qty, setQty] = useState({}); // productId -> {cod, paid}
  const [saving, setSaving] = useState(false);
  const [trackingCod, setTrackingCod] = useState('');
  const [trackingPaid, setTrackingPaid] = useState('');
  const [looking, setLooking] = useState(false);
  const [lookupResult, setLookupResult] = useState(null);
  const [matchedOrders, setMatchedOrders] = useState([]); // {..., isPaidBox: true/false}

  const filtered = products.filter(p =>
    !filter || (p.name + ' ' + (p.variant || '')).toLowerCase().includes(filter.toLowerCase())
  );

  const liveCapital = useMemo(() => {
    let capital = 0;
    products.forEach(p => {
      const q = qty[p.id] || {};
      capital += ((Number(q.cod) || 0) + (Number(q.paid) || 0)) * Number(p.cost);
    });
    return capital;
  }, [qty, products]);

  const livePaidRevenue = useMemo(() => {
    return matchedOrders.filter(o => o.isPaidBox).reduce((s, o) => s + o.total, 0);
  }, [matchedOrders]);

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

  function startAdd() {
    setAdding(true); setEditingId(null);
    setLabel(''); setDate(todayStr()); setDelivered(''); setCancelled('');
    setRevenueCod(''); setFilter(''); setQty({});
    setTrackingCod(''); setTrackingPaid(''); setLookupResult(null); setMatchedOrders([]);
  }

  function startEditWeek(w) {
    setAdding(true); setEditingId(w.id);
    setLabel(w.label); setDate(w.week_date);
    setDelivered(String(w.delivered ?? '')); setCancelled(String(w.cancelled ?? ''));
    setRevenueCod(String(w.revenue_cod ?? ''));
    setFilter('');
    const q = {};
    (w.items || []).forEach(it => { q[it.product_id] = { cod: it.qty_cod || '', paid: it.qty_paid || '' }; });
    setQty(q);
    const savedOrders = orders.filter(o => o.week_id === w.id);
    setTrackingCod(savedOrders.filter(o => o.kind === 'topspeed').map(o => o.tracking_number).filter(Boolean).join('\n'));
    setTrackingPaid(savedOrders.filter(o => o.kind === 'prepaid').map(o => o.tracking_number).filter(Boolean).join('\n'));
    setLookupResult(null); setMatchedOrders([]); // re-run "Look up" to refresh order records if you change anything
    setExpanded(e => ({ ...e, [w.id]: false }));
  }

  async function lookupTracking() {
    const codList = trackingCod.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    const paidList = trackingPaid.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    const all = [...codList, ...paidList];
    if (!all.length) return;
    setLooking(true);
    setLookupResult(null);
    try {
      const res = await fetch('/api/shopify-lookup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingNumbers: all }),
      });
      const data = await res.json();
      if (data.error) { alert('Lookup failed: ' + data.error); setLooking(false); return; }

      const codSet = new Set(codList.map(t => t.replace(/\s+/g, '').toUpperCase()));
      const paidSet = new Set(paidList.map(t => t.replace(/\s+/g, '').toUpperCase()));

      const newQty = { ...qty };
      let unmatchedProducts = new Set();
      const withClassification = data.matched.map(order => {
        const normTrack = (order.trackingNumber || '').replace(/\s+/g, '').toUpperCase();
        const isPaidBox = paidSet.has(normTrack) && !codSet.has(normTrack);
        order.lineItems.forEach(li => {
          const p = matchProduct(li.title, li.variant);
          if (!p) { unmatchedProducts.add(li.title + (li.variant ? ' - ' + li.variant : '')); return; }
          const key = isPaidBox ? 'paid' : 'cod';
          const existing = newQty[p.id] || {};
          newQty[p.id] = { ...existing, [key]: (Number(existing[key]) || 0) + li.quantity };
        });
        return { ...order, isPaidBox };
      });
      setQty(newQty);
      setMatchedOrders(withClassification);
      setLookupResult({
        matchedCount: data.matched.length,
        codCount: withClassification.filter(o => !o.isPaidBox).length,
        paidCount: withClassification.filter(o => o.isPaidBox).length,
        notFound: data.notFound,
        unmatchedProducts: [...unmatchedProducts],
      });
    } catch (err) {
      alert('Lookup failed: ' + err.message);
    }
    setLooking(false);
  }

  async function saveWeek() {
    setSaving(true);
    try {
      const paidRevenue = matchedOrders.filter(o => o.isPaidBox).reduce((s, o) => s + o.total, 0);
      const paidOrderCount = matchedOrders.filter(o => o.isPaidBox).length;

      const payload = {
        label: label || `Week ${date}`, week_date: date, kind: 'topspeed',
        delivered: Number(delivered) || 0, cancelled: Number(cancelled) || 0,
        revenue_cod: Number(revenueCod) || 0, revenue_paid: paidRevenue, paid_orders: paidOrderCount,
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

      // Only touch saved order records if a fresh lookup ran this session -
      // editing other fields (like Delivered count) must never wipe them out.
      if (matchedOrders.length) {
        await supabase.from('orders').delete().eq('week_id', weekId);

        const codMatched = matchedOrders.filter(o => !o.isPaidBox);
        const grossCod = codMatched.reduce((s, o) => s + o.total, 0);
        const netCod = Number(revenueCod) || 0;
        let avgFee = codMatched.length ? (grossCod - netCod) / codMatched.length : 3.5;
        if (!isFinite(avgFee) || avgFee < 0 || avgFee > 6) avgFee = 3.5;

        const orderRows = matchedOrders.map(o => {
          let capital = 0;
          o.lineItems.forEach(li => {
            const p = matchProduct(li.title, li.variant);
            if (p) capital += li.quantity * p.cost;
          });
          return {
            order_name: o.name, tracking_number: o.trackingNumber,
            placed_at: (o.createdAt || '').slice(0, 10) || date,
            total: o.total, capital, fee: o.isPaidBox ? 0 : avgFee,
            kind: o.isPaidBox ? 'prepaid' : 'topspeed', week_id: weekId,
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
      <h2>Weeks <small>one entry per Topspeed paper - COD and already-paid orders together, exactly like the real paper</small></h2>
      <table className="tbl">
        <thead>
          <tr><th>Week</th><th>Delivered</th><th>Cancelled</th><th>Revenue</th><th>Cash - Topspeed</th><th>Cash - Prepaid</th><th>Capital</th><th>Packaging</th><th></th></tr>
        </thead>
        <tbody>
          {legacy.map(b => (
            <tr key={'lg' + b.id} style={{ opacity: .65 }}>
              <td>{b.label} <span className="mini">(legacy)</span></td>
              <td>{b.delivered}</td><td>{b.cancelled}</td>
              <td>{money(b.revenue)}</td><td>{money(b.revenue)}</td><td>$0.00</td><td>{money(b.capital)}</td><td>-</td><td></td>
            </tr>
          ))}
          {weeks.map(w => {
            const t = weekTotals(w);
            const isOpen = expanded[w.id];
            const nonZero = (w.items || []).filter(it => it.qty_cod > 0 || it.qty_paid > 0);
            return (
              <>
                <tr key={w.id}>
                  <td>
                    <button className="expand" onClick={() => setExpanded(e => ({ ...e, [w.id]: !e[w.id] }))}>{isOpen ? '▾' : '▸'}</button>
                    {w.label} <span className="mini">({w.week_date})</span>
                  </td>
                  <td>{w.delivered}</td><td>{w.cancelled}</td>
                  <td>{money(t.revenue)}</td><td>{money(t.cashTopspeed)}</td><td>{money(t.cashPaid)}</td><td>{money(t.capital)}</td><td>{money(t.packaging)}</td>
                  <td>
                    <button className="expand" onClick={() => startEditWeek(w)}>Edit</button>
                    <button className="del" onClick={() => deleteWeek(w.id)}>✕</button>
                  </td>
                </tr>
                {isOpen && (
                  <tr><td colSpan={9}>
                    <div className="week-detail">
                      {nonZero.length ? nonZero.map((it, idx) => {
                        const p = products.find(pp => pp.id === it.product_id);
                        return (
                          <div key={idx} className="mini">
                            {p ? p.name + (p.variant ? ' - ' + p.variant : '') : 'Unknown product'}:
                            {' '}COD <b>{it.qty_cod}</b> &middot; Already paid <b>{it.qty_paid}</b> &middot; capital {money((it.qty_cod + it.qty_paid) * it.unit_cost)}
                          </div>
                        );
                      }) : <div className="mini">No products logged.</div>}
                      <div className="mini" style={{marginTop:8,paddingTop:8,borderTop:'1px dashed var(--line)'}}>
                        COD tracking: {orders.filter(o => o.week_id === w.id && o.kind === 'topspeed').map(o => o.tracking_number).filter(Boolean).join(', ') || 'none'}
                      </div>
                      <div className="mini">
                        Already-paid tracking: {orders.filter(o => o.week_id === w.id && o.kind === 'prepaid').map(o => o.tracking_number).filter(Boolean).join(', ') || 'none'}
                      </div>
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
            <div className="field"><label>Paper date - Dashboard filters by THIS</label><input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ border: '2px solid var(--gold)' }} /></div>
            <div className="field"><label>Delivered orders (COD)</label><input type="number" value={delivered} onChange={e => setDelivered(e.target.value)} /></div>
            <div className="field"><label>Cancelled orders</label><input type="number" value={cancelled} onChange={e => setCancelled(e.target.value)} /></div>
          </div>
          <div className="newweek-grid">
            <div className="field"><label>Revenue - COD (Topspeed's "Amount To Be Paid", already net)</label><input type="number" step="0.01" value={revenueCod} onChange={e => setRevenueCod(e.target.value)} /></div>
          </div>
          <div className="note" style={{ marginBottom: 10 }}>Revenue - Paid calculates itself below, from the real Shopify totals of whatever you paste into the second box.</div>

          <div className="week-detail" style={{ background: '#f4f0e2', marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>
              COD tracking numbers - orders Topspeed is collecting cash for
            </label>
            <textarea
              value={trackingCod}
              onChange={e => setTrackingCod(e.target.value)}
              rows={3}
              style={{ width: '100%', padding: 8, border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5, fontFamily: 'IBM Plex Mono, monospace', marginBottom: 12 }}
              placeholder={'SS0033487 34\nSS0033487 33\n...'}
            />
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>
              Already-paid tracking numbers - Whish/manual, no fee, cash already in your account
            </label>
            <textarea
              value={trackingPaid}
              onChange={e => setTrackingPaid(e.target.value)}
              rows={2}
              style={{ width: '100%', padding: 8, border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5, fontFamily: 'IBM Plex Mono, monospace' }}
              placeholder={'SS0033487 21'}
            />
            <div style={{ marginTop: 8 }}>
              <button className="btn gold" onClick={lookupTracking} disabled={looking}>{looking ? 'Looking up...' : 'Look up in Shopify'}</button>
            </div>
            {lookupResult && (
              <div className="note" style={{ marginTop: 8 }}>
                Matched {lookupResult.matchedCount} orders - {lookupResult.codCount} COD, {lookupResult.paidCount} already paid. Product quantities filled in below.
                {lookupResult.notFound.length > 0 && (
                  <div style={{ color: 'var(--bad)', marginTop: 4 }}>
                    Not found ({lookupResult.notFound.length}): {lookupResult.notFound.join(', ')}
                  </div>
                )}
                {lookupResult.unmatchedProducts.length > 0 && (
                  <div style={{ color: 'var(--warn)', marginTop: 4 }}>
                    Product not in your Products tab: {lookupResult.unmatchedProducts.join(', ')}
                  </div>
                )}
              </div>
            )}
          </div>

          <input className="search" placeholder="Search a product..." value={filter} onChange={e => setFilter(e.target.value)} />
          <div className="qtyhead"><div>Product</div><div>COD</div><div>Paid</div><div>Capital</div></div>
          <div className="qtygrid">
            {filtered.map(p => {
              const q = qty[p.id] || {};
              const lineCap = ((Number(q.cod) || 0) + (Number(q.paid) || 0)) * p.cost;
              return (
                <div key={p.id} className="qtyrow">
                  <div><span className="pname">{p.name}</span>{p.variant ? <span className="pvariant"> - {p.variant}</span> : null}</div>
                  <input type="number" min="0" value={q.cod || ''} onChange={e => setQty(s => ({ ...s, [p.id]: { ...s[p.id], cod: e.target.value } }))} />
                  <input type="number" min="0" value={q.paid || ''} onChange={e => setQty(s => ({ ...s, [p.id]: { ...s[p.id], paid: e.target.value } }))} />
                  <div className="lineval">{money(lineCap)}</div>
                </div>
              );
            })}
          </div>
          <div className="livebar"><span>Revenue: <b>{money((Number(revenueCod) || 0) + livePaidRevenue)}</b></span><span>Capital: <b>{money(liveCapital)}</b></span></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn gold" onClick={saveWeek} disabled={saving}>{saving ? 'Saving...' : editingId ? 'Update week' : 'Save week'}</button>
            <button className="btn ghost2" onClick={() => { setAdding(false); setEditingId(null); }}>Cancel</button>
          </div>
          <div className="note">One paper, one entry. COD gets a delivery fee deducted automatically; already-paid does not.</div>
        </div>
      )}
    </div>
  );
}

function Funds({ funds, totals, reload }) {
  const [fund, setFund] = useState('packaging');
  const [type, setType] = useState('spend');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayStr());
  const [editing, setEditing] = useState({}); // id -> {type, label, amount, entry_date}

  const fundList = {
    packaging: { title: 'Packaging', accrued: totals.packagingAccrued, reserved: totals.packagingReserved, spent: totals.packagingSpent, needed: totals.packagingStillNeeded, hasReserve: true },
    capital: { title: 'Capital (stock)', accrued: totals.capitalAccrued, reserved: totals.capitalReserved, spent: totals.capitalSpent, needed: totals.capitalStillNeeded, hasReserve: true },
    employee: { title: 'Employee wages', spent: totals.employeeCost, hasReserve: false },
    other: { title: 'Other expenses', spent: totals.otherCost, hasReserve: false },
    injection: { title: 'Your own money added', spent: totals.injections, hasReserve: false, isIncome: true },
  };

  async function addEntry() {
    if (!amount) return;
    const finalType = fund === 'injection' ? 'add' : (fundList[fund].hasReserve ? type : 'spend');
    const finalLabel = label || `${fundList[fund].title}, ${date}`;
    const { error } = await supabase.from('fund_entries').insert({
      fund, type: finalType, label: finalLabel, amount: Number(amount), entry_date: date,
    });
    if (error) { alert('Could not add: ' + error.message); return; }
    setLabel(''); setAmount('');
    await reload();
  }
  async function deleteEntry(id) {
    if (!confirm('Delete this entry? This cannot be undone.')) return;
    await supabase.from('fund_entries').delete().eq('id', id);
    await reload();
  }
  function startEdit(f) {
    setEditing(e => ({ ...e, [f.id]: { type: f.type, label: f.label, amount: f.amount, entry_date: f.entry_date } }));
  }
  async function saveEdit(id, hasReserve) {
    const v = editing[id];
    const { error } = await supabase.from('fund_entries').update({
      type: hasReserve ? v.type : v.type, label: v.label, amount: Number(v.amount) || 0, entry_date: v.entry_date,
    }).eq('id', id);
    if (error) { alert('Could not save: ' + error.message); return; }
    setEditing(e => { const c = { ...e }; delete c[id]; return c; });
    await reload();
  }

  return (
    <>
      <div className="panel">
        <h2>Funds <small>log a purchase whenever you spend on stock or packaging - or set money aside ahead of time</small></h2>
        <div className="kpis" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 18 }}>
          <div className="kpi warn"><div className="lbl">Capital still needed</div><div className="val">{money(totals.capitalStillNeeded)}</div></div>
          <div className="kpi warn"><div className="lbl">Packaging still needed</div><div className="val">{money(totals.packagingStillNeeded)}</div></div>
        </div>

        <div className="newweek-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr auto' }}>
          <div className="field">
            <label>Fund</label>
            <select value={fund} onChange={e => setFund(e.target.value)} style={{width:'100%',padding:'8px 9px',border:'1px solid var(--line)',borderRadius:8,fontSize:13,background:'#fbfaf6'}}>
              <option value="packaging">Packaging</option>
              <option value="capital">Capital (stock)</option>
              <option value="employee">Employee wages</option>
              <option value="other">Other expense</option>
              <option value="injection">Your own money added</option>
            </select>
          </div>
          {fundList[fund].hasReserve && (
            <div className="field">
              <label>Type</label>
              <select value={type} onChange={e => setType(e.target.value)} style={{width:'100%',padding:'8px 9px',border:'1px solid var(--line)',borderRadius:8,fontSize:13,background:'#fbfaf6'}}>
                <option value="spend">Spent (bought it)</option>
                <option value="reserve">Reserve (set aside)</option>
              </select>
            </div>
          )}
          <div className="field"><label>Note</label><input value={label} onChange={e => setLabel(e.target.value)} placeholder="optional" /></div>
          <div className="field"><label>Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div className="field"><label>Amount $</label><input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></div>
          <button className="btn gold" onClick={addEntry}>Add</button>
        </div>
      </div>

      {Object.entries(fundList).map(([key, info]) => {
        const entries = funds.filter(f => f.fund === key);
        if (!entries.length && info.hasReserve === false) return null;
        return (
          <div className="panel" key={key}>
            <h2>{info.title}
              {info.hasReserve && <small>accrued {money(info.accrued)} + reserved {money(info.reserved)} - spent {money(info.spent)} = needed {money(info.needed)}</small>}
            </h2>
            <table className="tbl">
              <thead><tr><th>Date</th><th>Note</th>{info.hasReserve && <th>Type</th>}<th>Amount</th><th></th></tr></thead>
              <tbody>
                {entries.length === 0 && <tr><td colSpan={info.hasReserve ? 4 : 3} className="mini">No entries yet.</td></tr>}
                {entries.map(f => {
                  const ed = editing[f.id];
                  if (ed) {
                    return (
                      <tr key={f.id}>
                        <td><input type="date" value={ed.entry_date} onChange={e => setEditing(s => ({ ...s, [f.id]: { ...s[f.id], entry_date: e.target.value } }))} style={{ minWidth: 130 }} /></td>
                        <td><input value={ed.label} onChange={e => setEditing(s => ({ ...s, [f.id]: { ...s[f.id], label: e.target.value } }))} style={{ width: '100%' }} /></td>
                        {info.hasReserve && (
                          <td>
                            <select value={ed.type} onChange={e => setEditing(s => ({ ...s, [f.id]: { ...s[f.id], type: e.target.value } }))} style={{ width: '100%', padding: '4px 6px' }}>
                              <option value="spend">Spent</option>
                              <option value="reserve">Reserved</option>
                            </select>
                          </td>
                        )}
                        <td><input type="number" step="0.01" value={ed.amount} onChange={e => setEditing(s => ({ ...s, [f.id]: { ...s[f.id], amount: e.target.value } }))} style={{ width: 80 }} /></td>
                        <td>
                          <button className="btn gold" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => saveEdit(f.id, info.hasReserve)}>Save</button>
                          <button className="expand" onClick={() => setEditing(e => { const c = { ...e }; delete c[f.id]; return c; })}>Cancel</button>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={f.id}>
                      <td>{f.entry_date}</td><td>{f.label}</td>
                      {info.hasReserve && <td>{f.type === 'reserve' ? 'Reserved' : 'Spent'}</td>}
                      <td>{money(f.amount)}</td>
                      <td>
                        <button className="expand" onClick={() => startEdit(f)}>Edit</button>
                        <button className="del" onClick={() => deleteEntry(f.id)}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
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
  const [metaAmount, setMetaAmount] = useState('');
  const [tiktokAmount, setTiktokAmount] = useState('');
  const [otherAmount, setOtherAmount] = useState('');
  const [date, setDate] = useState(todayStr());
  const [editing, setEditing] = useState({}); // id -> {ad_date, label, amount}

  async function addAd() {
    const meta = Number(metaAmount) || 0, tiktok = Number(tiktokAmount) || 0, other = Number(otherAmount) || 0;
    const total = meta + tiktok + other;
    if (total <= 0) return;
    const parts = [];
    if (meta) parts.push(`Meta $${meta.toFixed(2)}`);
    if (tiktok) parts.push(`TikTok $${tiktok.toFixed(2)}`);
    if (other) parts.push(`Other $${other.toFixed(2)}`);
    const { error } = await supabase.from('ads').insert({
      label: parts.join(' + '), amount: total, platform: 'Combined', ad_date: date, ad_date_to: date,
    });
    if (error) { alert('Could not add: ' + error.message); return; }
    setMetaAmount(''); setTiktokAmount(''); setOtherAmount('');
    await reload();
  }
  async function deleteAd(id) {
    if (!confirm('Delete this ad entry? This cannot be undone.')) return;
    await supabase.from('ads').delete().eq('id', id);
    await reload();
  }
  function startEdit(a) {
    setEditing(e => ({ ...e, [a.id]: { ad_date: a.ad_date, label: a.label, amount: a.amount } }));
  }
  async function saveEdit(id) {
    const v = editing[id];
    const { error } = await supabase.from('ads').update({
      ad_date: v.ad_date, label: v.label, amount: Number(v.amount) || 0, ad_date_to: v.ad_date,
    }).eq('id', id);
    if (error) { alert('Could not save: ' + error.message); return; }
    setEditing(e => { const c = { ...e }; delete c[id]; return c; });
    await reload();
  }

  return (
    <div className="panel">
      <h2>Ads <small>one row per day - Meta and TikTok combined into one total</small></h2>
      <table className="tbl">
        <thead><tr><th>Date</th><th>Breakdown</th><th>Total</th><th></th></tr></thead>
        <tbody>
          {legacy.filter(b => b.ads).map(b => (
            <tr key={'lg' + b.id} style={{ opacity: .65 }}><td>{b.label} <span className="mini">(legacy)</span></td><td>-</td><td>{money(b.ads)}</td><td></td></tr>
          ))}
          {ads.map(a => {
            const ed = editing[a.id];
            return ed ? (
              <tr key={a.id}>
                <td><input type="date" value={ed.ad_date} onChange={e => setEditing(s => ({ ...s, [a.id]: { ...s[a.id], ad_date: e.target.value } }))} style={{ minWidth: 130 }} /></td>
                <td><input value={ed.label} onChange={e => setEditing(s => ({ ...s, [a.id]: { ...s[a.id], label: e.target.value } }))} style={{ width: '100%' }} /></td>
                <td><input type="number" step="0.01" value={ed.amount} onChange={e => setEditing(s => ({ ...s, [a.id]: { ...s[a.id], amount: e.target.value } }))} style={{ width: 80 }} /></td>
                <td>
                  <button className="btn gold" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => saveEdit(a.id)}>Save</button>
                  <button className="expand" onClick={() => setEditing(e => { const c = { ...e }; delete c[a.id]; return c; })}>Cancel</button>
                </td>
              </tr>
            ) : (
              <tr key={a.id}>
                <td>{a.ad_date}</td><td className="mini">{a.label}</td><td>{money(a.amount)}</td>
                <td>
                  <button className="expand" onClick={() => startEdit(a)}>Edit</button>
                  <button className="del" onClick={() => deleteAd(a.id)}>✕</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="newweek-grid" style={{ marginTop: 14, gridTemplateColumns: '1fr 1fr 1fr 1fr auto' }}>
        <div className="field"><label>Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div className="field"><label>Meta $</label><input type="number" step="0.01" value={metaAmount} onChange={e => setMetaAmount(e.target.value)} /></div>
        <div className="field"><label>TikTok $</label><input type="number" step="0.01" value={tiktokAmount} onChange={e => setTiktokAmount(e.target.value)} /></div>
        <div className="field"><label>Other $</label><input type="number" step="0.01" value={otherAmount} onChange={e => setOtherAmount(e.target.value)} /></div>
        <button className="btn gold" onClick={addAd}>Add</button>
      </div>
      <div className="note">Leave a field blank/0 if you didn't spend there that day. One combined total gets saved for the date.</div>
    </div>
  );
}

function Performance({ orders, ads, products }) {
  const earliest = orders.length ? orders.map(o => o.placed_at).reduce((a, b) => (a < b ? a : b)) : todayStr();
  const [from, setFrom] = useState(earliest);
  const [to, setTo] = useState(todayStr());
  const [showOrders, setShowOrders] = useState(false);
  const [allOrders, setAllOrders] = useState(null);
  const [loadingAll, setLoadingAll] = useState(false);
  const [allErr, setAllErr] = useState('');

  const filteredAds = ads.filter(a => a.ad_date >= from && a.ad_date <= to);
  const adSpend = filteredAds.reduce((s, a) => s + Number(a.amount), 0);

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

  useEffect(() => {
    loadAllOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  async function loadAllOrders() {
    setLoadingAll(true); setAllErr(''); setAllOrders(null);
    try {
      const res = await fetch('/api/shopify-orders-range', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromDate: from, toDate: to }),
      });
      const data = await res.json();
      if (data.error) { setAllErr(data.error); setLoadingAll(false); return; }

      const loggedMap = {};
      orders.forEach(o => { loggedMap[o.order_name] = o; });

      const classified = data.orders.map(o => {
        const logged = loggedMap[o.name];
        let capital = 0;
        (o.lineItems || []).forEach(li => {
          const p = matchProduct(li.title, li.variant);
          if (p) capital += li.quantity * p.cost;
        });
        let status, fee, isReal;
        if (logged && logged.kind === 'prepaid') { status = 'Collected - Prepaid'; fee = 0; isReal = true; capital = Number(logged.capital); }
        else if (logged) { status = 'Collected - Topspeed'; fee = Number(logged.fee || 0); isReal = true; capital = Number(logged.capital); }
        else { status = 'Pending'; fee = 3.5; isReal = false; } // real capital (from real Shopify items), estimated fee only
        return { ...o, status, capital, fee, isReal };
      });
      setAllOrders(classified);
    } catch (err) {
      setAllErr(err.message);
    }
    setLoadingAll(false);
  }

  const pending = allOrders ? allOrders.filter(o => o.status === 'Pending') : [];
  const collected = allOrders ? allOrders.filter(o => o.status !== 'Pending') : [];
  const collectedValue = collected.reduce((s, o) => s + o.total, 0);
  const pendingValue = pending.reduce((s, o) => s + o.total, 0);
  const totalOrderValue = allOrders ? allOrders.reduce((s, o) => s + o.total, 0) : 0;
  const totalCapital = allOrders ? allOrders.reduce((s, o) => s + o.capital, 0) : 0;
  const totalFees = allOrders ? allOrders.reduce((s, o) => s + o.fee, 0) : 0;
  const packaging = allOrders ? allOrders.length * 1 : 0;
  const netRevenue = totalOrderValue - totalFees;
  const estimatedProfit = netRevenue - totalCapital - packaging - adSpend;
  const collectedCount = allOrders ? allOrders.filter(o => o.isReal).length : 0;

  return (
    <>
      <div className="daterange">
        <div className="field"><label>Orders placed from</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ border: '2px solid var(--gold)' }} /></div>
        <div className="field"><label>to</label><input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ border: '2px solid var(--gold)' }} /></div>
        <div className="mini" style={{ paddingBottom: 9 }}>By the date each order was PLACED - includes pending orders too</div>
      </div>

      {loadingAll && <div className="loading">Checking Shopify...</div>}
      {allErr && <div className="flag">{allErr}</div>}

      {allOrders && (
        <>
          <div className="kpis">
            <div className="kpi accent"><div className="lbl">Total order value</div><div className="val">{money(totalOrderValue)}</div></div>
            <div className="kpi good"><div className="lbl">Collected ({collected.length})</div><div className="val">{money(collectedValue)}</div></div>
            <div className="kpi warn"><div className="lbl">Pending ({pending.length})</div><div className="val">{money(pendingValue)}</div></div>
            <div className="kpi warn"><div className="lbl">Ad spend, these days</div><div className="val">{money(adSpend)}</div></div>
            <div className={`kpi ${estimatedProfit >= 0 ? 'good' : 'bad'}`}><div className="lbl">Real profit here</div><div className="val">{money(estimatedProfit)}</div></div>
          </div>

          <div className="panel">
            <h2>Full picture, this window <small>{allOrders.length} orders - {collectedCount} confirmed, {pending.length} pending</small></h2>
            <table className="tbl">
              <tbody>
                <tr><td>Gross order value (all orders)</td><td>{money(totalOrderValue)}</td></tr>
                <tr><td>Topspeed delivery fees (real where collected, ~$3.50 estimated for pending)</td><td className="neg">-{money(totalFees)}</td></tr>
                <tr><td><b>Net revenue</b></td><td><b>{money(netRevenue)}</b></td></tr>
                <tr><td>&nbsp;</td><td></td></tr>
                <tr><td>Product capital (real, from actual products sold)</td><td className="neg">-{money(totalCapital)}</td></tr>
                <tr><td>Packaging ({allOrders.length} x $1)</td><td className="neg">-{money(packaging)}</td></tr>
                <tr><td>Ad spend</td><td className="neg">-{money(adSpend)}</td></tr>
                <tr><td><b>REAL PROFIT</b></td><td><b>{money(estimatedProfit)}</b></td></tr>
              </tbody>
            </table>
            <div className="note" style={{ marginTop: 10 }}>
              Capital is exact for every order, collected or not - real products, real costs. Only the delivery fee for {pending.length} still-pending orders is an estimate (~$3.50/order), since Topspeed hasn't reported the real fee yet.
            </div>
          </div>
        </>
      )}

      <div className="panel">
        <h2>Orders <small>{allOrders ? `${allOrders.length} total` : ''}</small></h2>
        {!showOrders ? (
          <button className="btn ghost2" onClick={() => setShowOrders(true)} disabled={!allOrders}>Show all orders</button>
        ) : (
          <>
            <table className="tbl">
              <thead><tr><th>Order</th><th>Placed</th><th>Total</th><th>Capital</th><th>Status</th></tr></thead>
              <tbody>
                {allOrders && [...allOrders].sort((a, b) => (a.status === 'Pending' ? -1 : 1) - (b.status === 'Pending' ? -1 : 1)).map(o => (
                  <tr key={o.name}>
                    <td>{o.name}</td><td>{o.placedAt}</td><td>{money(o.total)}</td><td>{money(o.capital)}</td>
                    <td style={{ color: o.status === 'Pending' ? 'var(--bad)' : 'var(--good)', fontWeight: 700 }}>{o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="btn ghost2" style={{ marginTop: 10 }} onClick={() => setShowOrders(false)}>Hide</button>
          </>
        )}
      </div>

      <div className="panel">
        <h2>Ad spend, this window <small>{filteredAds.length} days logged</small></h2>
        <table className="tbl">
          <tbody>
            {filteredAds.length === 0 && <tr><td colSpan={2} className="mini">No ads logged for this window.</td></tr>}
            {filteredAds.map(a => (
              <tr key={a.id}><td>{a.ad_date} <span className="mini">({a.label})</span></td><td>{money(a.amount)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Settings({ settings, reload }) {
  const [form, setForm] = useState(settings);
  useEffect(() => setForm(settings), [settings]);

  async function save() {
    const { error } = await supabase.from('settings').update({
      bank: Number(form.bank) || 0,
    }).eq('id', 1);
    if (error) { alert('Could not save: ' + error.message); return; }
    await reload();
  }

  return (
    <div className="panel">
      <h2>Bank</h2>
      <div className="settings-grid" style={{ gridTemplateColumns: '1fr' }}>
        <div className="field"><label>Real bank balance</label><input type="number" step="0.01" value={form.bank} onChange={e => setForm(s => ({ ...s, bank: e.target.value }))} /></div>
      </div>
      <div style={{ marginTop: 16 }}><button className="btn gold" onClick={save}>Save</button></div>
      <div className="note">Employee wages, stock purchases, and other expenses now live in the Funds tab.</div>
    </div>
  );
}
