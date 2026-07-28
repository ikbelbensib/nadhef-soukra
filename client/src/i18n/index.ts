/**
 * i18next. L'arabe est la langue par défaut et la direction RTL est appliquée
 * sur <html> — toute chaîne affichée passe par t(), dès le premier jour.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './ar.json';
import fr from './fr.json';

export const LANGUES = ['ar', 'fr'] as const;
export type Langue = (typeof LANGUES)[number];

const STORAGE_KEY = 'nadhef.langue';

function langueInitiale(): Langue {
  const stockee = localStorage.getItem(STORAGE_KEY);
  if (stockee === 'ar' || stockee === 'fr') return stockee;
  // Le français n'est proposé d'emblée qu'à un navigateur explicitement francophone.
  return navigator.language.startsWith('fr') ? 'fr' : 'ar';
}

export function appliquerDirection(langue: Langue): void {
  const html = document.documentElement;
  html.lang = langue;
  html.dir = langue === 'ar' ? 'rtl' : 'ltr';
}

void i18n.use(initReactI18next).init({
  resources: { ar: { translation: ar }, fr: { translation: fr } },
  lng: langueInitiale(),
  fallbackLng: 'ar',
  interpolation: { escapeValue: false },
  returnNull: false,
});

appliquerDirection(i18n.language as Langue);

export async function changerLangue(langue: Langue): Promise<void> {
  await i18n.changeLanguage(langue);
  localStorage.setItem(STORAGE_KEY, langue);
  appliquerDirection(langue);
}

export default i18n;
