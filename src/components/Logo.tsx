import React from 'react';

interface LogoProps {
  size?: number;
  className?: string;
}

export const Logo: React.FC<LogoProps> = ({ size = 40, className = '' }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${className}`}
      aria-label="Logotipo EscalaPro"
    >
      <rect width="512" height="512" rx="112" fill="#0f172a" />
      <rect
        x="24"
        y="24"
        width="464"
        height="464"
        rx="92"
        stroke="#0d9488"
        strokeWidth="10"
        strokeOpacity="0.4"
      />
      {/* Cruz Médica Minimalista */}
      <path
        d="M208 96H304C312.837 96 320 103.163 320 112V192H400C408.837 192 416 199.163 416 208V304C416 312.837 408.837 320 400 320H320V400C320 408.837 312.837 416 304 416H208C199.163 416 192 408.837 192 400V320H112C103.163 320 96 312.837 96 304V208C96 199.163 103.163 192 112 192H192V112C192 103.163 199.163 96 208 96Z"
        fill="#0d9488"
      />
      {/* Grade de Calendário Interna */}
      <rect x="216" y="124" width="34" height="34" rx="6" fill="#0f172a" fillOpacity="0.35" />
      <rect x="262" y="124" width="34" height="34" rx="6" fill="#f8fafc" />
      <rect x="124" y="216" width="34" height="34" rx="6" fill="#f8fafc" />
      <rect x="124" y="262" width="34" height="34" rx="6" fill="#0f172a" fillOpacity="0.35" />
      <rect x="354" y="216" width="34" height="34" rx="6" fill="#0f172a" fillOpacity="0.35" />
      <rect x="354" y="262" width="34" height="34" rx="6" fill="#f8fafc" />
      <rect x="216" y="354" width="34" height="34" rx="6" fill="#f8fafc" />
      <rect x="262" y="354" width="34" height="34" rx="6" fill="#0f172a" fillOpacity="0.35" />
      {/* Linha de Pulso / ECG */}
      <path
        d="M136 256H202L224 210L256 306L284 234L302 256H376"
        stroke="#ffffff"
        strokeWidth="18"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
