/** Liste des chantiers. Consultable sans compte (règle #5). */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, type EventDto } from '../api/client';
import { utilisateur } from '../api/session';
import { Bandeau, Bouton, Chargement, Pastille } from '../components/ui';
import { EvacuationBandeau } from '../components/EvacuationBandeau';
import { VerificationFeuille } from './VerificationFeuille';

export function EventsScreen() {
  const { t, i18n } = useTranslation();
  const naviguer = useNavigate();
  const [events, setEvents] = useState<EventDto[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [verifOuverte, setVerifOuverte] = useState(false);

  useEffect(() => {
    let annule = false;
    void api
      .events({ limit: 100 })
      .then((r) => {
        if (!annule) setEvents(r.events);
      })
      .catch((err: unknown) => {
        if (!annule) setErreur(err instanceof ApiError ? err.messageKey : 'erreurs.reseau');
      });
    return () => {
      annule = true;
    };
  }, []);

  const organiser = useCallback(() => {
    const user = utilisateur();
    // On n'envoie pas l'utilisateur remplir un long formulaire pour lui refuser
    // la publication à la fin : la vérification est demandée d'emblée.
    if (!user?.is_verified) {
      setVerifOuverte(true);
      return;
    }
    naviguer('/chantiers/nouveau');
  }, [naviguer]);

  if (erreur !== null) {
    return (
      <Cadre titre={t('chantiers.titre')}>
        <Bandeau ton="erreur">{t(erreur)}</Bandeau>
      </Cadre>
    );
  }
  if (events === null) {
    return (
      <Cadre titre={t('chantiers.titre')}>
        <Chargement texte={t('app.chargement')} />
      </Cadre>
    );
  }

  const maintenant = Date.now();
  const aVenir = events.filter(
    (e) => Date.parse(e.date_fin) >= maintenant && e.statut !== 'annule' && e.statut !== 'termine',
  );
  const passes = events.filter(
    (e) => Date.parse(e.date_fin) < maintenant || e.statut === 'termine',
  );

  return (
    <Cadre titre={t('chantiers.titre')}>
      <div className="flex flex-col gap-5">
        <Bouton pleineLargeur onClick={organiser}>
          {t('chantiers.creer')}
        </Bouton>

        {aVenir.length === 0 && passes.length === 0 && (
          <p className="py-8 text-center text-slate-500">{t('chantiers.aucun')}</p>
        )}

        {aVenir.length > 0 && (
          <Section titre={t('chantiers.a_venir')}>
            {aVenir.map((e) => (
              <CarteChantier key={e.id} event={e} langue={i18n.language} />
            ))}
          </Section>
        )}

        {passes.length > 0 && (
          <Section titre={t('chantiers.passes')}>
            {passes.map((e) => (
              <CarteChantier key={e.id} event={e} langue={i18n.language} />
            ))}
          </Section>
        )}
      </div>

      <VerificationFeuille
        ouverte={verifOuverte}
        onFermer={() => setVerifOuverte(false)}
        onVerifie={() => naviguer('/chantiers/nouveau')}
      />
    </Cadre>
  );
}

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{titre}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function CarteChantier({ event, langue }: { event: EventDto; langue: string }) {
  const { t } = useTranslation();
  const debut = new Date(event.date_debut);
  const dateTexte = debut.toLocaleDateString(langue === 'ar' ? 'ar-TN' : 'fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const heure = debut.toLocaleTimeString(langue === 'ar' ? 'ar-TN' : 'fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Link
      to={`/chantiers/${event.id}`}
      className="block rounded-xl bg-white p-3 ring-1 ring-slate-200 active:bg-slate-50"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-900">{event.titre}</h3>
        {event.statut === 'termine' && <Pastille ton="succes">{t('statut.nettoye')}</Pastille>}
        {event.statut === 'brouillon' && <Pastille>{t('chantiers.brouillon')}</Pastille>}
      </div>
      <p className="mt-0.5 text-sm text-slate-600">
        {dateTexte} · {heure}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">
        {t('chantiers.inscrits', { count: event.inscrits })}
        {event.statut === 'termine' && event.kg_collectes !== null
          ? ` · ${t('chantiers.kg', { kg: event.kg_collectes })}`
          : ''}
      </p>
      {/* L'avertissement d'évacuation apparaît dès la liste : c'est une
          information qu'un participant doit avoir avant de s'engager. */}
      {event.evacuation.avertissement && event.statut !== 'termine' && (
        <div className="mt-2">
          <EvacuationBandeau evacuation={event.evacuation} compact />
        </div>
      )}
    </Link>
  );
}

export function Cadre({ titre, children }: { titre: string; children: React.ReactNode }) {
  const { t } = useTranslation();
  const naviguer = useNavigate();
  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg bg-slate-50">
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
        <h1 className="truncate text-base font-semibold text-slate-900">{titre}</h1>
      </header>
      <div className="p-4 pb-10">{children}</div>
    </div>
  );
}
