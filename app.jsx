// app.jsx — Kilo main app: tab routing + frame integration

function KiloApp({ tweaks, accentOverride }) {
  const [tab, setTab] = React.useState('home');

  // Apply accent override if set
  React.useEffect(() => {
    if (accentOverride) {
      window.KILO_C.accent = accentOverride;
      // re-trigger style refresh by toggling a class
      document.documentElement.style.setProperty('--kilo-accent', accentOverride);
    }
  }, [accentOverride]);

  const tabContent = (() => {
    switch (tab) {
      case 'home':   return <KiloHome   goToTab={setTab} openSession={() => setTab('log')} />;
      case 'log':    return <KiloLog    goToTab={setTab} />;
      case 'weight': return <KiloWeight goToTab={setTab} />;
      case 'stats':  return <KiloStats  goToTab={setTab} />;
      case 'more':   return <KiloMore   goToTab={setTab} />;
      default: return null;
    }
  })();

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: KILO_C.bg }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {tabContent}
      </div>
      <KiloTabBar tab={tab} setTab={setTab} />
    </div>
  );
}

window.KiloApp = KiloApp;
