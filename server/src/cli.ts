import { pathToFileURL } from 'node:url';

/**
 * Un module est-il lancé directement (et non importé) ?
 *
 * La comparaison naïve `import.meta.url === 'file://' + process.argv[1]` échoue
 * sous Windows : Node produit `file:///C:/…` (trois barres) là où la
 * concaténation donne `file://C:/…`. pathToFileURL normalise les deux plateformes.
 */
export function estExecuteDirectement(moduleUrl: string): boolean {
  const entree = process.argv[1];
  if (entree === undefined) return false;
  return moduleUrl === pathToFileURL(entree).href;
}
