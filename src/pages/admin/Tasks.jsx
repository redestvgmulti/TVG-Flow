function Tasks() {
    return (
        <div>
            <h2>Tarefas</h2>

            <div className="card" style={{
                textAlign: 'center',
                padding: 'var(--space-2xl)',
                maxWidth: '600px',
                margin: '0 auto'
            }}>
                <h3 style={{
                    fontSize: 'var(--text-xl)',
                    marginBottom: 'var(--space-md)',
                    color: 'var(--color-text-primary)'
                }}>
                    Nenhuma tarefa criada ainda
                </h3>

                <p style={{
                    fontSize: 'var(--text-base)',
                    color: 'var(--color-text-secondary)',
                    marginBottom: 'var(--space-lg)',
                    lineHeight: '1.6'
                }}>
                    As tarefas serão exibidas aqui assim que forem criadas.
                    Comece criando a primeira tarefa para organizar o trabalho da equipe.
                </p>

                <button
                    className="btn btn-primary"
                    onClick={() => alert('Funcionalidade em desenvolvimento. Use o Dashboard para criar tarefas.')}
                >
                    + Criar primeira tarefa
                </button>
            </div>
        </div>
    )
}

export default Tasks
