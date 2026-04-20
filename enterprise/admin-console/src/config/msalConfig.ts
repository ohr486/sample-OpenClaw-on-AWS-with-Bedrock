import { Configuration, LogLevel } from '@azure/msal-browser';

const AZURE_CLIENT_ID = import.meta.env.VITE_AZURE_CLIENT_ID || '';
const AZURE_TENANT_ID = import.meta.env.VITE_AZURE_TENANT_ID || '';

if (!AZURE_CLIENT_ID || !AZURE_TENANT_ID) {
  console.error('VITE_AZURE_CLIENT_ID and VITE_AZURE_TENANT_ID must be set in .env');
}

export const msalConfig: Configuration = {
  auth: {
    clientId: AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${AZURE_TENANT_ID}`,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'localStorage',
  },
  system: {
    loggerOptions: {
      logLevel: LogLevel.Warning,
      loggerCallback: (_level, message, containsPii) => {
        if (!containsPii) console.debug('[MSAL]', message);
      },
    },
  },
};

export const tokenRequest = {
  scopes: ['openid', 'profile', 'email'],
};
