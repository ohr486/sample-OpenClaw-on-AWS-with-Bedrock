import React from 'react';
import ReactDOM from 'react-dom/client';
import { PublicClientApplication, EventType } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { msalConfig } from './config/msalConfig';
import './index.css';
import App from './App';

const msalInstance = new PublicClientApplication(msalConfig);

// Handle redirect promise (must be called before rendering)
msalInstance.initialize().then(() => {
  // Set the active account after redirect
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length > 0) {
    msalInstance.setActiveAccount(accounts[0]);
  }

  msalInstance.addEventCallback((event) => {
    if (event.eventType === EventType.LOGIN_SUCCESS && (event.payload as any)?.account) {
      msalInstance.setActiveAccount((event.payload as any).account);
    }
  });

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, refetchInterval: 30_000 },
    },
  });

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <MsalProvider instance={msalInstance}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MsalProvider>
    </React.StrictMode>
  );
});
