/**
 * Signaler un point noir.
 *
 * Objectif d'ergonomie : trois taps maximum jusqu'à l'envoi — gravité, type,
 * envoyer. La photo, la description et l'ajustement de position sont
 * facultatifs. On remplit ce formulaire debout, dans la rue, souvent d'une main.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  GRAVITES,
  NIVEAUX_GRAVITE,
  SPOT_TYPES,
  type Gravite,
  type SpotType,
} from '@nadhef/shared';
import { api, ApiError, type ConfigDto, type ReponsePosition } from '../api/client';
import { PickerCarte } from '../map/PickerCarte';
import { compresserPhoto } from '../offline/image';
import { mettreEnFile } from '../offline/queue';
import { viderLaFile } from '../offline/sync';
import { Bandeau, Bouton, Champ, classesSaisie } from '../components/ui';

interface Props {
  config: ConfigDto;
  positionInitiale?: { lat: number; lng: number };
}

export function ReportScreen({ config, positionInitiale }: Props) {
  const { t } = useTranslation();
  const naviguer = useNavigate();

  const [position, setPosition] = useState(
    positionInitiale ?? {
      lat: (config.commune.bbox.minLat + config.commune.bbox.maxLat) / 2,
      lng: (config.commune.bbox.minLng + config.commune.bbox.maxLng) / 2,
    },
  );
  const [infoPosition, setInfoPosition] = useState<ReponsePosition | null>(null);
  const [gravite, setGravite] = useState<Gravite | null>(null);
  const [type, setType] = useState<SpotType | null>(null);
  const [description, setDescription] = useState('');
  const [proprietePrivee, setProprietePrivee] = useState(false);
  const [photo, setPhoto] = useState<{ blob: Blob; apercu: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [doublon, setDoublon] = useState<{ id: string; distance: number } | null>(null);
  const champPhoto = useRef<HTMLInputElement>(null);

  // Vérification du geofence côté serveur, en direct : l'utilisateur doit savoir
  // AVANT d'appuyer sur « envoyer » que le point est hors commune.
  useEffect(() => {
    let annule = false;
    const minuteur = setTimeout(() => {
      void api
        .positionInfo(position.lat, position.lng)
        .then((info) => {
          if (!annule) setInfoPosition(info);
        })
        .catch(() => {
          if (!annule) setInfoPosition(null);
        });
    }, 350);
    return () => {
      annule = true;
      clearTimeout(minuteur);
    };
  }, [position]);

  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.apercu);
  }, [photo]);

  const choisirPhoto = useCallback(async (fichier: File) => {
    setErreur(null);
    try {
      // Compression avant tout : envoyer 4 Mo sur un réseau de rue, c'est perdre
      // le signalement. Le passage par canvas efface aussi l'EXIF (donc le GPS).
      const compressee = await compresserPhoto(fichier);
      setPhoto({ blob: compressee.blob, apercu: URL.createObjectURL(compressee.blob) });
    } catch {
      setErreur('erreurs.camera_indisponible');
    }
  }, []);

  const utiliserMaPosition = useCallback(() => {
    if (!navigator.geolocation) {
      setErreur('erreurs.position_indisponible');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        setPosition({
          lat: Number(p.coords.latitude.toFixed(6)),
          lng: Number(p.coords.longitude.toFixed(6)),
        }),
      () => setErreur('erreurs.position_indisponible'),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, []);

  const envoyer = useCallback(async () => {
    if (gravite === null || type === null) return;
    setEnvoi(true);
    setErreur(null);
    setDoublon(null);

    const charge = {
      lat: position.lat,
      lng: position.lng,
      type,
      gravite,
      is_private_property: proprietePrivee,
      idempotency_key: crypto.randomUUID(),
      ...(description.trim() ? { description: description.trim() } : {}),
    };

    // Hors ligne : on met en file et on rend la main tout de suite. L'utilisateur
    // ne doit pas rester planté sur un écran de chargement dans la rue.
    if (!navigator.onLine) {
      await mettreEnFile(charge, photo?.blob ?? null);
      void viderLaFile();
      naviguer('/', { state: { message: 'signalement.mis_en_file' } });
      return;
    }

    try {
      let photoUrl: string | undefined;
      if (photo) {
        const { url } = await api.televerser(photo.blob);
        photoUrl = url;
      }
      const reponse = await api.creerSpot({
        ...charge,
        ...(photoUrl !== undefined ? { photo_url: photoUrl } : {}),
      });

      if (reponse.statut === 'doublon') {
        setDoublon({ id: reponse.spot.id, distance: reponse.distance_m });
        setEnvoi(false);
        return;
      }
      naviguer(`/spot/${reponse.spot.id}`, {
        state: {
          message: reponse.points > 0 ? 'signalement.succes_points' : 'signalement.succes',
          points: reponse.points,
          recidive: reponse.recidive,
        },
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NETWORK_ERROR') {
        await mettreEnFile(charge, photo?.blob ?? null);
        naviguer('/', { state: { message: 'signalement.mis_en_file' } });
        return;
      }
      setErreur(err instanceof ApiError ? err.messageKey : 'erreurs.interne');
      setEnvoi(false);
    }
  }, [gravite, type, position, description, proprietePrivee, photo, naviguer]);

  const horsCommune = infoPosition !== null && !infoPosition.dans_commune;
  const pretAEnvoyer = gravite !== null && type !== null && !horsCommune && !envoi;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-slate-50">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <button
          type="button"
          onClick={() => naviguer(-1)}
          aria-label={t('nav.retour')}
          className="flex size-11 items-center justify-center rounded-lg text-slate-600 active:bg-slate-100"
        >
          {/* Miroir automatique en RTL : la flèche « retour » doit suivre la langue. */}
          <svg viewBox="0 0 20 20" className="size-5 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 4l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h1 className="text-base font-semibold text-slate-900">{t('signalement.titre')}</h1>
      </header>

      <div className="flex flex-1 flex-col gap-5 p-4 pb-28">
        {erreur !== null && <Bandeau ton="erreur">{t(erreur)}</Bandeau>}

        {doublon !== null && (
          <Bandeau ton="alerte">
            <p className="font-semibold">{t('signalement.doublon_detecte')}</p>
            <p className="mt-0.5">
              {t('signalement.doublon_explication', { distance: doublon.distance })}
            </p>
            <Bouton
              variante="secondaire"
              className="mt-2"
              onClick={() => naviguer(`/spot/${doublon.id}`)}
            >
              {t('signalement.voir_le_spot')}
            </Bouton>
          </Bandeau>
        )}

        {/* --- Gravité : quatre grandes cibles, c'est le tap n°1 --- */}
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-700">
            {t('signalement.gravite_question')}
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {GRAVITES.map((niveau) => {
              const actif = gravite === niveau;
              return (
                <button
                  key={niveau}
                  type="button"
                  onClick={() => setGravite(niveau)}
                  aria-pressed={actif}
                  className={`flex min-h-20 flex-col items-start justify-center gap-1.5 rounded-xl px-3 py-2 text-start ring-2 transition-colors ${
                    actif ? 'bg-white ring-slate-900' : 'bg-white ring-slate-200'
                  }`}
                >
                  <span
                    className="size-5 rounded-full"
                    style={{ backgroundColor: NIVEAUX_GRAVITE[niveau].couleur }}
                  />
                  <span className="text-sm font-medium leading-tight text-slate-800">
                    {t(`gravite.${niveau}`)}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* --- Type : tap n°2 --- */}
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-700">
            {t('signalement.type_question')}
          </legend>
          <div className="flex flex-wrap gap-2">
            {SPOT_TYPES.map((valeur) => {
              const actif = type === valeur;
              return (
                <button
                  key={valeur}
                  type="button"
                  onClick={() => setType(valeur)}
                  aria-pressed={actif}
                  className={`min-h-11 rounded-full px-4 text-sm font-medium ring-1 transition-colors ${
                    actif
                      ? 'bg-slate-900 text-white ring-slate-900'
                      : 'bg-white text-slate-700 ring-slate-300'
                  }`}
                >
                  {t(`type.${valeur}`)}
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* --- Photo (facultative) --- */}
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">{t('signalement.photo')}</p>
          <input
            ref={champPhoto}
            type="file"
            accept="image/*"
            // `capture` ouvre directement l'appareil photo arrière sur mobile.
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              const fichier = e.target.files?.[0];
              if (fichier) void choisirPhoto(fichier);
            }}
          />
          {photo ? (
            <button
              type="button"
              onClick={() => champPhoto.current?.click()}
              className="block w-full overflow-hidden rounded-xl ring-1 ring-slate-300"
            >
              <img src={photo.apercu} alt="" className="h-44 w-full object-cover" />
              <span className="block bg-white py-2.5 text-sm font-medium text-slate-700">
                {t('signalement.changer_photo')}
              </span>
            </button>
          ) : (
            <Bouton variante="secondaire" pleineLargeur onClick={() => champPhoto.current?.click()}>
              {t('signalement.prendre_photo')}
            </Bouton>
          )}
          {/* Avertissement explicite : on ne fait pas de détection de visages,
              on prévient donc clairement avant la prise de vue. */}
          <p className="mt-2 text-xs text-slate-500">{t('signalement.avertissement_photo')}</p>
        </div>

        {/* --- Position --- */}
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-700">{t('signalement.position')}</p>
            <button
              type="button"
              onClick={utiliserMaPosition}
              className="min-h-11 rounded-lg px-2 text-sm font-medium text-slate-600 active:bg-slate-100"
            >
              {t('carte.ma_position')}
            </button>
          </div>
          <PickerCarte config={config} position={position} onChange={setPosition} />
          <p className="mt-1.5 text-xs text-slate-500">{t('signalement.position_aide')}</p>
          {horsCommune && (
            <div className="mt-2">
              <Bandeau ton="erreur">{t('signalement.hors_commune')}</Bandeau>
            </div>
          )}
          {infoPosition?.limite === true && (
            <div className="mt-2">
              <Bandeau ton="alerte">{t('signalement.en_limite')}</Bandeau>
            </div>
          )}
        </div>

        {/* --- Facultatifs --- */}
        <Champ label={t('signalement.description')}>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder={t('signalement.description_exemple')}
            className={`${classesSaisie} py-2.5`}
          />
        </Champ>

        <label className="flex items-start gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-200">
          <input
            type="checkbox"
            checked={proprietePrivee}
            onChange={(e) => setProprietePrivee(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-slate-900"
          />
          <span>
            <span className="block text-sm font-medium text-slate-800">
              {t('signalement.propriete_privee')}
            </span>
            <span className="mt-0.5 block text-xs text-slate-500">
              {t('signalement.propriete_privee_aide')}
            </span>
          </span>
        </label>
      </div>

      {/* Barre d'envoi fixe : le tap n°3 est toujours atteignable au pouce. */}
      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-lg">
          <Bouton pleineLargeur disabled={!pretAEnvoyer} onClick={() => void envoyer()}>
            {envoi ? t('signalement.envoi_en_cours') : t('signalement.envoyer')}
          </Bouton>
        </div>
      </div>
    </div>
  );
}
