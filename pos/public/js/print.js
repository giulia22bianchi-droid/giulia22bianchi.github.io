import { state, money, qtyFmt, dateFmt } from './ui.js';
import { code128Svg } from './code128.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const TITLES = { sale: 'SCONTRINO', invoice: 'FATTURA', refund: 'NOTA DI RESO', purchase: 'ACQUISTO', adjustment: 'RETTIFICA MAGAZZINO' };
export const DOC_LABELS = { sale: 'Vendita', invoice: 'Fattura', refund: 'Reso', purchase: 'Acquisto', adjustment: 'Rettifica' };

function printHtml(html) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.append(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();
  // Lascia il tempo di disegnare gli SVG prima di stampare
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 1500);
  }, 150);
}

function taxBreakdown(doc) {
  const map = new Map();
  for (const it of doc.items) {
    const row = map.get(it.tax_rate) || { rate: it.tax_rate, net: 0, tax: 0 };
    row.net += it.net;
    row.tax += it.tax;
    map.set(it.tax_rate, row);
  }
  return [...map.values()].sort((a, b) => b.rate - a.rate);
}

export function receiptHtml(doc) {
  const s = state.settings;
  const sign = doc.type === 'refund' ? '-' : '';
  const lines = doc.items.map((it) => `
    <tr><td colspan="2">${esc(it.name)}</td></tr>
    <tr><td class="sub">${qtyFmt(it.qty)} × ${money(it.price)}${it.discount_pct ? ` (-${it.discount_pct}%)` : ''}</td><td class="r">${money(it.total)}</td></tr>`).join('');
  const taxes = taxBreakdown(doc).map((t) => `<tr><td>IVA ${t.rate}% su ${money(t.net)}</td><td class="r">${money(t.tax)}</td></tr>`).join('');
  const pays = doc.payments.map((p) => `<tr><td>${esc(p.payment_type_name)}</td><td class="r">${money(p.amount)}</td></tr>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>${esc(doc.number || 'Scontrino')}</title>
<style>
  @page { size: 80mm auto; margin: 3mm; }
  body { font: 12px/1.35 'Courier New', monospace; width: 74mm; margin: 0 auto; color: #000; }
  h1 { font-size: 15px; text-align: center; margin: 0 0 2px; } .c { text-align: center; }
  table { width: 100%; border-collapse: collapse; } td { padding: 1px 0; vertical-align: top; } .r { text-align: right; white-space: nowrap; } .sub { padding-left: 8px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; } .tot td { font-size: 15px; font-weight: bold; }
</style>
<h1>${esc(s.company_name)}</h1>
<div class="c">${esc(s.company_address)}${s.company_tax_number ? `<br>P.IVA ${esc(s.company_tax_number)}` : ''}${s.company_phone ? `<br>Tel. ${esc(s.company_phone)}` : ''}</div>
${s.receipt_header ? `<div class="c">${esc(s.receipt_header).replace(/\n/g, '<br>')}</div>` : ''}
<hr><div class="c"><b>${TITLES[doc.type] || ''}</b> ${esc(doc.number || '')}</div>
<div class="c">${dateFmt(doc.completed_at || doc.created_at)} · ${esc(doc.user_name || '')}</div>
${doc.partner_name ? `<div class="c">Cliente: ${esc(doc.partner_name)}</div>` : ''}
${doc.ref_number ? `<div class="c">Rif. ${esc(doc.ref_number)}</div>` : ''}
<hr><table>${lines}</table><hr>
<table>
  ${doc.discount_total > 0 ? `<tr><td>Sconti</td><td class="r">-${money(doc.discount_total)}</td></tr>` : ''}
  <tr class="tot"><td>TOTALE</td><td class="r">${sign}${money(doc.total)}</td></tr>
  ${pays}
  ${doc.change_given > 0 ? `<tr><td>Resto</td><td class="r">${money(doc.change_given)}</td></tr>` : ''}
  ${doc.type === 'invoice' && doc.total - doc.paid > 0.004 ? `<tr><td>Da pagare</td><td class="r">${money(doc.total - doc.paid)}</td></tr>` : ''}
</table><hr><table>${taxes}</table>
${doc.note ? `<hr><div>${esc(doc.note)}</div>` : ''}
<hr><div class="c">${esc(s.receipt_footer).replace(/\n/g, '<br>')}</div><br>`;
}

export function invoiceHtml(doc) {
  const s = state.settings;
  const rows = doc.items.map((it, i) => `<tr><td>${i + 1}</td><td>${esc(it.name)}</td><td class="r">${qtyFmt(it.qty)}</td>
    <td class="r">${money(it.price)}</td><td class="r">${it.discount_pct ? it.discount_pct + '%' : ''}</td><td class="r">${it.tax_rate}%</td><td class="r">${money(it.total)}</td></tr>`).join('');
  const taxes = taxBreakdown(doc).map((t) => `<tr><td>${t.rate}%</td><td class="r">${money(t.net)}</td><td class="r">${money(t.tax)}</td></tr>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>${esc(doc.number || 'Documento')}</title>
<style>
  @page { size: A4; margin: 15mm; }
  body { font: 13px/1.4 system-ui, sans-serif; color: #111; }
  h1 { margin: 0; font-size: 24px; } .head { display: flex; justify-content: space-between; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; } th, td { padding: 6px 8px; border-bottom: 1px solid #ccc; text-align: left; }
  th { background: #f0f0f0; font-size: 11px; text-transform: uppercase; } .r { text-align: right; } .tot { font-size: 18px; font-weight: bold; }
  .box { border: 1px solid #ccc; padding: 10px; min-width: 240px; }
</style>
<div class="head"><div><h1>${esc(s.company_name)}</h1>${esc(s.company_address)}<br>${s.company_tax_number ? 'P.IVA ' + esc(s.company_tax_number) : ''} ${esc(s.company_phone)}</div>
<div class="box"><b>${TITLES[doc.type] || ''} ${esc(doc.number || '')}</b><br>Data: ${dateFmt(doc.completed_at || doc.created_at)}
${doc.ref_number ? `<br>Rif. ${esc(doc.ref_number)}` : ''}<br><br><b>${doc.type === 'purchase' ? 'Fornitore' : 'Cliente'}</b><br>
${esc(doc.partner_name || 'Cliente generico')}<br>${esc(doc.partner_address || '')} ${esc(doc.partner_city || '')}<br>${doc.partner_tax_number ? 'P.IVA/CF ' + esc(doc.partner_tax_number) : ''}</div></div>
<table><thead><tr><th>#</th><th>Descrizione</th><th class="r">Qtà</th><th class="r">Prezzo</th><th class="r">Sc.</th><th class="r">IVA</th><th class="r">Totale</th></tr></thead><tbody>${rows}</tbody></table>
<table style="width:55%;margin-left:auto"><thead><tr><th>Aliquota</th><th class="r">Imponibile</th><th class="r">Imposta</th></tr></thead><tbody>${taxes}</tbody></table>
<div class="r tot">Totale ${money(doc.total)}</div>
${doc.paid < doc.total - 0.004 ? `<div class="r">Pagato ${money(doc.paid)} · Residuo ${money(doc.total - doc.paid)}</div>` : '<div class="r">Pagato</div>'}
${doc.note ? `<p>${esc(doc.note)}</p>` : ''}<p>${esc(s.receipt_footer)}</p>`;
}

export function printDocument(doc) {
  printHtml(['invoice', 'purchase'].includes(doc.type) ? invoiceHtml(doc) : receiptHtml(doc));
}
export const printA4 = (doc) => printHtml(invoiceHtml(doc));

export function printShiftReport(r) {
  const s = state.settings;
  const rows = r.by_payment.map((p) => `<tr><td>${esc(p.name)}</td><td class="r">${money(p.sales)}</td><td class="r">${money(-p.refunds)}</td></tr>`).join('');
  printHtml(`<!doctype html><meta charset="utf-8"><title>Chiusura cassa</title>
<style>@page{size:80mm auto;margin:3mm} body{font:12px/1.4 'Courier New',monospace;width:74mm;margin:0 auto} table{width:100%;border-collapse:collapse} .r{text-align:right} hr{border:0;border-top:1px dashed #000} h1{font-size:15px;text-align:center;margin:0}</style>
<h1>${esc(s.company_name)}</h1><div style="text-align:center"><b>${r.shift.closed_at ? 'CHIUSURA CASSA (Z)' : 'LETTURA CASSA (X)'}</b><br>Turno #${r.shift.id} · ${esc(r.shift.user_name)}<br>
Apertura ${dateFmt(r.shift.opened_at)}${r.shift.closed_at ? `<br>Chiusura ${dateFmt(r.shift.closed_at)}` : ''}</div><hr>
<table><tr><td>Documenti</td><td class="r">${r.documents.count}</td></tr><tr><td>Venduto</td><td class="r">${money(r.documents.gross)}</td></tr>
<tr><td>Resi (${r.documents.refund_count})</td><td class="r">-${money(r.documents.refunded)}</td></tr><tr><td><b>Netto</b></td><td class="r"><b>${money(r.documents.net)}</b></td></tr>
<tr><td>di cui IVA</td><td class="r">${money(r.documents.tax)}</td></tr></table><hr>
<table><tr><td><b>Pagamenti</b></td><td class="r">Incassi</td><td class="r">Resi</td></tr>${rows}</table><hr>
<table><tr><td>Fondo iniziale</td><td class="r">${money(r.shift.opening_cash)}</td></tr><tr><td>Versamenti</td><td class="r">${money(r.cash_in)}</td></tr>
<tr><td>Prelievi</td><td class="r">-${money(r.cash_out)}</td></tr><tr><td><b>Contante atteso</b></td><td class="r"><b>${money(r.expected_cash)}</b></td></tr>
${r.shift.counted_cash !== null && r.shift.counted_cash !== undefined ? `<tr><td>Contante contato</td><td class="r">${money(r.shift.counted_cash)}</td></tr><tr><td>Differenza</td><td class="r">${money(r.shift.counted_cash - r.expected_cash)}</td></tr>` : ''}</table><br>`);
}

export function printLabels(products, perRow = 3) {
  const cells = products.flatMap((p) => Array.from({ length: p.copies || 1 }, () => `
    <div class="l"><div class="n">${esc(p.name)}</div>${p.barcode ? code128Svg(p.barcode, { height: 34 }) + `<div class="c">${esc(p.barcode)}</div>` : '<div class="c">(senza codice)</div>'}
    <div class="p">${money(p.price)}</div></div>`)).join('');
  printHtml(`<!doctype html><meta charset="utf-8"><title>Etichette</title>
<style>@page{size:A4;margin:8mm} body{margin:0;font:11px sans-serif} .g{display:grid;grid-template-columns:repeat(${perRow},1fr);gap:3mm}
.l{border:1px dashed #aaa;padding:3mm;text-align:center;break-inside:avoid} .n{font-weight:600;height:2.6em;overflow:hidden} svg{max-width:100%;height:auto} .c{font-size:10px;letter-spacing:.05em} .p{font-size:18px;font-weight:800}</style>
<div class="g">${cells}</div>`);
}
