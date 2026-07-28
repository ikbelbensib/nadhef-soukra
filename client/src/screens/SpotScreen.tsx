/**
 * Fiche d'un point noir.
 *
 * Les deux boutons « Toujours là » / « C'est propre » sont le cœur de la
 * règle #2 : sans ce geste, le signalement périme et disparaît de la carte.
 * Ils sont donc placés en premier, avant l'historique et les métadonnées.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  JOURS_AVANT_A_VERIFIER,
  NIVEAUX_GRAVITE,
  REPORT_REASONS,
  type ReportReason,
} from '@nadhef/shared';
import {
  api,
  ApiError,
  type ConfirmationDto,
  type ReponseConfirmation,
  type SpotFeatureDto,
} from '../api/client';
import { Bandeau, Bouton, Chargement, Feuille, Pastille, classesSaisie } from '../components/ui';

export function SpotScreen() {
  const { t, i18n } = useTranslation();
  const { id = '' } = useParams();
  const naviguer = useNavigate();
  const emplacement = useLocation();
  const etatEntrant = emplacement.state as { message?: string; points?: number; recidive?: boolean } | null;

  const [spot, setSpot] = useState<SpotFeatureDto | null>(null);
  const [confirmations, setConfirmations] = useState<ConfirmationDto[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [retour, setRetour] = useState<ReponseConfirmation | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [abusOuvert, setAbusOuvert] = useState(false);
  const [partage, setPartage] = useState(false);

  const recharger = useCallback(async () => {
    try {
      const [f, c] = await Promise.all([api.spot(id), api.confirmations(id)]);
      setSpot(f);
      setConfirmations(c.confirmations);
      setErreur(null);
    } catch (err) {
      setErreur(err instanceof ApiError ? err.messageKey : 'erreurs.interne');
    } finally {
      setChargement(false);
    }
  }, [id]);

  useEffect(() => {
    void recharger();
  }, [recharger]);

  const confirmer = useCallback(
    async (kind: 'toujours_la' | 'c_est_propre') => {
      setEnCours(true);
      setErreur(null);
      // La position n'est pas obligatoire, mais sans elle le geste ne rapporte
      // aucun point : la présence sur place est la seule preuve dont on dispose.
      const position = await positionActuelle();
      try {
        const reponse = await api.confirmer(id, { kind, ...position });
        setRetour(reponse);
        await recharger();
      } catch (err) {
        setErreur(err instanceof ApiError ? err.messageKey : 'erreurs.interne');
      } finally {
        setEnCours(false);
      }
    },
    [id, recharger],
  );

  const partager = useCallback(async () => {
    const url = `${window.location.origin}/spot/${id}`;
    const titre = spot ? t(`type.${spot.properties.type}`) : t('app.nom');
    if (navigator.share) {
      try {
        await navigator.share({ title: titre, url });
        return;
      } catch {
        /* partage annulé : on retombe sur la copie */
      }
    }
    await navigator.clipboard.writeText(url);
    setPartage(true);
    setTimeout(() => setPartage(false), 2500);
  }, [id, spot, t]);

  if (chargement) return <Chargement texte={t('app.chargement')} />;

  if (spot === null) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-slate-700">{t(erreur ?? 'erreurs.spot_introuvable')}</p>
        <Bouton onClick={() => naviguer('/')}>{t('nav.carte')}</Bouton>
      </div>
    );
  }

  const p = spot.properties;
  const couleur = NIVEAUX_GRAVITE[p.gravite].couleur;
  const dateLocale = (iso: string): string =>
    new Date(iso).toLocaleDateString(i18n.language === 'ar' ? 'ar-TN' : 'fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  const jours = Math.floor(
    (Date.now() - Date.parse(p.last_confirmed_at)) / 86_400_000,
  );

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg bg-slate-50 pb-8">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <button
          type="button"
          onClick={() => naviguer('/')}
          aria-label={t('nav.retour')}
          className="flex size-11 items-center justify-center rounded-lg text-slate-600 active:bg-slate-100"
        >
          <svg viewBox="0 0 20 20" className="size-5 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 4l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h1 className="flex-1 truncate text-base font-semibold text-slate-900">
          {t(`type.${p.type}`)}
        </h1>
        <button
          type="button"
          onClick={() => void partager()}
          className="min-h-11 rounded-lg px-3 text-sm font-medium text-slate-600 active:bg-slate-100"
        >
          {t('spot.partager')}
        </button>
      </header>

      {p.photo_url !== null && (
        <img src={p.photo_url} alt="" className="h-56 w-full bg-slate-200 object-cover" />
      )}

      <div className="flex flex-col gap-4 p-4">
        {partage && <Bandeau ton="succes">{t('spot.lien_copie')}</Bandeau>}

        {etatEntrant?.message !== undefined && (
          <Bandeau ton="succes">
            {t(etatEntrant.message, { points: etatEntrant.points ?? 0 })}
            {p.en_attente_moderation && ` ${t('signalement.en_moderation')}`}
          </Bandeau>
        )}
        {etatEntrant?.recidive === true && <Bandeau ton="alerte">{t('signalement.recidive')}</Bandeau>}

        {retour !== null && (
          <Bandeau ton={retour.points > 0 ? 'succes' : 'info'}>
            {retour.points > 0
              ? t('spot.merci_points', { count: retour.points, points: retour.points })
              : t('spot.merci_confirmation')}
            {retour.raison_sans_points !== undefined &&
              ` ${t(`spot.sans_points.${retour.raison_sans_points}`, {
                defaultValue: '',
              })}`}
            {retour.spot_ferme && ` ${t('spot.ferme')}`}
            {retour.kind === 'c_est_propre' && !retour.spot_ferme &&
              ` ${t('spot.attente_second_temoin')}`}
          </Bandeau>
        )}

        {erreur !== null && <Bandeau ton="erreur">{t(erreur)}</Bandeau>}

        {/* --- Le geste central : reconfirmer ou clore --- */}
        <div className="grid grid-cols-2 gap-2">
          <Bouton disabled={enCours} onClick={() => void confirmer('toujours_la')}>
            {t('spot.toujours_la')}
          </Bouton>
          <Bouton
            variante="secondaire"
            disabled={enCours}
            onClick={() => void confirmer('c_est_propre')}
          >
            {t('spot.c_est_propre')}
          </Bouton>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-white"
            style={{ backgroundColor: couleur }}
          >
            {t(`gravite.${p.gravite}`)}
          </span>
          <Pastille ton={p.statut === 'nettoye' ? 'succes' : 'neutre'}>
            {t(`statut.${p.statut}`)}
          </Pastille>
          {p.freshness === 'a_verifier' && (
            <Pastille ton="alerte">{t('freshness.a_verifier', { jours })}</Pastille>
          )}
          {p.freshness === 'frais' && (
            <Pastille>
              {t('freshness.peremption_dans', { jours: Math.max(0, JOURS_AVANT_A_VERIFIER - jours) })}
            </Pastille>
          )}
          {p.is_private_property && <Pastille ton="alerte">{t('spot.propriete_privee')}</Pastille>}
        </div>

        {p.en_attente_moderation && (
          <Bandeau ton="info">
            <span className="font-medium">{t('spot.en_attente_moderation')}</span>
            <span className="mt-0.5 block">{t('spot.en_attente_explication')}</span>
          </Bandeau>
        )}

        {p.description !== null && p.description.trim() !== '' && (
          <p className="whitespace-pre-line rounded-xl bg-white p-3 text-slate-800 ring-1 ring-slate-200">
            {p.description}
          </p>
        )}

        <dl className="rounded-xl bg-white p-3 text-sm ring-1 ring-slate-200">
          <div className="flex justify-between gap-3 py-1">
            <dt className="text-slate-500">{t('spot.label_signale')}</dt>
            <dd className="text-slate-800">{dateLocale(p.created_at)}</dd>
          </div>
          <div className="flex justify-between gap-3 py-1">
            <dt className="text-slate-500">{t('spot.label_confirme')}</dt>
            <dd className="text-slate-800">{dateLocale(p.last_confirmed_at)}</dd>
          </div>
        </dl>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            {t('spot.historique')} · {t('spot.confirmations', { count: confirmations.length })}
          </h2>
          {confirmations.length === 0 ? (
            <p className="text-sm text-slate-500">{t('spot.aucune_confirmation')}</p>
          ) : (
            <ul className="divide-y divide-slate-200 rounded-xl bg-white ring-1 ring-slate-200">
              {confirmations.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-800">
                      {c.anonyme ? t('spot.anonyme') : c.pseudo}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {t(c.kind === 'toujours_la' ? 'spot.toujours_la' : 'spot.c_est_propre')}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">{dateLocale(c.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {p.statut !== 'nettoye' && (
          <Bouton
            variante="secondaire"
            pleineLargeur
            onClick={() => naviguer(`/chantiers/nouveau?spot=${id}`)}
          >
            {t('spot.organiser')}
          </Bouton>
        )}

        <button
          type="button"
          onClick={() => setAbusOuvert(true)}
          className="min-h-11 self-start rounded-lg px-2 text-sm text-slate-500 underline underline-offset-2 active:bg-slate-100"
        >
          {t('spot.signaler_abus')}
        </button>
      </div>

      <FeuilleAbus
        ouverte={abusOuvert}
        spotId={id}
        onFermer={() => setAbusOuvert(false)}
        onEnvoye={() => {
          setAbusOuvert(false);
          void recharger();
        }}
      />
    </div>
  );
}

