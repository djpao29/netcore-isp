import React from 'react';
import { CircleCheck, CircleHelp, Plug } from 'lucide-react';
import type { IntegrationKind } from '../lib/registry';

/**
 * Etiqueta de honestidad: indica si el módulo ejecuta una operación real,
 * si requiere credenciales propias, o si su motor externo aún está pendiente.
 * No se muestra nada para catálogos/registros simples (integration === undefined).
 */
const META: Record<string, { label: string; hint: string; className: string; Icon: React.ElementType }> = {
  real: {
    label: 'Motor real',
    hint: 'Ejecuta una operación real contra un sistema desde este mismo código.',
    className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    Icon: CircleCheck,
  },
  config: {
    label: 'Requiere credenciales',
    hint: 'El código de integración es real, pero necesitas configurar host/usuario/clave o una API key.',
    className: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
    Icon: Plug,
  },
  pending: {
    label: 'Pendiente de integración',
    hint: 'El módulo guarda y gestiona registros reales, pero su motor/proveedor externo aún no está implementado.',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    Icon: CircleHelp,
  },
};

export default function IntegrationBadge({ kind }: { kind?: IntegrationKind }) {
  if (!kind) return null;
  const meta = META[kind];
  if (!meta) return null;
  const { Icon } = meta;
  return (
    <span
      title={meta.hint}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium ${meta.className}`}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}
