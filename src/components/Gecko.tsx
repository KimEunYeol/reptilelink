export function Gecko({ className = '', variant = 0 }: { className?: string; variant?: number }) {
  const body = ['#8ddfa0', '#e6c67c', '#b4d8b7'][variant % 3];
  return <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 360 240" role="img" aria-label="도마뱀 일러스트">
    <ellipse cx="186" cy="207" rx="109" ry="12" fill="#193b2a" opacity=".08" />
    <path d="M150 169C91 212 51 187 60 160c7-19 24-16 28-6 4 9-5 15-9 13 12 11 29 8 46-10" fill="none" stroke={body} strokeWidth="26" strokeLinecap="round" />
    <path d="m176 148-32 36-24 4m89-25 9 25 22 5m-26-61-25-24-20 5m65 28 26-29 15 1" fill="none" stroke={body} strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
    <ellipse cx="184" cy="150" rx="61" ry="34" transform="rotate(-15 184 150)" fill={body} />
    <path d="M214 139c-16-35-8-63 27-69 32-6 54 23 40 45-10 15-36 30-67 24Z" fill={body} />
    <path d="m220 85 1-17 15 7m28 2 10-11 4 20" fill={body} />
    <ellipse cx="244" cy="95" rx="10" ry="12" fill="#fcfff5" /><ellipse cx="247" cy="96" rx="4" ry="8" fill="#24442d" />
    <path d="m256 116 14-3" stroke="#47764a" strokeWidth="3" strokeLinecap="round" />
    <g fill="#fff4cc" opacity=".8"><circle cx="166" cy="139" r="5"/><circle cx="182" cy="153" r="6"/><circle cx="200" cy="138" r="4"/><circle cx="147" cy="157" r="4"/><circle cx="213" cy="155" r="4"/></g>
    <path d="M80 204c18-35 17-61 9-90 24 16 32 56 22 90m-9-37c28-41 52-40 63-38-23 7-40 23-49 49" fill="#77be88" opacity=".55" />
  </svg>;
}
