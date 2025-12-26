import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './layout/AppLayout'
import AdminLayout from './layout/AdminLayout'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Suspended from './pages/Suspended'
import Dashboard from './pages/admin/Dashboard'
import Tasks from './pages/admin/Tasks'
import NewOS from './pages/admin/tasks/NewOS'
// import Professionals from './pages/admin/Professionals' // Old
import ProfessionalsList from './pages/admin/professionals/index'

import ProfessionalEdit from './pages/admin/professionals/Edit'
import Reports from './pages/admin/Reports'
import Calendar from './pages/admin/Calendar'
import Areas from './pages/admin/Areas'
import Companies from './pages/admin/Companies'
import CompanyDetails from './pages/admin/CompanyDetails'
import AdminContent from './pages/admin/AdminContent'
import StaffDashboard from './pages/staff/Dashboard'
import StaffTasks from './pages/staff/Tasks'
import StaffContent from './pages/staff/StaffContent'

import StaffToday from './pages/staff/Today'
import StaffCalendar from './pages/staff/Calendar'
import StaffProfile from './pages/staff/Profile'
import StaffRequestCreate from './pages/staff/RequestCreate'
import ProtectedRoute from './routes/ProtectedRoute'
import RoleProtectedRoute from './routes/RoleProtectedRoute'
import SuperAdminRoute from './routes/SuperAdminRoute'
import SuperAdminLayout from './layout/SuperAdminLayout'
import SuperAdminDashboard from './pages/super-admin/SuperAdminDashboard'
import TenantListPage from './pages/super-admin/TenantListPage'
import TenantDetail from './pages/super-admin/TenantDetail'

import { Toaster } from 'sonner'

import { RefreshProvider } from './contexts/RefreshContext'
import { InAppNotificationProvider } from './contexts/InAppNotificationContext'
import InAppNotificationBanner from './components/InAppNotificationBanner'

function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <RefreshProvider>
        <InAppNotificationProvider>
          <Toaster position="top-right" richColors />
          <InAppNotificationBanner />
          <AppLayout>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/suspended" element={<Suspended />} />

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
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="tasks" element={<Tasks />} />
                <Route path="tarefas/nova" element={<NewOS />} />
                <Route path="areas" element={<Areas />} />

                {/* Professionals Module */}
                <Route path="professionals">
                  <Route index element={<ProfessionalsList />} />
                  <Route path=":id/edit" element={<ProfessionalEdit />} />
                </Route>

                {/* Companies Module */}
                <Route path="companies">
                  <Route index element={<Companies />} />
                  <Route path=":id" element={<CompanyDetails />} />
                </Route>

                <Route path="calendar" element={<Calendar />} />
                <Route path="content" element={<AdminContent />} />
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

                <Route path="requests/new" element={<StaffRequestCreate />} />
                <Route path="calendar" element={<StaffCalendar />} />
                <Route path="content" element={<StaffContent />} />
                <Route path="profile" element={<StaffProfile />} />
                <Route path="today" element={<StaffToday />} />
              </Route>


              {/* Super Admin Routes */}
              <Route
                path="/platform"
                element={
                  <ProtectedRoute>
                    <SuperAdminRoute>
                      <SuperAdminLayout />
                    </SuperAdminRoute>
                  </ProtectedRoute>
                }
              >
                <Route index element={<SuperAdminDashboard />} />
                <Route path="companies" element={<TenantListPage />} />
                <Route path="companies/:id" element={<TenantDetail />} />
              </Route>


              <Route path="/" element={<Navigate to="/login" replace />} />
            </Routes>
          </AppLayout>
        </InAppNotificationProvider>
      </RefreshProvider>
    </BrowserRouter>
  )
}

export default App
