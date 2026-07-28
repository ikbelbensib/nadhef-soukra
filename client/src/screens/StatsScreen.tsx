/**
 * Statistiques publiques.
 *
 * Page pensée pour être partagée et pour parler à une municipalité ou à un
 * bailleur. D'où le choix des chiffres : pas de vanité (« X signalements ! »),
 * mais des résultats — kilos, points fermés, et surtout le **taux de récidive**,
 * seul indicateur qui dise si un nettoyage a tenu.
 *
 * Les quatre chiffres de tête sont des tuiles, pas un graphique : une valeur
 * unique se lit mieux en grand qu'en barre. Le seul graphique est la tendance
 * sur douze mois, où la comparaison dans le temps justifie une forme.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, type StatsDto } from '../api/client';
import { Bandeau, Chargement, Bouton } from '../components/ui';
import { Cadre } from './EventsScreen';

/**
 * Deux séries, deux teintes validées : indigo et émeraude passent les six
 * contrôles (bande de clarté, chroma, séparation deutan/tritan, contraste).
 * Elles sont volontairement distinctes de l'échelle de gravité vert→rouge, qui
 * reste réservée à la sévérité des points noirs.
 */
const SERIE_SIGNALES = '#4f46e5';
const SERIE_NETTOYES = '#059669';

export function StatsScreen() {
  const { t, i18n } = useTranslation();
  const enArabe = i18n.language === 'ar';
  const [stats, setStats] = useState<StatsDto | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [partage, setPartage] = useState(false);

  useEffect(() => {
    let annule = false;
    void api
      .stats()
      .then((s) => {
        if (!annule) setStats(s);
      })
      .catch((err: unknown) => {
        if (!annule) setErreur(err instanceof ApiError ? err.messageKey : 'erreurs.reseau');
      });
    return () => {
      annule = true;
    };
  }, []);

  if (erreur !== null) {
    return (
      <Cadre titre={t('stats.titre')}>
        <Bandeau ton="erreur">{t(erreur)}</Bandeau>
      </Cadre>
    );
  }
  if (stats === null) {
    return (
      <Cadre titre={t('stats.titre')}>
        <Chargement texte={t('app.chargement')} />
      </Cadre>
    );
  }

  const locale = enArabe ? 'ar-TN' : 'fr-FR';
  const nombre = (n: number): string => n.toLocaleString(locale);
  const partager = async (): Promise<void> => {
    const url = `${window.location.origin}/statistiques`;
    if (navigator.share) {
      try {
        await navigator.share({ title: t('stats.titre'), url });
        return;
      } catch {
        /* annulé */
      }
    }
    await navigator.clipboard.writeText(url);
    setPartage(true);
    setTimeout(() => setPartage(false), 2500);
  };

  return (
    <Cadre titre={t('stats.titre')}>
      <div className="flex flex-col gap-6">
        <p className="-mt-2 text-xs text-slate-500">
          {t('stats.sous_titre', {
            date: new Date(stats.genere_le).toLocaleDateString(locale, {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }),
          })}
        </p>

        {partage && <Bandeau ton="succes">{t('spot.lien_copie')}</Bandeau>}

        {/* Quatre chiffres de tête. Une valeur unique se lit en grand. */}
        <div className="grid grid-cols-2 gap-2">
          <Tuile valeur={nombre(stats.chantiers.kg_collectes)} libelle={t('stats.kg')} />
          <Tuile valeur={nombre(stats.spots.nettoyes)} libelle={t('stats.spots_fermes')} />
          <Tuile valeur={nombre(stats.chantiers.realises)} libelle={t('stats.chantiers')} />
          <Tuile
            valeur={`${stats.spots.taux_recidive} %`}
            libelle={t('stats.taux_recidive')}
            aide={t('stats.taux_recidive_aide')}
          />
        </div>

        <Evolution historique={stats.historique} locale={locale} />

        <Section titre={t('stats.par_quartier')}>
          <Barres
            lignes={stats.par_quartier.map((q) => ({
              cle: q.quartier_id,
              libelle: enArabe ? q.nom_ar : q.nom_fr,
              a: q.spots_actifs,
              b: q.spots_nettoyes,
            }))}
            locale={locale}
          />
        </Section>

        <Section titre={t('stats.par_type')}>
          <Barres
            lignes={stats.par_type.map((ty) => ({
              cle: ty.type,
              libelle: t(`type.${ty.type}`),
              a: ty.total - ty.nettoyes,
              b: ty.nettoyes,
            }))}
            locale={locale}
          />
        </Section>

        <Section titre={t('stats.tableau')}>
          <dl className="divide-y divide-slate-200 rounded-xl bg-white text-sm ring-1 ring-slate-200">
            <Ligne libelle={t('stats.spots_actifs')} valeur={nombre(stats.spots.actifs)} />
            <Ligne libelle={t('stats.a_verifier')} valeur={nombre(stats.spots.a_verifier)} />
            <Ligne libelle={t('stats.archives')} valeur={nombre(stats.spots.archives)} />
            <Ligne libelle={t('stats.participations')} valeur={nombre(stats.chantiers.participations)} />
            <Ligne libelle={t('stats.contributeurs')} valeur={nombre(stats.communaute.contributeurs)} />
            <Ligne libelle={t('stats.confirmations')} valeur={nombre(stats.communaute.confirmations)} />
            {/* Chiffre inconfortable, affiché quand même : c'est le mode
                d'échec principal, et le masquer serait malhonnête. */}
            <Ligne
              libelle={t('stats.sans_evacuation')}
              valeur={nombre(stats.chantiers.sans_evacuation_confirmee)}
              alerte={stats.chantiers.sans_evacuation_confirmee > 0}
            />
          </dl>
        </Section>

        <Bouton variante="secondaire" pleineLargeur onClick={() => void partager()}>
          {t('stats.partager')}
        </Bouton>
      </div>
    </Cadre>
  );
}

