import { useEffect, useState } from 'react';
import { GardenProvider, useGarden } from './state/gardenStore';
import { GardensProvider, useGardens } from './state/gardensStore';
import { SetupScreen } from './components/SetupScreen';
import { BedCanvas } from './components/BedCanvas';

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
  return (
    <GardensProvider>
      <ActiveGarden />
    </GardensProvider>
  );
}

export default App;
