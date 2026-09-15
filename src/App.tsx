import { useState } from 'react';
import { GardenProvider, useGarden } from './state/gardenStore';
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

function App() {
  return (
    <GardenProvider>
      <AppShell />
    </GardenProvider>
  );
}

export default App;
