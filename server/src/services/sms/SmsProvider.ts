/**
 * Envoi de SMS, derrière une interface.
 *
 * Le SMS A2P vers la Tunisie est le point le plus susceptible de bloquer un
 * lancement : coût, délais d'homologation, fiabilité variable. L'arbitrage Q2 le
 * sort du chemin critique — un compte léger suffit pour contribuer — mais la
 * vérification reste nécessaire pour organiser un chantier et entrer au
 * classement public. D'où cette abstraction : on développe et on teste avec
 * `ConsoleSmsProvider`, on branche un opérateur le jour venu sans toucher au
 * reste du code.
 */

export interface SmsProvider {
  readonly nom: string;
  envoyer(destinataire: string, message: string): Promise<void>;
}

/** Implémentation de développement : le code s'affiche dans les logs serveur. */
export class ConsoleSmsProvider implements SmsProvider {
  readonly nom = 'console';

  async envoyer(destinataire: string, message: string): Promise<void> {
    // Masqué au-delà des quatre derniers chiffres : les logs de développement
    // finissent régulièrement dans des captures d'écran ou des tickets.
    const masque = destinataire.replace(/.(?=.{4})/g, '•');
    console.log(`\n  ┌─ SMS (${this.nom}) → ${masque}\n  │  ${message}\n  └─\n`);
  }
}

/**
 * Squelette pour un opérateur réel. Volontairement non implémenté : brancher un
 * fournisseur sans contrat ni numéro émetteur donnerait une fausse impression de
 * fonctionnement.
 */
export class SmsProviderNonConfigure implements SmsProvider {
  readonly nom = 'non_configure';

  async envoyer(): Promise<void> {
    throw new Error(
      "Aucun fournisseur SMS configuré. Renseignez SMS_PROVIDER ou gardez 'console' en développement.",
    );
  }
}

export function choisirSmsProvider(nom: string): SmsProvider {
  switch (nom) {
    case 'console':
      return new ConsoleSmsProvider();
    default:
      return new SmsProviderNonConfigure();
  }
}
