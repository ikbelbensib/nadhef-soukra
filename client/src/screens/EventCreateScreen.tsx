/**
 * Créer un chantier.
 *
 * Le bloc évacuation n'est pas une section parmi d'autres : c'est la condition
 * de publication (règle #3). Il est donc mis en avant, expliqué, et la case
 * d'acquittement n'apparaît que si l'organisateur choisit « non confirmée ».
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EVACUATION_PAR, MATERIELS, type EvacuationPar, type Materiel } from '@nadhef/shared';
import { api, ApiError, type ConfigDto, type SpotProperties } from '../api/client';
import { PickerCarte } from '../map/PickerCarte';
import { Bandeau, Bouton, Champ, classesSaisie } from '../components/ui';
import { Cadre } from './EventsScreen';

/** `datetime-local` attend une chaîne locale sans fuseau. */
const versChampLocal = (d: Date): string => {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function EventCreateScreen({ config }: { config: ConfigDto }) {
  const { t } = useTranslation();
  const naviguer = useNavigate();
  const [params] = useSearchParams();
  const spotInitial = params.get('spot');

  const demain = new Date(Date.now() + 86_400_000);
  demain.setHours(9, 0, 0, 0);
  const fin = new Date(demain.getTime() + 3 * 3_600_000);

  const [titre, setTitre] = useState('');
  const [description, setDescription] = useState('');
  const [debut, setDebut] = useState(versChampLocal(demain));
  const [dateFin, setDateFin] = useState(versChampLocal(fin));
  const [capacite, setCapacite] = useState('');
  const [materiel, setMateriel] = useState<Materiel[]>(['gants', 'sacs']);
  const [autorisation, setAutorisation] = useState(false);
  const [evacuationPar, setEvacuationPar] = useState<EvacuationPar>('municipalite');
  const [contactNom, setContactNom] = useState('');
  const [contactTel, setContactTel] = useState('');
  const [acquitte, setAcquitte] = useState(false);
  const [spotsChoisis, setSpotsChoisis] = useState<string[]>(spotInitial ? [spotInitial] : []);
  const [spotsDisponibles, setSpotsDisponibles] = useState<SpotProperties[]>([]);
  const [rdv, setRdv] = useState({
    lat: (config.commune.bbox.minLat + config.commune.bbox.maxLat) / 2,
    lng: (config.commune.bbox.minLng + config.commune.bbox.maxLng) / 2,
  });
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    void api
      .spots({ limit: 500, statut: 'signale,confirme,a_verifier,recidive' })
      .then((r) => setSpotsDisponibles(r.features.map((f) => f.properties)))
      .catch(() => setSpotsDisponibles([]));
  }, []);

  const publiable =
    evacuationPar !== 'non_confirme' || acquitte;
  const complet =
    titre.trim().length >= 5 &&
    contactNom.trim().length >= 2 &&
    contactTel.trim().length >= 6 &&
    spotsChoisis.length > 0 &&
    !envoi;

  const soumettre = async (publier: boolean): Promise<void> => {
    setEnvoi(true);
    setErreur(null);
    try {
      const event = await api.creerEvent({
        titre: titre.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        date_debut: new Date(debut).toISOString(),
        date_fin: new Date(dateFin).toISOString(),
        point_rdv_lat: rdv.lat,
        point_rdv_lng: rdv.lng,
        ...(capacite ? { capacite: Number(capacite) } : {}),
        materiel_fourni: materiel,
        autorisation_obtenue: autorisation,
        spot_ids: spotsChoisis,
        evacuation_par: evacuationPar,
        contact_evacuation_nom: contactNom.trim(),
        contact_evacuation_tel: contactTel.trim(),
        evacuation_risque_acquittee: acquitte,
      });
      if (publier) await api.publierEvent(event.id);
      naviguer(`/chantiers/${event.id}`);
    } catch (err) {
      setErreur(err instanceof ApiError ? err.messageKey : 'erreurs.interne');
      setEnvoi(false);
    }
  };

  const puce = (actif: boolean): string =>
    `min-h-11 rounded-full px-3.5 text-sm font-medium ring-1 ${
      actif ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-300'
    }`;

  return (
    <Cadre titre={t('creation.titre')}>
      <div className="flex flex-col gap-5 pb-24">
        {erreur !== null && <Bandeau ton="erreur">{t(erreur)}</Bandeau>}

        <Champ label={t('creation.nom')}>
          <input
            type="text"
            value={titre}
            onChange={(e) => setTitre(e.target.value)}
            maxLength={120}
            placeholder={t('creation.nom_exemple')}
            className={classesSaisie}
          />
        </Champ>

        <Champ label={t('creation.description')}>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={t('creation.description_exemple')}
            className={`${classesSaisie} py-2.5`}
          />
        </Champ>

        <div className="grid grid-cols-2 gap-2">
          <Champ label={t('creation.debut')}>
            <input
              type="datetime-local"
              value={debut}
              onChange={(e) => setDebut(e.target.value)}
              dir="ltr"
              className={classesSaisie}
            />
          </Champ>
          <Champ label={t('creation.fin')}>
            <input
              type="datetime-local"
              value={dateFin}
              onChange={(e) => setDateFin(e.target.value)}
              dir="ltr"
              className={classesSaisie}
            />
          </Champ>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700">{t('creation.rdv')}</p>
          <PickerCarte config={config} position={rdv} onChange={setRdv} />
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700">{t('creation.spots')}</p>
          <p className="mb-2 text-xs text-slate-500">{t('creation.spots_aide')}</p>
          <div className="max-h-56 overflow-y-auto rounded-xl bg-white ring-1 ring-slate-200">
            {spotsDisponibles.map((s) => (
              <label key={s.id} className="flex items-center gap-2.5 border-b border-slate-100 p-2.5 last:border-0">
                <input
                  type="checkbox"
                  checked={spotsChoisis.includes(s.id)}
                  onChange={(e) =>
                    setSpotsChoisis((v) =>
                      e.target.checked ? [...v, s.id] : v.filter((x) => x !== s.id),
                    )
                  }
                  className="size-5 shrink-0 accent-slate-900"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-800">{t(`type.${s.type}`)}</span>
                  <span className="block text-xs text-slate-500">{t(`gravite.${s.gravite}`)}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">{t('creation.materiel')}</p>
          <div className="flex flex-wrap gap-2">
            {MATERIELS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() =>
                  setMateriel((v) => (v.includes(m) ? v.filter((x) => x !== m) : [...v, m]))
                }
                aria-pressed={materiel.includes(m)}
                className={puce(materiel.includes(m))}
              >
                {t(`materiel.${m}`)}
              </button>
            ))}
          </div>
        </div>

        <Champ label={t('creation.capacite')}>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={capacite}
            onChange={(e) => setCapacite(e.target.value)}
            dir="ltr"
            className={`${classesSaisie} text-start`}
          />
        </Champ>

        <label className="flex items-start gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-200">
          <input
            type="checkbox"
            checked={autorisation}
            onChange={(e) => setAutorisation(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-slate-900"
          />
          <span className="text-sm text-slate-800">{t('creation.autorisation')}</span>
        </label>

        {/* --- Bloc évacuation : la condition de publication --- */}
        <section className="rounded-xl bg-white p-3 ring-2 ring-slate-300">
          <h2 className="text-base font-semibold text-slate-900">
            {t('creation.evacuation_titre')}
          </h2>
          <p className="mt-1 text-xs text-slate-600">{t('creation.evacuation_aide')}</p>

          <p className="mb-2 mt-3 text-sm font-medium text-slate-700">{t('creation.qui_evacue')}</p>
          <div className="flex flex-col gap-2">
            {EVACUATION_PAR.map((valeur) => (
              <button
                key={valeur}
                type="button"
                onClick={() => setEvacuationPar(valeur)}
                aria-pressed={evacuationPar === valeur}
                className={`min-h-12 rounded-xl px-3 text-start text-sm font-medium ring-1 ${
                  evacuationPar === valeur
                    ? 'bg-slate-900 text-white ring-slate-900'
                    : 'bg-white text-slate-700 ring-slate-300'
                }`}
              >
                {t(`evacuation.${valeur}`)}
              </button>
            ))}
          </div>

          <div className="mt-3 flex flex-col gap-3">
            <Champ label={t('creation.contact_nom')}>
              <input
                type="text"
                value={contactNom}
                onChange={(e) => setContactNom(e.target.value)}
                maxLength={120}
                className={classesSaisie}
              />
            </Champ>
            <Champ label={t('creation.contact_tel')}>
              <input
                type="tel"
                value={contactTel}
                onChange={(e) => setContactTel(e.target.value)}
                maxLength={30}
                dir="ltr"
                className={`${classesSaisie} text-start`}
              />
            </Champ>
          </div>

          {/* L'acquittement n'apparaît que dans le cas dégradé — le rendre
              permanent banaliserait le geste. */}
          {evacuationPar === 'non_confirme' && (
            <label className="mt-3 flex items-start gap-3 rounded-xl bg-orange-50 p-3 ring-2 ring-orange-400">
              <input
                type="checkbox"
                checked={acquitte}
                onChange={(e) => setAcquitte(e.target.checked)}
                className="mt-0.5 size-5 shrink-0 accent-orange-600"
              />
              <span className="text-sm font-medium text-orange-900">{t('creation.acquitter')}</span>
            </label>
          )}
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-lg gap-2">
          <Bouton
            variante="secondaire"
            className="flex-1"
            disabled={!complet}
            onClick={() => void soumettre(false)}
          >
            {t('creation.creer')}
          </Bouton>
          <Bouton
            className="flex-1"
            disabled={!complet || !publiable}
            onClick={() => void soumettre(true)}
          >
            {t('creation.publier_direct')}
          </Bouton>
        </div>
      </div>
    </Cadre>
  );
}
