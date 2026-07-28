# Nadhef Soukra · نظّف سكرة

PWA citoyenne de cartographie et de résorption des points noirs de déchets,
limitée à la commune de **La Soukra** (Ariana, Tunisie).

> Conception, règles et découpage : voir **[PLAN.md](PLAN.md)**.
> État actuel : **les cinq phases (0 à 4) sont terminées.**

---

## Démarrer

### En une commande (Docker)

```bash
docker compose up --build
```

→ <http://localhost:3000> · migrations et seed appliqués au démarrage.

### Sans Docker

Le conteneur ne fait rien de particulier : il construit puis lance Node. Le même
résultat, en deux commandes :

```bash
npm run build
NODE_ENV=production PHONE_PEPPER=… JWT_SECRET=… node server/dist/index.js
```

Un seul processus, un seul port : l'API **et** le client bâti sont servis par
Express (`server/src/app.ts`), le repli SPA renvoyant `index.html` sur toute
route inconnue. C'est ce qui permet un déploiement sur n'importe quel hébergeur
Node (Render en runtime natif, Railway, une VM) sans image à construire.

### En développement

```bash
npm install
npm run boundaries      # une fois : frontières OSM (mises en cache ensuite)
npm run migrate -w server
npm run seed    -w server
npm run dev             # API sur :3000, client sur :5173
```

| Commande | Effet |
|---|---|
| `npm run dev` | serveur + client, rechargement à chaud |
| `npm test` | tests de logique métier (48) |
| `npm run typecheck` | TypeScript strict sur les trois paquets |
| `npm run reset -w server` | efface la base locale, remigre, reseed |
| `npm run boundaries -- --refresh` | force un nouvel appel Overpass |

---

## Structure

```
shared/   types, schémas Zod, géométrie, décroissance, barème — logique pure, testée
server/   Express + libSQL, SQL brut, migrations, seed, geofence
client/   React + Vite + Tailwind v4, MapLibre, PWA, i18n ar/fr RTL
```

---

## Ce qui tourne aujourd'hui

- **Carte** MapLibre : heatmap pondéré par la gravité (< z14), marqueurs
  clusterisés (≥ z14), limite communale et 7 secteurs, bornée à La Soukra.
  Filtres type / gravité / statut / quartier / archives.
- **Signalement en trois taps** : gravité, type, envoyer. Photo, description et
  ajustement de position facultatifs. Photo compressée en WebP 1280 px.
- **File hors ligne** : en cas d'échec réseau le signalement part en IndexedDB
  et s'envoie au retour du réseau ou au retour de l'app au premier plan.
- **Confirmations** : « Toujours là » relance la péremption ; « C'est propre »
  ferme le spot sous conditions strictes.
- **Décroissance** : 45 j → à vérifier (opacité 40 %), 90 j → hors vue par défaut.
- **Comptes légers** (pseudo + appareil), points, signalement d'abus.
- **Chantiers** : création avec bloc évacuation obligatoire, publication bloquée
  sans filière confirmée ou acquittement explicite, inscription en un tap.
- **Jour J** : QR de présence rotatif toutes les 30 s, liste des présents en
  direct, check-in par code ou par position (150 m), clôture avec photos
  avant/après et kilos collectés.
- **Vérification du numéro** par SMS (`ConsoleSmsProvider` en développement),
  exigée seulement pour organiser un chantier.
- **Interface arabe RTL par défaut**, bascule français, aucune chaîne en dur.
- **Seed** : 7 quartiers réels, 30 spots (16 frais · 7 à vérifier · 7 archivés),
  22 confirmations, 2 chantiers, 1 admin, 3 citoyens, 9 badges.

- **Classements** : quartiers normalisés par habitant sur fenêtre glissante de
  90 jours avec seuil d'activité, et citoyens (comptes vérifiés uniquement).
- **Badges** décrits en données, réévalués au gain de points et à la lecture.
- **Statistiques publiques** partageables : kilos, points fermés, taux de
  récidive, tendance sur douze mois, répartition par quartier et par type.

- **Modération** : file d'attente, décisions tracées, masquage automatique,
  bannissements, journal d'audit. Back-office dans la même PWA, route protégée
  par rôle côté serveur.
- **Exports CSV** pour la municipalité : points noirs, chantiers, synthèse par
  quartier. BOM UTF-8, séparateur point-virgule, formules neutralisées.

## Ce qu'il reste avant une mise en ligne

- Brancher un vrai fournisseur SMS derrière `SmsProvider` (voir arbitrage Q2).
- Remplacer les `population_estimee` par des chiffres INS avant de publier le
  classement normalisé.
- Générer un extrait Protomaps et le déposer dans `server/data/tiles/`.
- Faire tourner `docker compose up --build` au moins une fois (jamais vérifié,
  voir PLAN.md Phase 0) — **ou déployer sans Docker**, le chemin production
  (`npm run build` + `node server/dist/index.js`) étant, lui, vérifié.
