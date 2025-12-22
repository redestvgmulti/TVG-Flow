# Implementação de Micro-Tasks e Deadline - Guia de Modificações

## Visão Geral

Este documento descreve as modificações necessárias nos componentes existentes para implementar:
1. **Micro-Tasks** (tarefas colaborativas com múltiplos profissionais)
2. **Deadline com Data + Hora** (timestamp ao invés de apenas data)

---

## 1. MODIFICAÇÕES NO FORMULÁRIO DE TAREFAS

### Arquivo: `src/pages/admin/Tasks.jsx`

#### 1.1 Adicionar Estados para Micro-Tasks

```javascript
// Adicionar no início do componente Tasks()
const [selectedProfessionals, setSelectedProfessionals] = useState([])
const [companies, setCompanies] = useState([])
```

#### 1.2 Atualizar fetchData() para incluir empresas

```javascript
async function fetchData() {
    try {
        setLoading(true)

        // ... código existente para profissionais e áreas ...

        // ADICIONAR: Fetch companies
        const { data: companiesData, error: companiesError } = await supabase
            .from('empresas')
            .select('id, nome')
            .eq('ativo', true)
            .order('nome')

        if (companiesError) throw companiesError
        setCompanies(companiesData || [])

        // ... resto do código ...
    }
}
```

#### 1.3 Modificar handleCreateTask() para criar micro-tasks

```javascript
async function handleCreateTask(e) {
    e.preventDefault()

    try {
        // 1. Criar tarefa macro
        const { data: newTask, error: taskError } = await supabase
            .from('tarefas')
            .insert([{
                titulo: formData.titulo,
                descricao: formData.descricao,
                deadline_at: formData.deadline_at, // MUDANÇA: usar deadline_at
                priority: formData.priority,
                status: 'pending',
                departamento_id: formData.departamento_id,
                empresa_id: formData.empresa_id, // NOVO
                profissional_id: formData.profissional_id // Coordenador
            }])
            .select()
            .single()

        if (taskError) throw taskError

        // 2. NOVO: Criar micro-tasks para cada profissional selecionado
        if (selectedProfessionals.length > 0) {
            const microTasks = selectedProfessionals.map(profId => ({
                tarefa_id: newTask.id,
                profissional_id: profId,
                status: 'pendente'
            }))

            const { error: microTasksError } = await supabase
                .from('tarefas_itens')
                .insert(microTasks)

            if (microTasksError) throw microTasksError
        }

        toast.success('Tarefa criada com sucesso')
        resetForm()
        setShowModal(false)
        fetchData()

    } catch (error) {
        console.error('Error creating task:', error)
        toast.error('Erro ao criar tarefa')
    }
}
```

#### 1.4 Adicionar campos no formulário (Modal)

```jsx
{/* ADICIONAR no modal de criação/edição */}

{/* Campo: Empresa */}
<div className="input-group">
    <label htmlFor="empresa_id">Empresa (Cliente)</label>
    <select
        id="empresa_id"
        value={formData.empresa_id || ''}
        onChange={(e) => setFormData({ ...formData, empresa_id: e.target.value || null })}
    >
        <option value="">Nenhuma</option>
        {companies.map(company => (
            <option key={company.id} value={company.id}>
                {company.nome}
            </option>
        ))}
    </select>
</div>

{/* Campo: Deadline com Data + Hora */}
<div className="input-group">
    <label htmlFor="deadline_at">Prazo (Data e Hora) *</label>
    <input
        type="datetime-local"
        id="deadline_at"
        value={formData.deadline_at || ''}
        onChange={(e) => setFormData({ ...formData, deadline_at: e.target.value })}
        required
    />
</div>

{/* Seção: Atribuir Profissionais (Micro-Tasks) */}
<div className="professional-assignment">
    <h4 className="professional-assignment-title">
        Atribuir Profissionais (Colaborativo)
    </h4>
    <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '12px' }}>
        Selecione os profissionais que trabalharão nesta tarefa
    </p>
    
    <div className="professional-assignment-list">
        {professionals.map(prof => (
            <label key={prof.id} className="professional-assignment-item">
                <input
                    type="checkbox"
                    className="professional-assignment-checkbox"
                    checked={selectedProfessionals.includes(prof.id)}
                    onChange={(e) => {
                        if (e.target.checked) {
                            setSelectedProfessionals([...selectedProfessionals, prof.id])
                        } else {
                            setSelectedProfessionals(selectedProfessionals.filter(id => id !== prof.id))
                        }
                    }}
                />
                <span className="professional-assignment-name">{prof.nome}</span>
            </label>
        ))}
    </div>
</div>
```

