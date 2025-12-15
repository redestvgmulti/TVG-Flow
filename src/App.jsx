import React from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { AppRoutes } from './routes/routes';
import BottomNav from './components/layout/BottomNav';

function App() {
  return (
    <AuthProvider>
      <AppRoutes />
      <BottomNav />
    </AuthProvider>
  );
}

export default App;

