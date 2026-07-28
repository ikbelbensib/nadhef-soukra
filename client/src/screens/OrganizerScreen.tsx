/**
 * Mode organisateur, jour J.
 *
 * Le QR est affiché en grand : on le tend à bout de bras, en plein soleil, à des
 * gens qui portent des gants. Il se renouvelle toutes les 30 secondes — un
 * QR figé finirait photographié et partagé, et cinquante points iraient à des
 * absents.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { MIN_PRESENTS_ORGANISATION } from '@nadhef/shared';
import { api, ApiError, type EventDto, type ParticipantDto } from '../api/client';
import { compresserPhoto } from '../offline/image';
import { Bandeau, Bouton, Champ, Chargement, Pastille, classesSaisie } from '../components/ui';
import { Cadre } from './EventsScreen';

export function OrganizerScreen() {
  const { t } = useTranslation();
  const { id = '' } = useParams();

  const [event, setEvent] = useState<EventDto | null>(null);
  const [participants, setParticipants] = useState<ParticipantDto[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const recharger = useCallback(async () => {
    try {
      const [e, p] = await Promise.all([api.event(id), api.participants(id)]);
      setEvent(e);
      setParticipants(p.participants);
    } catch (err) {
      setErreur(err instanceof ApiError ? err.messageKey : 'erreurs.interne');
    }
  }, [id]);

  useEffect(() => {
    void recharger();
    // Les présents arrivent par vagues : on rafraîchit sans que l'organisateur
    // ait à toucher son téléphone, qu'il tient déjà à bout de bras.
    const minuteur = setInterval(() => void recharger(), 10_000);
    return () => clearInterval(minuteur);
  }, [recharger]);

  if (event === null) {
    return (
      <Cadre titre={t('organisateur.titre')}>
        {erreur !== null ? (
          <Bandeau ton="erreur">{t(erreur)}</Bandeau>
        ) : (
          <Chargement texte={t('app.chargement')} />
        )}
      </Cadre>
    );
  }

  const presents = participants.filter((p) => p.statut === 'present');

  return (
    <Cadre titre={event.titre}>
      <div className="flex flex-col gap-5">
        {message !== null && <Bandeau ton="succes">{t(message)}</Bandeau>}
        {erreur !== null && <Bandeau ton="erreur">{t(erreur)}</Bandeau>}

        {event.statut !== 'termine' && <CodePresence eventId={event.id} />}

        <section>
          <h2 className="mb-2 flex items-center justify-between text-sm font-semibold text-slate-700">
            {t('organisateur.participants')}
            <Pastille ton={presents.length >= MIN_PRESENTS_ORGANISATION ? 'succes' : 'neutre'}>
              {t('chantiers.presents', { count: presents.length })}
            </Pastille>
          </h2>
          {participants.length === 0 ? (
            <p className="text-sm text-slate-500">{t('organisateur.aucun_present')}</p>
          ) : (
            <ul className="divide-y divide-slate-200 rounded-xl bg-white ring-1 ring-slate-200">
              {participants.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                  <span className="truncate text-sm text-slate-800">{p.pseudo}</span>
                  {p.statut === 'present' ? (
                    <Pastille ton="succes">{p.method === 'geo' ? 'GPS' : 'QR'}</Pastille>
                  ) : (
                    <Pastille>{t('chantiers.inscrit')}</Pastille>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {event.statut !== 'termine' && (
          <FormulaireCloture
            event={event}
            nbPresents={presents.length}
            onCloture={(points) => {
              setMessage(points > 0 ? 'organisateur.cloture_ok' : 'organisateur.cloture_sans_points');
              void recharger();
            }}
            onErreur={setErreur}
          />
        )}
      </div>
    </Cadre>
  );
}

/** QR plein écran, régénéré à chaque rotation du code. */
function CodePresence({ eventId }: { eventId: string }) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [code, setCode] = useState<string | null>(null);
  const [restant, setRestant] = useState(0);

  useEffect(() => {
    let annule = false;
    let minuteurRafraichissement: ReturnType<typeof setTimeout>;

    const rafraichir = async (): Promise<void> => {
      try {
        const r = await api.codePresence(eventId);
        if (annule) return;
        setCode(r.code);
        setRestant(r.expire_dans_s);
        // On redemande juste après l'expiration annoncée par le serveur :
        // c'est lui qui fait autorité sur l'heure, pas le téléphone.
        minuteurRafraichissement = setTimeout(
          () => void rafraichir(),
          (r.expire_dans_s + 1) * 1000,
        );
      } catch {
        if (!annule) minuteurRafraichissement = setTimeout(() => void rafraichir(), 5000);
      }
    };
    void rafraichir();

    const compteARebours = setInterval(() => setRestant((s) => Math.max(0, s - 1)), 1000);
    return () => {
      annule = true;
      clearTimeout(minuteurRafraichissement);
      clearInterval(compteARebours);
    };
  }, [eventId]);

  useEffect(() => {
    if (code === null || !canvas.current) return;
    void QRCode.toCanvas(canvas.current, code, {
      width: 280,
      margin: 1,
      // Contraste maximal : l'écran sera lu en plein soleil.
      color: { dark: '#0f172a', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    });
  }, [code]);

  return (
    <section className="rounded-2xl bg-white p-4 text-center ring-1 ring-slate-200">
      <h2 className="text-sm font-semibold text-slate-700">{t('organisateur.code_titre')}</h2>
      <div className="mt-3 flex justify-center">
        <canvas ref={canvas} className="rounded-lg" />
      </div>
      {/* Le code en clair sert de repli si l'appareil photo refuse de coopérer. */}
      <p dir="ltr" className="mt-3 text-3xl font-bold tracking-[0.3em] text-slate-900">
        {code ?? '······'}
      </p>
      <p className="mt-1 text-xs text-slate-500">{t('organisateur.expire_dans', { s: restant })}</p>
      <p className="mt-2 text-xs text-slate-500">{t('organisateur.code_aide')}</p>
    </section>
  );
}