/** Position au moment du geste. L'échec est silencieux : on n'empêche jamais de confirmer. */
async function positionActuelle(): Promise<{ lat?: number; lng?: number }> {
  if (!navigator.geolocation) return {};
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve({}),
      // Court volontairement : le bouton reste inerte pendant l'attente, et
      // faire patienter six secondes debout dans la rue est inacceptable.
      // Sans position le geste compte quand même, il ne rapporte simplement rien.
      { enableHighAccuracy: true, timeout: 3000, maximumAge: 60_000 },
    );
  });
}

function FeuilleAbus({
  ouverte,
  spotId,
  onFermer,
  onEnvoye,
}: {
  ouverte: boolean;
  spotId: string;
  onFermer: () => void;
  onEnvoye: () => void;
}) {
  const { t } = useTranslation();
  const [motif, setMotif] = useState<ReportReason>('propriete_privee');
  const [details, setDetails] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const envoyer = async (): Promise<void> => {
    setEnvoi(true);
    setErreur(null);
    try {
      await api.signalerAbus({
        target_type: 'spot',
        target_id: spotId,
        reason: motif,
        ...(details.trim() ? { details: details.trim() } : {}),
      });
      onEnvoye();
    } catch (err) {
      setErreur(err instanceof ApiError ? err.messageKey : 'erreurs.interne');
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Feuille ouverte={ouverte} onFermer={onFermer} titre={t('abus.titre')}>
      <div className="flex flex-col gap-3">
        {erreur !== null && <Bandeau ton="erreur">{t(erreur)}</Bandeau>}
        <div className="flex flex-col gap-2">
          {REPORT_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setMotif(r)}
              aria-pressed={motif === r}
              className={`min-h-12 rounded-xl px-3 text-start text-sm font-medium ring-1 ${
                motif === r
                  ? 'bg-slate-900 text-white ring-slate-900'
                  : 'bg-white text-slate-700 ring-slate-300'
              }`}
            >
              {t(`abus.${r}`)}
            </button>
          ))}
        </div>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder={t('abus.details')}
          className={`${classesSaisie} py-2.5`}
        />
        <Bouton variante="danger" pleineLargeur disabled={envoi} onClick={() => void envoyer()}>
          {t('abus.envoyer')}
        </Bouton>
      </div>
    </Feuille>
  );
}
