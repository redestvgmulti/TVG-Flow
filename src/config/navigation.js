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
    Settings
} from 'lucide-react'

// Single Source of Truth for Navigation
export const NAV_ITEMS = [
    // --- STAFF ROUTES ---
    {
        key: 'dashboard',
        label: 'Dashboard',
        path: '/staff/dashboard',
        icon: LayoutGrid,
        roles: ['profissional'],
        mobilePriority: false // Less important on mobile bottom nav? Check user requirement.
        // User said: Mobile = Tarefas, Agenda, Solicitar, Conteúdo, Perfil. 
        // Dashboard is NOT in the user's list for Mobile BottomNav preference.
        // User list: "Mobile / PWA (BottomNav): Tarefas, Agenda, Solicitar (CTA central), Conteúdo, Perfil"
        // We will keep Dashboard accessible but maybe not in the primary 5 slots if space is tight, OR we strictly follow the user's specific list for Mobile.
        // User explicit list for Mobile BottomNav: Tarefas, Agenda, Solicitar, Conteúdo, Perfil.
        // Dashboard is NOT in that list. We will strictly follow.
        showOnMobileBottom: false,
    },
    {
        key: 'tasks',
        label: 'Tarefas',
        path: '/staff/tasks',
        icon: CheckSquare,
        roles: ['profissional'],
        showOnMobileBottom: true
    },
    {
        key: 'calendar',
        label: 'Agenda',
        path: '/staff/calendar',
        icon: Calendar,
        roles: ['profissional'],
        showOnMobileBottom: true
    },
    {
        key: 'request',
        label: 'Solicitar',
        path: '/staff/requests/new',
        icon: PlusSquare,
        roles: ['profissional'],
        isCTA: true,
        showOnMobileBottom: true
    },
    {
        key: 'content',
        label: 'Conteúdo',
        path: '/staff/content',
        icon: FolderOpen,
        roles: ['profissional'],
        showOnMobileBottom: true
    },
    {
        key: 'profile',
        label: 'Perfil',
        path: '/staff/profile',
        icon: User,
        roles: ['profissional'],
        showOnMobileBottom: true // Typically handled separately in code but defined here for completeness
    },

    // --- ADMIN ROUTES ---
    {
        key: 'admin-dashboard',
        label: 'Dashboard',
        path: '/admin',
        icon: LayoutGrid,
        roles: ['admin'],
        showOnMobileBottom: true
    },
    {
        key: 'admin-tasks',
        label: 'Tarefas',
        path: '/admin/tasks',
        icon: CheckSquare,
        roles: ['admin'],
        showOnMobileBottom: true
    },
    {
        key: 'admin-content',
        label: 'Conteúdo',
        path: '/admin/content',
        icon: FolderOpen,
        roles: ['admin'],
        showOnMobileBottom: true // Adding Content to Admin Mobile as per Rule: "Todas as funcionalidades acessíveis em todos os dispositivos"
    },
    {
        key: 'admin-calendar',
        label: 'Agenda',
        path: '/admin/calendar',
        icon: Calendar,
        roles: ['admin'],
        showOnMobileBottom: true
    },
    {
        key: 'admin-team',
        label: 'Equipe',
        path: '/admin/professionals',
        icon: Users,
        roles: ['admin'],
        showOnMobileBottom: true
    },
    {
        key: 'admin-reports',
        label: 'Relatórios',
        path: '/admin/reports',
        icon: BarChart,
        roles: ['admin'],
        showOnMobileBottom: true
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
