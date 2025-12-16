import React from 'react';
// import './TeamWorkload.css';

const TeamWorkload = ({ teamData, onMemberClick }) => {
    if (!teamData || teamData.length === 0) {
        return (
            <div className="team-workload-empty">
                <p>Nenhum profissional ativo encontrado</p>
            </div>
        );
    }

    return (
        <div className="team-workload">
            <h2 className="section-title">👥 Carga da Equipe</h2>

            <div className="team-members-list">
                {teamData.map((member) => (
                    <div
                        key={member.id}
                        className={`team-member ${member.isOverloaded ? 'team-member-overloaded' : ''}`}
                        onClick={() => onMemberClick && onMemberClick(member)}
                    >
                        <div className="team-member-info">
                            <div className="team-member-name">{member.nome}</div>
                            {member.departamentos && (
                                <span className="member-dept">
                                    {member.departamentos?.nome}
                                </span>
                            )}
                        </div>

                        <div className="team-member-stats">
                            <div className="team-stat">
                                <span className="team-stat-value">{member.activeTasks}</span>
                                <span className="team-stat-label">ativas</span>
                            </div>

                            {member.overdueTasks > 0 && (
                                <div className="team-stat team-stat-overdue">
                                    <span className="team-stat-value">{member.overdueTasks}</span>
                                    <span className="team-stat-label">atrasadas</span>
                                </div>
                            )}
                        </div>

                        {member.isOverloaded && (
                            <div className="overload-indicator">⚠️</div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default TeamWorkload;
