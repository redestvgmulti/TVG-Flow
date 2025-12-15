import { useState, useEffect, useCallback } from 'react';
import { getDashboardMetrics, getTodayTasks, getTeamWorkload } from '../services/dashboardService';
import { supabase } from '../services/supabase';

/**
 * Hook para gerenciar dados do dashboard
 * Inclui loading, error handling e refresh
 */
export const useDashboardData = () => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [metrics, setMetrics] = useState(null);
    const [todayTasks, setTodayTasks] = useState([]);
    const [overdueTasks, setOverdueTasks] = useState([]);
    const [teamWorkload, setTeamWorkload] = useState([]);

    const loadDashboardData = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            const [metricsData, todayData, teamData] = await Promise.all([
                getDashboardMetrics(),
                getTodayTasks(),
                getTeamWorkload(),
            ]);

            setMetrics(metricsData);
            setTodayTasks(todayData);
            setOverdueTasks(metricsData.overdueTasks);
            setTeamWorkload(teamData);
        } catch (err) {
            console.error('Erro ao carregar dados do dashboard:', err);
            setError(err.message || 'Erro ao carregar dashboard');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadDashboardData();
    }, [loadDashboardData]);

    return {
        loading,
        error,
        metrics,
        todayTasks,
        overdueTasks,
        teamWorkload,
        refresh: loadDashboardData,
    };
};

/**
 * Hook para real-time updates do dashboard
 * Escuta mudanças na tabela de tarefas
 */
export const useRealtimeDashboard = (onUpdate) => {
    useEffect(() => {
        // Subscription para mudanças em tarefas
        const tasksSubscription = supabase
            .channel('dashboard-tasks-changes')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'tarefas',
                },
                (payload) => {
                    console.log('Mudança detectada em tarefas:', payload);
                    if (onUpdate) {
                        onUpdate(payload);
                    }
                }
            )
            .subscribe();

        return () => {
            tasksSubscription.unsubscribe();
        };
    }, [onUpdate]);
};

/**
 * Hook para gerenciar estado de um modal
 */
export const useModal = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [data, setData] = useState(null);

    const open = useCallback((modalData = null) => {
        setData(modalData);
        setIsOpen(true);
    }, []);

    const close = useCallback(() => {
        setIsOpen(false);
        setData(null);
    }, []);

    const toggle = useCallback(() => {
        setIsOpen((prev) => !prev);
    }, []);

    return {
        isOpen,
        data,
        open,
        close,
        toggle,
    };
};
