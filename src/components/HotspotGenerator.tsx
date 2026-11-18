import React, { useState } from 'react';
import { Printer, RefreshCw, QrCode, TicketCheck, Wand2 } from 'lucide-react';
import { api, formatMoney } from '../lib/api';

interface Card {
  code: string;
  username: string;
  password: string;
  plan: string;
  price: number;
  batch: string;
}

export default function HotspotGenerator({ onToast, onDataChanged }: { onToast?: (m: string) => void; onDataChanged?: () => void }) {
  const [form, setForm] = useState({ plan: '1 Hora', quantity: 10, prefix: 'WH', batch: '', price: 1, pdv: '' });
  const [cards, setCards] = useState<Card[]>([]);
  const [busy, setBusy] = useState(false);
  const [withQr, setWithQr] = useState(true);

  const generate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res: any = await api.generateHotspotCards(form);
    setBusy(false);
    if (res.status === 'success') {
      setCards(res.rows || []);
      onToast?.(res.message);
      onDataChanged?.();
    } else {
      onToast?.(res.message || 'No se pudieron generar las fichas.');
    }
  };

  const printCards = () => {
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) {
      onToast?.('Habilita las ventanas emergentes para imprimir las fichas.');
      return;
    }
    const qr = (value: string) =>
      withQr
        ? `<img src="https://api.qrserver.com/v1/create-qr-code/?size=90x90&data=${encodeURIComponent(value)}" alt="QR" />`
        : '';
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Fichas HotSpot</title>
      <style>
        body{font-family:system-ui,sans-serif;margin:20px}
        .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
        .card{border:1.5px dashed #333;border-radius:10px;padding:10px;text-align:center;page-break-inside:avoid}
        .brand{font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase}
        .plan{font-size:13px;font-weight:700;margin:4px 0}
        .cred{font-family:ui-monospace,monospace;font-size:12px}
        .price{font-size:14px;font-weight:700;margin-top:6px}
      </style></head><body>
      <h2>Fichas HotSpot · ${form.plan} (${cards.length})</h2>
      <div class="grid">
      ${cards
        .map(
          (c) => `<div class="card">
            <div class="brand">Acceso Wi-Fi</div>
            <div class="plan">${form.plan}</div>
            ${qr(c.username)}
            <div class="cred">Usuario: <b>${c.username}</b></div>
            <div class="cred">Clave: <b>${c.password}</b></div>
            <div class="price">${formatMoney(c.price)}</div>
          </div>`
        )
        .join('')}
      </div></body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800 pb-5">
        <h1 className="text-xl font-semibold tracking-tight text-slate-100">Generador de Fichas HotSpot</h1>
        <p className="mt-1 text-xs text-slate-400">
          Crea usuarios de prepago por tiempo (horas, días, semanas) o por tráfico (100 MB, 1 GB) e imprime las
          fichas con código QR para tus puntos de venta.
        </p>
      </div>

      <form onSubmit={generate} className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <div>
            <label className="mb-1 block text-[11px] text-slate-300">Plan / Prefijo</label>
            <input
              value={form.plan}
              onChange={(e) => setForm({ ...form, plan: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-slate-300">Cantidad (1-500)</label>
            <input
              type="number"
              min={1}
              max={500}
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-slate-300">Prefijo fichas</label>
            <input
              value={form.prefix}
              onChange={(e) => setForm({ ...form, prefix: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-slate-300">Lote</label>
            <input
              value={form.batch}
              onChange={(e) => setForm({ ...form, batch: e.target.value })}
              placeholder="2026-10"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-slate-300">Precio</label>
            <input
              type="number"
              step="0.01"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-slate-300">Punto de venta</label>
            <input
              value={form.pdv}
              onChange={(e) => setForm({ ...form, pdv: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
          >
            {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            {busy ? 'Generando...' : 'Generar fichas'}
          </button>
          <label className="inline-flex items-center gap-2 text-[11px] text-slate-300">
            <input type="checkbox" checked={withQr} onChange={(e) => setWithQr(e.target.checked)} className="accent-sky-500" />
            <QrCode className="h-3.5 w-3.5" /> Incluir código QR
          </label>
          {cards.length > 0 && (
            <button
              type="button"
              onClick={printCards}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              <Printer className="h-3.5 w-3.5" /> Imprimir {cards.length} ficha(s)
            </button>
          )}
        </div>
      </form>

      {cards.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
          <div className="mb-3 flex items-center gap-2">
            <TicketCheck className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-100">Fichas generadas</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            {cards.map((card) => (
              <div key={card.code} className="rounded-lg border border-dashed border-slate-600 bg-slate-950 p-3 text-center">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Acceso Wi-Fi</div>
                <div className="my-1 text-xs font-semibold text-sky-300">{card.plan}</div>
                {withQr && (
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=90x90&data=${encodeURIComponent(card.username)}`}
                    alt={`QR ${card.username}`}
                    loading="lazy"
                    className="mx-auto my-1.5 h-16 w-16 rounded bg-white p-1"
                  />
                )}
                <div className="font-mono text-[11px] text-slate-200">{card.username}</div>
                <div className="font-mono text-[11px] text-slate-400">{card.password}</div>
                <div className="mt-1 font-mono text-xs font-semibold text-emerald-400">{formatMoney(card.price)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
