// ui.jsx — Kilo shared UI primitives (industrial dark, hot-orange accent)

const KILO_C = {
  bg:        '#0a0a0a',
  bg2:       '#111111',
  surface:   '#161616',
  surface2:  '#1c1c1c',
  border:    '#262626',
  border2:   '#333333',
  ink:       '#f5f5f5',
  ink2:      '#a3a3a3',
  ink3:      '#737373',
  ink4:      '#525252',
  accent:    '#ff5b1f',
  accent2:   '#ff7a47',
  accentDim: 'rgba(255,91,31,0.14)',
  green:     '#84cc16',
  yellow:    '#facc15',
  red:       '#ef4444',
  blue:      '#60a5fa',
};

const KILO_FONT = "'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif";
const KILO_BRAND_FONT = "'Anybody', sans-serif";
const KILO_MONO = "'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, monospace";

// Inject styles once
if (typeof document !== 'undefined' && !document.getElementById('kilo-styles')) {
  const s = document.createElement('style');
  s.id = 'kilo-styles';
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Anybody:ital,wght@0,100..900;1,100..900&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
    .kilo-screen { font-family: ${KILO_FONT}; color: ${KILO_C.ink}; background: ${KILO_C.bg}; height: 100%; overflow: hidden; display: flex; flex-direction: column; -webkit-font-smoothing: antialiased; }
    .kilo-brand { font-family: ${KILO_BRAND_FONT}; font-weight: 800; text-transform: uppercase; letter-spacing: -0.04em; }
    .kilo-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; }
    .kilo-scroll::-webkit-scrollbar { display: none; }
    .kilo-mono { font-family: ${KILO_MONO}; font-feature-settings: "tnum" on, "zero" on; }
    .kilo-tab { font-feature-settings: "tnum" on, "zero" on; }
    button.kilo-btn { font-family: ${KILO_FONT}; cursor: pointer; border: none; }
    .kilo-divider { border-bottom: 1px solid ${KILO_C.border}; }
    .kilo-divider-thin { border-bottom: 1px solid ${KILO_C.border}; }
    input.kilo-input { font-family: ${KILO_MONO}; background: transparent; border: none; outline: none; color: ${KILO_C.ink}; width: 100%; padding: 0; }
    input.kilo-input::placeholder { color: ${KILO_C.ink4}; }
    .kilo-no-tap { -webkit-tap-highlight-color: transparent; }
    .kilo-pill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; border-radius: 3px; font-size: 9px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; font-family: ${KILO_FONT}; }
    @keyframes kilo-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.4 } }
    .kilo-blink { animation: kilo-pulse 2s ease-in-out infinite; }
    .kilo-cursor::after { content: '|'; color: ${KILO_C.accent}; animation: kilo-pulse 1.1s steps(2) infinite; margin-left: 1px; }
  `;
  document.head.appendChild(s);
}

// Logo mark (Direction 3: Technical Precision - exact approved asset)
function KiloLogo({ size = 32 }) {
  return (
    <img 
      src="src/assets/brand/logo.png" 
      alt="Kilo Logo" 
      style={{ 
        width: size, 
        height: size, 
        objectFit: 'contain', 
        filter: 'invert(1) hue-rotate(180deg)',
        mixBlendMode: 'screen' 
      }} 
    />
  );
}

// Top status header — fine rule, label rows
function KiloHeader({ title, sub, right, isBrand = false }) {
  const isKiloBrand = isBrand || title === 'Kilo';
  return (
    <div style={{ padding: '14px 16px 12px', borderBottom: `1px solid ${KILO_C.border}`, background: KILO_C.bg, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
          {isKiloBrand ? (
            <>
              <KiloLogo size={42} />
              <div style={{ display: 'flex', flexDirection: 'column', marginTop: 2 }}>
                {sub && <div className="kilo-mono" style={{ fontSize: 9, color: KILO_C.ink3, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 2 }}>{sub}</div>}
                <img 
                  src="src/assets/brand/wordmark.png" 
                  alt="Kilo" 
                  style={{ 
                    height: 52, 
                    width: 'auto', 
                    objectFit: 'contain', 
                    filter: 'invert(1) hue-rotate(180deg)',
                    mixBlendMode: 'screen',
                    marginLeft: -6,
                    marginTop: -2
                  }} 
                />
              </div>
            </>
          ) : (
            <div style={{ minWidth: 0 }}>
              {sub && <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4 }}>{sub}</div>}
              <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{title}</div>
            </div>
          )}
        </div>
        {right}
      </div>
    </div>
  );
}

// Bottom tab bar
function KiloTabBar({ tab, setTab }) {
  const tabs = [
    { id: 'home',   label: 'Home',   icon: 'home' },
    { id: 'log',    label: 'Log',    icon: 'log' },
    { id: 'weight', label: 'Weight', icon: 'weight' },
    { id: 'stats',  label: 'Stats',  icon: 'stats' },
    { id: 'more',   label: 'More',   icon: 'more' },
  ];
  return (
    <div style={{
      display: 'flex', borderTop: `1px solid ${KILO_C.border}`, background: KILO_C.bg,
      paddingBottom: 4, paddingTop: 4, flexShrink: 0,
    }}>
      {tabs.map(t => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            className="kilo-btn kilo-no-tap"
            onClick={() => setTab(t.id)}
            style={{
              flex: 1, background: 'transparent', padding: '8px 4px 6px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              color: active ? KILO_C.accent : KILO_C.ink3,
            }}
          >
            <KiloIcon name={t.icon} size={18} />
            <span className="kilo-mono" style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Tiny icon set (1.5px stroke)
function KiloIcon({ name, size = 16, color = 'currentColor' }) {
  const s = size;
  const sw = 1.5;
  const p = { fill: 'none', stroke: color, strokeWidth: sw, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'home':   return <svg width={s} height={s} viewBox="0 0 20 20"><path {...p} d="M3 8.5L10 3l7 5.5V17a1 1 0 0 1-1 1h-3v-6H7v6H4a1 1 0 0 1-1-1V8.5z"/></svg>;
    case 'log':    return <svg width={s} height={s} viewBox="0 0 20 20"><path {...p} d="M3 10h2M15 10h2M5.5 6h-2v8h2M14.5 6h2v8h-2M5.5 10h9M7 7v6M13 7v6M9 8v4M11 8v4"/></svg>;
    case 'weight': return <svg width={s} height={s} viewBox="0 0 20 20"><path {...p} d="M4 5h12l1.5 12.5a.5.5 0 0 1-.5.55H3a.5.5 0 0 1-.5-.55L4 5z"/><path {...p} d="M7 8.5l3 2.5M10 7v1.5"/></svg>;
    case 'stats':  return <svg width={s} height={s} viewBox="0 0 20 20"><path {...p} d="M3 17h14M5 13v4M9 9v8M13 11v6M17 5v12"/></svg>;
    case 'more':   return <svg width={s} height={s} viewBox="0 0 20 20"><circle cx="5" cy="10" r="1.5" fill={color}/><circle cx="10" cy="10" r="1.5" fill={color}/><circle cx="15" cy="10" r="1.5" fill={color}/></svg>;
    case 'plus':   return <svg width={s} height={s} viewBox="0 0 20 20"><path {...p} d="M10 4v12M4 10h12"/></svg>;
    case 'check':  return <svg width={s} height={s} viewBox="0 0 20 20"><path {...p} d="M4 10.5l4 4 8-9"/></svg>;
    case 'arrow':  return <svg width={s} height={s} viewBox="0 0 20 20"><path {...p} d="M7 4l6 6-6 6"/></svg>;
    case 'arrowL': return <svg width={s} height={s} viewBox="0 0 20 20"><path {...p} d="M13 4l-6 6 6 6"/></svg>;
    case 'arrowU': return <svg width={s} height={s} viewBox="0 0 20 20"><path {...p} d="M4 13l6-6 6 6"/></svg>;
    case 'arrowD': return <svg width={s} height={s} viewBox="0 0 20 20"><path {...p} d="M4 7l6 6 6-6"/></svg>;
    case 'close':  return <svg width={s} height={s} viewBox="0 0 20 20"><path {...p} d="M5 5l10 10M15 5L5 15"/></svg>;
    case 'edit':   return <svg width={s} height={s} viewBox="0 0 20 20"><path {...p} d="M3 17l1-4 9-9 3 3-9 9-4 1zM12 5l3 3"/></svg>;
    case 'dot':    return <svg width={s} height={s} viewBox="0 0 20 20"><circle cx="10" cy="10" r="3" fill={color}/></svg>;
    case 'gear':   return <svg width={s} height={s} viewBox="0 0 20 20"><circle {...p} cx="10" cy="10" r="2.5"/><path {...p} d="M10 2v2M10 16v2M2 10h2M16 10h2M4.5 4.5l1.4 1.4M14.1 14.1l1.4 1.4M4.5 15.5l1.4-1.4M14.1 5.9l1.4-1.4"/></svg>;
    case 'flame':  return <svg width={s} height={s} viewBox="0 0 20 20"><path {...p} d="M10 2c.5 3 3 4 3 7a3 3 0 0 1-6 0c0-1 .5-2 1-2.5C8 8 9 6 10 2z"/><path {...p} d="M10 12a1.5 1.5 0 0 0-1.5 1.5c0 1 .5 1.5 1.5 1.5s1.5-.5 1.5-1.5A1.5 1.5 0 0 0 10 12z"/></svg>;
    case 'history':return <svg width={s} height={s} viewBox="0 0 20 20"><path {...p} d="M3 10a7 7 0 1 0 2-5M3 4v3h3M10 6v4l3 2"/></svg>;
    case 'calc':   return <svg width={s} height={s} viewBox="0 0 20 20"><rect {...p} x="4" y="3" width="12" height="14" rx="1.5"/><path {...p} d="M6 6h8M6.5 10h.01M10 10h.01M13.5 10h.01M6.5 13.5h.01M10 13.5h.01M13.5 13.5h.01"/></svg>;
    case 'deload': return <svg width={s} height={s} viewBox="0 0 20 20"><path {...p} d="M4 6h12M3 10h14M5 14h10M8 4l4 12"/></svg>;
    case 'goal':   return <svg width={s} height={s} viewBox="0 0 20 20"><circle {...p} cx="10" cy="10" r="7"/><circle {...p} cx="10" cy="10" r="4"/><circle cx="10" cy="10" r="1.5" fill={color}/></svg>;
    case 'pt':     return <svg width={s} height={s} viewBox="0 0 20 20"><path {...p} d="M10 3v14M3 10h14M5 7l3 3-3 3M15 7l-3 3 3 3"/></svg>;
    default: return null;
  }
}

// Section header with rule
function KiloSection({ title, right, children, padded = true, dense = false }) {
  return (
    <div style={{ marginTop: dense ? 16 : 24 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        padding: padded ? '0 16px 8px' : '0 0 8px',
      }}>
        <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 600 }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

// PO badge
function KiloPill({ kind = 'default', children }) {
  const styles = {
    default: { bg: KILO_C.surface2, fg: KILO_C.ink2, border: KILO_C.border2 },
    accent:  { bg: KILO_C.accentDim, fg: KILO_C.accent, border: 'transparent' },
    green:   { bg: 'rgba(132,204,22,0.15)', fg: KILO_C.green, border: 'transparent' },
    yellow:  { bg: 'rgba(250,204,21,0.15)', fg: KILO_C.yellow, border: 'transparent' },
    muted:   { bg: 'transparent', fg: KILO_C.ink3, border: KILO_C.border2 },
  }[kind];
  return (
    <span className="kilo-pill" style={{ background: styles.bg, color: styles.fg, border: `1px solid ${styles.border}` }}>{children}</span>
  );
}

// Number display with mono + tabular numerals
function KiloNum({ children, size = 16, color, weight = 500, sub }) {
  return (
    <span className="kilo-mono" style={{ fontSize: size, fontWeight: weight, color: color || KILO_C.ink, letterSpacing: '-0.01em' }}>
      {children}
      {sub && <span style={{ fontSize: size * 0.55, color: KILO_C.ink3, marginLeft: 2 }}>{sub}</span>}
    </span>
  );
}

window.KILO_C = KILO_C;
window.KILO_FONT = KILO_FONT;
window.KILO_MONO = KILO_MONO;
window.KiloHeader = KiloHeader;
window.KiloTabBar = KiloTabBar;
window.KiloIcon = KiloIcon;
window.KiloSection = KiloSection;
window.KiloPill = KiloPill;
window.KiloNum = KiloNum;
