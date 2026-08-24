import { LayoutGrid, CheckSquare, Calendar, Bot, PlusSquare, User, BarChart, Users, Building, Rss, Inbox, LayoutTemplate, Settings } from 'lucide-react'

// Single source of truth for every role-aware navigation surface.
export const NAV_ITEMS = [
    { key: 'dashboard', label: 'Dashboard', path: '/staff/dashboard', icon: LayoutGrid, roles: ['staff', 'profissional'], section: 'staff', showOnMobileBottom: true },
    { key: 'tasks', label: 'Tarefas', path: '/staff/tasks', icon: CheckSquare, roles: ['staff', 'profissional'], section: 'staff', showOnMobileBottom: true },
    { key: 'calendar', label: 'Agenda', path: '/staff/calendar', icon: Calendar, roles: ['staff', 'profissional'], section: 'staff', showOnMobileBottom: true },
    { key: 'staff-meetings', label: 'Reuniões', path: '/staff/meetings', icon: Calendar, roles: ['staff'], section: 'staff', showOnMobileBottom: false },
    { key: 'request', label: 'Solicitar', path: '/staff/requests/new', icon: PlusSquare, roles: ['staff', 'profissional'], section: 'staff', isCTA: true, showOnMobileBottom: false },
    { key: 'content', label: 'Assistentes', path: '/staff/content', icon: Bot, roles: ['staff', 'profissional'], section: 'staff', showOnMobileBottom: true },
    { key: 'staff-autopublisher', label: 'Criar Matérias', path: '?modal=employee-mode', icon: Rss, roles: ['staff', 'profissional', 'employee'], section: 'tools', showOnMobileBottom: false },
    { key: 'profile', label: 'Perfil', path: '/staff/profile', icon: User, roles: ['staff', 'profissional'], section: 'staff', showOnMobileBottom: true },

    { key: 'admin-dashboard', label: 'Dashboard', path: '/admin', icon: LayoutGrid, roles: ['admin', 'super_admin'], section: 'main', showOnMobileBottom: true },
    { key: 'admin-tasks', label: 'Tarefas', path: '/admin/tasks', icon: CheckSquare, roles: ['admin', 'super_admin'], section: 'main', showOnMobileBottom: true },
    { key: 'ap-backlog', label: 'Banco de Matérias', path: '/admin/autopublisher/backlog', icon: Inbox, roles: ['admin', 'super_admin'], section: 'main', showOnMobileBottom: false },
    { key: 'admin-content', label: 'Assistentes', path: '/admin/content', icon: Bot, roles: ['admin', 'super_admin'], section: 'main', showOnMobileBottom: false },
    { key: 'admin-calendar', label: 'Agenda', path: '/admin/calendar', icon: Calendar, roles: ['admin', 'super_admin'], section: 'main', showOnMobileBottom: false },
    { key: 'admin-meetings', label: 'Reuniões', path: '/admin/meetings', icon: Users, roles: ['admin', 'super_admin'], section: 'main', showOnMobileBottom: true },
    {
        key: 'admin-autopublisher', label: 'AutoPublisher', path: '/admin/autopublisher', icon: Rss, roles: ['admin', 'super_admin'], section: 'main', showOnMobileBottom: false,
        children: [
            { key: 'ap-pipeline', label: 'Pipeline', path: '/admin/autopublisher', icon: Rss },
            { key: 'ap-templates', label: 'Templates', path: '/admin/autopublisher/templates', icon: LayoutTemplate },
            { key: 'ap-settings', label: 'Configurações', path: '/admin/autopublisher/settings', icon: Settings },
        ],
    },
    { key: 'admin-companies', label: 'Empresas', path: '/admin/companies', icon: Building, roles: ['admin', 'super_admin'], section: 'management', showOnMobileBottom: false },
    { key: 'admin-team', label: 'Equipe', path: '/admin/professionals', icon: Users, roles: ['admin', 'super_admin'], section: 'management', showOnMobileBottom: false },
    { key: 'admin-reports', label: 'Relatórios', path: '/admin/reports', icon: BarChart, roles: ['admin', 'super_admin'], section: 'management', showOnMobileBottom: true },
]

export function getNavigationItemsForRole(role) {
    return NAV_ITEMS.filter((item) => item.roles.includes(role))
}
