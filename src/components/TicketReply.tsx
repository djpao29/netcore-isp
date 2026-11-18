import React, { useState } from 'react';
import { MessageSquarePlus, Send, X } from 'lucide-react';
import { api } from '../lib/api';

/** Acción de fila para el módulo de Tickets: registrar respuesta y mover a «En proceso». */
export default function TicketReply({ ticket, onToast, onDone }: { ticket: any; onToast?: (m: string) => void; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [author, setAuthor] = useState('Soporte Técnico');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setBusy(true);
    const res: any = await api.replyTicket(ticket.id, { message, author, internal });
    setBusy(false);
    if (res.status === 'success') {
      setOpen(false);
      setMessage('');
      onToast?.(`Respuesta registrada en el ticket ${ticket.code}.`);
      onDone?.();
    } else {
      onToast?.(res.message || 'No se pudo registrar la respuesta.');
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Responder ticket"
        className="rounded-md border border-sky-500/40 bg-sky-950/40 p-1.5 text-sky-300 hover:bg-sky-900/50"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Responder {ticket.code}</h2>
                <p className="text-[11px] text-slate-400">
                  {ticket.customer_name} · {ticket.subject}
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={submit} className="space-y-3 p-5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-slate-300">Autor</label>
                  <input
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                  />
                </div>
                <label className="flex items-end gap-2 pb-2 text-slate-300">
                  <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="accent-sky-500" />
                  Nota interna (no visible al cliente)
                </label>
              </div>
              <div>
                <label className="mb-1 block text-slate-300">Respuesta</label>
                <textarea
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Detalle de la atención, diagnóstico o solución aplicada..."
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-800 pt-3">
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-slate-300">
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                  {busy ? 'Enviando...' : 'Registrar respuesta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
