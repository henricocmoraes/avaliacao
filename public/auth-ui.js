fetch('/api/session', { cache: 'no-store' })
  .then(response => response.json())
  .then(session => {
    const logout = document.getElementById('logout');
    if (!logout || !session.authRequired) return;
    logout.hidden = false;
    logout.addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      window.location.assign('/');
    });
  })
  .catch(error => console.warn('Não foi possível verificar a sessão.', error));
