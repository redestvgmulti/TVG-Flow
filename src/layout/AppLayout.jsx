import { Outlet, useSearchParams } from 'react-router-dom'
import EmployeeMode from '../pages/admin/EmployeeMode'

function AppLayout({ children }) {
    const [searchParams, setSearchParams] = useSearchParams()
    const isEmployeeModeOpen = searchParams.get('modal') === 'employee-mode'

    const closeEmployeeMode = () => {
        setSearchParams(params => {
            params.delete('modal')
            return params
        }, { replace: true })
    }

    return (
        <div className="app-container">
            {children || <Outlet />}
            <EmployeeMode isOpen={isEmployeeModeOpen} onClose={closeEmployeeMode} />
        </div>
    )
}

export default AppLayout
