/**
 * File de signalements hors ligne (règle #7).
 *
 * On signale dans la rue, souvent sans réseau exploitable. Le signalement est
 * donc écrit en IndexedDB — photo comprise, sous forme de Blob — puis envoyé
 * quand le réseau revient.
 *
 * IMPORTANT : la synchronisation ne repose PAS sur la Background Sync API.
 * Safari ne l'implémente pas, et l'iPhone représente une part non négligeable
 * du parc. On se déclenche sur `online` et sur le retour au premier plan.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CreateSpotInput } from '@nadhef/shared';

export type EtatEnvoi = 'en_attente' | 'en_cours' | 'echec';

export interface SignalementEnFile {
  id: string;
  charge: Omit<CreateSpotInput, 'photo_url'>;
  photo: Blob | null;
  etat: EtatEnvoi;
  tentatives: number;
  derniere_erreur: string | null;
  cree_a: string;
}

interface SchemaNadhef extends DBSchema {
  signalements: {
    key: string;
    value: SignalementEnFile;
    indexes: { 'par-etat': EtatEnvoi };
  };
}

const NOM_BASE = 'nadhef';
const VERSION = 1;
const MAX_TENTATIVES = 5;

let basePromise: Promise<IDBPDatabase<SchemaNadhef>> | null = null;

function base(): Promise<IDBPDatabase<SchemaNadhef>> {
  basePromise ??= openDB<SchemaNadhef>(NOM_BASE, VERSION, {
    upgrade(db) {
      const store = db.createObjectStore('signalements', { keyPath: 'id' });
      store.createIndex('par-etat', 'etat');
    },
  });
  return basePromise;
}

export async function mettreEnFile(
  charge: SignalementEnFile['charge'],
  photo: Blob | null,
): Promise<SignalementEnFile> {
  const entree: SignalementEnFile = {
    // `idempotency_key` est un UUID généré à la mise en file : rejouer la file
    // après un envoi partiel ne peut donc pas dupliquer le signalement.
    id: charge.idempotency_key ?? crypto.randomUUID(),
    charge,
    photo,
    etat: 'en_attente',
    tentatives: 0,
    derniere_erreur: null,
    cree_a: new Date().toISOString(),
  };
  await (await base()).put('signalements', entree);
  notifier();
  return entree;
}

export async function listerEnAttente(): Promise<SignalementEnFile[]> {
  const db = await base();
  const tout = await db.getAll('signalements');
  return tout
    .filter((s) => s.etat !== 'en_cours' && s.tentatives < MAX_TENTATIVES)
    .sort((a, b) => a.cree_a.localeCompare(b.cree_a));
}

export async function compterEnAttente(): Promise<number> {
  return (await listerEnAttente()).length;
}

export async function marquer(
  id: string,
  etat: EtatEnvoi,
  erreur?: string,
): Promise<void> {
  const db = await base();
  const entree = await db.get('signalements', id);
  if (!entree) return;
  entree.etat = etat;
  if (etat === 'echec') {
    entree.tentatives += 1;
    entree.derniere_erreur = erreur ?? null;
  }
  await db.put('signalements', entree);
  notifier();
}

export async function retirer(id: string): Promise<void> {
  await (await base()).delete('signalements', id);
  notifier();
}

/** Abandonnés définitivement : à montrer à l'utilisateur, pas à effacer en silence. */
export async function listerEchecsDefinitifs(): Promise<SignalementEnFile[]> {
  const tout = await (await base()).getAll('signalements');
  return tout.filter((s) => s.tentatives >= MAX_TENTATIVES);
}

// --- Notification de changement ---------------------------------------------

type Abonne = () => void;
const abonnes = new Set<Abonne>();

export function surChangementFile(abonne: Abonne): () => void {
  abonnes.add(abonne);
  return () => abonnes.delete(abonne);
}

function notifier(): void {
  for (const abonne of abonnes) abonne();
}

export const MAX_TENTATIVES_FILE = MAX_TENTATIVES;
