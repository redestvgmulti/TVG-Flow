import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Clock, DollarSign, AlertTriangle, Layers, Zap } from "lucide-react";
import { toast } from "sonner";

export default function AutoPublisherMonitoring() {
    const [stats, setStats] = useState({ health: [], throughput: [], costs: [], recentErrors: [] });
    const [isLoading, setIsLoading] = useState(true);

    const fetchMonitoringData = async () => {
        try {
            // 1. Pipeline Health (Backlog)
            const { data: health } = await supabase.schema('ap').from('v_pipeline_health').select('*');
            // 2. Throughput & Performance
            const { data: throughput } = await supabase.schema('ap').from('v_throughput').select('*');
            // 3. Daily Costs
            const { data: costs } = await supabase.schema('ap').from('v_cost_summary').select('*').limit(7);
            // 4. Recent Errors
            const { data: errors } = await supabase.schema('ap').from('worker_telemetry')
                .select('*').eq('status', 'error').order('created_at', { ascending: false }).limit(5);

            setStats({ health: health || [], throughput: throughput || [], costs: costs || [], recentErrors: errors || [] });
        } catch (err) {
            toast.error("Erro ao carregar métricas de monitoramento.");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchMonitoringData();
        const interval = setInterval(fetchMonitoringData, 10000); // Refreshes every 10s
        return () => clearInterval(interval);
    }, []);

    const totalBacklog = stats.health.reduce((acc, curr) => acc + (curr.item_count || 0), 0);
    const totalHourlyCost = stats.throughput.reduce((acc, curr) => acc + Number(curr.total_cost_last_hour || 0), 0);

    return (
        <div className="p-6 space-y-6 bg-slate-950 min-h-screen text-slate-100">
            <div className="flex justify-between items-center bg-slate-900/50 p-6 rounded-2xl border border-slate-800 backdrop-blur-md">
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">SRE Monitoring</h1>
                    <p className="text-slate-400 mt-1">Visibilidade em tempo real do AutoPublisher Pipeline</p>
                </div>
                <div className="flex gap-4">
                    <Card className="bg-slate-900/80 border-slate-800 min-w-[150px]">
                        <CardContent className="pt-4 flex items-center gap-3">
                            <Layers className="text-blue-400" size={20} />
                            <div>
                                <p className="text-xs text-slate-500 uppercase font-bold">Backlog</p>
                                <p className="text-2xl font-bold text-blue-100">{totalBacklog}</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-slate-900/80 border-slate-800 min-w-[150px]">
                        <CardContent className="pt-4 flex items-center gap-3">
                            <DollarSign className="text-emerald-400" size={20} />
                            <div>
                                <p className="text-xs text-slate-500 uppercase font-bold">Custo /Hr</p>
                                <p className="text-2xl font-bold text-emerald-100">${totalHourlyCost.toFixed(2)}</p>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Pipeline Health */}
                <Card className="bg-slate-900/50 border-slate-800 col-span-2">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium text-slate-400 uppercase tracking-wider flex items-center gap-2">
                            <Zap size={16} className="text-amber-400" /> Backlog por Etapa
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            {stats.health.map((h) => (
                                <div key={h.status} className="p-4 rounded-xl bg-slate-950/50 border border-slate-800/50">
                                    <p className="text-xs text-slate-500 font-medium mb-1 truncate">{h.status}</p>
                                    <div className="flex items-baseline gap-2">
                                        <p className="text-2xl font-bold">{h.item_count}</p>
                                        <span className="text-[10px] text-slate-600">itens</span>
                                    </div>
                                    <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1">
                                        <Clock size={10} /> Latência: {Math.round(h.avg_wait_minutes)}m
                                    </p>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* Performance Analytics */}
                <Card className="bg-slate-900/50 border-slate-800">
                    <CardHeader>
                        <CardTitle className="text-sm font-medium text-slate-400 uppercase tracking-wider flex items-center gap-2">
                            <Activity size={16} className="text-emerald-400" /> Vazão (Última Hora)
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {stats.throughput.map((t) => (
                            <div key={t.worker_name} className="flex justify-between items-center p-3 rounded-lg bg-slate-950/30">
                                <div>
                                    <p className="text-xs font-bold text-slate-300">{t.worker_name.replace('ap-', '')}</p>
                                    <p className="text-[10px] text-slate-500">Avg {Math.round(t.avg_duration_ms / 1000)}s / item</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm font-bold text-emerald-400">{t.processed_last_hour} ops</p>
                                </div>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 {/* Error Monitor */}
                 <Card className="bg-slate-900/50 border-slate-800">
                    <CardHeader>
                        <CardTitle className="text-sm font-medium text-red-400 uppercase tracking-wider flex items-center gap-2">
                            <AlertTriangle size={16} /> Erros Críticos Recentes
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {stats.recentErrors.map((err) => (
                            <div key={err.id} className="p-3 rounded-lg bg-red-950/20 border border-red-900/20">
                                <div className="flex justify-between mb-1">
                                    <span className="text-[10px] font-bold text-red-300 uppercase">{err.worker_name}</span>
                                    <span className="text-[10px] text-slate-500">{new Date(err.created_at).toLocaleTimeString()}</span>
                                </div>
                                <p className="text-xs text-red-200 line-clamp-1">{err.error_message}</p>
                            </div>
                        ))}
                        {stats.recentErrors.length === 0 && <p className="text-xs text-slate-500 text-center py-4">Nenhum erro detectado no período.</p>}
                    </CardContent>
                </Card>

                {/* Daily Cost Tracker */}
                <Card className="bg-slate-900/50 border-slate-800">
                    <CardHeader>
                        <CardTitle className="text-sm font-medium text-amber-400 uppercase tracking-wider flex items-center gap-2">
                            <DollarSign size={16} /> Histórico de Custo (7 dias)
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[150px] flex items-end justify-between gap-2 px-2">
                            {stats.costs.map((c) => (
                                <div key={c.day} className="flex-1 group relative">
                                    <div 
                                        className="bg-emerald-500/30 group-hover:bg-emerald-400/50 transition-all rounded-t-sm" 
                                        style={{ height: `${Math.min(100, (Number(c.daily_cost) * 10))}px` }}
                                    ></div>
                                    <p className="text-[8px] text-slate-500 mt-2 text-center -rotate-45">{new Date(c.day).toLocaleDateString()}</p>
                                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-slate-800 text-[10px] p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                                        ${Number(c.daily_cost).toFixed(2)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
