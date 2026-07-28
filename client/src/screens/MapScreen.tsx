/**
 * Écran d'accueil : la carte, plein écran.
 *
 * Consultable sans compte (règle #5). Le bouton « Signaler » est flottant, à
 * portée de pouce ; les filtres passent par une feuille pour ne pas manger la
 * carte sur un écran de 360 px.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  GRAVITES,
  NIVEAUX_GRAVITE,
  SPOT_STATUTS,
  SPOT_TYPES,
  type Gravite,
  type SpotStatut,
  type SpotType,
} from '@nadhef/shared';
import type { ConfigDto } from '../api/client';
import { MapView } from '../map/MapView';
import { Bandeau, Bouton, Feuille } from '../components/ui';
import { compterEnAttente, surChangementFile } from '../offline/queue';
import { demarrerSynchronisation, type BilanSync } from '../offline/sync';
import { changerLangue, type Langue } from '../i18n';
import { CompteFeuille } from './CompteScreen';
import { utilisateur, surChangementSession, type UtilisateurLocal } from '../api/session';

export interface Filtres {
  types: SpotType[];
  gravites: Gravite[];
  statuts: SpotStatut[];
  quartierId: string | null;
  archives: boolean;
}

const FILTRES_VIDES: Filtres = {
  types: [],
  gravites: [],
  statuts: [],
  quartierId: null,
  archives: false,
};

export function MapScreen({ config }: { config: ConfigDto }) {
  const { t, i18n } = useTranslation();
  const naviguer = useNavigate();
  const emplacement = useLocation();
  const messageEntrant = (emplacement.state as { message?: string } | null)?.message;

  const [filtres, setFiltres] = useState<Filtres>(FILTRES_VIDES);
  const [filtresOuverts, setFiltresOuverts] = useState(false);
  const [compteOuvert, setCompteOuvert] = useState(false);
  const [compte, setCompte] = useState(0);
  const [schematique, setSchematique] = useState(false);
  const [enAttente, setEnAttente] = useState(0);
  const [bilan, setBilan] = useState<BilanSync | null>(null);
  const [enLigne, setEnLigne] = useState(navigator.onLine);
  const [user, setUser] = useState<UtilisateurLocal | null>(utilisateur);
  const [messageLocal, setMessageLocal] = useState<string | null>(messageEntrant ?? null);

  useEffect(() => surChangementSession(() => setUser(utilisateur())), []);

  // File hors ligne : compteur affiché, et vidage sur retour du réseau ou de
  // l'application au premier plan (Safari n'a pas de Background Sync).
  useEffect(() => {
    const rafraichir = (): void => void compterEnAttente().then(setEnAttente);
    rafraichir();
    const desabonner = surChangementFile(rafraichir);
    const arreter = demarrerSynchronisation((b) => {
      setBilan(b);
      rafraichir();
      setTimeout(() => setBilan(null), 5000);
    });
    const surReseau = (): void => setEnLigne(navigator.onLine);
    window.addEventListener('online', surReseau);
    window.addEventListener('offline', surReseau);
    return () => {
      desabonner();
      arreter();
      window.removeEventListener('online', surReseau);
      window.removeEventListener('offline', surReseau);
    };
  }, []);

  useEffect(() => {
    if (messageLocal === null) return;
    const minuteur = setTimeout(() => setMessageLocal(null), 5000);
    return () => clearTimeout(minuteur);
  }, [messageLocal]);

  const nbFiltresActifs =
    filtres.types.length +
    filtres.gravites.length +
    filtres.statuts.length +
    (filtres.quartierId !== null ? 1 : 0) +
    (filtres.archives ? 1 : 0);

  const parametresRequete = useMemo(
    () => ({
      ...(filtres.types.length > 0 ? { type: filtres.types.join(',') } : {}),
      ...(filtres.gravites.length > 0 ? { gravite: filtres.gravites.join(',') } : {}),
      ...(filtres.statuts.length > 0 ? { statut: filtres.statuts.join(',') } : {}),
      ...(filtres.quartierId !== null ? { quartier_id: filtres.quartierId } : {}),
      ...(filtres.archives ? { include_archives: 'true' } : {}),
    }),
    [filtres],
  );

  const basculerLangue = useCallback(() => {
    void changerLangue((i18n.language === 'ar' ? 'fr' : 'ar') as Langue);
  }, [i18n.language]);

  return (
    <div className="flex h-dvh flex-col bg-slate-100">
      <header className="z-10 flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-slate-900">{t('app.nom')}</h1>
          <p className="truncate text-xs text-slate-500">
            {compte > 0 ? t('carte.spots_affiches', { count: compte }) : t('carte.titre')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCompteOuvert(true)}
          className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium text-slate-700 active:bg-slate-100"
        >
          {user ? `${user.pseudo} · ${user.points}` : t('compte.titre')}
        </button>
        <button
          type="button"
          onClick={basculerLangue}
          className="min-h-11 shrink-0 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700"
        >
          {t('commun.langue')}
        </button>
      </header>

      <main className="relative flex-1">
        <MapView
          config={config}
          parametres={parametresRequete}
          onCompteChange={setCompte}
          onFondSchematique={setSchematique}
          onSpotClick={(spot) => naviguer(`/spot/${spot.id}`)}
        />

        <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col gap-2">
          {messageLocal !== null && (
            <div className="pointer-events-auto">
              <Bandeau ton="succes">{t(messageLocal)}</Bandeau>
            </div>
          )}
          {!enLigne && (
            <div className="pointer-events-auto">
              <Bandeau ton="alerte">{t('hors_ligne.hors_ligne')}</Bandeau>
            </div>
          )}
          {enAttente > 0 && (
            <div className="pointer-events-auto">
              <Bandeau ton="info">{t('hors_ligne.en_attente', { count: enAttente })}</Bandeau>
            </div>
          )}
          {bilan !== null && bilan.envoyes + bilan.doublons > 0 && (
            <div className="pointer-events-auto">
              <Bandeau ton="succes">
                {t('hors_ligne.envoyes', { count: bilan.envoyes + bilan.doublons })}
              </Bandeau>
            </div>
          )}
        </div>

        <Legende />

        {schematique && (
          <p className="pointer-events-none absolute inset-x-0 bottom-0 bg-slate-900/70 px-3 py-1.5 text-center text-[11px] text-white">
            {t('carte.fond_schematique')}
          </p>
        )}

        {/* Filtres : bouton discret, feuille au besoin. */}
        <div className="absolute start-3 top-3 flex flex-col items-start gap-2">
          <button
            type="button"
            onClick={() => setFiltresOuverts(true)}
            className="min-h-11 rounded-xl bg-white px-3 text-sm font-medium text-slate-700 shadow-md active:bg-slate-100"
          >
            {nbFiltresActifs > 0
              ? t('carte.filtres_actifs', { count: nbFiltresActifs })
              : t('carte.filtres')}
          </button>
          <button
            type="button"
            onClick={() => naviguer('/classement')}
            className="min-h-11 rounded-xl bg-white px-3 text-sm font-medium text-slate-700 shadow-md active:bg-slate-100"
          >
            {t('nav.classement')}
          </button>
          <button
            type="button"
            onClick={() => naviguer('/statistiques')}
            className="min-h-11 rounded-xl bg-white px-3 text-sm font-medium text-slate-700 shadow-md active:bg-slate-100"
          >
            {t('nav.statistiques')}
          </button>
        </div>

        {/* Actions principales : flottantes, en bas, atteignables au pouce. */}
        <div className="absolute inset-x-0 bottom-6 flex justify-center gap-2 px-4">
          <Bouton variante="secondaire" className="shadow-xl" onClick={() => naviguer('/chantiers')}>
            {t('nav.chantiers')}
          </Bouton>
          <Bouton className="shadow-xl" onClick={() => naviguer('/signaler')}>
            {t('carte.signaler')}
          </Bouton>
        </div>
      </main>

      <FeuilleFiltres
        ouverte={filtresOuverts}
        config={config}
        filtres={filtres}
        onChange={setFiltres}
        onFermer={() => setFiltresOuverts(false)}
      />
      <CompteFeuille
        ouverte={compteOuvert}
        config={config}
        onFermer={() => setCompteOuvert(false)}
      />
    </div>
  );
}

