/**
 * Briques d'interface. Pas de librairie de composants : quelques primitives
 * suffisent et restent lisibles en plein soleil.
 *
 * Deux règles tenues partout :
 *   · propriétés logiques uniquement (`ms`, `pe`, `start`) — jamais left/right,
 *     sinon l'arabe casse ;
 *   · cibles tactiles d'au moins 44 px : on utilise l'app debout, dans la rue.
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useEffect } from 'react';

type Variante = 'principal' | 'secondaire' | 'discret' | 'danger';

const VARIANTES: Record<Variante, string> = {
  principal: 'bg-slate-900 text-white active:bg-slate-700 disabled:bg-slate-400',
  secondaire: 'bg-white text-slate-900 ring-1 ring-slate-300 active:bg-slate-100',
  discret: 'bg-transparent text-slate-600 active:bg-slate-100',
  danger: 'bg-red-600 text-white active:bg-red-700',
};

interface BoutonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  pleineLargeur?: boolean;
}

export function Bouton({
  variante = 'principal',
  pleineLargeur = false,
  className = '',
  ...props
}: BoutonProps) {
  return (
    <button
      type="button"
      {...props}
      className={`min-h-12 rounded-xl px-5 text-base font-semibold transition-colors disabled:cursor-not-allowed ${
        VARIANTES[variante]
      } ${pleineLargeur ? 'w-full' : ''} ${className}`}
    />
  );
}

/** Feuille remontante : le motif de navigation attendu sur mobile. */
export function Feuille({
  ouverte,
  onFermer,
  titre,
  children,
}: {
  ouverte: boolean;
  onFermer: () => void;
  titre?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!ouverte) return;
    const surTouche = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onFermer();
    };
    document.addEventListener('keydown', surTouche);
    return () => document.removeEventListener('keydown', surTouche);
  }, [ouverte, onFermer]);

  if (!ouverte) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onFermer}
        className="absolute inset-0 bg-slate-900/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titre}
        className="relative max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl"
      >
        <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <h2 className="truncate text-base font-semibold text-slate-900">{titre}</h2>
          <button
            type="button"
            onClick={onFermer}
            aria-label={titre}
            className="-me-2 flex size-11 shrink-0 items-center justify-center rounded-lg text-slate-500 active:bg-slate-100"
          >
            <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
      </div>
    </div>
  );
}

/** Bandeau d'information passager. `ton` porte le sens, pas seulement la couleur. */
export function Bandeau({
  ton = 'info',
  children,
}: {
  ton?: 'info' | 'succes' | 'alerte' | 'erreur';
  children: ReactNode;
}) {
  const tons = {
    info: 'bg-slate-100 text-slate-700 ring-slate-200',
    succes: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
    alerte: 'bg-orange-50 text-orange-900 ring-orange-300',
    erreur: 'bg-red-50 text-red-900 ring-red-200',
  } as const;
  return (
    <div className={`rounded-xl px-3 py-2.5 text-sm ring-1 ${tons[ton]}`} role="status">
      {children}
    </div>
  );
}

export function Champ({
  label,
  aide,
  children,
}: {
  label: string;
  aide?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {aide !== undefined && <span className="mt-1 block text-xs text-slate-500">{aide}</span>}
    </label>
  );
}

export const classesSaisie =
  'w-full min-h-12 rounded-xl border border-slate-300 bg-white px-3 text-base ' +
  'text-slate-900 placeholder:text-slate-400 focus:border-slate-800 focus:outline-none';

/** Pastille de statut ou de fraîcheur. */
export function Pastille({
  children,
  ton = 'neutre',
}: {
  children: ReactNode;
  ton?: 'neutre' | 'alerte' | 'succes';
}) {
  const tons = {
    neutre: 'bg-slate-100 text-slate-700',
    alerte: 'bg-orange-100 text-orange-900',
    succes: 'bg-emerald-100 text-emerald-900',
  } as const;
  return (
    <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${tons[ton]}`}>
      {children}
    </span>
  );
}

export function Chargement({ texte }: { texte: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <p className="text-slate-500">{texte}</p>
    </div>
  );
}