function FormulaireCloture({
  event,
  nbPresents,
  onCloture,
  onErreur,
}: {
  event: EventDto;
  nbPresents: number;
  onCloture: (points: number) => void;
  onErreur: (cle: string) => void;
}) {
  const { t } = useTranslation();
  const [kg, setKg] = useState('');
  const [avant, setAvant] = useState<{ url: string; apercu: string } | null>(null);
  const [apres, setApres] = useState<{ url: string; apercu: string } | null>(null);
  const [nettoyes, setNettoyes] = useState<string[]>([]);
  const [envoi, setEnvoi] = useState(false);

  const televerser = async (fichier: File, cible: 'avant' | 'apres'): Promise<void> => {
    try {
      const compressee = await compresserPhoto(fichier);
      const { url } = await api.televerser(compressee.blob);
      const apercu = URL.createObjectURL(compressee.blob);
      if (cible === 'avant') setAvant({ url, apercu });
      else setApres({ url, apercu });
    } catch (err) {
      onErreur(err instanceof ApiError ? err.messageKey : 'erreurs.interne');
    }
  };

  const cloturer = async (): Promise<void> => {
    if (!avant || !apres) return;
    setEnvoi(true);
    try {
      const r = await api.cloturerEvent(event.id, {
        kg_collectes: Number(kg) || 0,
        photo_avant_url: avant.url,
        photo_apres_url: apres.url,
        spots_nettoyes: nettoyes,
      });
      onCloture(r.points_organisateur);
    } catch (err) {
      onErreur(err instanceof ApiError ? err.messageKey : 'erreurs.interne');
    } finally {
      setEnvoi(false);
    }
  };

  const complet = avant !== null && apres !== null && nbPresents >= MIN_PRESENTS_ORGANISATION;

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-200">
      <h2 className="text-sm font-semibold text-slate-700">{t('organisateur.cloturer')}</h2>

      <Champ label={t('organisateur.kg_collectes')}>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          value={kg}
          onChange={(e) => setKg(e.target.value)}
          dir="ltr"
          className={`${classesSaisie} text-start`}
        />
      </Champ>

      <div className="grid grid-cols-2 gap-2">
        <ChampPhoto label={t('organisateur.photo_avant')} photo={avant} onChoisir={(f) => void televerser(f, 'avant')} />
        <ChampPhoto label={t('organisateur.photo_apres')} photo={apres} onChoisir={(f) => void televerser(f, 'apres')} />
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-slate-700">
          {t('organisateur.spots_nettoyes')}
        </p>
        <div className="flex flex-col gap-1.5">
          {event.spots.map((s) => (
            <label key={s.id} className="flex items-center gap-2.5 rounded-lg bg-slate-50 p-2.5">
              <input
                type="checkbox"
                checked={nettoyes.includes(s.id)}
                onChange={(e) =>
                  setNettoyes((v) => (e.target.checked ? [...v, s.id] : v.filter((x) => x !== s.id)))
                }
                className="size-5 shrink-0 accent-slate-900"
              />
              <span className="text-sm text-slate-800">{t(`type.${s.type}`)}</span>
            </label>
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-500">
        {t('organisateur.cloture_aide', { min: MIN_PRESENTS_ORGANISATION })}
      </p>

      <Bouton pleineLargeur disabled={!complet || envoi} onClick={() => void cloturer()}>
        {t('organisateur.cloturer')}
      </Bouton>
    </section>
  );
}

function ChampPhoto({
  label,
  photo,
  onChoisir,
}: {
  label: string;
  photo: { apercu: string } | null;
  onChoisir: (fichier: File) => void;
}) {
  const champ = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input
        ref={champ}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onChoisir(f);
        }}
      />
      <button
        type="button"
        onClick={() => champ.current?.click()}
        className="w-full overflow-hidden rounded-lg ring-1 ring-slate-300"
      >
        {photo ? (
          <img src={photo.apercu} alt="" className="h-24 w-full object-cover" />
        ) : (
          <span className="flex h-24 items-center justify-center bg-slate-50 text-xs text-slate-500">
            {label}
          </span>
        )}
      </button>
    </div>
  );
}
