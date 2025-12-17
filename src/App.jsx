import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './layout/AppLayout'
import AdminLayout from './layout/AdminLayout'
import Login from './pages/Login'
import Admin from './pages/Admin'
import ProtectedRoute from './routes/ProtectedRoute'

function App() {
  return (
    <BrowserRouter>
      <AppLayout>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Admin />} />
            <Route path="tasks" element={<div><h2>Tasks</h2></div>} />
            <Route path="calendar" element={<div><h2>Calendar</h2></div>} />
          </Route>

          <Route path="/" element={<Navigate to="/login" replace />} />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  )
}

export default App
