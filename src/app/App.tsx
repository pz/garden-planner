import { lazy, Suspense, useEffect, useState } from 'react';
import { GardenProvider, useGarden } from './state/gardenStore';
import { GardensProvider, useGardens } from './state/gardensStore';
import { SetupScreen } from './components/SetupScreen';
import { BedCanvas } from './components/BedCanvas';
import { SpritesPage } from './SpritesPage';
import { isSolverRoute, isSpritesRoute } from './route';

// The solver viewer exists only in development builds: `import.meta.env.DEV` is replaced by `false`
// in a production build, so this branch, the dynamic import and everything it pulls in (the
// solver, its fixtures) are dropped. CI greps the built files for `solver-viewer` to keep it so.
const SolverPage = import.meta.env.DEV ? lazy(() => import('./solver/SolverPage')) : null;

function AppShell() {
  const { plan } = useGarden();
  const [forceSetup, setForceSetup] = useState(false);

  if (!plan.profile.onboarded || forceSetup) {
    return <SetupScreen onDone={() => setForceSetup(false)} />;
  }

  return <BedCanvas onEditSetup={() => setForceSetup(true)} />;
}

function ActiveGarden() {
  const { activeGardenId, createGarden } = useGardens();

  // Defensive: GardensProvider's bootstrap always leaves at least one garden, but if a future
  // change to removeGarden ever left the roster empty, don't strand the user on a blank page.
  useEffect(() => {
    if (!activeGardenId) createGarden();
  }, [activeGardenId, createGarden]);

  if (!activeGardenId) return null;

  // Remounting on gardenId change (rather than rehydrating in place) gives every garden switch
  // a clean slate: fresh reducer state, and no stale component state (selections, open menus)
  // left over from the previous garden.
  return (
    <GardenProvider key={activeGardenId} gardenId={activeGardenId}>
      <AppShell />
    </GardenProvider>
  );
}

function App() {
  // The sprite sheet needs no garden, so it sits outside the providers.
  if (isSpritesRoute(window.location.pathname, window.location.hash)) return <SpritesPage />;
  if (SolverPage && isSolverRoute(window.location.pathname, window.location.hash)) {
    return (
      <Suspense fallback={null}>
        <SolverPage />
      </Suspense>
    );
  }
  return (
    <GardensProvider>
      <ActiveGarden />
    </GardensProvider>
  );
}

export default App;
