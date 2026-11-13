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
import {
  linkGoogleToCurrentAccount,
  loadWorkspaceFromFirestore,
  loginWithFirebaseEmail,
  refreshCurrentFirebaseUser,
  registerWithFirebaseEmail,
  resendVerificationEmail,
  sendFirebasePasswordReset,
  signInWithGooglePopup,
  signOutFirebase,
  syncWorkspaceToFirestore,
} from '../services/firebaseService';
import { Logo } from './Logo';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Cloud,
  Loader2,
  Lock,
  Mail,
  MailCheck,
  Plus,
  RefreshCw,
  Trash2,
  User,
} from 'lucide-react';

interface AuthScreenProps {
  onAuthenticated: (account: UserAccount) => void;
}

function mapFirebaseAuthErrorPtBr(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('auth/invalid-credential') || raw.includes('auth/wrong-password')) {
    return 'E-mail ou senha incorretos. Se você entrou com Google no celular, toque em "Continuar com Conta Google" abaixo; caso contrário, use "Esqueci minha senha".';
  }
  if (raw.includes('auth/user-not-found')) {
    return 'Nenhuma conta encontrada com este e-mail. Toque em "Criar Conta" para se cadastrar.';
  }
  if (raw.includes('auth/email-already-in-use')) {
    return 'Este e-mail já possui uma conta integrada (App e Site)! Use a aba "Entrar" com sua senha ou o botão Google.';
  }
  if (raw.includes('auth/account-exists-with-different-credential')) {
    return 'Este e-mail já está cadastrado com senha. Entre usando seu e-mail e senha na aba "Entrar".';
  }
  if (raw.includes('auth/weak-password')) {
    return 'A senha deve ter no mínimo 6 caracteres.';
  }
  if (raw.includes('auth/invalid-email')) {
    return 'Informe um endereço de e-mail válido.';
  }
  if (raw.includes('auth/too-many-requests')) {
    return 'Muitas tentativas seguidas. Aguarde alguns instantes ou use "Esqueci minha senha".';
  }
  if (raw.includes('auth/network-request-failed')) {
    return 'Sem conexão com a internet no momento. Verifique sua rede e tente novamente.';
  }
  if (raw.includes('auth/popup-blocked')) {
    return 'O navegador bloqueou a janela do Google. Permita pop-ups ou entre com seu e-mail e senha.';
  }
  return raw;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthenticated }) => {
  const savedAccounts = storageService.listRegisteredAccounts();

  const [mode, setMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
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

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isLoadingGoogle, setIsLoadingGoogle] = useState<boolean>(false);
  const [isCheckingPending, setIsCheckingPending] = useState<boolean>(false);
  const [pendingVerificationAccount, setPendingVerificationAccount] =
    useState<UserAccount | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

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
    setInfoMessage(null);
    setIsLoadingGoogle(true);
    try {
      const firebaseUser = await signInWithGooglePopup();
      const existingAcc = savedAccounts.find(
        (a) =>
          a.uid === firebaseUser.uid ||
          (firebaseUser.email && a.email.toLowerCase() === firebaseUser.email.toLowerCase())
      );
      const account: UserAccount = {
        uid: firebaseUser.uid,
        name: existingAcc?.name || firebaseUser.displayName || '',
        email: firebaseUser.email || '',
        photoURL: firebaseUser.photoURL || undefined,
        authMode: 'firebase-google',
        emailVerified: true,
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
      if (!msg.includes('popup-closed-by-user') && !msg.includes('cancelled-popup-request')) {
        setErrorMessage(mapFirebaseAuthErrorPtBr(err));
      }
    } finally {
      setIsLoadingGoogle(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setInfoMessage(null);

    const cleanEmail = loginEmail.trim().toLowerCase();
    if (!cleanEmail || !loginPassword) {
      setErrorMessage('Informe seu e-mail e senha.');
      return;
    }

    setIsSubmitting(true);
    try {
      const fbUser = await loginWithFirebaseEmail(cleanEmail, loginPassword);
      const existingAcc = savedAccounts.find(
        (a) => a.uid === fbUser.uid || a.email.toLowerCase() === cleanEmail
      );
      const account: UserAccount = {
        uid: fbUser.uid,
        name: fbUser.displayName || existingAcc?.name || cleanEmail.split('@')[0],
        email: fbUser.email || cleanEmail,
        photoURL: fbUser.photoURL || undefined,
        authMode: 'firebase-email',
        emailVerified: fbUser.emailVerified,
        hospitalName: existingAcc?.hospitalName || '',
        sectorName: existingAcc?.sectorName || '',
        role: existingAcc?.role || '',
        units: existingAcc?.units || [],
        createdAt: existingAcc?.createdAt || new Date().toISOString(),
      };
      storageService.saveRegisteredAccountMetadata(account);
      storageService.setActiveSessionAccount(account);

      const localState = storageService.loadStateForUser(account);
      const orphaned = storageService.findOrphanedLocalWorkspace(account.uid);
      if (!fbUser.emailVerified && !localState.manager.onboardingCompleted && !orphaned) {
        setPendingVerificationAccount(account);
        setInfoMessage(
          'Sua conta já existe! Confirme o link enviado para o seu e-mail (ou vincule seu Google) para carregar os dados do seu outro aparelho aqui.'
        );
        return;
      }

      onAuthenticated(account);
    } catch (err) {
      // Migração transparente: se a conta só existia localmente neste aparelho antes da integração nuvem
      const legacyLocal = storageService.findLegacyLocalAccountByEmail(cleanEmail, loginPassword);
      if (legacyLocal) {
        if (loginPassword.length < 6) {
          setErrorMessage(
            'Sua conta anterior usava uma senha curta. Crie uma nova senha de pelo menos 6 dígitos na aba "Criar Conta" ou entre com Google.'
          );
          setIsSubmitting(false);
          return;
        }
        try {
          const migratedFbUser = await registerWithFirebaseEmail({
            name: legacyLocal.name,
            email: cleanEmail,
            password: loginPassword,
          });
          const legacyState = storageService.loadStateForUser(legacyLocal);
          storageService.saveStateForUser(migratedFbUser.uid, legacyState);
          storageService.removeLocalAccountRecord(legacyLocal.uid);

          const migratedAcc: UserAccount = {
            uid: migratedFbUser.uid,
            name: legacyLocal.name,
            email: cleanEmail,
            authMode: 'firebase-email',
            emailVerified: migratedFbUser.emailVerified,
            hospitalName: legacyLocal.hospitalName,
            sectorName: legacyLocal.sectorName,
            role: legacyLocal.role,
            units: legacyLocal.units,
            createdAt: legacyLocal.createdAt,
          };
          storageService.saveRegisteredAccountMetadata(migratedAcc);
          storageService.setActiveSessionAccount(migratedAcc);
          if (!migratedFbUser.emailVerified) {
            setPendingVerificationAccount(migratedAcc);
            setInfoMessage(
              `Conta migrada para a nuvem! Confirme o link enviado para ${cleanEmail} ou vincule com o Google para acessar no PC e no celular.`
            );
            return;
          }
          onAuthenticated(migratedAcc);
          return;
        } catch (migErr) {
          setErrorMessage(mapFirebaseAuthErrorPtBr(migErr));
          setIsSubmitting(false);
          return;
        }
      }

      setErrorMessage(mapFirebaseAuthErrorPtBr(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordReset = async () => {
    setErrorMessage(null);
    setInfoMessage(null);
    if (!loginEmail.trim()) {
      setErrorMessage('Digite seu e-mail acima primeiro para receber o link de recuperação.');
      return;
    }
    try {
      await sendFirebasePasswordReset(loginEmail);
      setInfoMessage(
        `Link de redefinição de senha enviado para ${loginEmail.trim().toLowerCase()}. Verifique sua caixa de entrada e spam.`
      );
    } catch (err) {
      setErrorMessage(mapFirebaseAuthErrorPtBr(err));
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setInfoMessage(null);

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
    if (regPassword.length < 6) {
      setErrorMessage('Crie uma senha de pelo menos 6 caracteres.');
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

    setIsSubmitting(true);
    try {
      const fbUser = await registerWithFirebaseEmail({
        name: regName.trim(),
        email: regEmail.trim(),
        password: regPassword,
      });

      const newAccount: UserAccount = {
        uid: fbUser.uid,
        name: regName.trim(),
        email: fbUser.email || regEmail.trim().toLowerCase(),
        authMode: 'firebase-email',
        emailVerified: fbUser.emailVerified,
        hospitalName: regHospital.trim(),
        sectorName: finalSector,
        role: finalRole,
        units: validUnits,
        createdAt: new Date().toISOString(),
      };

      storageService.saveRegisteredAccountMetadata(newAccount);
      storageService.setActiveSessionAccount(newAccount);
      storageService.loadStateForUser(newAccount);

      if (!fbUser.emailVerified) {
        setPendingVerificationAccount(newAccount);
        setInfoMessage(
          `Conta criada! Enviamos um link de confirmação para ${newAccount.email}. Ative abaixo para sincronizar no App e no Site.`
        );
        return;
      }

      onAuthenticated(newAccount);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (raw.includes('auth/email-already-in-use')) {
        const clean = regEmail.trim().toLowerCase();
        setMode('LOGIN');
        setLoginEmail(clean);
        setInfoMessage(
          `O e-mail ${clean} já possui uma conta integrada (App e Site)! Digite sua senha abaixo para entrar — ou use o botão Google.`
        );
        return;
      }
      setErrorMessage(mapFirebaseAuthErrorPtBr(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmPendingVerification = async () => {
    if (!pendingVerificationAccount) return;
    setErrorMessage(null);
    setInfoMessage(null);
    setIsCheckingPending(true);
    try {
      const refreshed = await refreshCurrentFirebaseUser();
      if (refreshed && refreshed.emailVerified) {
        const verifiedAcc: UserAccount = {
          ...pendingVerificationAccount,
          emailVerified: true,
        };
        storageService.saveRegisteredAccountMetadata(verifiedAcc);
        storageService.setActiveSessionAccount(verifiedAcc);
        const localState = storageService.loadStateForUser(verifiedAcc);
        const remote = await loadWorkspaceFromFirestore(refreshed.uid);
        if (!remote && localState.manager.onboardingCompleted) {
          await syncWorkspaceToFirestore(refreshed.uid, localState);
        }
        onAuthenticated(verifiedAcc);
        return;
      }
      setErrorMessage(
        `Ainda não identificamos o clique no link enviado para ${pendingVerificationAccount.email}. Verifique sua caixa de entrada ou Spam.`
      );
    } catch (err) {
      setErrorMessage(mapFirebaseAuthErrorPtBr(err));
    } finally {
      setIsCheckingPending(false);
    }
  };

  const handleLinkPendingWithGoogle = async () => {
    if (!pendingVerificationAccount) return;
    setErrorMessage(null);
    setInfoMessage(null);
    setIsCheckingPending(true);
    try {
      const linkedUser = await linkGoogleToCurrentAccount();
      const verifiedAcc: UserAccount = {
        ...pendingVerificationAccount,
        authMode: 'firebase-google',
        emailVerified: true,
        photoURL: linkedUser.photoURL || pendingVerificationAccount.photoURL,
      };
      storageService.saveRegisteredAccountMetadata(verifiedAcc);
      storageService.setActiveSessionAccount(verifiedAcc);
      const localState = storageService.loadStateForUser(verifiedAcc);
      const remote = await loadWorkspaceFromFirestore(linkedUser.uid);
      if (!remote && localState.manager.onboardingCompleted) {
        await syncWorkspaceToFirestore(linkedUser.uid, localState);
      }
      onAuthenticated(verifiedAcc);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('popup-closed-by-user')) {
        setErrorMessage(mapFirebaseAuthErrorPtBr(err));
      }
    } finally {
      setIsCheckingPending(false);
    }
  };

  const handleResendPendingEmail = async () => {
    setErrorMessage(null);
    setInfoMessage(null);
    try {
      await resendVerificationEmail();
      setInfoMessage(
        `Novo link enviado para ${pendingVerificationAccount?.email}. Abra o e-mail, toque no link e volte aqui.`
      );
    } catch (err) {
      setErrorMessage(mapFirebaseAuthErrorPtBr(err));
    }
  };

  const handleCancelPendingToLogin = async () => {
    await signOutFirebase();
    storageService.setActiveSessionAccount(null);
    setPendingVerificationAccount(null);
    setErrorMessage(null);
    setInfoMessage(null);
    setMode('LOGIN');
  };

  const handleQuickSelectSavedAccount = (acc: LocalRegisteredAccount) => {
    setErrorMessage(null);
    setInfoMessage(null);
    if (acc.authMode === 'firebase-google') {
      handleGoogleSignIn();
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
          {pendingVerificationAccount ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-teal-50 border border-teal-200 flex items-center justify-center shrink-0">
                  <MailCheck className="w-5 h-5 text-teal-700" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Ative sua conta na nuvem
                  </h2>
                  <p className="text-xs text-slate-500">
                    {pendingVerificationAccount.email}
                  </p>
                </div>
              </div>

              {errorMessage && (
                <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-800">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span className="font-medium">{errorMessage}</span>
                </div>
              )}

              {infoMessage && (
                <div className="p-3.5 rounded-2xl bg-teal-50 border border-teal-200 flex items-start gap-2.5 text-xs text-teal-900">
                  <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
                  <span className="font-medium">{infoMessage}</span>
                </div>
              )}

              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-relaxed">
                Para que seus dados e colaboradores apareçam automaticamente tanto no{' '}
                <strong className="text-slate-900">App do celular</strong> quanto no{' '}
                <strong className="text-slate-900">Site do computador</strong>, confirme seu e-mail no link enviado ou vincule sua conta Google agora:
              </div>

              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={handleConfirmPendingVerification}
                  disabled={isCheckingPending}
                  className="w-full py-3 px-4 rounded-xl bg-[#0d9488] hover:bg-teal-700 disabled:opacity-60 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  {isCheckingPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  <span>Já confirmei o link · Entrar e Sincronizar</span>
                </button>

                <button
                  type="button"
                  onClick={handleLinkPendingWithGoogle}
                  disabled={isCheckingPending}
                  className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Cloud className="w-4 h-4 text-teal-400" />
                  <span>Vincular com Google (Ativação Imediata)</span>
                </button>

                <button
                  type="button"
                  onClick={handleResendPendingEmail}
                  disabled={isCheckingPending}
                  className="w-full py-2 px-4 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-semibold text-xs cursor-pointer"
                >
                  Reenviar e-mail de confirmação
                </button>
              </div>

              <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2 text-xs">
                <button
                  type="button"
                  onClick={handleCancelPendingToLogin}
                  className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900 font-semibold cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Voltar</span>
                </button>
                <button
                  type="button"
                  onClick={() => onAuthenticated(pendingVerificationAccount)}
                  className="text-slate-500 hover:text-teal-700 font-semibold underline cursor-pointer"
                >
                  Usar só neste aparelho agora
                </button>
              </div>
            </div>
          ) : (
            <>
          {/* Seletor Entrar / Criar Conta */}
          <div className="grid grid-cols-2 gap-1.5 bg-slate-100 p-1 rounded-2xl">
            <button
              type="button"
              onClick={() => {
                setMode('LOGIN');
                setErrorMessage(null);
                setInfoMessage(null);
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
                setInfoMessage(null);
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

          {infoMessage && (
            <div className="p-3.5 rounded-2xl bg-teal-50 border border-teal-200 flex items-start gap-2.5 text-xs text-teal-900">
              <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
              <span className="font-medium">{infoMessage}</span>
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
                            {acc.name || acc.email}
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
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-700">
                      Senha
                    </label>
                    <button
                      type="button"
                      onClick={handlePasswordReset}
                      className="text-[11px] font-semibold text-teal-700 hover:underline cursor-pointer"
                    >
                      Esqueci minha senha
                    </button>
                  </div>
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
                  disabled={isSubmitting}
                  className="w-full py-3 px-5 rounded-xl bg-[#0d9488] hover:bg-teal-700 disabled:opacity-60 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ArrowRight className="w-4 h-4" />
                  )}
                  <span>{isSubmitting ? 'Entrando...' : 'Entrar'}</span>
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
                {isLoadingGoogle ? 'Conectando...' : 'Continuar com Conta Google'}
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
                    Senha (mín. 6 dígitos) *
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      required
                      minLength={6}
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
                disabled={isSubmitting}
                className="w-full py-3 px-5 rounded-xl bg-[#0d9488] hover:bg-teal-700 disabled:opacity-60 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs"
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                <span>{isSubmitting ? 'Criando Conta...' : 'Criar Conta e Acessar'}</span>
              </button>

              <div className="relative flex items-center justify-center py-0.5">
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
                {isLoadingGoogle ? 'Conectando...' : 'Criar / Entrar com Conta Google'}
              </button>
            </form>
          )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
