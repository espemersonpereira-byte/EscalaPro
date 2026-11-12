import React, { useState } from 'react';
import {
  HospitalUnit,
  LocalRegisteredAccount,
  PRE_REGISTERED_MANAGER_ROLES,
  PRE_REGISTERED_SECTORS,
  UnitShiftMode,
  UserAccount,
} from '../types';
import { storageService } from '../services/storageService';
import { signInWithGooglePopup } from '../services/firebaseService';
import { Logo } from './Logo';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Lock,
  Mail,
  Plus,
  Trash2,
  User,
} from 'lucide-react';

interface AuthScreenProps {
  onAuthenticated: (account: UserAccount) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthenticated }) => {
  const savedAccounts = storageService.listRegisteredAccounts();

  const [mode, setMode] = useState<'LOGIN' | 'REGISTER'>(
    savedAccounts.length > 0 ? 'LOGIN' : 'REGISTER'
  );
  const [loginEmail, setLoginEmail] = useState<string>(savedAccounts[0]?.email || '');
  const [loginPassword, setLoginPassword] = useState<string>('');

  // Campos de cadastro em branco para livre escolha do usuário
  const [regName, setRegName] = useState<string>('');
  const [regEmail, setRegEmail] = useState<string>('');
  const [regPassword, setRegPassword] = useState<string>('');
  const [regHospital, setRegHospital] = useState<string>('');

  const [regSectorSelect, setRegSectorSelect] = useState<string>('');
  const [regCustomSector, setRegCustomSector] = useState<string>('');

  const [regRoleSelect, setRegRoleSelect] = useState<string>('');
  const [regCustomRole, setRegCustomRole] = useState<string>('');

  const [regUnits, setRegUnits] = useState<HospitalUnit[]>([
    {
      id: `unit-${Date.now()}-1`,
      name: '',
      shiftMode: '24H',
      minStaffDay: 2,
      minStaffNight: 1,
    },
  ]);

  const [isLoadingGoogle, setIsLoadingGoogle] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleAddUnitRow = () => {
    setRegUnits((prev) => [
      ...prev,
      {
        id: `unit-${Date.now()}-${prev.length + 1}`,
        name: '',
        shiftMode: '24H',
        minStaffDay: 2,
        minStaffNight: 1,
      },
    ]);
  };

  const handleRemoveUnitRow = (id: string) => {
    if (regUnits.length <= 1) return;
    setRegUnits((prev) => prev.filter((u) => u.id !== id));
  };

  const handleUpdateUnitRow = <K extends keyof HospitalUnit>(
    id: string,
    field: K,
    value: HospitalUnit[K]
  ) => {
    setRegUnits((prev) =>
      prev.map((u) => {
        if (u.id !== id) return u;
        const next = { ...u, [field]: value };
        if (field === 'shiftMode') {
          if (value === 'DIURNO') next.minStaffNight = 0;
          if (value === 'NOTURNO') next.minStaffDay = 0;
        }
        return next;
      })
    );
  };

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    setIsLoadingGoogle(true);
    try {
      const firebaseUser = await signInWithGooglePopup();
      const existingAcc = savedAccounts.find((a) => a.uid === firebaseUser.uid);
      const account: UserAccount = {
        uid: firebaseUser.uid,
        name: existingAcc?.name || firebaseUser.displayName || '',
        email: firebaseUser.email || '',
        photoURL: firebaseUser.photoURL || undefined,
        authMode: 'firebase-google',
        hospitalName: existingAcc?.hospitalName || '',
        sectorName: existingAcc?.sectorName || '',
        role: existingAcc?.role || '',
        units: existingAcc?.units || [],
        createdAt: existingAcc?.createdAt || new Date().toISOString(),
      };
      storageService.saveRegisteredAccountMetadata(account);
      storageService.setActiveSessionAccount(account);
      onAuthenticated(account);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('popup-closed-by-user')) {
        setErrorMessage(
          'Não foi possível autenticar pela janela pop-up. Utilize seu e-mail e senha abaixo.'
        );
      }
    } finally {
      setIsLoadingGoogle(false);
    }
  };

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    try {
      const account = storageService.loginWithCredentials(loginEmail, loginPassword);
      onAuthenticated(account);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Erro ao entrar na conta.');
    }
  };

  const handleRegisterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const finalSector =
      regSectorSelect === 'OUTRO' ? regCustomSector.trim() : regSectorSelect.trim();
    const finalRole =
      regRoleSelect === 'OUTRO' ? regCustomRole.trim() : regRoleSelect.trim();

    if (!regName.trim()) {
      setErrorMessage('Informe seu nome completo.');
      return;
    }
    if (!regHospital.trim()) {
      setErrorMessage('Informe o nome da instituição.');
      return;
    }
    if (!regEmail.trim()) {
      setErrorMessage('Informe seu e-mail.');
      return;
    }
    if (regPassword.length < 3) {
      setErrorMessage('Crie uma senha de pelo menos 3 caracteres.');
      return;
    }
    if (!finalSector) {
      setErrorMessage('Escolha ou digite seu setor.');
      return;
    }
    if (!finalRole) {
      setErrorMessage('Escolha ou digite seu cargo.');
      return;
    }

    const validUnits = regUnits
      .map((u) => ({
        ...u,
        name: u.name.trim(),
      }))
      .filter((u) => u.name.length > 0);

    if (validUnits.length === 0) {
      setErrorMessage('Informe o nome de pelo menos 1 unidade.');
      return;
    }

    try {
      const newAccount = storageService.registerNewAccount({
        name: regName.trim(),
        email: regEmail.trim(),
        password: regPassword,
        hospitalName: regHospital.trim(),
        sectorName: finalSector,
        role: finalRole,
        units: validUnits,
      });
      onAuthenticated(newAccount);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Erro ao cadastrar conta.');
    }
  };

  const handleQuickSelectSavedAccount = (acc: LocalRegisteredAccount) => {
    setErrorMessage(null);
    if (!acc.passwordHash) {
      const { passwordHash: _, ...publicAcc } = acc;
      storageService.setActiveSessionAccount(publicAcc);
      onAuthenticated(publicAcc);
      return;
    }
    setMode('LOGIN');
    setLoginEmail(acc.email);
  };

  return (
    <div className="min-h-screen bg-[#0f172a] flex flex-col justify-center items-center px-4 py-8 relative overflow-hidden">
      {/* Brilho sutil de fundo */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[560px] h-[560px] rounded-full bg-teal-500/10 blur-3xl"
      />

      <div
        className={`w-full ${
          mode === 'LOGIN' ? 'max-w-md' : 'max-w-xl'
        } relative z-10 transition-all duration-200`}
      >
        {/* Identidade limpa no topo */}
        <div className="flex flex-col items-center text-center mb-6">
          <Logo size={52} />
          <h1 className="text-2xl font-bold tracking-tight text-white mt-3">
            Escala<span className="text-[#0d9488]">Pro</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Gestão de Escalas Hospitalares
          </p>
        </div>

        {/* Card Central Minimalista */}
        <div className="bg-white rounded-3xl shadow-2xl border border-slate-200/80 p-6 md:p-8 space-y-5">
          {/* Seletor Entrar / Criar Conta */}
          <div className="grid grid-cols-2 gap-1.5 bg-slate-100 p-1 rounded-2xl">
            <button
              type="button"
              onClick={() => {
                setMode('LOGIN');
                setErrorMessage(null);
              }}
              className={`py-2.5 px-4 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                mode === 'LOGIN'
                  ? 'bg-[#0f172a] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('REGISTER');
                setErrorMessage(null);
              }}
              className={`py-2.5 px-4 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                mode === 'REGISTER'
                  ? 'bg-[#0d9488] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Criar Conta
            </button>
          </div>

          {errorMessage && (
            <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-800">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span className="font-medium">{errorMessage}</span>
            </div>
          )}

          {mode === 'LOGIN' ? (
            <div className="space-y-4">
              {savedAccounts.length > 0 && (
                <div className="space-y-1.5">
                  <span className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    Acesso rápido
                  </span>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {savedAccounts.map((acc) => (
                      <button
                        key={acc.uid}
                        type="button"
                        onClick={() => handleQuickSelectSavedAccount(acc)}
                        className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-slate-50 hover:bg-teal-50/50 border border-slate-200 hover:border-teal-500/40 text-left transition-colors cursor-pointer"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate">
                            {acc.name}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate">{acc.email}</p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-teal-600 shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <form onSubmit={handleLoginSubmit} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    E-mail
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="Digite seu e-mail"
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-300 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Senha
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      required
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="Digite sua senha"
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-slate-300 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full py-3 px-5 rounded-xl bg-[#0d9488] hover:bg-teal-700 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs"
                >
                  <span>Entrar</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              <div className="relative flex items-center justify-center py-1">
                <div className="border-t border-slate-200 w-full" />
                <span className="bg-white px-3 text-[11px] font-medium text-slate-400">
                  ou
                </span>
                <div className="border-t border-slate-200 w-full" />
              </div>

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isLoadingGoogle}
                className="w-full py-2.5 px-4 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-semibold text-xs transition-colors cursor-pointer"
              >
                {isLoadingGoogle ? 'Conectando...' : 'Entrar com Conta Google'}
              </button>
            </div>
          ) : (
            <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Seu Nome *
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      placeholder="Digite seu nome"
                      className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Hospital / Instituição *
                  </label>
                  <div className="relative">
                    <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={regHospital}
                      onChange={(e) => setRegHospital(e.target.value)}
                      placeholder="Nome da instituição"
                      className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    E-mail *
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      placeholder="Digite seu e-mail"
                      className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Senha *
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      required
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="Crie uma senha"
                      className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Setor *
                  </label>
                  <select
                    required
                    value={regSectorSelect}
                    onChange={(e) => setRegSectorSelect(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-base text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                  >
                    <option value="" disabled>
                      Escolha o setor...
                    </option>
                    {PRE_REGISTERED_SECTORS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                    <option value="OUTRO">Outro (digitar)...</option>
                  </select>
                  {regSectorSelect === 'OUTRO' && (
                    <input
                      type="text"
                      required
                      value={regCustomSector}
                      onChange={(e) => setRegCustomSector(e.target.value)}
                      placeholder="Digite seu setor"
                      className="mt-2 w-full px-3 py-2 rounded-xl border border-slate-300 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Cargo *
                  </label>
                  <select
                    required
                    value={regRoleSelect}
                    onChange={(e) => setRegRoleSelect(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-base text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                  >
                    <option value="" disabled>
                      Escolha seu cargo...
                    </option>
                    {PRE_REGISTERED_MANAGER_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                    <option value="OUTRO">Outro (digitar)...</option>
                  </select>
                  {regRoleSelect === 'OUTRO' && (
                    <input
                      type="text"
                      required
                      value={regCustomRole}
                      onChange={(e) => setRegCustomRole(e.target.value)}
                      placeholder="Digite seu cargo"
                      className="mt-2 w-full px-3 py-2 rounded-xl border border-slate-300 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  )}
                </div>
              </div>

              {/* Unidades definidas pelo usuário */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700">
                    Unidades de Escala *
                  </label>
                  <button
                    type="button"
                    onClick={handleAddUnitRow}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white hover:bg-teal-50 text-teal-700 border border-slate-200 text-xs font-bold cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Adicionar</span>
                  </button>
                </div>

                <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                  {regUnits.map((unit, idx) => (
                    <div key={unit.id} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-7">
                        <input
                          type="text"
                          required
                          value={unit.name}
                          onChange={(e) =>
                            handleUpdateUnitRow(unit.id, 'name', e.target.value)
                          }
                          placeholder={`Nome da unidade ${idx + 1}`}
                          className="w-full px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                        />
                      </div>
                      <div className="col-span-4">
                        <select
                          value={unit.shiftMode}
                          onChange={(e) =>
                            handleUpdateUnitRow(
                              unit.id,
                              'shiftMode',
                              e.target.value as UnitShiftMode
                            )
                          }
                          className="w-full px-2 py-1.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                        >
                          <option value="24H">24h</option>
                          <option value="DIURNO">Diurno</option>
                          <option value="NOTURNO">Noturno</option>
                        </select>
                      </div>
                      <div className="col-span-1 flex justify-end">
                        {regUnits.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveUnitRow(unit.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 cursor-pointer"
                            title="Remover"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-3 px-5 rounded-xl bg-[#0d9488] hover:bg-teal-700 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Criar Conta e Acessar</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
