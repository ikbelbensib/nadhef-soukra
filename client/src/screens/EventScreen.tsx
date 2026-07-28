/**
 * Fiche d'un chantier : inscription en un tap, et pointage le jour J.
 *
 * Le pointage propose le code affiché par l'organisateur, ou la position en
 * repli. Jamais l'auto-déclaration seule — c'est ce qui sépare 50 points d'une
 * simple case cochée.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { RAYON_CHECKIN_M } from '@nadhef/shared';
import { api, ApiError, type EventDto } from '../api/client';
import { utilisateur } from '../api/session';
import { Bandeau, Bouton, Chargement, Feuille, Pastille, classesSaisie } from '../components/ui';
import { EvacuationBandeau } from '../components/EvacuationBandeau';
import { Cadre } from './EventsScreen';

export function EventScreen() {
  const { t, i18n } = useTranslation();
  const { id = '' } = useParams();
  const naviguer = useNavigate();

  const [event, setEvent] = useState<EventDto | null>(null);
  const [erreur, setErreur] = useState<{ cle: string; details?: Record<string, unknown> } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [pointageOuvert, setPointageOuvert] = useState(false);
  const user = utilisateur();

  const recharger = useCallback(async () => {
    try {
      setEvent(await api.event(id));
    } catch (err) {
      setErreur({
        cle: err instanceof ApiError ? err.messageKey : 'erreurs.interne',
        ...(err instanceof ApiError && err.details ? { details: err.details } : {}),
      });
    }
  }, [id]);

  useEffect(() => {
    void recharger();
  }, [recharger]);

  const agir = useCallback(
    async (action: () => Promise<unknown>, succes?: string) => {
      setEnCours(true);
      setErreur(null);
      try {
        await action();
        if (succes) setMessage(succes);
        await recharger();
      } catch (err) {
        setErreur({
          cle: err instanceof ApiError ? err.messageKey : 'erreurs.interne',
          ...(err instanceof ApiError && err.details ? { details: err.details } : {}),
        });
      } finally {
        setEnCours(false);
      }
    },
    [recharger],
  );

  if (event === null) {
    return (
      <Cadre titre={t('chantiers.titre')}>
        {erreur !== null ? (
          <Bandeau ton="erreur">{t(erreur.cle, erreur.details ?? {})}</Bandeau>
        ) : (
          <Chargement texte={t('app.chargement')} />
        )}
      </Cadre>
    );
  }

  const langue = i18n.language === 'ar' ? 'ar-TN' : 'fr-FR';
  const debut = new Date(event.date_debut);
  const fin = new Date(event.date_fin);
  const maintenant = Date.now();
  const estOrganisateur = user?.id === event.organisateur.id;
  const fenetreOuverte =
    maintenant >= debut.getTime() - 30 * 60_000 && maintenant <= fin.getTime() + 30 * 60_000;
  const restantes = event.capacite !== null ? event.capacite - event.inscrits : null;

  return (
    <Cadre titre={event.titre}>
      <div className="flex flex-col gap-4">
        {message !== null && <Bandeau ton="succes">{t(message)}</Bandeau>}
        {erreur !== null && (
          <Bandeau ton="erreur">{t(erreur.cle, erreur.details ?? {})}</Bandeau>
        )}

        {/* Règle #3 : impossible à manquer, quel que soit l'écran. */}
        <EvacuationBandeau evacuation={event.evacuation} />

        <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
          <p className="text-sm font-medium text-slate-900">
            {debut.toLocaleDateString(langue, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <p className="text-sm text-slate-600">
            {debut.toLocaleTimeString(langue, { hour: '2-digit', minute: '2-digit' })} –{' '}
            {fin.toLocaleTimeString(langue, { hour: '2-digit', minute: '2-digit' })}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {t('chantiers.organise_par', { pseudo: event.organisateur.pseudo ?? '—' })}
          </p>
        </div>

        {event.description !== null && event.description.trim() !== '' && (
          <p className="whitespace-pre-line rounded-xl bg-white p-3 text-slate-800 ring-1 ring-slate-200">
            {event.description}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Pastille>{t('chantiers.inscrits', { count: event.inscrits })}</Pastille>
          {event.presents > 0 && (
            <Pastille ton="succes">{t('chantiers.presents', { count: event.presents })}</Pastille>
          )}
          {restantes !== null && restantes > 0 && (
            <Pastille>{t('chantiers.places', { restantes })}</Pastille>
          )}
          {restantes !== null && restantes <= 0 && (
            <Pastille ton="alerte">{t('chantiers.complet')}</Pastille>
          )}
          <Pastille ton={event.autorisation_obtenue ? 'succes' : 'alerte'}>
            {event.autorisation_obtenue
              ? t('chantiers.autorisation_obtenue')
              : t('chantiers.autorisation_absente')}
          </Pastille>
        </div>

        {event.materiel_fourni.length > 0 && (
          <div>
            <h2 className="mb-1.5 text-sm font-medium text-slate-700">{t('chantiers.materiel')}</h2>
            <div className="flex flex-wrap gap-2">
              {event.materiel_fourni.map((m) => (
                <Pastille key={m}>{t(`materiel.${m}`)}</Pastille>
              ))}
            </div>
          </div>
        )}

        <div>
          <h2 className="mb-1.5 text-sm font-medium text-slate-700">
            {t('chantiers.spots_concernes')}
          </h2>
          <ul className="divide-y divide-slate-200 rounded-xl bg-white ring-1 ring-slate-200">
            {event.spots.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => naviguer(`/spot/${s.id}`)}
                  className="flex min-h-12 w-full items-center justify-between gap-2 px-3 text-start active:bg-slate-50"
                >
                  <span className="text-sm text-slate-800">{t(`type.${s.type}`)}</span>
                  <span className="text-xs text-slate-500">{t(`statut.${s.statut}`)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {event.statut === 'termine' && (
          <div className="rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-200">
            <p className="text-sm font-semibold text-emerald-900">
              {t('chantiers.kg', { kg: event.kg_collectes ?? 0 })}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {event.photo_avant_url !== null && (
                <img src={event.photo_avant_url} alt="" className="h-28 w-full rounded-lg object-cover" />
              )}
              {event.photo_apres_url !== null && (
                <img src={event.photo_apres_url} alt="" className="h-28 w-full rounded-lg object-cover" />
              )}
            </div>
          </div>
        )}

        {/* --- Actions --- */}
        {event.statut === 'brouillon' && estOrganisateur && (
          <Bouton
            pleineLargeur
            disabled={enCours}
            onClick={() => void agir(() => api.publierEvent(event.id))}
          >
            {t('chantiers.publier')}
          </Bouton>
        )}

        {event.statut === 'publie' && !estOrganisateur && user !== null && (
          <Bouton
            pleineLargeur
            disabled={enCours || (restantes !== null && restantes <= 0)}
            onClick={() => void agir(() => api.sInscrire(event.id), 'chantiers.inscrit')}
          >
            {t('chantiers.sinscrire')}
          </Bouton>
        )}

        {fenetreOuverte && event.statut !== 'termine' && event.statut !== 'annule' && (
          <Bouton
            variante="secondaire"
            pleineLargeur
            onClick={() => setPointageOuvert(true)}
          >
            {t('chantiers.pointer')}
          </Bouton>
        )}

        {estOrganisateur && event.statut !== 'brouillon' && event.statut !== 'annule' && (
          <Bouton
            variante="secondaire"
            pleineLargeur
            onClick={() => naviguer(`/chantiers/${event.id}/organisateur`)}
          >
            {t('chantiers.mode_organisateur')}
          </Bouton>
        )}
      </div>

      <FeuillePointage
        ouverte={pointageOuvert}
        eventId={event.id}
        onFermer={() => setPointageOuvert(false)}
        onPointe={(points) => {
          setMessage(points > 0 ? 'chantiers.presence_ok' : 'chantiers.presence_ok_sans_points');
          void recharger();
        }}
      />
    </Cadre>
  );
}

function FeuillePointage({
  ouverte,
  eventId,
  onFermer,
  onPointe,
}: {
  ouverte: boolean;
  eventId: string;
  onFermer: () => void;
  onPointe: (points: number) => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<{ cle: string; details?: Record<string, unknown> } | null>(null);

  const echouer = (err: unknown): void =>
    setErreur({
      cle: err instanceof ApiError ? err.messageKey : 'erreurs.interne',
      ...(err instanceof ApiError && err.details ? { details: err.details } : {}),
    });

  const pointer = async (charge: { code?: string; lat?: number; lng?: number }): Promise<void> => {
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await api.checkin(eventId, charge as never);
      onPointe(r.points);
      onFermer();
    } catch (err) {
      echouer(err);
    } finally {
      setEnvoi(false);
    }
  };

  const parPosition = (): void => {
    if (!navigator.geolocation) {
      setErreur({ cle: 'erreurs.position_indisponible' });
      return;
    }
    setEnvoi(true);
    navigator.geolocation.getCurrentPosition(
      (p) => void pointer({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {
        setEnvoi(false);
        setErreur({ cle: 'erreurs.position_indisponible' });
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  return (
    <Feuille ouverte={ouverte} onFermer={onFermer} titre={t('chantiers.pointer')}>
      <div className="flex flex-col gap-4">
        {erreur !== null && <Bandeau ton="erreur">{t(erreur.cle, erreur.details ?? {})}</Bandeau>}

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">
            {t('chantiers.code_saisie')}
          </span>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            dir="ltr"
            className={`${classesSaisie} text-center text-2xl tracking-[0.4em]`}
          />
        </label>
        <Bouton
          pleineLargeur
          disabled={code.length !== 6 || envoi}
          onClick={() => void pointer({ code })}
        >
          {t('chantiers.valider_presence')}
        </Bouton>

        <div aria-hidden className="flex items-center gap-3">
          <span className="h-px flex-1 bg-slate-200" />
          <span className="text-xs text-slate-400">{t('commun.ou')}</span>
          <span className="h-px flex-1 bg-slate-200" />
        </div>

        {/* Repli : tout le monde n'a pas de quoi scanner, et le réseau peut
            manquer au moment de rafraîchir le code. */}
        <Bouton variante="secondaire" pleineLargeur disabled={envoi} onClick={parPosition}>
          {t('chantiers.par_position')}
        </Bouton>
        <p className="text-xs text-slate-500">
          {t('chantiers.position_aide', { rayon: RAYON_CHECKIN_M })}
        </p>
      </div>
    </Feuille>
  );
}
