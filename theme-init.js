try { document.documentElement.dataset.theme = localStorage.getItem('sp-theme') || 'cyberpunk'; } catch (e) { /* default theme */ }
