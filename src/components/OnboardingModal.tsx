import React, { useState } from 'react';
import {
  HospitalUnit,
  ManagerProfile,
  PRE_REGISTERED_MANAGER_ROLES,
  PRE_REGISTERED_SECTORS,
  UnitShiftMode,
} from '../types';
import { Logo } from './Logo';
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronRight,
  Layers,
  Plus,
  Trash2,
  UserCheck,
} from 'lucide-react';

interface OnboardingModalProps {
  initialManager: ManagerProfile;
  initialUnits: HospitalUnit[];
  onCompleteOnboarding: (manager: ManagerProfile, units: HospitalUnit[]) => void;
  onBackToAuth?: () => void;
  onLoadDemoData?: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  initialManager,
  initialUnits,
  onCompleteOnboarding,
  onBackToAuth,
}) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState(initialManager.name || '');
  const [hospitalName, setHospitalName] = useState(initialManager.hospitalName || '');
  const [selectedRoleOption, setSelectedRoleOption] = useState<string>(
    initialManager.role && PRE_REGISTERED_MANAGER_ROLES.includes(initialManager.role)
      ? initialManager.role
      : ''
  );
  const [customRoleText, setCustomRoleText] = useState(
    initialManager.role && !PRE_REGISTERED_MANAGER_ROLES.includes(initialManager.role)
      ? initialManager.role
      : ''
  );
  const [avatarBase64, setAvatarBase64] = useState(initialManager.avatarBase64 || '');

  // Passo 2: Setor e Sub-unidades 100% escolhidos pelo usuário (sem nomes de exemplo)
  const [selectedSector, setSelectedSector] = useState<string>(
    initialManager.sectorName && PRE_REGISTERED_SECTORS.includes(initialManager.sectorName)
      ? initialManager.sectorName
      : ''
  );
  const [customSectorText, setCustomSectorText] = useState(
    initialManager.sectorName && !PRE_REGISTERED_SECTORS.includes(initialManager.sectorName)
      ? initialManager.sectorName
      : ''
  );
  const [units, setUnits] = useState<HospitalUnit[]>(
    initialUnits.length > 0
      ? initialUnits
      : [
          {
            id: `unit-${Date.now()}-1`,
            name: '',
            shiftMode: '24H',
            minStaffDay: 2,
            minStaffNight: 1,
          },
        ]
  );
  const [errorMsg, setErrorMsg] = useState('');

  const effectiveSectorName =
    selectedSector === 'OUTRO' ? customSectorText.trim() : selectedSector.trim();

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = 240;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const minDim = Math.min(img.width, img.height);
          const sx = (img.width - minDim) / 2;
          const sy = (img.height - minDim) / 2;
          ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
          setAvatarBase64(canvas.toDataURL('image/jpeg', 0.82));
        }
      };
      if (typeof ev.target?.result === 'string') {
        img.src = ev.target.result;
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAddUnit = () => {
    setUnits((prev) => [
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

  const handleRemoveUnit = (index: number) => {
    if (units.length <= 1) return;
    setUnits((prev) => prev.filter((_, i) => i !== index));
  };

  const updateUnitField = <K extends keyof HospitalUnit>(
    index: number,
    field: K,
    value: HospitalUnit[K]
  ) => {
    setUnits((prev) =>
      prev.map((u, i) => {
        if (i !== index) return u;
        const updated = { ...u, [field]: value };
        if (field === 'shiftMode') {
          if (value === 'DIURNO') updated.minStaffNight = 0;
          if (value === 'NOTURNO') updated.minStaffDay = 0;
        }
        return updated;
      })
    );
  };

  const handleNextStep = () => {
    const finalRole =
      selectedRoleOption === 'OUTRO' ? customRoleText.trim() : selectedRoleOption.trim();

    if (!name.trim() || !hospitalName.trim()) {
      setErrorMsg('Preencha seu nome completo e o nome da instituição para continuar.');
      return;
    }
    if (!finalRole) {
      setErrorMsg('Selecione ou digite o seu cargo.');
      return;
    }
    setErrorMsg('');
    setStep(2);
  };

  const handleFinish = (e: React.FormEvent) => {
    e.preventDefault();
    const finalRole =
      selectedRoleOption === 'OUTRO' ? customRoleText.trim() : selectedRoleOption.trim();

    if (!effectiveSectorName) {
      setErrorMsg('Selecione ou digite o setor principal que você gerencia.');
      return;
    }

    const cleanedUnits = units
      .map((u) => ({
        ...u,
        name: u.name.trim(),
      }))
      .filter((u) => u.name.length > 0);

    if (cleanedUnits.length === 0) {
      setErrorMsg('Informe o nome de pelo menos 1 unidade.');
      return;
    }

    onCompleteOnboarding(
      {
        name: name.trim(),
        hospitalName: hospitalName.trim(),
        role: finalRole,
        sectorName: effectiveSectorName,
        avatarBase64,
        onboardingCompleted: true,
      },
      cleanedUnits
    );
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-900 flex flex-col justify-center items-center p-4 md:p-8">
      <div className="w-full max-w-3xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Cabeçalho Institucional */}
        <div className="bg-slate-900 text-white px-5 py-5 md:px-8 md:py-6 border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3.5 min-w-0">
            <Logo size={46} />
            <div className="min-w-0">
              <h1 className="text-lg md:text-xl font-bold tracking-tight text-white truncate">
                Configuração da Sua Conta · Escala<span className="text-[#0d9488]">Pro</span>
              </h1>
              <p className="text-xs text-slate-300">
                Defina seus dados e suas unidades · Passo {step} de 2
              </p>
            </div>
          </div>

          {onBackToAuth && (
            <button
              type="button"
              onClick={onBackToAuth}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-bold transition-colors cursor-pointer shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Voltar</span>
            </button>
          )}
        </div>

        <form onSubmit={handleFinish} className="p-6 md:p-8 space-y-6">
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
              {errorMsg}
            </div>
          )}

          {step === 1 ? (
            <div className="space-y-6">
              <div className="flex items-center gap-2 text-sm font-semibold text-teal-700">
                <UserCheck className="w-4 h-4" />
                <span>1. Seus Dados e Instituição</span>
              </div>

              {/* Upload de Foto Circular */}
              <div className="flex flex-col sm:flex-row items-center gap-5 p-4 rounded-2xl bg-slate-50 border border-slate-200">
                <div className="relative w-20 h-20 rounded-full bg-slate-200 border-2 border-teal-600 overflow-hidden flex items-center justify-center shrink-0">
                  {avatarBase64 ? (
                    <img
                      src={avatarBase64}
                      alt="Foto do perfil"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Camera className="w-7 h-7 text-slate-500" />
                  )}
                </div>
                <div className="text-center sm:text-left">
                  <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 text-sm font-medium cursor-pointer transition-colors">
                    <Camera className="w-4 h-4 text-teal-600" />
                    <span>Selecionar Foto de Perfil (opcional)</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Seu Nome Completo *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Digite seu nome completo"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Hospital / Instituição *
                  </label>
                  <input
                    type="text"
                    required
                    value={hospitalName}
                    onChange={(e) => setHospitalName(e.target.value)}
                    placeholder="Digite o nome da instituição"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Seu Cargo *
                  </label>
                  <select
                    required
                    value={selectedRoleOption}
                    onChange={(e) => setSelectedRoleOption(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                  >
                    <option value="" disabled>
                      Selecione seu cargo...
                    </option>
                    {PRE_REGISTERED_MANAGER_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                    <option value="OUTRO">Outro (digitar manualmente)...</option>
                  </select>
                </div>

                {selectedRoleOption === 'OUTRO' && (
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                      Digite seu Cargo *
                    </label>
                    <input
                      type="text"
                      required
                      value={customRoleText}
                      onChange={(e) => setCustomRoleText(e.target.value)}
                      placeholder="Digite o nome do seu cargo"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-200">
                {onBackToAuth ? (
                  <button
                    type="button"
                    onClick={onBackToAuth}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 text-sm font-semibold transition-colors cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Voltar para Entrar / Criar Conta</span>
                  </button>
                ) : (
                  <div />
                )}

                <button
                  type="button"
                  onClick={handleNextStep}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[#0d9488] hover:bg-teal-700 text-white font-semibold text-sm transition-colors cursor-pointer"
                >
                  <span>Avançar para Setor e Unidades</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-teal-700">
                  <Layers className="w-4 h-4" />
                  <span>2. Escolha seu Setor e Suas Unidades</span>
                </div>
                <button
                  type="button"
                  onClick={handleAddUnit}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 text-xs font-bold cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Adicionar Unidade</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Qual setor principal você gerencia? *
                  </label>
                  <select
                    required
                    value={selectedSector}
                    onChange={(e) => setSelectedSector(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                  >
                    <option value="" disabled>
                      Selecione o setor...
                    </option>
                    {PRE_REGISTERED_SECTORS.map((sec) => (
                      <option key={sec} value={sec}>
                        {sec}
                      </option>
                    ))}
                    <option value="OUTRO">Outro setor (digitar manualmente)...</option>
                  </select>
                </div>

                {selectedSector === 'OUTRO' && (
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                      Nome do Setor *
                    </label>
                    <input
                      type="text"
                      required
                      value={customSectorText}
                      onChange={(e) => setCustomSectorText(e.target.value)}
                      placeholder="Digite o nome do setor"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                )}
              </div>

              {/* Lista dinâmica de unidades definidas pelo usuário */}
              <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1">
                {units.map((unit, idx) => (
                  <div
                    key={unit.id}
                    className="p-4 rounded-2xl bg-slate-50 border border-slate-200 grid grid-cols-1 md:grid-cols-12 gap-3 items-end"
                  >
                    <div className="md:col-span-5">
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Nome da Unidade #{idx + 1} *
                      </label>
                      <input
                        type="text"
                        required
                        value={unit.name}
                        onChange={(e) => updateUnitField(idx, 'name', e.target.value)}
                        placeholder="Digite o nome da unidade"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                      />
                    </div>

                    <div className="md:col-span-3">
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Turnos Ativos
                      </label>
                      <select
                        value={unit.shiftMode}
                        onChange={(e) =>
                          updateUnitField(idx, 'shiftMode', e.target.value as UnitShiftMode)
                        }
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900"
                      >
                        <option value="24H">24h (Diurno + Noturno)</option>
                        <option value="DIURNO">Apenas Diurno</option>
                        <option value="NOTURNO">Apenas Noturno</option>
                      </select>
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        Mín. Diurno
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={50}
                        disabled={unit.shiftMode === 'NOTURNO'}
                        value={unit.minStaffDay}
                        onChange={(e) =>
                          updateUnitField(idx, 'minStaffDay', Math.max(0, Number(e.target.value)))
                        }
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900 disabled:bg-slate-100 tabular-nums"
                      />
                    </div>

                    <div className="md:col-span-2 flex items-center gap-2">
                      <div className="flex-1">
                        <label className="block text-xs font-semibold text-slate-600 mb-1">
                          Mín. Noturno
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={50}
                          disabled={unit.shiftMode === 'DIURNO'}
                          value={unit.minStaffNight}
                          onChange={(e) =>
                            updateUnitField(
                              idx,
                              'minStaffNight',
                              Math.max(0, Number(e.target.value))
                            )
                          }
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-base text-slate-900 disabled:bg-slate-100 tabular-nums"
                        />
                      </div>
                      {units.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveUnit(idx)}
                          className="p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer mb-0.5"
                          title="Remover unidade"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 text-sm font-semibold cursor-pointer"
                >
                  Voltar ao Passo 1
                </button>

                <button
                  type="submit"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[#0d9488] hover:bg-teal-700 text-white font-semibold text-sm transition-colors cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Salvar Configurações na Minha Conta</span>
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
