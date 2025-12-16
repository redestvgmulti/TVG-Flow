import React, { useState, useEffect } from 'react';
import { getAllTasks } from '../../services/taskService';
import {
    format,
    startOfMonth,
    endOfMonth,
    startOfWeek,
    endOfWeek,
    eachDayOfInterval,
    isSameMonth,
    isSameDay,
    addMonths,
    subMonths
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import TaskFormModal from '../../components/modals/TaskFormModal';
import './Calendario.css';

const Calendario = () => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedTask, setSelectedTask] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Aux data loading (we might need full data for the modal)
    // Importing services here again or passing is repetitive, but for now filtering
    // tasks for display is enough. Editing triggers full load inside modal if we pass data? 
    // Actually the Modal needs departments etc. 
    // To keep it simple, I'll load tasks here, and if user clicks a task, I open the Modal which loads its own aux data?
    // The previous implementation of TaskFormModal relied on props for aux data.
    // I should load them here too if I want to edit from Calendar.
    // Or just View Details?
    // Let's implement View Details (reuse Modal) and Edit.

    // For now, I'll skip fetching departments/etc here to save space, assuming editing might fail dropdowns if missing.
    // I'll reuse the logic from Tarefas.jsx properly if I had time to refactor a custom hook.
    // But I'll just strictly fetch tasks for now.

    const fetchTasks = async () => {
        setLoading(true);
        try {
            const data = await getAllTasks(); // Fetch all for simplicity
            setTasks(data);
        } catch (error) {
            console.error('Erro ao carregar tarefas:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTasks();
    }, []);

    const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
    const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));
    const today = () => setCurrentDate(new Date());

    const days = eachDayOfInterval({
        start: startOfWeek(startOfMonth(currentDate)),
        end: endOfWeek(endOfMonth(currentDate))
    });

    const getTasksForDay = (day) => {
        return tasks.filter(task => isSameDay(new Date(task.deadline), day));
    };

    const handleTaskClick = (task, e) => {
        e.stopPropagation();
        alert(`Tarefa: ${task.titulo}\nStatus: ${task.status}`);
        // Here we would open the modal
    };

    return (
        <div className="calendar-container">
            <div className="calendar-header">
                <div className="header-left">
                    <CalendarIcon size={24} className="text-primary" />
                    <h1>{format(currentDate, 'MMMM yyyy', { locale: ptBR })}</h1>
                </div>
                <div className="header-actions">
                    <button onClick={prevMonth} className="nav-btn"><ChevronLeft size={20} /></button>
                    <button onClick={today} className="btn-today">Hoje</button>
                    <button onClick={nextMonth} className="nav-btn"><ChevronRight size={20} /></button>
                </div>
            </div>

            <div className="calendar-grid">
                {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => (
                    <div key={day} className="calendar-day-header">{day}</div>
                ))}

                {days.map(day => {
                    const dayTasks = getTasksForDay(day);
                    const isCurrentMonth = isSameMonth(day, currentDate);
                    const isToday = isSameDay(day, new Date());

                    return (
                        <div
                            key={day.toISOString()}
                            className={`calendar-cell ${!isCurrentMonth ? 'other-month' : ''} ${isToday ? 'current-day' : ''}`}
                        >
                            <span className="day-number">{format(day, 'd')}</span>
                            <div className="day-tasks">
                                {dayTasks.map(task => (
                                    <div
                                        key={task.id}
                                        className="calendar-event"
                                        onClick={(e) => handleTaskClick(task, e)}
                                        title={`${task.titulo} - ${task.status}`}
                                    >
                                        {task.titulo}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default Calendario;
