import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/global.css';
// Install the Firestore-backed LPSApi overrides (getMyProfile, getUsers, ...)
// before the app renders. Every module — including sheets-api and auth — is
// fully loaded by this point, so the patch is applied exactly once, reliably.
// This also guarantees the login page uses the Firestore profile lookup even
// though no page module imports firestore-api directly.
import { initFirestoreApi } from './lib/firestore-api';

initFirestoreApi();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
