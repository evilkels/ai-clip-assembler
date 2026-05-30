import { NavLink } from 'react-router-dom';

const projects = [
  { name: 'sunset-drone-footage', clips: 72, active: true },
  { name: 'forest-interview', clips: 18, active: false },
  { name: 'coast-broll', clips: 44, active: false },
];

const routes = [
  { to: '/import', label: 'Import' },
  { to: '/review', label: 'Review' },
  { to: '/timeline', label: 'Timeline' },
  { to: '/export', label: 'Export' },
];

export function Sidebar() {
  return (
    <aside className="sidebar" aria-label="Project sidebar">
      <button className="sidebar-new-project" type="button">
        <span aria-hidden="true">+</span>
        New Project
      </button>

      <div className="sidebar-section">
        <div className="sidebar-section-label">Projects</div>
        <div className="project-list">
          {projects.map((project) => (
            <button
              className={project.active ? 'project-row active' : 'project-row'}
              key={project.name}
              type="button"
            >
              <span className="project-dot" aria-hidden="true" />
              <span className="project-row-name">{project.name}</span>
              <span className="project-row-count">{project.clips}</span>
            </button>
          ))}
        </div>
      </div>

      <nav className="sidebar-section" aria-label="Workflow">
        <div className="sidebar-section-label">Workflow</div>
        <div className="route-list">
          {routes.map((route) => (
            <NavLink
              className={({ isActive }) => (isActive ? 'route-link active' : 'route-link')}
              key={route.to}
              to={route.to}
            >
              {route.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <div className="sidebar-footer">
        <button className="sidebar-action" type="button">
          Open Folder
        </button>
        <button className="sidebar-action" type="button">
          Settings
        </button>
        <button className="sidebar-action" type="button">
          Diagnostics
        </button>
      </div>
    </aside>
  );
}
