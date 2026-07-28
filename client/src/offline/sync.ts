/**
 * Vidage de la file hors ligne.
 *
 * Déclencheurs : retour du réseau (`online`) et retour au premier plan
 * (`visibilitychange`). Volontairement PAS la Background Sync API — Safari ne
 * l'implémente pas, et s'appuyer dessus reviendrait à perdre silencieusement
 * les signalements de tous les utilisateurs iPhone.
 */

import { api } from '../api/client';
import {
  listerEnAttente,
  marquer,
  retirer,
  type SignalementEnFile,
} from './queue';

let enCours = false;

export interface BilanSync {
  envoyes: number;
  doublons: number;
  echecs: number;
}

async function envoyer(entree: SignalementEnFile): Promise<'envoye' | 'doublon'> {
  let photoUrl: string | undefined;
  if (entree.photo) {
    const { url } = await api.televerser(entree.photo);
    photoUrl = url;
  }
  const resultat = await api.creerSpot({
    ...entree.charge,
    idempotency_key: entree.id,
    ...(photoUrl !== undefined ? { photo_url: photoUrl } : {}),
  });
  return resultat.statut === 'doublon' ? 'doublon' : 'envoye';
}

export async function viderLaFile(): Promise<BilanSync> {
  const bilan: BilanSync = { envoyes: 0, doublons: 0, echecs: 0 };
  // Un seul vidage à la fois : `online` et `visibilitychange` se déclenchent
  // souvent ensemble, et deux passes concurrentes rejoueraient les mêmes envois.
  if (enCours || !navigator.onLine) return bilan;
  enCours = true;

  try {
    for (const entree of await listerEnAttente()) {
      await marquer(entree.id, 'en_cours');
      try {
        const resultat = await envoyer(entree);
        // Un doublon détecté côté serveur est un succès du point de vue de la
        // file : le point noir est bien enregistré, sur le spot existant.
        if (resultat === 'doublon') bilan.doublons++;
        else bilan.envoyes++;
        await retirer(entree.id);
      } catch (err) {
        bilan.echecs++;
        await marquer(entree.id, 'echec', err instanceof Error ? err.message : String(err));
        // Une panne réseau touchera aussi les suivants : inutile d'insister.
        if (!navigator.onLine) break;
      }
    }
  } finally {
    enCours = false;
  }
  return bilan;
}

export function demarrerSynchronisation(surBilan?: (bilan: BilanSync) => void): () => void {
  const declencher = (): void => {
    void viderLaFile().then((bilan) => {
      if (bilan.envoyes + bilan.doublons + bilan.echecs > 0) surBilan?.(bilan);
    });
  };

  const surVisibilite = (): void => {
    if (document.visibilityState === 'visible') declencher();
  };

  window.addEventListener('online', declencher);
  document.addEventListener('visibilitychange', surVisibilite);
  declencher();

  return () => {
    window.removeEventListener('online', declencher);
    document.removeEventListener('visibilitychange', surVisibilite);
  };
}
