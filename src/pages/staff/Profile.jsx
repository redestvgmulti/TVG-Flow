import { useAuth } from '../../contexts/AuthContext'
import { User, Mail, Shield, Building } from 'lucide-react'

function StaffProfile() {
    const { user, professionalName, role } = useAuth()

    const getInitials = (name) => {
        if (!name) return 'U'
        return name
            .split(' ')
            .map(n => n[0])
            .slice(0, 2)
            .join('')
            .toUpperCase()
    }

    return (
        <div className="animation-fade-in pb-12">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-primary mb-2">Meu Perfil</h1>
                <p className="text-secondary">Suas informações de acesso.</p>
            </div>

            <div className="max-w-2xl mx-auto">
                <div className="card p-8 text-center mb-6">
                    <div className="w-24 h-24 bg-brand-light text-brand rounded-full flex items-center justify-center text-3xl font-bold mx-auto mb-4 border-4 border-white shadow-lg">
                        {getInitials(professionalName)}
                    </div>
                    <h2 className="text-2xl font-bold text-primary mb-1">{professionalName}</h2>
                    <p className="text-secondary flex items-center justify-center gap-2">
                        <span className="badge badge-primary uppercase text-xs tracking-wider px-2 py-0.5">
                            {role === 'profissional' ? 'Colaborador' : role}
                        </span>
                    </p>
                </div>

                <div className="card p-0 overflow-hidden">
                    <div className="p-4 border-b border-gray-100 bg-subtle">
                        <h3 className="font-semibold text-primary">Dados Pessoais</h3>
                    </div>

                    <div className="divide-y divide-gray-100">
                        <div className="p-5 flex items-center gap-4">
                            <div className="w-10 h-10 rounded-lg bg-blue-50 text-brand flex items-center justify-center">
                                <User size={20} />
                            </div>
                            <div>
                                <p className="text-xs text-tertiary uppercase tracking-wide font-semibold">Nome Completo</p>
                                <p className="text-primary font-medium">{professionalName}</p>
                            </div>
                        </div>

                        <div className="p-5 flex items-center gap-4">
                            <div className="w-10 h-10 rounded-lg bg-blue-50 text-brand flex items-center justify-center">
                                <Mail size={20} />
                            </div>
                            <div>
                                <p className="text-xs text-tertiary uppercase tracking-wide font-semibold">Email de Acesso</p>
                                <p className="text-primary font-medium">{user?.email}</p>
                            </div>
                        </div>

                        <div className="p-5 flex items-center gap-4">
                            <div className="w-10 h-10 rounded-lg bg-blue-50 text-brand flex items-center justify-center">
                                <Shield size={20} />
                            </div>
                            <div>
                                <p className="text-xs text-tertiary uppercase tracking-wide font-semibold">Função no Sistema</p>
                                <p className="text-primary font-medium capitalize">
                                    {role === 'profissional' ? 'Profissional / Colaborador' : role}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default StaffProfile
