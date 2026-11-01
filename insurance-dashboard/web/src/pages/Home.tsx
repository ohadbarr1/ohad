import { lazy } from 'react';
import { useActiveDoor } from '../components/home/doorState';
import { AgentHome, DoorPicker, SaverHome } from '../components/home/Doors';

/* W1 shell, "three doors, one site": `/` is the door picker until a door is chosen, then that door's home. The Pro home is today's
   home, unchanged (components/home/ProHome.tsx), loaded only when it is shown, and also served at /pro. */
const ProHome = lazy(() => import('../components/home/ProHome').then((m) => ({ default: m.ProHome })));

export function Home() {
  const [door] = useActiveDoor();
  if (door === 'saver') return <SaverHome />;
  if (door === 'agent') return <AgentHome />;
  if (door === 'pro') return <ProHome />;
  return <DoorPicker />;
}

/** /pro: the Pro home at a fixed address, whatever door is chosen */
export function ProPage() { return <ProHome />; }
