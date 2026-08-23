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
             { data: lg, error: e4 }, { data: adRows, error: e5 }, { data: st, error: e6 }] =
        await Promise.all([
          supabase.from('products').select('*').order('name'),
          supabase.from('weeks').select('*').order('week_date', { ascending: false }),
          supabase.from('week_items').select('*'),
          supabase.from('legacy_batches').select('*'),
          supabase.from('ads').select('*').order('ad_date', { ascending: false }),
          supabase.from('settings').select('*').eq('id', 1).single(),
        ]);
      if (e1 || e2 || e3 || e4 || e5 || e6) throw (e1 || e2 || e3 || e4 || e5 || e6);

      const weeksWithItems = (wk || []).map(w => ({
        ...w,
        items: (items || []).filter(i => i.week_id === w.id),
      }));

      setProducts(prod || []);
      setWeeks(weeksWithItems);
      setLegacy(lg || []);
      setAds(adRows || []);
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
    ads.forEach(a => { if (inRange(a.ad_date)) adsTotal += Number(a.amount) || 0; });
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
          {['dashboard', 'weeks', 'products', 'ads', 'settings'].map(t => (
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
  const [expanded, setExpanded] = useState({});
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [date, setDate] = useState(todayStr());
  const [delivered, setDelivered] = useState('');
  const [cancelled, setCancelled] = useState('');
  const [revenueCod, setRevenueCod] = useState('');
  const [revenuePaid, setRevenuePaid] = useState('');
  const [paidOrders, setPaidOrders] = useState('');
  const [filter, setFilter] = useState('');
  const [qty, setQty] = useState({}); // productId -> {cod, paid}
  const [saving, setSaving] = useState(false);

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
    setAdding(true); setLabel(''); setDate(todayStr()); setDelivered(''); setCancelled('');
    setRevenueCod(''); setRevenuePaid(''); setPaidOrders(''); setFilter(''); setQty({});
  }

  async function saveWeek() {
    setSaving(true);
    try {
      const { data: weekRow, error: werr } = await supabase.from('weeks').insert({
        label: label || `Week ${date}`, week_date: date,
        delivered: Number(delivered) || 0, cancelled: Number(cancelled) || 0,
        revenue_cod: Number(revenueCod) || 0, revenue_paid: Number(revenuePaid) || 0,
        paid_orders: Number(paidOrders) || 0,
      }).select().single();
      if (werr) throw werr;

      const itemsToInsert = [];
      products.forEach(p => {
        const q = qty[p.id] || {};
        const cod = Number(q.cod) || 0, paid = Number(q.paid) || 0;
        if (cod > 0 || paid > 0) {
          itemsToInsert.push({
            week_id: weekRow.id, product_id: p.id,
            qty_cod: cod, qty_paid: paid,
            unit_price: p.price, unit_cost: p.cost,
          });
        }
      });
      if (itemsToInsert.length) {
        const { error: ierr } = await supabase.from('week_items').insert(itemsToInsert);
        if (ierr) throw ierr;
      }
      setAdding(false);
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
      <h2>Weeks <small>one row per Topspeed paper &middot; COD and already-paid quantities tracked separately per product</small></h2>
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
                  <td>{money(t.revenue)}</td><td>{money(t.cash)}</td><td>{money(t.capital)}</td><td>{money(t.packaging)}</td>
                  <td><button className="del" onClick={() => deleteWeek(w.id)}>✕</button></td>
                </tr>
                {isOpen && (
                  <tr><td colSpan={8}>
                    <div className="week-detail">
                      {nonZero.length ? nonZero.map((it, idx) => {
                        const p = products.find(pp => pp.id === it.product_id);
                        return (
                          <div key={idx} className="mini">
                            {p ? p.name + (p.variant ? ' - ' + p.variant : '') : 'Unknown product'}:
                            {' '}COD <b>{it.qty_cod}</b> &middot; Paid <b>{it.qty_paid}</b> &middot; capital {money((it.qty_cod + it.qty_paid) * it.unit_cost)}
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
            <div className="field"><label>Prepaid orders (Whish/manual)</label><input type="number" value={paidOrders} onChange={e => setPaidOrders(e.target.value)} /></div>
          </div>
          <div className="note" style={{marginBottom:10}}>Packaging cost is $1 per shipped order - delivered + prepaid, both need a box.</div>
          <div className="newweek-grid">
            <div className="field"><label>Revenue - COD (Topspeed's "Amount To Be Paid", already net)</label><input type="number" step="0.01" value={revenueCod} onChange={e => setRevenueCod(e.target.value)} /></div>
            <div className="field"><label>Revenue - Paid (real $ from Shopify)</label><input type="number" step="0.01" value={revenuePaid} onChange={e => setRevenuePaid(e.target.value)} /></div>
          </div>
          <div className="note" style={{ marginBottom: 10 }}>Type the exact "Amount To Be Paid" total from the paper's summary box - already net of Topspeed's delivery fee, no further deduction happens. The product grid below only sets Capital, not revenue.</div>
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
          <div className="livebar"><span>Revenue: <b>{money((Number(revenueCod) || 0) + (Number(revenuePaid) || 0))}</b></span><span>Capital: <b>{money(liveCapital)}</b></span></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn gold" onClick={saveWeek} disabled={saving}>{saving ? 'Saving...' : 'Save week'}</button>
            <button className="btn ghost2" onClick={() => setAdding(false)}>Cancel</button>
          </div>
          <div className="note">COD = delivered via Topspeed, charged the delivery fee. Paid = already paid online (Whish/manual), no delivery fee.</div>
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
  const [date, setDate] = useState(todayStr());

  async function addAd() {
    if (!label || !amount) return;
    const { error } = await supabase.from('ads').insert({ label, amount: Number(amount), ad_date: date });
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
      <h2>Ads <small>log spend on whatever schedule you check Meta/TikTok</small></h2>
      <table className="tbl">
        <thead><tr><th>Period</th><th>Amount</th><th></th></tr></thead>
        <tbody>
          {legacy.filter(b => b.ads).map(b => (
            <tr key={'lg' + b.id} style={{ opacity: .65 }}><td>{b.label} <span className="mini">(legacy)</span></td><td>{money(b.ads)}</td><td></td></tr>
          ))}
          {ads.map(a => (
            <tr key={a.id}><td>{a.label} <span className="mini">({a.ad_date})</span></td><td>{money(a.amount)}</td>
              <td><button className="del" onClick={() => deleteAd(a.id)}>✕</button></td></tr>
          ))}
        </tbody>
      </table>
      <div className="newweek-grid" style={{ marginTop: 14, gridTemplateColumns: '2fr 1fr 1fr auto' }}>
        <div className="field"><label>Period label</label><input value={label} onChange={e => setLabel(e.target.value)} placeholder="8-18 Aug, Meta + TikTok" /></div>
        <div className="field"><label>Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div className="field"><label>Amount $</label><input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></div>
        <button className="btn gold" onClick={addAd}>Add</button>
      </div>
      <div className="note">This total feeds Cash Out on the Dashboard, filtered by the same date range.</div>
    </div>
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
    return {
      revenue: revCod + revPaid, capital: capCod + capPaid,
      cashTopspeed: revCod, cashPaid: revPaid, cash: revCod + revPaid,
    };
  };

  const inRange = (dateStr) => {
    if (!dateStr) return true;
    return dateStr >= fromDate && dateStr <= toDate;
  };

  const totals = useMemo(() => {
    let topspeedCash = 0, capitalTotal = 0, deliveredTotal = 0, cancelledTotal = 0, revenueTotal = 0;
    weeks.forEach(w => {
      if (!inRange(w.week_date)) return;
      const t = weekTotals(w);
      topspeedCash += t.cash;
      capitalTotal += t.capital;
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
    ads.forEach(a => { if (inRange(a.ad_date)) adsTotal += Number(a.amount) || 0; });
    legacy.forEach(b => { adsTotal += Number(b.ads) || 0; });

    const cashIn = topspeedCash;
    const cashOut = adsTotal + (Number(settings.employee) || 0) + (Number(settings.stock) || 0) + (Number(settings.other) || 0);
    const cashOnHand = cashIn - cashOut;
    const net = cashOnHand - capitalTotal;
    return { topspeedCash, capitalTotal, adsTotal, deliveredTotal, cancelledTotal, revenueTotal, cashIn, cashOut, cashOnHand, net };
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
          {['dashboard', 'weeks', 'products', 'ads', 'settings'].map(t => (
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
  const [expanded, setExpanded] = useState({});
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [date, setDate] = useState(todayStr());
  const [delivered, setDelivered] = useState('');
  const [cancelled, setCancelled] = useState('');
  const [revenueCod, setRevenueCod] = useState('');
  const [revenuePaid, setRevenuePaid] = useState('');
  const [filter, setFilter] = useState('');
  const [qty, setQty] = useState({}); // productId -> {cod, paid}
  const [saving, setSaving] = useState(false);

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
    setAdding(true); setLabel(''); setDate(todayStr()); setDelivered(''); setCancelled('');
    setRevenueCod(''); setRevenuePaid(''); setFilter(''); setQty({});
  }

  async function saveWeek() {
    setSaving(true);
    try {
      const { data: weekRow, error: werr } = await supabase.from('weeks').insert({
        label: label || `Week ${date}`, week_date: date,
        delivered: Number(delivered) || 0, cancelled: Number(cancelled) || 0,
        revenue_cod: Number(revenueCod) || 0, revenue_paid: Number(revenuePaid) || 0,
      }).select().single();
      if (werr) throw werr;

      const itemsToInsert = [];
      products.forEach(p => {
        const q = qty[p.id] || {};
        const cod = Number(q.cod) || 0, paid = Number(q.paid) || 0;
        if (cod > 0 || paid > 0) {
          itemsToInsert.push({
            week_id: weekRow.id, product_id: p.id,
            qty_cod: cod, qty_paid: paid,
            unit_price: p.price, unit_cost: p.cost,
          });
        }
      });
      if (itemsToInsert.length) {
        const { error: ierr } = await supabase.from('week_items').insert(itemsToInsert);
        if (ierr) throw ierr;
      }
      setAdding(false);
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
      <h2>Weeks <small>one row per Topspeed paper &middot; COD and already-paid quantities tracked separately per product</small></h2>
      <table className="tbl">
        <thead>
          <tr><th>Week</th><th>Delivered</th><th>Cancelled</th><th>Revenue</th><th>Cash</th><th>Capital</th><th></th></tr>
        </thead>
        <tbody>
          {legacy.map(b => {
            const fee = (Number(b.delivered) || 0) * 3.4 + (Number(b.cancelled) || 0) * 4;
            return (
              <tr key={'lg' + b.id} style={{ opacity: .65 }}>
                <td>{b.label} <span className="mini">(legacy)</span></td>
                <td>{b.delivered}</td><td>{b.cancelled}</td>
                <td>{money(b.revenue)}</td><td>{money(b.revenue - fee)}</td><td>{money(b.capital)}</td><td></td>
              </tr>
            );
          })}
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
                  <td>{money(t.revenue)}</td><td>{money(t.cash)}</td><td>{money(t.capital)}</td>
                  <td><button className="del" onClick={() => deleteWeek(w.id)}>✕</button></td>
                </tr>
                {isOpen && (
                  <tr><td colSpan={7}>
                    <div className="week-detail">
                      {nonZero.length ? nonZero.map((it, idx) => {
                        const p = products.find(pp => pp.id === it.product_id);
                        return (
                          <div key={idx} className="mini">
                            {p ? p.name + (p.variant ? ' - ' + p.variant : '') : 'Unknown product'}:
                            {' '}COD <b>{it.qty_cod}</b> &middot; Paid <b>{it.qty_paid}</b> &middot; capital {money((it.qty_cod + it.qty_paid) * it.unit_cost)}
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
            <div className="field"><label>Delivered orders</label><input type="number" value={delivered} onChange={e => setDelivered(e.target.value)} /></div>
            <div className="field"><label>Cancelled orders</label><input type="number" value={cancelled} onChange={e => setCancelled(e.target.value)} /></div>
          </div>
          <div className="newweek-grid">
            <div className="field"><label>Revenue - COD (Topspeed's "Amount To Be Paid", already net)</label><input type="number" step="0.01" value={revenueCod} onChange={e => setRevenueCod(e.target.value)} /></div>
            <div className="field"><label>Revenue - Paid (real $ from Shopify)</label><input type="number" step="0.01" value={revenuePaid} onChange={e => setRevenuePaid(e.target.value)} /></div>
          </div>
          <div className="note" style={{ marginBottom: 10 }}>Type the exact "Amount To Be Paid" total from the paper's summary box - already net of Topspeed's delivery fee, no further deduction happens. The product grid below only sets Capital, not revenue.</div>
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
          <div className="livebar"><span>Revenue: <b>{money((Number(revenueCod) || 0) + (Number(revenuePaid) || 0))}</b></span><span>Capital: <b>{money(liveCapital)}</b></span></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn gold" onClick={saveWeek} disabled={saving}>{saving ? 'Saving...' : 'Save week'}</button>
            <button className="btn ghost2" onClick={() => setAdding(false)}>Cancel</button>
          </div>
          <div className="note">COD = delivered via Topspeed, charged the delivery fee. Paid = already paid online (Whish/manual), no delivery fee.</div>
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
  const [date, setDate] = useState(todayStr());

  async function addAd() {
    if (!label || !amount) return;
    const { error } = await supabase.from('ads').insert({ label, amount: Number(amount), ad_date: date });
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
      <h2>Ads <small>log spend on whatever schedule you check Meta/TikTok</small></h2>
      <table className="tbl">
        <thead><tr><th>Period</th><th>Amount</th><th></th></tr></thead>
        <tbody>
          {legacy.filter(b => b.ads).map(b => (
            <tr key={'lg' + b.id} style={{ opacity: .65 }}><td>{b.label} <span className="mini">(legacy)</span></td><td>{money(b.ads)}</td><td></td></tr>
          ))}
          {ads.map(a => (
            <tr key={a.id}><td>{a.label} <span className="mini">({a.ad_date})</span></td><td>{money(a.amount)}</td>
              <td><button className="del" onClick={() => deleteAd(a.id)}>✕</button></td></tr>
          ))}
        </tbody>
      </table>
      <div className="newweek-grid" style={{ marginTop: 14, gridTemplateColumns: '2fr 1fr 1fr auto' }}>
        <div className="field"><label>Period label</label><input value={label} onChange={e => setLabel(e.target.value)} placeholder="8-18 Aug, Meta + TikTok" /></div>
        <div className="field"><label>Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div className="field"><label>Amount $</label><input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></div>
        <button className="btn gold" onClick={addAd}>Add</button>
      </div>
      <div className="note">This total feeds Cash Out on the Dashboard, filtered by the same date range.</div>
    </div>
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
