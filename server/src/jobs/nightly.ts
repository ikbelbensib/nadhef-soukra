/**
 * Travaux nocturnes.
 *
 * Point important : la carte ne dépend PAS de ce job. La fraîcheur est calculée
 * à la lecture depuis `last_confirmed_at` ; si ce job meurt, l'affichage reste
 * juste. Il n'écrit `statut = 'a_verifier'` que pour les exports municipaux, les
 * statistiques et les requêtes SQL directes, où un statut lisible est attendu.
 */

import { JOURS_AVANT_A_VERIFIER } from '@nadhef/shared';
import { db } from '../db/client.js';

export interface BilanNocturne {
  passes_a_verifier: number;
  otp_purges: number;
  duree_ms: number;
}

export async function travauxNocturnes(): Promise<BilanNocturne> {
  const debut = Date.now();

  // Les spots déjà nettoyés, rejetés ou rattachés à un chantier à venir ne
  // périment pas : leur statut porte une information plus forte que l'âge.
  const perimes = await db.execute({
    sql: `UPDATE spots
             SET statut = 'a_verifier'
           WHERE statut IN ('signale','confirme','recidive')
             AND julianday('now') - julianday(last_confirmed_at) > ?`,
    args: [JOURS_AVANT_A_VERIFIER],
  });

  const otp = await db.execute(
    `DELETE FROM otp_codes WHERE expires_at < datetime('now','-1 day')`,
  );

  return {
    passes_a_verifier: perimes.rowsAffected,
    otp_purges: otp.rowsAffected,
    duree_ms: Date.now() - debut,
  };
}

/**
 * Planification simple : première exécution au prochain 03:15 local, puis
 * toutes les 24 h. Pas de dépendance cron — une seule tâche, un seul processus.
 */
export function planifierTravauxNocturnes(): () => void {
  const HEURE = 3;
  const MINUTE = 15;

  const prochaineExecution = (): number => {
    const maintenant = new Date();
    const cible = new Date(maintenant);
    cible.setHours(HEURE, MINUTE, 0, 0);
    if (cible <= maintenant) cible.setDate(cible.getDate() + 1);
    return cible.getTime() - maintenant.getTime();
  };

  let intervalle: NodeJS.Timeout | null = null;

  const executer = (): void => {
    void travauxNocturnes()
      .then((bilan) =>
        console.log(
          `· travaux nocturnes : ${bilan.passes_a_verifier} spot(s) à vérifier, ` +
            `${bilan.otp_purges} OTP purgé(s) (${bilan.duree_ms} ms)`,
        ),
      )
      .catch((err: Error) => console.error('✗ travaux nocturnes :', err.message));
  };

  const premier = setTimeout(() => {
    executer();
    intervalle = setInterval(executer, 24 * 60 * 60_000);
    intervalle.unref();
  }, prochaineExecution());
  premier.unref();

  return () => {
    clearTimeout(premier);
    if (intervalle) clearInterval(intervalle);
  };
}