function Tuile({ valeur, libelle, aide }: { valeur: string; libelle: string; aide?: string }) {
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
      <p className="text-2xl font-bold tabular-nums text-slate-900">{valeur}</p>
      <p className="mt-0.5 text-xs leading-tight text-slate-600">{libelle}</p>
      {aide !== undefined && <p className="mt-1 text-[10px] leading-tight text-slate-400">{aide}</p>}
    </div>
  );
}

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">{titre}</h2>
      {children}
    </section>
  );
}

function Ligne({ libelle, valeur, alerte }: { libelle: string; valeur: string; alerte?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <dt className="text-slate-600">{libelle}</dt>
      <dd className={`font-semibold tabular-nums ${alerte ? 'text-orange-700' : 'text-slate-900'}`}>
        {valeur}
      </dd>
    </div>
  );
}

/** Légende commune aux deux séries — l'identité ne repose jamais sur la seule couleur. */
function Legende() {
  const { t } = useTranslation();
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
      {[
        { couleur: SERIE_SIGNALES, texte: t('stats.signales') },
        { couleur: SERIE_NETTOYES, texte: t('stats.nettoyes') },
      ].map((s) => (
        <span key={s.texte} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ backgroundColor: s.couleur }} />
          {s.texte}
        </span>
      ))}
    </div>
  );
}

function Evolution({
  historique,
  locale,
}: {
  historique: { mois: string; signales: number; nettoyes: number }[];
  locale: string;
}) {
  const { t } = useTranslation();
  if (historique.length === 0) {
    return (
      <Section titre={t('stats.evolution')}>
        <p className="text-sm text-slate-500">{t('stats.aucune_donnee')}</p>
      </Section>
    );
  }
  const max = Math.max(...historique.map((h) => Math.max(h.signales, h.nettoyes)), 1);

  return (
    <Section titre={t('stats.evolution')}>
      <Legende />
      <div className="overflow-x-auto">
        <div className="flex min-w-full items-end gap-2" style={{ height: 140 }}>
          {historique.map((h) => {
            const mois = new Date(`${h.mois}-01T00:00:00Z`);
            return (
              <div key={h.mois} className="flex min-w-10 flex-1 flex-col items-center gap-1">
                {/* Deux barres fines séparées de 2 px, ancrées à la ligne de base. */}
                <div className="flex h-28 w-full items-end justify-center gap-0.5">
                  <span
                    className="w-2.5 rounded-t"
                    style={{
                      height: `${Math.max(2, (h.signales / max) * 100)}%`,
                      backgroundColor: SERIE_SIGNALES,
                    }}
                    title={`${t('stats.signales')} : ${h.signales}`}
                  />
                  <span
                    className="w-2.5 rounded-t"
                    style={{
                      height: `${Math.max(2, (h.nettoyes / max) * 100)}%`,
                      backgroundColor: SERIE_NETTOYES,
                    }}
                    title={`${t('stats.nettoyes')} : ${h.nettoyes}`}
                  />
                </div>
                <span className="text-[10px] text-slate-500">
                  {mois.toLocaleDateString(locale, { month: 'short' })}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

/** Barres empilées horizontales : actifs / nettoyés, avec les valeurs en clair. */
function Barres({
  lignes,
  locale,
}: {
  lignes: { cle: string; libelle: string; a: number; b: number }[];
  locale: string;
}) {
  const { t } = useTranslation();
  const max = Math.max(...lignes.map((l) => l.a + l.b), 1);

  return (
    <>
      <Legende />
      <ul className="flex flex-col gap-2">
        {lignes.map((l) => (
          <li key={l.cle}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-slate-700">{l.libelle}</span>
              <span className="shrink-0 tabular-nums text-slate-500">
                {l.a.toLocaleString(locale)} {t('stats.actifs_courts')} ·{' '}
                {l.b.toLocaleString(locale)} {t('stats.nettoyes_courts')}
              </span>
            </div>
            <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-slate-100">
              <span
                style={{ width: `${(l.a / max) * 100}%`, backgroundColor: SERIE_SIGNALES }}
                className="rounded-full"
              />
              <span
                style={{ width: `${(l.b / max) * 100}%`, backgroundColor: SERIE_NETTOYES }}
                className="rounded-full"
              />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
