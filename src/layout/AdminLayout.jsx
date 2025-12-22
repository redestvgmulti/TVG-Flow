import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import BottomNav from './BottomNav'
import PullToRefresh from '../components/PullToRefresh'

function AdminLayout() {
    return (
        <div className="admin-layout">
            <Sidebar />

            <div className="admin-main">
                <Header />

                <PullToRefresh className="admin-content">
                    <Outlet />
                </PullToRefresh>
            </div>

            <BottomNav />
        </div>
    )
}

export default AdminLayout
