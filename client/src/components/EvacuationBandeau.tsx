/**
 * Bandeau d'évacuation — règle non négociable #3.
 *
 * Quand la filière n'est pas confirmée, l'avertissement doit être impossible à
 * manquer : c'est le mode d'échec numéro un des opérations de nettoyage
 * citoyennes. Deux cents sacs empilés que personne ne vient chercher, et le
 * quartier est plus sale qu'avant.
 */

import { useTranslation } from 'react-i18next';
import type { EvacuationPar } from '@nadhef/shared';

export function EvacuationBandeau({
  evacuation,
  compact = false,
}: {
  evacuation: { par: EvacuationPar; contact_nom: string; contact_tel: string; avertissement: boolean };
  compact?: boolean;
}) {
  const { t } = useTranslation();

  if (evacuation.avertissement) {
    return (
      <div
        role="alert"
        className="rounded-xl bg-orange-50 p-3 ring-2 ring-orange-400"
      >
        <p className="flex items-start gap-2 text-sm font-semibold text-orange-900">
          <span aria-hidden className="text-base leading-none">⚠</span>
          {t('evacuation.avertissement')}
        </p>
        {!compact && (
          <p className="mt-1.5 text-xs text-orange-800">
            {evacuation.contact_nom} · <span dir="ltr">{evacuation.contact_tel}</span>
          </p>
        )}
      </div>
    );
  }

  if (compact) return null;

  return (
    <div className="rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-200">
      <p className="text-sm font-medium text-emerald-900">
        {t('evacuation.titre')} · {t(`evacuation.${evacuation.par}`)}
      </p>
      <p className="mt-1 text-xs text-emerald-800">
        {evacuation.contact_nom} · <span dir="ltr">{evacuation.contact_tel}</span>
      </p>
    </div>
  );
}
