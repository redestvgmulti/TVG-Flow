import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import BottomNav from './BottomNav'

function AdminLayout() {
    return (
        <div className="admin-layout">
            <Sidebar />

            <div className="admin-main">
                <Header />

                <main className="admin-content">
                    <Outlet />
                </main>
            </div>

            <BottomNav />
        </div>
    )
}

export default AdminLayout
