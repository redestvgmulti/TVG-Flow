import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './layout/AppLayout'
import AdminLayout from './layout/AdminLayout'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/admin/Dashboard'
import Tasks from './pages/admin/Tasks'
// import Professionals from './pages/admin/Professionals' // Old
import ProfessionalsList from './pages/admin/professionals/index'

import ProfessionalEdit from './pages/admin/professionals/Edit'
import Reports from './pages/admin/Reports'
import Calendar from './pages/admin/Calendar'
import Areas from './pages/admin/Areas'
import StaffDashboard from './pages/staff/Dashboard'
import StaffTasks from './pages/staff/Tasks'
import StaffTaskDetail from './pages/staff/TaskDetail'
import StaffToday from './pages/staff/Today'
import ProtectedRoute from './routes/ProtectedRoute'
import RoleProtectedRoute from './routes/RoleProtectedRoute'

import { Toaster } from 'sonner'

function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Toaster position="top-right" richColors />
      <AppLayout>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />

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
            <Route path="areas" element={<Areas />} />
            <Route path="areas" element={<Areas />} />

            {/* Professionals Module */}
            <Route path="professionals">
              <Route index element={<ProfessionalsList />} />

              <Route path=":id/edit" element={<ProfessionalEdit />} />
            </Route>

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
            <Route path="tasks" element={<StaffTasks />} />
            <Route path="tasks/:id" element={<StaffTaskDetail />} />
            <Route path="today" element={<StaffToday />} />
          </Route>

          <Route path="/" element={<Navigate to="/login" replace />} />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  )
}

export default App