---

## 2. COMPONENTE DE MICRO-TASKS

### Arquivo: `src/components/MicroTasksList.jsx` (NOVO)

```javascript
import { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import { Users, CheckCircle, Clock, Link as LinkIcon } from 'lucide-react'
import { toast } from 'sonner'
import '../styles/microTasks.css'

function MicroTasksList({ taskId, isAdmin }) {
    const [microTasks, setMicroTasks] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (taskId) {
            fetchMicroTasks()
        }
    }, [taskId])

    async function fetchMicroTasks() {
        try {
            setLoading(true)

            const { data, error } = await supabase
                .from('tarefas_itens')
                .select(`
                    *,
                    usuarios (
                        id,
                        nome,
                        email
                    )
                `)
                .eq('tarefa_id', taskId)
                .order('created_at')

            if (error) throw error
            setMicroTasks(data || [])

        } catch (error) {
            console.error('Error fetching micro-tasks:', error)
        } finally {
            setLoading(false)
        }
    }

    async function handleToggleStatus(microTaskId, currentStatus) {
        try {
            const newStatus = currentStatus === 'concluida' ? 'pendente' : 'concluida'

            const { error } = await supabase
                .from('tarefas_itens')
                .update({ status: newStatus })
                .eq('id', microTaskId)

            if (error) throw error

            toast.success(newStatus === 'concluida' ? 'Micro-tarefa concluída' : 'Micro-tarefa reaberta')
            fetchMicroTasks()

        } catch (error) {
            console.error('Error updating micro-task:', error)
            toast.error('Erro ao atualizar micro-tarefa')
        }
    }

    if (loading) {
        return <div>Carregando micro-tarefas...</div>
    }

    if (microTasks.length === 0) {
        return (
            <div className="micro-tasks-empty">
                <div className="micro-tasks-empty-icon">
                    <Users size={48} />
                </div>
                <p className="micro-tasks-empty-text">
                    Nenhum profissional atribuído a esta tarefa
                </p>
            </div>
        )
    }

    const completedCount = microTasks.filter(mt => mt.status === 'concluida').length
    const totalCount = microTasks.length
    const progressPercent = (completedCount / totalCount) * 100

    return (
        <div>
            {/* Progress Indicator */}
            <div className="micro-tasks-progress">
                <div className="micro-tasks-progress-bar">
                    <div 
                        className="micro-tasks-progress-fill" 
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>
                <span className="micro-tasks-progress-text">
                    {completedCount}/{totalCount} concluídas
                </span>
            </div>

            {/* Micro-Tasks List */}
            <div className="micro-tasks-list">
                {microTasks.map(microTask => (
                    <div 
                        key={microTask.id} 
                        className={`micro-task-card ${microTask.status === 'concluida' ? 'completed' : ''}`}
                    >
                        <div className="micro-task-header">
                            <div className="micro-task-professional">
                                <Users size={16} />
                                <p className="micro-task-professional-name">
                                    {microTask.usuarios.nome}
                                </p>
                            </div>
                            <span className={`micro-task-status-badge ${microTask.status}`}>
                                {microTask.status === 'concluida' ? (
                                    <><CheckCircle size={14} /> Concluída</>
                                ) : (
                                    <><Clock size={14} /> Pendente</>
                                )}
                            </span>
                        </div>

                        <div className="micro-task-body">
                            {microTask.entrega_link && (
                                <div className="micro-task-link">
                                    <LinkIcon size={14} />
                                    <a href={microTask.entrega_link} target="_blank" rel="noopener noreferrer">
                                        Link de Entrega
                                    </a>
                                </div>
                            )}

                            {microTask.observacoes && (
                                <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: 0 }}>
                                    {microTask.observacoes}
                                </p>
                            )}
                        </div>

                        {isAdmin && (
                            <div className="micro-task-actions">
                                <button
                                    onClick={() => handleToggleStatus(microTask.id, microTask.status)}
                                    className={microTask.status === 'concluida' ? 'btn btn-secondary' : 'btn btn-success'}
                                    style={{ fontSize: '13px', padding: '6px 12px' }}
                                >
                                    {microTask.status === 'concluida' ? 'Reabrir' : 'Marcar como Concluída'}
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}

export default MicroTasksList
```

