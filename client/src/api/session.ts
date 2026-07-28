/**
 * Session locale.
 *
 * L'identifiant d'appareil est créé au premier lancement et persiste : il rend
 * le signalement anonyme possible (règle #5) tout en donnant une prise contre
 * le spam. Le jeton n'apparaît qu'après création d'un compte léger.
 */

import type { UserRole } from '@nadhef/shared';

const CLE_DEVICE = 'nadhef.device';
const CLE_JETON = 'nadhef.token';
const CLE_USER = 'nadhef.user';

export interface UtilisateurLocal {
  id: string;
  pseudo: string;
  role: UserRole;
  quartier_id: string | null;
  points: number;
  is_verified: boolean;
}

export function idAppareil(): string {
  let id = localStorage.getItem(CLE_DEVICE);
  if (id === null || !/^[0-9a-f-]{36}$/i.test(id)) {
    id = crypto.randomUUID();
    localStorage.setItem(CLE_DEVICE, id);
  }
  return id;
}

export const jeton = (): string | null => localStorage.getItem(CLE_JETON);

export function utilisateur(): UtilisateurLocal | null {
  const brut = localStorage.getItem(CLE_USER);
  if (brut === null) return null;
  try {
    return JSON.parse(brut) as UtilisateurLocal;
  } catch {
    return null;
  }
}

export function enregistrerSession(user: UtilisateurLocal, token: string): void {
  localStorage.setItem(CLE_JETON, token);
  localStorage.setItem(CLE_USER, JSON.stringify(user));
  notifier();
}

export function effacerSession(): void {
  localStorage.removeItem(CLE_JETON);
  localStorage.removeItem(CLE_USER);
  notifier();
}

type Abonne = () => void;
const abonnes = new Set<Abonne>();

export function surChangementSession(abonne: Abonne): () => void {
  abonnes.add(abonne);
  return () => abonnes.delete(abonne);
}

const notifier = (): void => {
  for (const a of abonnes) a();
};
