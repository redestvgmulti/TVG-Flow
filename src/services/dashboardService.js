import { supabase } from './supabase';
import { startOfDay, endOfDay, addDays, endOfWeek, parseISO } from 'date-fns';

/**
 * MOCK DATA CONSTANTS
 * Temporarily used to bypass Supabase schema issues
 */
const MOCK_METRICS = {
    tasksToday: 12,
    overdueTasks: [
        {
            id: '1',
            title: 'Relatório Mensal de Vendas',
            deadline: new Date(new Date().setDate(new Date().getDate() - 2)).toISOString(), // 2 days ago
            priority: 'alta',
            status: 'pending',
            responsavel: { id: 'p1', nome: 'Ana Silva' },
            empresas: { nome: 'Empresa ABC' },
            departamentos: { nome: 'Financeiro', cor_hex: '#dc2626' }
        },
        {
            id: '2',
            title: 'Atualizar Contrato Social',
            deadline: new Date(new Date().setDate(new Date().getDate() - 1)).toISOString(), // 1 day ago
            priority: 'media',
            status: 'pending',
            responsavel: { id: 'p2', nome: 'Carlos Oliveira' },
            empresas: { nome: 'Tech Solutions' },
            departamentos: { nome: 'Jurídico', cor_hex: '#2563eb' }
        },
        {
            id: '3',
            title: 'Revisão de Impostos',
            deadline: new Date(new Date().setHours(new Date().getHours() - 4)).toISOString(), // 4 hours ago
            priority: 'alta',
            status: 'in_progress',
            responsavel: { id: 'p1', nome: 'Ana Silva' },
            empresas: { nome: 'Global Imports' },
            departamentos: { nome: 'Contabilidade', cor_hex: '#059669' }
        }
    ],
    completedToday: 5,
    tasksThisWeek: 45,
    activeProfessionals: 8
};

const MOCK_TODAY_TASKS = [
    {
        id: 't1',
        title: 'Fechamento Contábil - Grupo X',
        deadline: new Date(new Date().setHours(14, 0)).toISOString(),
        priority: 'alta',
        status: 'in_progress',
        responsavel: { id: 'p1', nome: 'Ana Silva' },
        empresas: { nome: 'Grupo X' },
        departamentos: { nome: 'Contabilidade', cor_hex: '#059669' }
    },
    {
        id: 't2',
        title: 'Reunião de Alinhamento',
        deadline: new Date(new Date().setHours(16, 30)).toISOString(),
        priority: 'media',
        status: 'pending',
        responsavel: { id: 'p3', nome: 'Roberto Santos' },
        empresas: { nome: 'Interno' },
        departamentos: { nome: 'RH', cor_hex: '#d97706' }
    },
    {
        id: 't3',
        title: 'Entrega de Balancete',
        deadline: new Date(new Date().setHours(17, 0)).toISOString(),
        priority: 'alta',
        status: 'pending',
        responsavel: { id: 'p2', nome: 'Carlos Oliveira' },
        empresas: { nome: 'Padaria Central' },
        departamentos: { nome: 'Financeiro', cor_hex: '#dc2626' }
    }
];

const MOCK_WORKLOAD = [
    {
        id: 'p1',
        nome: 'Ana Silva',
        departamento: { nome: 'Contabilidade', cor_hex: '#059669' },
        activeTasks: 8,
        overdueTasks: 2,
        isOverloaded: true
    },
    {
        id: 'p2',
        nome: 'Carlos Oliveira',
        departamento: { nome: 'Financeiro', cor_hex: '#dc2626' },
        activeTasks: 4,
        overdueTasks: 0,
        isOverloaded: false
    },
    {
        id: 'p3',
        nome: 'Roberto Santos',
        departamento: { nome: 'RH', cor_hex: '#d97706' },
        activeTasks: 2,
        overdueTasks: 0,
        isOverloaded: false
    },
    {
        id: 'p4',
        nome: 'Mariana Costa',
        departamento: { nome: 'Jurídico', cor_hex: '#2563eb' },
        activeTasks: 6,
        overdueTasks: 1,
        isOverloaded: true
    }
];

/**
 * Dashboard Service
 * Serviços de dados para o Master Admin Dashboard
 */

/**
 * Busca métricas principais do dashboard
 */
export const getDashboardMetrics = async () => {
    // Return mock data immediately
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(MOCK_METRICS);
        }, 800); // Simulate network latency
    });
};

/**
 * Busca tarefas de hoje com detalhes
 */
export const getTodayTasks = async () => {
    // Return mock data immediately
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(MOCK_TODAY_TASKS);
        }, 600);
    });
};

/**
 * Busca carga de trabalho da equipe
 */
export const getTeamWorkload = async () => {
    // Return mock data immediately
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(MOCK_WORKLOAD);
        }, 700);
    });
};

/**
 * Busca estatísticas rápidas para um período
 */
export const getQuickStats = async (startDate, endDate) => {
    // Simplified status mock
    return {
        total: 15,
        completed: 5,
        pending: 8,
        inProgress: 2,
        highPriority: 3
    };
};

/**
 * Atualiza status de uma tarefa
 */
export const updateTaskStatus = async (taskId, newStatus) => {
    console.log(`[MOCK] Task ${taskId} updated to ${newStatus}`);
    return { id: taskId, status: newStatus };
};

/**
 * Reatribui uma tarefa para outro profissional
 */
export const reassignTask = async (taskId, newAssigneeId) => {
    console.log(`[MOCK] Task ${taskId} reassigned to ${newAssigneeId}`);
    return { id: taskId, assigned_to: newAssigneeId };
};
