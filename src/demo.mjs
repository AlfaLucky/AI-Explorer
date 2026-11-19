const projects = [
  ['Reconcile invoices', 'Finance operations', 'In progress', 'AP'],
  ['Customer portal', 'Product design', 'In review', 'ML'],
  ['Warehouse handoff', 'Logistics', 'Complete', 'SC']
];

const pages = {
  '/demo/': ['Overview', 'A simple workspace for keeping your team’s projects on track.', `
    <div class="tile-grid">
      <a class="tile" href="/demo/projects"><span>Projects</span><strong>3 active workstreams</strong><span>Browse projects</span></a>
      <a class="tile" href="/demo/activity"><span>Activity</span><strong>Recent updates</strong><span>View the activity feed</span></a>
      <a class="tile" href="/demo/settings"><span>Settings</span><strong>Workspace preferences</strong><span>Manage settings</span></a>
    </div>`],
  '/demo/projects': ['Projects', 'Find, review, and create projects in this workspace.', `
    <div class="panel">
      <div class="panel-head"><h2>All projects</h2><a class="button" href="/demo/projects/new">New project</a></div>
      <form id="filter"><label for="search">Search projects</label><div class="field-row"><input id="search" name="search" type="search" placeholder="Project name"><button type="submit">Search</button></div></form>
      <div id="project-list" class="project-list"></div>
      <p id="summary" class="muted" role="status"></p>
    </div>`],
  '/demo/projects/new': ['New project', 'Add a project to your demo workspace.', `
    <div class="panel narrow"><form id="new-project">
      <label for="name">Project name</label><input id="name" name="name" maxlength="60" required>
      <label for="team">Team</label><select id="team" name="team"><option>Operations</option><option>Product</option></select>
      <label for="notes">Notes</label><textarea id="notes" name="notes" rows="3"></textarea>
      <button class="button" type="submit">Create project</button><p id="result" role="status" class="notice" hidden></p>
    </form></div>`],
  '/demo/activity': ['Activity', 'See recent changes across your workspace.', `
    <div class="panel narrow"><h2>Workspace feed</h2><p class="muted">Load the most recent project updates.</p>
      <button class="button" id="load-activity">Load activity</button>
      <p id="activity-status" role="status" class="notice" hidden></p><ul id="activity-list"></ul>
    </div>`],
  '/demo/settings': ['Settings', 'Manage your workspace name and notification address.', `
    <div class="panel narrow"><form id="settings">
      <h2>Workspace preferences</h2>
      <label for="workspace">Workspace name</label><input id="workspace" name="workspace" value="Fieldwork" maxlength="60" required>
      <label for="email">Notification email</label><input id="email" name="email" type="email" value="team@example.test" required>
      <button class="button" type="submit">Save preferences</button><p id="result" role="alert" class="notice" hidden></p>
    </form></div>`]
};

export function isDemoPage(path) {
  return Object.hasOwn(pages, path);
}

export function demoResponse(req, path) {
  if (req.method === 'GET' && isDemoPage(path)) {
    const [title, description, content] = pages[path];
    const navigation = Object.entries(pages).filter(([href]) => href !== '/demo/projects/new')
      .map(([href, [label]]) => `<a href="${href}"${href === path ? ' aria-current="page"' : ''}>${label}</a>`).join('');
    return [200, 'text/html; charset=utf-8', `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Fieldwork</title><link rel="stylesheet" href="/demo/site.css"><link rel="service-desc" href="/demo/api/contract">
<script src="/demo/site.js" defer></script></head><body>
<header><div class="header-inner"><a class="brand" href="/demo/"><span class="logo" aria-hidden="true">F</span>Fieldwork</a><nav aria-label="Workspace">${navigation}</nav><a class="back" href="/">AI Explorer</a></div></header>
<main><p class="context">DEMO WORKSPACE</p><h1>${title}</h1><p class="intro">${description}</p>${content}</main>
<footer>Fieldwork · Exploratory QA demo</footer></body></html>`];
  }

  const json = (body, status = 200) => [status, 'application/json; charset=utf-8', JSON.stringify(body)];
  if (req.method === 'GET') {
    switch (path) {
      case '/demo/api/projects': return json({ projects });
      case '/demo/api/summary': return json({ openProjects: '3', archivedProjects: 1 });
      case '/demo/api/activity': return json({ items: null });
      case '/demo/api/contract': return json({ responses: [
        { path: '/demo/api/projects', properties: { projects: 'array' } },
        { path: '/demo/api/summary', properties: { openProjects: 'integer', archivedProjects: 'integer' } }
      ] });
    }
  }
  if (req.method === 'POST' && path === '/demo/api/preferences') {
    return json({ error: 'Preferences could not be saved. Please try again later.' }, 500);
  }
  return null;
}
