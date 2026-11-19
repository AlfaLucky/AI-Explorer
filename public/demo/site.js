const element = (id) => document.getElementById(id);

function showNotice(target, message, kind = '') {
  target.hidden = false;
  target.textContent = message;
  target.dataset.kind = kind;
}

function readProjects() {
  return JSON.parse(sessionStorage.getItem('fieldwork-projects') || '[]');
}

async function loadProjects() {
  const response = await fetch('/demo/api/projects');
  const { projects } = await response.json();
  const rows = [...readProjects(), ...projects];
  const render = (query = '') => {
    const visible = rows.filter(([name]) => name.toLowerCase().includes(query.toLowerCase()));
    element('project-list').replaceChildren(...visible.map(([name, team, status, initials]) => {
      const row = document.createElement('div');
      row.className = 'project-row';
      for (const [value, cssClass] of [[initials, 'avatar'], [name, 'project-name'], [team, 'muted'], [status, 'status']]) {
        const span = document.createElement('span');
        span.className = cssClass;
        span.textContent = value;
        row.append(span);
      }
      return row;
    }));
    if (!visible.length) element('project-list').textContent = 'No matching projects.';
  };
  element('filter').addEventListener('submit', (event) => {
    event.preventDefault();
    render(element('search').value.trim());
  });
  render();
  const summaryResponse = await fetch('/demo/api/summary');
  const summary = await summaryResponse.json();
  element('summary').textContent = `${summary.openProjects} open · ${summary.archivedProjects} archived`;
}

if (element('project-list')) void loadProjects();

element('new-project')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const { name, team } = Object.fromEntries(new FormData(event.currentTarget));
  sessionStorage.setItem('fieldwork-projects', JSON.stringify([[name, team, 'In progress', 'QA'], ...readProjects()]));
  showNotice(element('result'), `Project created: ${name}`, 'success');
  console.info('Fieldwork created a project in the demo session.');
});

element('load-activity')?.addEventListener('click', async () => {
  showNotice(element('activity-status'), 'Loading activity…');
  const response = await fetch('/demo/api/activity');
  const { items } = await response.json();
  element('activity-list').replaceChildren(...items.map((text) => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }));
  showNotice(element('activity-status'), `${items.length} updates loaded.`);
});

element('settings')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const response = await fetch('/demo/api/preferences', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values)
  });
  const result = await response.json();
  showNotice(element('result'), response.ok ? 'Preferences saved.' : result.error, response.ok ? 'success' : 'error');
});
