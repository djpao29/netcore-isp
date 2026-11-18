import React, { useMemo, useState } from 'react';
import { Network, Copy, Check } from 'lucide-react';

function parseIPv6(input: string): bigint | null {
  const addr = input.trim().replace(/^\[|\]$/g, '');
  if (!addr.includes(':')) return null;
  let head = addr;
  let tail = '';
  const dc = addr.indexOf('::');
  if (dc !== -1) {
    head = addr.slice(0, dc);
    tail = addr.slice(dc + 2);
  }
  const headParts = head ? head.split(':').filter((p) => p !== '') : [];
  const tailParts = tail ? tail.split(':').filter((p) => p !== '') : [];
  const missing = 8 - headParts.length - tailParts.length;
  if (dc === -1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...headParts, ...Array(dc === -1 ? 0 : missing).fill('0'), ...tailParts];
  if (groups.length !== 8) return null;
  let value = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    value = (value << 16n) | BigInt(parseInt(g, 16));
  }
  return value;
}

function formatIPv6(value: bigint): string {
  const groups: string[] = [];
  let v = value;
  for (let i = 0; i < 8; i++) {
    groups.unshift((v & 0xffffn).toString(16));
    v >>= 16n;
  }
  // Comprimir el run de ceros más largo
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  groups.forEach((g, i) => {
    if (g === '0') {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  });
  if (bestLen < 2) return groups.join(':');
  const left = groups.slice(0, bestStart).join(':');
  const right = groups.slice(bestStart + bestLen).join(':');
  return `${left}::${right}`;
}

export default function IPv6Calculator({ onToast }: { onToast?: (m: string) => void }) {
  const [prefix, setPrefix] = useState('2001:db8::/32');
  const [subPrefix, setSubPrefix] = useState(48);
  const [subnetsToShow, setSubnetsToShow] = useState(8);
  const [copied, setCopied] = useState<string | null>(null);

  const result = useMemo<any>(() => {
    const [addrPart, lenPart] = prefix.split('/');
    const base = parseIPv6(addrPart || '');
    const prefixLen = Number(lenPart ?? 64);
    if (base === null || !Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > 128) {
      return { error: 'Prefijo IPv6 inválido. Ejemplo: 2001:db8::/32' };
    }
    if (subPrefix < prefixLen || subPrefix > 128) {
      return { error: `La longitud de subred debe estar entre /${prefixLen} y /128.` };
    }
    const hostBits = BigInt(128 - prefixLen);
    const mask = ((1n << BigInt(prefixLen)) - 1n) << hostBits;
    const network = base & mask;
    const subnets = 1n << (BigInt(subPrefix) - BigInt(prefixLen));
    const subnetSize = 1n << (128n - BigInt(subPrefix));
    const addressesPerSubnet = subnetSize;
    const count = subnets > BigInt(subnetsToShow) ? BigInt(subnetsToShow) : subnets;

    const sample: string[] = [];
    for (let i = 0n; i < count; i++) {
      const net = network + i * subnetSize;
      sample.push(`${formatIPv6(net)}/${subPrefix}`);
    }
    return {
      base: formatIPv6(network),
      fullBase: (() => {
        const g: string[] = [];
        let v = network;
        for (let i = 0; i < 8; i++) {
          g.unshift((v & 0xffffn).toString(16).padStart(4, '0'));
          v >>= 16n;
        }
        return g.join(':');
      })(),
      prefixLen,
      subPrefix,
      subnets: subnets.toString(),
      subnetSize: subnetSize.toString(),
      addressesPerSubnet: addressesPerSubnet.toString(),
      sample,
      truncated: subnets > BigInt(subnetsToShow),
    };
  }, [prefix, subPrefix, subnetsToShow]);

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(text);
    onToast?.('Copiado al portapapeles.');
    window.setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800 pb-5">
        <h1 className="text-xl font-semibold tracking-tight text-slate-100">Planificador / Calculadora IPv6</h1>
        <p className="mt-1 text-xs text-slate-400">
          Subdivide un prefijo IPv6 (DHCPv6-PD) en subredes /48, /56 o /64 para asignarlas a zonas, PONs o clientes.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Network className="h-4 w-4 text-sky-400" />
            Parámetros
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Prefijo base (IPv6/CIDR)</label>
            <input
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="2001:db8::/32"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Longitud de subred</label>
            <select
              value={subPrefix}
              onChange={(e) => setSubPrefix(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100"
            >
              {[32, 40, 44, 48, 52, 56, 60, 64].map((p) => (
                <option key={p} value={p}>
                  /{p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Subredes a mostrar</label>
            <select
              value={subnetsToShow}
              onChange={(e) => setSubnetsToShow(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100"
            >
              {[8, 16, 32, 64].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          {result.error ? (
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-5 text-sm text-rose-200">
              {result.error}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                  <div className="text-[11px] text-slate-400">Red base</div>
                  <div className="mt-1 font-mono text-sm text-sky-300">{result.base}</div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                  <div className="text-[11px] text-slate-400">Subredes /{result.subPrefix}</div>
                  <div className="mt-1 font-mono text-lg text-emerald-400">{result.subnets}</div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                  <div className="text-[11px] text-slate-400">Direcciones por subred</div>
                  <div className="mt-1 font-mono text-lg text-slate-100">2^{128 - (result.subPrefix || 0)}</div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                  <div className="text-[11px] text-slate-400">Ejemplo</div>
                  <div className="mt-1 font-mono text-xs text-slate-300 break-all">{result.sample[0]}</div>
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-100">
                    Subredes asignables ({result.truncated ? `primeras ${result.sample.length}` : result.sample.length})
                  </h2>
                  <span className="font-mono text-[11px] text-slate-500">forma expandida: {result.fullBase}</span>
                </div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {result.sample.map((subnet: string) => (
                    <button
                      key={subnet}
                      type="button"
                      onClick={() => copy(subnet)}
                      className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-left font-mono text-xs text-slate-200 hover:border-sky-500/50"
                    >
                      <span>{subnet}</span>
                      {copied === subnet ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 text-slate-500" />
                      )}
                    </button>
                  ))}
                </div>
                {result.truncated && (
                  <p className="mt-3 text-[11px] text-slate-500">
                    Se muestran solo las primeras {result.sample.length} de {result.subnets} subredes posibles.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
