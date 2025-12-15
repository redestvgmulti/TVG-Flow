import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { AppRoutes } from './routes/routes';
import BottomNav from './components/layout/BottomNav';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
        <BottomNav />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
