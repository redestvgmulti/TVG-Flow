import { Outlet, useSearchParams } from 'react-router-dom'
import EmployeeMode from '../pages/admin/EmployeeMode'
import { useAuth } from '../contexts/AuthContext'

function AppLayout({ children }) {
    const [searchParams, setSearchParams] = useSearchParams()
    const { user } = useAuth()
    const isEmployeeModeOpen = searchParams.get('modal') === 'employee-mode'
    const employeeBacklogId = searchParams.get('backlog_id')
    const employeeInitialTab = searchParams.get('tab')

    const closeEmployeeMode = () => {
        setSearchParams(params => {
            params.delete('modal')
            params.delete('backlog_id')
            params.delete('tab')
            return params
        }, { replace: true })
    }

    return (
        <div className="app-container">
            {children || <Outlet />}
            <EmployeeMode
                isOpen={isEmployeeModeOpen}
                onClose={closeEmployeeMode}
                user={user}
                backlogId={employeeBacklogId}
                initialTab={employeeInitialTab}
            />
        </div>
    )
}

export default AppLayout
