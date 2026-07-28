/**
 * Numéro de téléphone par SMS — vérification *et* connexion.
 *
 * Les deux parcours sont le même échange : `POST /auth/otp/verifier` renvoie le
 * compte propriétaire du numéro s'il en existe un, et rattache le numéro au
 * compte courant sinon. Une seule feuille, deux libellés (`connexion`), plutôt
 * que deux écrans qui divergeraient.
 *
 * Vérifier reste facultatif pour contribuer (arbitrage Q2) — mais le numéro est
 * la seule chose qui permette de retrouver son compte depuis un autre appareil.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client';
import { enregistrerSession } from '../api/session';
import { Bandeau, Bouton, Champ, Feuille, classesSaisie } from '../components/ui';

export function VerificationFeuille({
  ouverte,
  onFermer,
  onVerifie,
  connexion = false,
}: {
  ouverte: boolean;
  onFermer: () => void;
  onVerifie?: () => void;
  /** Ouverte depuis « J'ai déjà un compte » : mêmes appels, autres libellés. */
  connexion?: boolean;
}) {
  const { t } = useTranslation();
  const [etape, setEtape] = useState<'numero' | 'code'>('numero');
  const [telephone, setTelephone] = useState('');
  const [code, setCode] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, unknown> | null>(null);

  const echouer = (err: unknown): void => {
    if (err instanceof ApiError) {
      setErreur(err.messageKey);
      setDetails(err.details ?? null);
    } else {
      setErreur('erreurs.interne');
    }
  };

  const demander = async (): Promise<void> => {
    setEnvoi(true);
    setErreur(null);
    try {
      await api.demanderCodeSms(telephone.trim());
      setEtape('code');
    } catch (err) {
      echouer(err);
    } finally {
      setEnvoi(false);
    }
  };

  const valider = async (): Promise<void> => {
    setEnvoi(true);
    setErreur(null);
    try {
      const reponse = await api.verifierCodeSms(telephone.trim(), code.trim());
      enregistrerSession(reponse.user, reponse.token);
      onVerifie?.();
      onFermer();
    } catch (err) {
      echouer(err);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Feuille
      ouverte={ouverte}
      onFermer={onFermer}
      titre={t(connexion ? 'verification.titre_connexion' : 'verification.titre')}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-600">
          {t(connexion ? 'verification.explication_connexion' : 'verification.explication')}
        </p>
        {erreur !== null && <Bandeau ton="erreur">{t(erreur, details ?? {})}</Bandeau>}

        {etape === 'numero' ? (
          <>
            <Champ label={t('verification.telephone')}>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={telephone}
                onChange={(e) => setTelephone(e.target.value)}
                placeholder={t('verification.telephone_exemple')}
                // Le numéro reste en LTR même dans une interface arabe.
                dir="ltr"
                className={`${classesSaisie} text-start`}
              />
            </Champ>
            <Bouton
              pleineLargeur
              disabled={telephone.trim().length < 8 || envoi}
              onClick={() => void demander()}
            >
              {t('verification.envoyer')}
            </Bouton>
          </>
        ) : (
          <>
            <Champ label={t('verification.code')}>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                dir="ltr"
                className={`${classesSaisie} text-center text-2xl tracking-[0.4em]`}
              />
            </Champ>
            <Bouton pleineLargeur disabled={code.length !== 6 || envoi} onClick={() => void valider()}>
              {t('verification.valider')}
            </Bouton>
            <button
              type="button"
              onClick={() => {
                setEtape('numero');
                setCode('');
              }}
              className="min-h-11 text-sm text-slate-500 underline underline-offset-2"
            >
              {t('verification.renvoyer')}
            </button>
          </>
        )}
      </div>
    </Feuille>
  );
}
