import {
    LayoutGrid,
    CheckSquare,
    Calendar,
    FolderOpen,
    PlusSquare,
    User,
    BarChart,
    Users,
    Building,
    Settings,
    Rss
} from 'lucide-react'

// Single Source of Truth for Navigation
export const NAV_ITEMS = [
    // --- STAFF ROUTES ---
    {
        key: 'dashboard',
        label: 'Dashboard',
        path: '/staff/dashboard',
        icon: LayoutGrid,
        roles: ['staff', 'profissional'],
        showOnMobileBottom: true, // Mental entry point for app
    },
    {
        key: 'tasks',
        label: 'Tarefas',
        path: '/staff/tasks',
        icon: CheckSquare,
        roles: ['staff', 'profissional'],
        showOnMobileBottom: true
    },
    {
        key: 'calendar',
        label: 'Agenda',
        path: '/staff/calendar',
        icon: Calendar,
        roles: ['staff', 'profissional'],
        showOnMobileBottom: true
    },
    {
        key: 'staff-meetings',
        label: 'Reuniões',
        path: '/staff/meetings',
        icon: Calendar,
        roles: ['staff'],
        showOnMobileBottom: false // Accessible via Agenda tab/filter
    },
    {
        key: 'request',
        label: 'Solicitar',
        path: '/staff/requests/new',
        icon: PlusSquare,
        roles: ['staff', 'profissional'],
        isCTA: true,
        showOnMobileBottom: false // Converted to FAB on mobile
    },
    {
        key: 'content',
        label: 'Conteúdo',
        path: '/staff/content',
        icon: FolderOpen,
        roles: ['staff', 'profissional'],
        showOnMobileBottom: true
    },
    {
        key: 'profile',
        label: 'Perfil',
        path: '/staff/profile',
        icon: User,
        roles: ['staff', 'profissional'],
        showOnMobileBottom: true // Typically handled separately in code but defined here for completeness
    },

    // --- ADMIN ROUTES ---
    {
        key: 'admin-dashboard',
        label: 'Dashboard',
        path: '/admin',
        icon: LayoutGrid,
        roles: ['admin', 'super_admin'],
        showOnMobileBottom: true
    },
    {
        key: 'admin-tasks',
        label: 'Tarefas',
        path: '/admin/tasks',
        icon: CheckSquare,
        roles: ['admin', 'super_admin'],
        showOnMobileBottom: true
    },
    {
        key: 'admin-content',
        label: 'Conteúdo',
        path: '/admin/content',
        icon: FolderOpen,
        roles: ['admin', 'super_admin'],
        showOnMobileBottom: false // Hidden per User Request (Jan 2026)
    },
    {
        key: 'admin-calendar',
        label: 'Agenda',
        path: '/admin/calendar',
        icon: Calendar,
        roles: ['admin', 'super_admin'],
        showOnMobileBottom: false
    },
    {
        key: 'admin-meetings',
        label: 'Reuniões',
        path: '/admin/meetings',
        icon: Users,
        roles: ['admin', 'super_admin'],
        showOnMobileBottom: true
    },
    {
        key: 'admin-team',
        label: 'Equipe',
        path: '/admin/professionals',
        icon: Users,
        roles: ['admin', 'super_admin'],
        showOnMobileBottom: false
    },
    {
        key: 'admin-reports',
        label: 'Relatórios',
        path: '/admin/reports',
        icon: BarChart,
        roles: ['admin', 'super_admin'],
        showOnMobileBottom: true
    },
    {
        key: 'admin-autopublisher',
        label: 'AutoPublisher',
        path: '/admin/autopublisher',
        icon: Rss,
        roles: ['admin', 'super_admin'],
        showOnMobileBottom: false
    }
]

// Secondary/Management links (Desktop Sidebar specific often)
export const MANAGEMENT_ITEMS = [
    {
        key: 'companies',
        label: 'Empresas',
        path: '/admin/companies',
        icon: Building,
        roles: ['admin']
    },
    {
        key: 'professionals',
        label: 'Funcionários',
        path: '/admin/professionals',
        icon: Users,
        roles: ['admin']
    },
    {
        key: 'reports',
        label: 'Relatórios',
        path: '/admin/reports',
        icon: BarChart,
        roles: ['admin']
    }
]
