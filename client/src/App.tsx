import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, ApiError, type ConfigDto } from './api/client';
import { MapScreen } from './screens/MapScreen';
import { ReportScreen } from './screens/ReportScreen';
import { SpotScreen } from './screens/SpotScreen';
import { EventsScreen } from './screens/EventsScreen';
import { EventScreen } from './screens/EventScreen';
import { EventCreateScreen } from './screens/EventCreateScreen';
import { OrganizerScreen } from './screens/OrganizerScreen';
import { LeaderboardScreen } from './screens/LeaderboardScreen';
import { StatsScreen } from './screens/StatsScreen';
import { AdminScreen } from './screens/AdminScreen';
import { Bouton, Chargement } from './components/ui';

export default function App() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<ConfigDto | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    void api
      .config()
      .then((c) => {
        if (!annule) setConfig(c);
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
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-slate-100 px-6 text-center">
        <p className="text-slate-700">{t(erreur)}</p>
        <Bouton onClick={() => window.location.reload()}>{t('commun.reessayer')}</Bouton>
      </div>
    );
  }

  if (config === null) {
    return (
      <div className="h-dvh bg-slate-100">
        <Chargement texte={t('app.chargement')} />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MapScreen config={config} />} />
        <Route path="/signaler" element={<RouteSignalement config={config} />} />
        <Route path="/spot/:id" element={<SpotScreen />} />
        <Route path="/chantiers" element={<EventsScreen />} />
        <Route path="/chantiers/nouveau" element={<EventCreateScreen config={config} />} />
        <Route path="/chantiers/:id" element={<EventScreen />} />
        <Route path="/chantiers/:id/organisateur" element={<OrganizerScreen />} />
        <Route path="/classement" element={<LeaderboardScreen />} />
        <Route path="/statistiques" element={<StatsScreen />} />
        {/* Route protégée côté serveur par `exigerRole` : l'écran ne fait que
            refléter le droit, il ne l'accorde pas. */}
        <Route path="/moderation" element={<AdminScreen />} />
        {/* Toute autre URL retombe sur la carte : un lien partagé ne doit
            jamais aboutir sur une page morte. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

/** Reprend la position transmise par la carte, si elle en a fourni une. */
function RouteSignalement({ config }: { config: ConfigDto }) {
  const emplacement = useLocation();
  const etat = emplacement.state as { position?: { lat: number; lng: number } } | null;
  return (
    <ReportScreen
      config={config}
      {...(etat?.position ? { positionInitiale: etat.position } : {})}
    />
  );
}