---

## 3. MODIFICAÇÕES NA PÁGINA DE STAFF

### Arquivo: `src/pages/staff/Tasks.jsx`

#### 3.1 Modificar para mostrar apenas micro-tasks do profissional

```javascript
async function fetchTasks() {
    try {
        setLoading(true)

        const { data: { user } } = await supabase.auth.getUser()

        // MUDANÇA: Buscar micro-tasks ao invés de tarefas completas
        const { data, error } = await supabase
            .from('tarefas_itens')
            .select(`
                *,
                tarefas (
                    id,
                    titulo,
                    descricao,
                    deadline_at,
                    priority,
                    status,
                    departamento_id,
                    areas (nome)
                )
            `)
            .eq('profissional_id', user.id)
            .order('created_at', { ascending: false })

        if (error) throw error
        setTasks(data || [])

    } catch (error) {
        console.error('Error fetching tasks:', error)
        toast.error('Erro ao carregar tarefas')
    } finally {
        setLoading(false)
    }
}
```

---

## 4. FORMATAÇÃO DE DATETIME

### Utilitário: `src/utils/dateFormat.js` (NOVO)

```javascript
export function formatDateTime(dateTimeString) {
    if (!dateTimeString) return '-'
    
    const date = new Date(dateTimeString)
    
    return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date)
}

export function formatDateTimeInput(dateTimeString) {
    if (!dateTimeString) return ''
    
    const date = new Date(dateTimeString)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    
    return `${year}-${month}-${day}T${hours}:${minutes}`
}
```

---

## 5. RESUMO DAS MUDANÇAS

### Database ✅ (Já implementado)
- [x] Tabela `empresas`
- [x] Tabela `empresa_profissionais`
- [x] Tabela `tarefas_itens`
- [x] Tabela `tarefas_itens_historico`
- [x] Campo `empresa_id` em `tarefas`
- [x] Campo `deadline_at` em `tarefas` (timestamp)

### Frontend (A implementar)
- [ ] Adicionar campo `empresa_id` no formulário de tarefas
- [ ] Trocar `due_date` por `deadline_at` (datetime-local input)
- [ ] Adicionar seleção múltipla de profissionais
- [ ] Criar micro-tasks ao salvar tarefa
- [ ] Componente `MicroTasksList.jsx`
- [ ] Modificar staff tasks para mostrar micro-tasks
- [ ] Utilitários de formatação de data/hora

### Testes
- [ ] Criar tarefa com múltiplos profissionais
- [ ] Verificar criação automática de micro-tasks
- [ ] Testar conclusão de micro-task
- [ ] Verificar atualização automática do status da tarefa macro
- [ ] Testar auditoria (histórico)
- [ ] Testar deadline com hora

---

## 6. PRÓXIMOS PASSOS

1. **Implementar MicroTasksList.jsx** ✅
2. **Modificar Tasks.jsx** (adicionar campos e lógica)
3. **Modificar StaffTasks.jsx** (mostrar micro-tasks)
4. **Criar utilitários de data**
5. **Testar fluxo completo**

---

**Nota**: Devido à complexidade do arquivo `Tasks.jsx` (1054 linhas), recomenda-se fazer as modificações de forma incremental e testar cada mudança antes de prosseguir.
