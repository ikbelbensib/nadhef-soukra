/**
 * Compte léger : un pseudo suffit (arbitrage Q2).
 *
 * Le téléphone n'est demandé que pour organiser un chantier ou apparaître au
 * classement public — pas pour contribuer. On sort ainsi le SMS du chemin
 * critique tout en gardant l'incitation à se vérifier.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, type ConfigDto } from '../api/client';
import {
  effacerSession,
  enregistrerSession,
  utilisateur,
  type UtilisateurLocal,
} from '../api/session';
import { Bandeau, Bouton, Champ, Feuille, classesSaisie } from '../components/ui';
import { VerificationFeuille } from './VerificationFeuille';

export function CompteFeuille({
  ouverte,
  config,
  onFermer,
}: {
  ouverte: boolean;
  config: ConfigDto;
  onFermer: () => void;
}) {
  const { t, i18n } = useTranslation();
  const enArabe = i18n.language === 'ar';
  const [user, setUser] = useState<UtilisateurLocal | null>(utilisateur);
  const [pseudo, setPseudo] = useState('');
  const [quartier, setQuartier] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [rattaches, setRattaches] = useState<number | null>(null);
  const [connexion, setConnexion] = useState(false);

  const creer = async (): Promise<void> => {
    setEnvoi(true);
    setErreur(null);
    try {
      const reponse = await api.creerCompteLeger(pseudo.trim(), quartier || undefined);
      enregistrerSession(reponse.user, reponse.token);
      setUser(reponse.user);
      setRattaches(reponse.spots_rattaches);
    } catch (err) {
      setErreur(err instanceof ApiError ? err.messageKey : 'erreurs.interne');
    } finally {
      setEnvoi(false);
    }
  };

  const deconnecter = (): void => {
    effacerSession();
    setUser(null);
    setPseudo('');
  };

  return (
    <>
    {/* Les deux feuilles sont mutuellement exclusives : superposer deux calques
        `fixed inset-0` laisserait le premier cliquable derrière le second. */}
    <Feuille ouverte={ouverte && !connexion} onFermer={onFermer} titre={t('compte.titre')}>
      {user ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <p className="text-base font-semibold text-slate-900">
              {t('compte.connecte', { pseudo: user.pseudo })}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {t('compte.points', { count: user.points })}
            </p>
          </div>

          {rattaches !== null && rattaches > 0 && (
            <Bandeau ton="succes">{t('signalement.succes')}</Bandeau>
          )}

          {/* L'incitation à la vérification, sans jamais bloquer la contribution. */}
          {!user.is_verified && <Bandeau ton="info">{t('compte.non_verifie')}</Bandeau>}

          {/* Accès à la modération : visible seulement pour qui en a le rôle,
              et de toute façon refusé côté serveur pour les autres. */}
          {(user.role === 'moderateur' || user.role === 'admin') && (
            <Bouton
              variante="secondaire"
              pleineLargeur
              onClick={() => {
                onFermer();
                window.location.assign('/moderation');
              }}
            >
              {t('admin.titre')}
            </Bouton>
          )}

          <Bouton variante="secondaire" pleineLargeur onClick={deconnecter}>
            {t('compte.deconnexion')}
          </Bouton>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-slate-600">{t('compte.explication')}</p>
          {erreur !== null && <Bandeau ton="erreur">{t(erreur)}</Bandeau>}

          <Champ label={t('compte.pseudo')}>
            <input
              type="text"
              value={pseudo}
              onChange={(e) => setPseudo(e.target.value)}
              maxLength={32}
              autoComplete="nickname"
              placeholder={t('compte.pseudo_exemple')}
              className={classesSaisie}
            />
          </Champ>

          <Champ label={t('compte.quartier')}>
            <select
              value={quartier}
              onChange={(e) => setQuartier(e.target.value)}
              className={classesSaisie}
            >
              <option value="">—</option>
              {config.quartiers.map((q) => (
                <option key={q.id} value={q.id}>
                  {enArabe ? q.nom_ar : q.nom_fr}
                </option>
              ))}
            </select>
          </Champ>

          <Bouton
            pleineLargeur
            disabled={pseudo.trim().length < 2 || envoi}
            onClick={() => void creer()}
          >
            {envoi ? t('compte.creation') : t('compte.creer')}
          </Bouton>

          {/* Le numéro est le seul identifiant portable : un compte léger vit
              dans l'appareil, un compte vérifié se retrouve n'importe où. */}
          <Bouton variante="secondaire" pleineLargeur onClick={() => setConnexion(true)}>
            {t('compte.deja_compte')}
          </Bouton>
        </div>
      )}
    </Feuille>

    <VerificationFeuille
      connexion
      ouverte={connexion}
      onFermer={() => setConnexion(false)}
      // `utilisateur` est une fonction : l'appeler explicitement, sinon React
      // l'interpréterait comme une mise à jour fonctionnelle.
      onVerifie={() => setUser(utilisateur())}
    />
    </>
  );
}