- Changer `PHONE_PEPPER` et `JWT_SECRET` — le serveur refuse de démarrer en
  production s'ils gardent leur valeur de développement.

---

## Données géographiques

`server/data/*.geojson` est **généré** depuis OpenStreetMap, pas écrit à la main :

```bash
npm run boundaries
```

La Tunisie n'utilise pas `admin_level=8`. La hiérarchie OSM y est
`4 = gouvernorat · 5 = délégation · 6 = secteur (imada)`. La Soukra correspond
donc à la **relation 4184709** (Délégation Soukra, `ref:tn:codegeo=1252`), et ses
quartiers aux 7 secteurs qu'elle contient :

| codegeo | id | nom | population estimée |
|---|---|---|---|
| 125251 | `soukra` | سكرة | 34 000 |
| 125252 | `dar-fadhal` | دار فضال | 18 000 |
| 125253 | `el-bassatine` | البساتين | 16 000 |
| 125254 | `chotrana` | شطرانة | 39 000 |
| 125255 | `borj-louzir` | برج الوزير | 28 000 |
| 125256 | `ennassim` | النسيم | 14 000 |
| 125257 | `ettaamir` | التعمير | 11 000 |

⚠️ Les populations sont des **estimations de projet**, pas des chiffres INS.
Elles pilotent le classement normalisé par habitant : à valider avant toute
publication de ce classement (Phase 3).

---

## Fond de carte

Aucune dépendance à Google Maps, ni à un service facturé au chargement.

- **Avec tuiles** : déposez un extrait Protomaps dans `server/data/tiles/soukra.pmtiles`
  (générable sur <https://protomaps.com/extract> à partir de la bbox de la commune).
  Il est servi en local avec support des requêtes Range.
- **Sans tuiles** : l'application bascule automatiquement sur un **fond
  schématique** construit à partir de nos propres polygones. Tout reste
  fonctionnel, on perd seulement le détail des rues. C'est ce qui permet à
  `docker compose up` de marcher sans aucun actif externe.

La carte ne dessine **aucun texte** : les noms de quartiers sont des marqueurs
HTML, où le navigateur applique la vraie police arabe et sa mise en forme
contextuelle. Cela évite les glyphes SDF, le greffon RTL de MapLibre et toute
dépendance à un domaine externe. Pour rétablir des étiquettes vectorielles, il
suffira de servir des glyphes sous `/fonts/{fontstack}/{range}.pbf` : ils sont
détectés automatiquement.

---

## Configuration

Copiez `.env.example` en `.env`. Deux variables méritent attention :

- **`PHONE_PEPPER`** — les numéros sont stockés en `HMAC-SHA256(numéro, pepper)`.
  Un `sha256(numéro + sel)` serait brute-forçable : l'espace des numéros
  tunisiens tient dans 10⁸. Le pepper ne doit jamais être en base ni commité.
- **`JWT_SECRET`** — le serveur refuse de démarrer en production si l'une des
  deux garde sa valeur de développement.

---

## Notes d'implémentation

Trois points où l'évidence a été démentie par les faits ; les commentaires du
code et les tests les verrouillent.

**La dédup à 30 m ne peut pas reposer sur les geohash.** Une cellule de
précision 8 mesure ≈ 38 × 19 m, et le bloc 3×3 des voisines ne garantit qu'une
portée d'environ 19 m en latitude : un doublon à 30 m plein nord passe au
travers. La recherche se fait par bbox sur `(lat, lng)` indexés puis filtre
haversine exact. Un test échouerait si l'on revenait au voisinage de geohash.

**La fraîcheur est dérivée, jamais stockée.** Elle se calcule à la lecture
depuis `last_confirmed_at`. Le job nocturne n'écrit `statut = 'a_verifier'` que
pour les exports : si le cron meurt, la carte reste juste.

**La carte reçoit ses données dans son style, pas après coup.** Muter la carte
depuis un gestionnaire `load` supposait que l'événement se déclenche *et* arrive
après notre abonnement ; toute dérive de minutage produisait une carte vide et
silencieuse. Désormais une carte existe si et seulement si elle a ses données.

**Un 200 ne prouve pas qu'un actif existe.** Le repli SPA renvoie `index.html`
pour n'importe quel chemin inconnu. La sonde de tuiles vérifie donc la signature
`PMTiles` et celle des glyphes refuse un `content-type` HTML — sans quoi la carte
déclarait une source vectorielle pointant sur du HTML et restait figée avant
`style.load`, sans la moindre erreur.

**Les rappels React ne doivent pas piloter le cycle de vie de la carte.** Passés
en dépendances d'effet, des rappels déclarés en ligne par le parent détruisaient
et reconstruisaient la carte à chaque changement d'état. Ils passent par une
`ref` ; l'effet de montage ne dépend que de la configuration.

---

## Licence des données

Frontières administratives : © contributeurs OpenStreetMap, sous **ODbL**.
