import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './layout/AppLayout'
import AdminLayout from './layout/AdminLayout'
import Login from './pages/Login'
import Dashboard from './pages/admin/Dashboard'
import Tasks from './pages/admin/Tasks'
import Professionals from './pages/admin/Professionals'
import Reports from './pages/admin/Reports'
import Calendar from './pages/admin/Calendar'
import StaffDashboard from './pages/staff/Dashboard'
import ProtectedRoute from './routes/ProtectedRoute'
import RoleProtectedRoute from './routes/RoleProtectedRoute'

function App() {
  return (
    <BrowserRouter>
      <AppLayout>
        <Routes>
          <Route path="/login" element={<Login />} />

          {/* Admin Routes */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <RoleProtectedRoute allowedRole="admin">
                  <AdminLayout />
                </RoleProtectedRoute>
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="professionals" element={<Professionals />} />
            <Route path="calendar" element={<Calendar />} />
            <Route path="reports" element={<Reports />} />
          </Route>

          {/* Staff Routes */}
          <Route
            path="/staff"
            element={
              <ProtectedRoute>
                <RoleProtectedRoute allowedRole="profissional">
                  <AdminLayout />
                </RoleProtectedRoute>
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/staff/dashboard" replace />} />
            <Route path="dashboard" element={<StaffDashboard />} />
          </Route>

          <Route path="/" element={<Navigate to="/login" replace />} />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  )
}

export default App
