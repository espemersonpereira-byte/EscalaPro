import React, { useEffect, useState } from 'react';
import { Logo } from './Logo';

interface SplashScreenProps {
  onComplete: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onComplete }) => {
  const [progress, setProgress] = useState(12);

  useEffect(() => {
    const t1 = setTimeout(() => setProgress(48), 350);
    const t2 = setTimeout(() => setProgress(86), 850);
    const t3 = setTimeout(() => setProgress(100), 1250);
    const t4 = setTimeout(() => onComplete(), 1500);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0f172a] text-white px-6 select-none">
      <div className="flex flex-col items-center max-w-xs w-full text-center">
        <div className="p-3 rounded-3xl bg-slate-800/80 border border-teal-500/30 shadow-2xl mb-6 transition-transform duration-500 scale-100">
          <Logo size={84} />
        </div>

        <h1 className="text-3xl font-bold tracking-tight text-white">
          Escala<span className="text-[#0d9488]">Pro</span>
        </h1>
        <p className="mt-1.5 text-sm text-slate-300 font-medium">
          Gestão Inteligente de Escalas Hospitalares
        </p>

        <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden mt-8 border border-slate-700">
          <div
            className="h-full bg-[#0d9488] transition-all duration-300 ease-out rounded-full"
            style={{ width: `${progress}%` }}
          />
        </div>

        <p className="mt-3 text-xs text-slate-400 tabular-nums">
          Sincronizando banco local e protocolos hospitalares · {progress}%
        </p>
      </div>
    </div>
  );
};
