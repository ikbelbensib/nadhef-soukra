/**
 * Back-office de modération.
 *
 * Même application, route protégée par rôle — pas de second déploiement à
 * maintenir. Le serveur reste la seule autorité : masquer l'écran ne protège
 * rien, c'est `exigerRole` qui protège.
 *
 * L'écran est conçu pour être tenable au téléphone : un modérateur bénévole
 * traite sa file dans le bus, pas devant un tableur.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, type EntreeFileDto, type EntreeAuditDto } from '../api/client';
import { utilisateur } from '../api/session';
import { Bandeau, Bouton, Chargement, Pastille, classesSaisie } from '../components/ui';
import { Cadre } from './EventsScreen';

type Onglet = 'file' | 'masques' | 'audit' | 'exports';

export function AdminScreen() {
  const { t } = useTranslation();
  const user = utilisateur();
  const [onglet, setOnglet] = useState<Onglet>('file');
  const [file, setFile] = useState<{ en_attente: EntreeFileDto[]; masques: EntreeFileDto[] } | null>(null);
  const [audit, setAudit] = useState<EntreeAuditDto[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const recharger = useCallback(async () => {
    try {
      const f = await api.fileModeration();
      setFile({ en_attente: f.en_attente, masques: f.masques });
      setErreur(null);
    } catch (err) {
      setErreur(err instanceof ApiError ? err.messageKey : 'erreurs.interne');
    }
  }, []);

  useEffect(() => {
    void recharger();
  }, [recharger]);

  useEffect(() => {
    if (onglet !== 'audit' || audit !== null) return;
    void api
      .audit()
      .then((r) => setAudit(r.entrees))
      .catch(() => setAudit([]));
  }, [onglet, audit]);

  if (user === null || (user.role !== 'moderateur' && user.role !== 'admin')) {
    return (
      <Cadre titre={t('admin.titre')}>
        <Bandeau ton="erreur">{t('admin.acces_refuse')}</Bandeau>
      </Cadre>
    );
  }

  const onglets: Onglet[] = ['file', 'masques', 'audit', 'exports'];

  return (
    <Cadre titre={t('admin.titre')}>
      <div className="flex flex-col gap-4">
        {message !== null && <Bandeau ton="succes">{t(message)}</Bandeau>}
        {erreur !== null && <Bandeau ton="erreur">{t(erreur)}</Bandeau>}

        <div role="tablist" className="flex flex-wrap gap-2">
          {onglets.map((o) => (
            <button
              key={o}
              role="tab"
              type="button"
              aria-selected={onglet === o}
              onClick={() => setOnglet(o)}
              className={`min-h-11 rounded-full px-3.5 text-sm font-medium ring-1 ${
                onglet === o
                  ? 'bg-slate-900 text-white ring-slate-900'
                  : 'bg-white text-slate-700 ring-slate-300'
              }`}
            >
              {t(`admin.${o}`)}
              {o === 'file' && file !== null && file.en_attente.length > 0 && ` · ${file.en_attente.length}`}
            </button>
          ))}
        </div>

        {onglet === 'exports' ? (
          <Exports />
        ) : onglet === 'audit' ? (
          audit === null ? (
            <Chargement texte={t('app.chargement')} />
          ) : (
            <Journal entrees={audit} />
          )
        ) : file === null ? (
          <Chargement texte={t('app.chargement')} />
        ) : (
          <ListeSpots
            entrees={onglet === 'file' ? file.en_attente : file.masques}
            onDecision={() => {
              setMessage('admin.decision_prise');
              setTimeout(() => setMessage(null), 3000);
              void recharger();
            }}
            onErreur={setErreur}
          />
        )}
      </div>
    </Cadre>
  );
}

function ListeSpots({
  entrees,
  onDecision,
  onErreur,
}: {
  entrees: EntreeFileDto[];
  onDecision: () => void;
  onErreur: (cle: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [raisons, setRaisons] = useState<Record<string, string>>({});
  const [enCours, setEnCours] = useState<string | null>(null);

  if (entrees.length === 0) {
    return <p className="py-8 text-center text-slate-500">{t('admin.aucun')}</p>;
  }

  const decider = async (id: string, decision: 'approved' | 'rejected' | 'hidden'): Promise<void> => {
    setEnCours(id);
    try {
      await api.modererSpot(id, decision, raisons[id]);
      onDecision();
    } catch (err) {
      onErreur(err instanceof ApiError ? err.messageKey : 'erreurs.interne');
    } finally {
      setEnCours(null);
    }
  };

  return (
    <ul className="flex flex-col gap-3">
      {entrees.map(({ spot, confirmations, signalements }) => (
        <li key={spot.id} className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
          {spot.photo_url !== null && (
            <img src={spot.photo_url} alt="" className="h-40 w-full bg-slate-100 object-cover" />
          )}
          <div className="flex flex-col gap-2 p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-semibold text-slate-900">{t(`type.${spot.type}`)}</span>
              <span className="shrink-0 text-xs text-slate-400">
                {new Date(spot.created_at).toLocaleDateString(
                  i18n.language === 'ar' ? 'ar-TN' : 'fr-FR',
                )}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <Pastille>{t(`gravite.${spot.gravite}`)}</Pastille>
              <Pastille>{t('admin.confirmations', { count: confirmations })}</Pastille>
              <Pastille>
                {t('admin.par', { auteur: spot.auteur ?? t('admin.anonyme') })}
              </Pastille>
              {/* Le drapeau propriété privée est le principal risque de
                  harcèlement de voisinage : il doit sauter aux yeux. */}
              {spot.is_private_property && (
                <Pastille ton="alerte">{t('admin.propriete_privee')}</Pastille>
              )}
            </div>

            {spot.description !== null && spot.description.trim() !== '' && (
              <p className="text-sm text-slate-700">{spot.description}</p>
            )}

            {signalements.length > 0 && (
              <Bandeau ton="alerte">
                {t('admin.signale_pour', {
                  motifs: signalements.map((s) => t(`abus.${s.reason}`)).join(', '),
                })}
              </Bandeau>
            )}

            <input
              type="text"
              value={raisons[spot.id] ?? ''}
              onChange={(e) => setRaisons((v) => ({ ...v, [spot.id]: e.target.value }))}
              maxLength={300}
              placeholder={t('admin.raison')}
              className={`${classesSaisie} min-h-11 text-sm`}
            />

            <div className="grid grid-cols-3 gap-2">
              <Bouton
                className="text-sm"
                disabled={enCours === spot.id}
                onClick={() => void decider(spot.id, 'approved')}
              >
                {t('admin.approuver')}
              </Bouton>
              <Bouton
                variante="secondaire"
                className="text-sm"
                disabled={enCours === spot.id}
                onClick={() => void decider(spot.id, 'hidden')}
              >
                {t('admin.masquer')}
              </Bouton>
              <Bouton
                variante="danger"
                className="text-sm"
                disabled={enCours === spot.id}
                onClick={() => void decider(spot.id, 'rejected')}
              >
                {t('admin.rejeter')}
              </Bouton>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Journal({ entrees }: { entrees: EntreeAuditDto[] }) {
  const { t, i18n } = useTranslation();
  if (entrees.length === 0) {
    return <p className="py-8 text-center text-slate-500">{t('admin.aucun')}</p>;
  }
  return (
    <ul className="divide-y divide-slate-200 rounded-xl bg-white text-sm ring-1 ring-slate-200">
      {entrees.map((e) => (
        <li key={e.id} className="px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium text-slate-800">{e.action}</span>
            <span className="shrink-0 text-xs text-slate-400">
              {new Date(e.created_at).toLocaleString(i18n.language === 'ar' ? 'ar-TN' : 'fr-FR')}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {e.acteur ?? '—'} · {e.target_type} · <span dir="ltr">{e.target_id}</span>
          </p>
          {e.payload !== null && (
            <p className="mt-0.5 truncate text-xs text-slate-400">{e.payload}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function Exports() {
  const { t } = useTranslation();
  const jeux = [
    { cle: 'spots', libelle: t('admin.export_spots') },
    { cle: 'chantiers', libelle: t('admin.export_chantiers') },
    { cle: 'quartiers', libelle: t('admin.export_quartiers') },
  ] as const;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-500">{t('admin.exports_aide')}</p>
      {jeux.map((j) => (
        <Bouton
          key={j.cle}
          variante="secondaire"
          pleineLargeur
          onClick={() => void api.telechargerExport(j.cle)}
        >
          {j.libelle}
        </Bouton>
      ))}
    </div>
  );
}
