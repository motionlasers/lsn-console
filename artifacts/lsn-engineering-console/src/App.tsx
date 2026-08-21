import { type ReactNode, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { AppLayout } from '@/components/AppLayout';
import { AuthGate } from '@/components/AuthGate';
import { getRouterRuntimeConfig } from '@/lib/router';
import { UpdateProvider } from '@/components/UpdateManager';
import {
  getDefaultRuntimeMode,
  getDesktopBridge,
} from '@/lib/desktop';
import { useStore } from '@/lib/store';

// Pages
import Dashboard from '@/pages/dashboard';
import HardwareDevice from '@/pages/device';
import ProtocolInspector from '@/pages/protocol';
import Control from '@/pages/control';
import StatusFields from '@/pages/status';
import Runtime from '@/pages/runtime';
import Diagnostics from '@/pages/diagnostics';
import Tests from '@/pages/tests';
import StressTesting from '@/pages/stress';
import Firmware from '@/pages/firmware';
import Profile from '@/pages/profile';
import Modules from '@/pages/modules';
import Logs from '@/pages/logs';
import Help from '@/pages/help';
import SettingsPage from '@/pages/settings';
import Downloads from '@/pages/downloads';

const queryClient = new QueryClient();

function Router() {
  return (
    <AppLayout>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/device" component={HardwareDevice} />
          <Route path="/protocol" component={ProtocolInspector} />
          <Route path="/control" component={Control} />
          <Route path="/status" component={StatusFields} />
          <Route path="/runtime" component={Runtime} />
          <Route path="/diagnostics" component={Diagnostics} />
          <Route path="/tests" component={Tests} />
          <Route path="/stress" component={StressTesting} />
          <Route path="/firmware" component={Firmware} />
          <Route path="/profile" component={Profile} />
          <Route path="/modules" component={Modules} />
          <Route path="/logs" component={Logs} />
          <Route path="/help" component={Help} />
          <Route path="/downloads" component={Downloads} />
          <Route path="/settings" component={SettingsPage} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </AppLayout>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function RuntimeModeInitializer({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(() => getDesktopBridge() === null);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;

    const cleanup = useStore.getState().initializeHardwareSubscriptions();

    let cancelled = false;
    void bridge.getPlatform()
      .then((platform) => {
        if (!cancelled && getDefaultRuntimeMode(platform) === 'hardware') {
          useStore.getState().setMode('hardware');
        }
      })
      .catch(() => {
        // The web/default Simulation Mode remains available if desktop runtime
        // detection is unavailable; startup must never be blocked.
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
  }, []);

  return ready ? children : null;
}

function App() {
  const routerConfig = getRouterRuntimeConfig(
    window.location.protocol,
    import.meta.env.BASE_URL,
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <UpdateProvider>
          <RuntimeModeInitializer>
            <WouterRouter
              hook={routerConfig.useHashLocation ? useHashLocation : undefined}
              base={routerConfig.base}
            >
              <AuthGate>
                <Router />
              </AuthGate>
            </WouterRouter>
          </RuntimeModeInitializer>
        </UpdateProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
