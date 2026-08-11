import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './layout/AppLayout'
import AdminLayout from './layout/AdminLayout'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Suspended from './pages/Suspended'
import Dashboard from './pages/admin/Dashboard'
import Tasks from './pages/admin/Tasks'
import NewOS from './pages/admin/tasks/NewOS'
import ProfessionalsList from './pages/admin/professionals/index'

import ProfessionalEdit from './pages/admin/professionals/Edit'
import Reports from './pages/admin/Reports'
import Calendar from './pages/admin/Calendar'
import Areas from './pages/admin/Areas'
import Companies from './pages/admin/Companies'
import CompanyDetails from './pages/admin/CompanyDetails'
import AdminContent from './pages/admin/AdminContent'
import Meetings from './pages/admin/Meetings'
import AutoPublisher from './pages/admin/AutoPublisher'
import EmployeeMode from './pages/admin/EmployeeMode'
import StaffDashboard from './pages/staff/Dashboard'
import StaffTasks from './pages/staff/Tasks'
import StaffContent from './pages/staff/StaffContent'
import StaffMeetings from './pages/staff/Meetings'

import StaffToday from './pages/staff/Today'
import StaffCalendar from './pages/staff/Calendar'
import StaffProfile from './pages/staff/Profile'
import StaffRequestCreate from './pages/staff/RequestCreate'
import ProtectedRoute from './routes/ProtectedRoute'
import RoleProtectedRoute from './routes/RoleProtectedRoute'
import StrictSuperAdminRoute from './routes/StrictSuperAdminRoute'
import SuperAdminLayout from './layout/SuperAdminLayout'
import StaffLayout from './layout/StaffLayout'
import SuperAdminDashboard from './pages/super-admin/SuperAdminDashboard'
import TenantListPage from './pages/super-admin/TenantListPage'
import TenantDetail from './pages/super-admin/TenantDetail'
import ReportsPage from './pages/super-admin/ReportsPage'
import SystemStatusPage from './pages/super-admin/SystemStatusPage'

import { Toaster } from 'sonner'

import { AuthProvider } from './contexts/AuthContext'
import { RefreshProvider } from './contexts/RefreshContext'
import { InAppNotificationProvider } from './contexts/InAppNotificationContext'
import InAppNotificationBanner from './components/InAppNotificationBanner'
import TenantErrorBoundary from './components/TenantErrorBoundary'



import { UpdateBanner } from './components/UpdateBanner'
import { useVersionGate } from './hooks/useVersionGate'

function App() {
  // PWA Update System
  useVersionGate()

  // Controller change listener for Vite PWA updates
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    
    const bc = new BroadcastChannel('tvg-hub-pwa-sync')
    let refreshing = false

    // On the very first load there is no SW controlling the page. Because the
    // service worker uses skipWaiting + clientsClaim, it activates and claims the
    // page right after render, firing `controllerchange` even though nothing was
    // updated. Reloading then throws the user out mid-interaction (e.g. while
    // typing login credentials). Only reload on a genuine update — i.e. when a
    // controller already existed when this listener was installed.
    const hadController = !!navigator.serviceWorker.controller

    const handleControllerChange = () => {
      if (!hadController) return
      if (refreshing) return
      refreshing = true
      bc.postMessage({ type: 'RELOAD_REQUESTED' })
      window.location.reload()
    }
    
    const handleBroadcastChannelMessage = (event) => {
      if (event.data?.type === 'RELOAD_REQUESTED') {
        if (refreshing) return
        refreshing = true
        window.location.reload()
      }
    }
    
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange)
    bc.addEventListener('message', handleBroadcastChannelMessage)
    
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange)
      bc.removeEventListener('message', handleBroadcastChannelMessage)
      bc.close()
    }
  }, [])
  
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <RefreshProvider>
          <InAppNotificationProvider>
            <Toaster position="top-right" richColors />
            <UpdateBanner />

            <InAppNotificationBanner />
            <TenantErrorBoundary>
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
                    <Route path="meetings" element={<Meetings />} />
                    <Route path="content" element={<AdminContent />} />
                    <Route path="reports" element={<Reports />} />
                    <Route path="autopublisher" element={<AutoPublisher />} />
                  </Route>

                  {/* Staff Routes */}
                  <Route
                    path="/staff"
                    element={
                      <ProtectedRoute>
                        <RoleProtectedRoute allowedRole="staff">
                          <StaffLayout />
                        </RoleProtectedRoute>
                      </ProtectedRoute>
                    }
                  >
                    <Route index element={<Navigate to="/staff/dashboard" replace />} />
                    <Route path="dashboard" element={<StaffDashboard />} />
                    <Route path="tasks" element={<StaffTasks />} />
                    <Route path="meetings" element={<StaffMeetings />} />

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
                        <StrictSuperAdminRoute>
                          <SuperAdminLayout />
                        </StrictSuperAdminRoute>
                      </ProtectedRoute>
                    }
                  >
                    <Route index element={<SuperAdminDashboard />} />
                    <Route path="companies" element={<TenantListPage />} />
                    <Route path="companies/:id" element={<TenantDetail />} />
                    <Route path="reports" element={<ReportsPage />} />
                    <Route path="system" element={<SystemStatusPage />} />
                  </Route>



                  <Route path="/" element={<Navigate to="/login" replace />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </AppLayout>
            </TenantErrorBoundary>
          </InAppNotificationProvider>
        </RefreshProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
