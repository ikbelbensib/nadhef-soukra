import express, { type Express } from 'express';
import compression from 'compression';
import helmet from 'helmet';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { router } from './routes/index.js';
import { routerEcriture } from './routes/ecriture.js';
import { routerChantiers } from './routes/chantiers.js';
import { routerGamification } from './routes/gamification.js';
import { routerAdmin } from './routes/admin.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { lireDevice, sessionOptionnelle } from './middleware/context.js';
import { limiteGlobale } from './middleware/rateLimit.js';
import { CHEMIN_UPLOADS } from './services/storage.js';
import { injecterMetadonnees, metadonneesPartage } from './services/partage.js';
import { env, isProd } from './env.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = join(HERE, '..', '..', 'client', 'dist');
const TILES_DIR = join(HERE, '..', 'data', 'tiles');

export function createApp(): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.use(
    helmet({
      // MapLibre construit ses tuiles vectorielles via des workers et des blobs.
      contentSecurityPolicy: isProd
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
              workerSrc: ["'self'", 'blob:'],
              imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
              connectSrc: ["'self'", 'https:'],
              styleSrc: ["'self'", "'unsafe-inline'"],
              fontSrc: ["'self'", 'data:'],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cors({ origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',') }));
  app.use(compression());
  app.use(express.json({ limit: '256kb' }));

  app.use('/api', limiteGlobale, lireDevice, sessionOptionnelle());
  app.use('/api', router);
  app.use('/api', routerEcriture);
  app.use('/api', routerChantiers);
  app.use('/api', routerGamification);
  app.use('/api', routerAdmin);

  // Photos en stockage disque (défaut sans R2). Clés aléatoires, contenu
  // immuable : on peut mettre en cache agressivement.
  if (existsSync(CHEMIN_UPLOADS)) {
    app.use('/uploads', express.static(CHEMIN_UPLOADS, { maxAge: '365d', immutable: true }));
  }

  // Les .pmtiles se lisent par requêtes Range : sans accept-ranges, MapLibre
  // téléchargerait le fichier entier à chaque tuile.
  if (existsSync(TILES_DIR)) {
    app.use(
      '/tiles',
      express.static(TILES_DIR, {
        acceptRanges: true,
        maxAge: '30d',
        setHeaders: (res) => res.setHeader('Access-Control-Allow-Origin', '*'),
      }),
    );
  }

  // En production le serveur sert aussi le build du client (image Docker unique).
  if (existsSync(CLIENT_DIST)) {
    const indexPath = join(CLIENT_DIST, 'index.html');
    app.use(express.static(CLIENT_DIST, { maxAge: '1h', index: false }));

    // Les robots d'aperçu (WhatsApp, Facebook) n'exécutent pas le JavaScript :
    // sans injection, un lien partagé vers un spot n'aurait aucun aperçu.
    app.get('/spot/:id', (req, res, next) => {
      void (async () => {
        try {
          const meta = await metadonneesPartage(req.params.id);
          if (!meta) {
            res.sendFile(indexPath);
            return;
          }
          const html = await readFile(indexPath, 'utf8');
          res.type('html').send(injecterMetadonnees(html, meta));
        } catch (err) {
          next(err);
        }
      })();
    });

    app.get(/^(?!\/api|\/tiles|\/uploads).*/, (_req, res) => {
      res.sendFile(indexPath);
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