function Legende() {
  const { t } = useTranslation();
  return (
    <div className="pointer-events-none absolute bottom-24 end-3 rounded-lg bg-white/95 p-2.5 shadow-md">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {t('gravite.titre')}
      </p>
      <ul className="space-y-1">
        {GRAVITES.map((niveau) => (
          <li key={niveau} className="flex items-center gap-2 text-xs text-slate-700">
            <span
              className="size-3 shrink-0 rounded-full ring-1 ring-white"
              style={{ backgroundColor: NIVEAUX_GRAVITE[niveau].couleur }}
            />
            {t(`gravite.${niveau}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FeuilleFiltres({
  ouverte,
  config,
  filtres,
  onChange,
  onFermer,
}: {
  ouverte: boolean;
  config: ConfigDto;
  filtres: Filtres;
  onChange: (f: Filtres) => void;
  onFermer: () => void;
}) {
  const { t, i18n } = useTranslation();
  const enArabe = i18n.language === 'ar';

  const basculer = <T,>(liste: T[], valeur: T): T[] =>
    liste.includes(valeur) ? liste.filter((v) => v !== valeur) : [...liste, valeur];

  const puce = (actif: boolean): string =>
    `min-h-11 rounded-full px-3.5 text-sm font-medium ring-1 ${
      actif ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-300'
    }`;

  return (
    <Feuille ouverte={ouverte} onFermer={onFermer} titre={t('carte.filtres')}>
      <div className="flex flex-col gap-5">
        <section>
          <h3 className="mb-2 text-sm font-medium text-slate-700">{t('gravite.titre')}</h3>
          <div className="flex flex-wrap gap-2">
            {GRAVITES.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => onChange({ ...filtres, gravites: basculer(filtres.gravites, g) })}
                aria-pressed={filtres.gravites.includes(g)}
                className={puce(filtres.gravites.includes(g))}
              >
                {t(`gravite.${g}`)}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-medium text-slate-700">{t('type.titre')}</h3>
          <div className="flex flex-wrap gap-2">
            {SPOT_TYPES.map((ty) => (
              <button
                key={ty}
                type="button"
                onClick={() => onChange({ ...filtres, types: basculer(filtres.types, ty) })}
                aria-pressed={filtres.types.includes(ty)}
                className={puce(filtres.types.includes(ty))}
              >
                {t(`type.${ty}`)}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-medium text-slate-700">{t('statut.titre')}</h3>
          <div className="flex flex-wrap gap-2">
            {SPOT_STATUTS.filter((s) => s !== 'rejete').map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onChange({ ...filtres, statuts: basculer(filtres.statuts, s) })}
                aria-pressed={filtres.statuts.includes(s)}
                className={puce(filtres.statuts.includes(s))}
              >
                {t(`statut.${s}`)}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-medium text-slate-700">{t('compte.quartier')}</h3>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onChange({ ...filtres, quartierId: null })}
              aria-pressed={filtres.quartierId === null}
              className={puce(filtres.quartierId === null)}
            >
              {t('carte.tous_quartiers')}
            </button>
            {config.quartiers.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() =>
                  onChange({ ...filtres, quartierId: filtres.quartierId === q.id ? null : q.id })
                }
                aria-pressed={filtres.quartierId === q.id}
                className={puce(filtres.quartierId === q.id)}
              >
                {enArabe ? q.nom_ar : q.nom_fr}
              </button>
            ))}
          </div>
        </section>

        {/* Les archives sont accessibles, mais jamais par défaut : c'est ce qui
            empêche la carte de redevenir un cimetière de points rouges. */}
        <label className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <input
            type="checkbox"
            checked={filtres.archives}
            onChange={(e) => onChange({ ...filtres, archives: e.target.checked })}
            className="mt-0.5 size-5 shrink-0 accent-slate-900"
          />
          <span>
            <span className="block text-sm font-medium text-slate-800">
              {t('carte.afficher_archives')}
            </span>
            <span className="mt-0.5 block text-xs text-slate-500">
              {t('carte.archives_explication')}
            </span>
          </span>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <Bouton variante="secondaire" onClick={() => onChange(FILTRES_VIDES)}>
            {t('carte.reinitialiser')}
          </Bouton>
          <Bouton onClick={onFermer}>{t('commun.valider')}</Bouton>
        </div>
      </div>
    </Feuille>
  );
}
