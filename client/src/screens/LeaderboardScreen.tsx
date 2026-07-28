/**
 * Classement — onglet Quartiers par défaut.
 *
 * Le classement collectif passe avant l'individuel : c'est un quartier qu'on
 * nettoie, pas un score personnel. Et il est normalisé par habitant, sinon
 * Chotrana (39 000 hab.) écrase les six autres à chaque saison.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, type LigneCitoyenDto, type LigneQuartierDto } from '../api/client';
import { utilisateur } from '../api/session';
import { Bandeau, Chargement, Pastille } from '../components/ui';
import { Cadre } from './EventsScreen';

type Onglet = 'quartiers' | 'citoyens';
type Periode = '30d' | '90d' | 'all';

export function LeaderboardScreen() {
  const { t, i18n } = useTranslation();
  const enArabe = i18n.language === 'ar';
  const [onglet, setOnglet] = useState<Onglet>('quartiers');
  const [periode, setPeriode] = useState<Periode>('90d');
  const [quartiers, setQuartiers] = useState<{ lignes: LigneQuartierDto[]; seuil_actions: number } | null>(null);
  const [citoyens, setCitoyens] = useState<LigneCitoyenDto[] | null>(null);
  const [monRang, setMonRang] = useState<{ points: number; rang: number | null; verifie: boolean } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    setQuartiers(null);
    setCitoyens(null);
    void Promise.all([
      api.classementQuartiers(periode),
      api.classementCitoyens(periode),
      utilisateur() ? api.monRang(periode).catch(() => null) : Promise.resolve(null),
    ])
      .then(([q, c, r]) => {
        if (annule) return;
        setQuartiers({ lignes: q.lignes, seuil_actions: q.seuil_actions });
        setCitoyens(c.lignes);
        setMonRang(r);
      })
      .catch((err: unknown) => {
        if (!annule) setErreur(err instanceof ApiError ? err.messageKey : 'erreurs.reseau');
      });
    return () => {
      annule = true;
    };
  }, [periode]);

  const puce = (actif: boolean): string =>
    `min-h-11 rounded-full px-4 text-sm font-medium ring-1 ${
      actif ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-300'
    }`;

  return (
    <Cadre titre={t('classement.titre')}>
      <div className="flex flex-col gap-4">
        {erreur !== null && <Bandeau ton="erreur">{t(erreur)}</Bandeau>}

        <div role="tablist" className="grid grid-cols-2 gap-2">
          {(['quartiers', 'citoyens'] as const).map((o) => (
            <button
              key={o}
              role="tab"
              type="button"
              aria-selected={onglet === o}
              onClick={() => setOnglet(o)}
              className={`min-h-12 rounded-xl text-sm font-semibold ring-1 ${
                onglet === o
                  ? 'bg-slate-900 text-white ring-slate-900'
                  : 'bg-white text-slate-700 ring-slate-300'
              }`}
            >
              {t(`classement.${o}`)}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {(['30d', '90d', 'all'] as const).map((p) => (
            <button key={p} type="button" onClick={() => setPeriode(p)} className={puce(periode === p)}>
              {t(`classement.periode_${p}`)}
            </button>
          ))}
        </div>

        {monRang !== null && (
          <Bandeau ton={monRang.verifie ? 'info' : 'alerte'}>
            {monRang.verifie && monRang.rang !== null
              ? t('classement.mon_rang', { rang: monRang.rang, points: monRang.points })
              : t('classement.mon_rang_non_verifie', { points: monRang.points })}
          </Bandeau>
        )}

        {onglet === 'quartiers' ? (
          quartiers === null ? (
            <Chargement texte={t('app.chargement')} />
          ) : (
            <>
              <p className="text-xs text-slate-500">{t('classement.explication_quartiers')}</p>
              <ol className="flex flex-col gap-2">
                {quartiers.lignes.map((l) => (
                  <li
                    key={l.quartier_id}
                    className={`rounded-xl bg-white p-3 ring-1 ${
                      l.rang === 1 ? 'ring-2 ring-slate-900' : 'ring-slate-200'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="w-6 shrink-0 text-sm font-bold text-slate-400">
                          {l.rang ?? '—'}
                        </span>
                        <span className="truncate text-base font-semibold text-slate-900">
                          {enArabe ? l.nom_ar : l.nom_fr}
                        </span>
                      </span>
                      <span className="shrink-0 text-end">
                        <span className="block text-lg font-bold tabular-nums text-slate-900">
                          {l.points_par_1000}
                        </span>
                        <span className="block text-[10px] text-slate-500">
                          {t('classement.par_habitant')}
                        </span>
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {!l.classe && <Pastille ton="alerte">{t('classement.non_classe')}</Pastille>}
                      <Pastille>{t('classement.actions', { count: l.actions })}</Pastille>
                      <Pastille>{t('classement.spots_fermes', { count: l.spots_fermes })}</Pastille>
                      <span className="text-[11px] text-slate-400">
                        {t('classement.habitants', { n: l.population_estimee.toLocaleString(enArabe ? 'ar-TN' : 'fr-FR') })}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="text-xs text-slate-500">
                {t('classement.seuil', { seuil: quartiers.seuil_actions })}
              </p>
            </>
          )
        ) : citoyens === null ? (
          <Chargement texte={t('app.chargement')} />
        ) : citoyens.length === 0 ? (
          <>
            <p className="py-6 text-center text-slate-500">{t('classement.vide')}</p>
            <p className="text-xs text-slate-500">{t('classement.explication_citoyens')}</p>
          </>
        ) : (
          <>
            <ol className="divide-y divide-slate-200 rounded-xl bg-white ring-1 ring-slate-200">
              {citoyens.map((l) => (
                <li key={l.user_id} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="w-6 shrink-0 text-sm font-bold text-slate-400">{l.rang}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">
                      {l.pseudo}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {t('classement.badges', { count: l.badges })}
                    </span>
                  </span>
                  <span className="shrink-0 text-base font-bold tabular-nums text-slate-900">
                    {l.points}
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-xs text-slate-500">{t('classement.explication_citoyens')}</p>
          </>
        )}
      </div>
    </Cadre>
  );
}
