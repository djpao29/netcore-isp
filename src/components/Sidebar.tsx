// ============================================================================
//  Barra lateral responsiva para NetCore ISP
//  Menú navegable con grupos colapsables, indicador de módulo activo
//  y guardado persistente en localStorage.
// ============================================================================

import React, { useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}

interface Props {
  groups: NavGroup[];
  activeId: string;
  onSelect: (id: string) => void;
  ispName: string;
  ispPlan: string;
  userName: string;
  userRole: string;
  onOpenPortal?: () => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  openGroups: Set<string>;
  onOpenGroupsChange: (groups: Set<string>) => void;
}

export default function Sidebar({
  groups,
  activeId,
  onSelect,
  ispName,
  ispPlan,
  userName,
  userRole,
  onOpenPortal,
  collapsed,
  onCollapsedChange,
  openGroups,
  onOpenGroupsChange
}: Props) {

  const activeGroup = useMemo(
    () => groups.find((g) => g.items.some((i) => i.id === activeId))?.group,
    [groups, activeId]
  );

  // Efecto para abrir automáticamente el grupo que contiene el módulo activo.
  useEffect(() => {
    if (activeGroup) {
      onOpenGroupsChange(new Set([...openGroups, activeGroup]));
    }
  }, [activeGroup, onOpenGroupsChange]);

  const toggleGroup = (group: string) => {
    const newGroups = new Set(openGroups);
    newGroups.has(group) ? newGroups.delete(group) : newGroups.add(group);
    onOpenGroupsChange(newGroups);
  };

  const isGroupOpen = (group: string) => openGroups.has(group);

  return (
    <aside
      className={`flex shrink-0 flex-col border-r transition-all duration-200 ${
        collapsed ? 'w-[68px]' : 'w-64'
      } border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]`}
    >
      {/* Header: Logo + Colapso global */}
      <div className="flex items-center gap-2.5 border-b px-4 py-3.5 border-[var(--sidebar-border)]">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 font-bold text-slate-950">
          N
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{ispName}</div>
            <div className="truncate text-[10px] font-medium uppercase tracking-wide text-sky-400">
              {ispPlan}
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => onCollapsedChange(!collapsed)}
          title={collapsed ? 'Expandir menú' : 'Colapsar menú'}
          className={`ml-auto rounded-md p-1 text-slate-500 hover:bg-slate-800/50 hover:text-slate-200 ${collapsed ? 'text-slate-200' : ''} transition-colors`}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Navigation: Collapsible groups */}
      <nav className="flex-1 flex flex-col pt-2 pb-3 overflow-y-auto">
        {!collapsed ? (
          // Expanded mode: show collapsible groups with items
          <div className="flex flex-col gap-1 px-2">
            {groups.map((g) => {
              const isOpen = isGroupOpen(g.group);
              const hasActive = g.items.some((i) => i.id === activeId);
              const GroupIcon = g.items[0]?.icon;
              return (
                <div key={g.group} className="flex flex-col">
                  {/* Group header - clickable to toggle */}
                  <button
                    type="button"
                    onClick={() => toggleGroup(g.group)}
                    className={`flex items-center gap-2 px-2 py-2 rounded-lg transition-colors ${
                      isOpen || hasActive
                        ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                        : 'bg-transparent text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                    }`}
                    aria-expanded={isOpen}
                  >
                    {GroupIcon && <GroupIcon className="h-4 w-4 flex-shrink-0 text-[var(--accent-primary)]" />}
                    <span className="text-sm font-medium truncate flex-1">{g.group}</span>
                    <ChevronDown
                      className={`h-4 w-4 flex-shrink-0 transition-transform text-[var(--text-muted)] ${isOpen ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {/* Group items - collapsible */}
                  <div
                    className={`overflow-hidden transition-all duration-200 ease-in-out ${
                      isOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
                    }`}
                    style={{ height: isOpen ? 'auto' : 0 }}
                  >
                    <div className="pl-6 pt-1 pb-2 space-y-1">
                      {g.items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            onSelect(item.id);
                            if (collapsed) onCollapsedChange(true);
                          }}
                          className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-[11px] transition-colors ${
                            item.id === activeId
                              ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]'
                              : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          <item.icon className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-muted)]" />
                          <span className="truncate flex-1">{item.label}</span>
                          {item.badge && item.badge > 0 && (
                            <span className="ml-auto px-1.5 py-0.5 text-[9px] font-medium rounded-full bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]">
                              {item.badge}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          // Collapsed mode: show only group icons with tooltip
          <div className="flex flex-col gap-1 px-2">
            {groups.map((g) => {
              const isOpen = isGroupOpen(g.group);
              const Icon = g.items[0]?.icon;
              return (
                <div key={g.group} className="relative">
                  <button
                    type="button"
                    onClick={() => toggleGroup(g.group)}
                    className={`flex items-center justify-center w-full px-2 py-2 rounded-lg transition-colors ${
                      isOpen ? 'bg-[var(--bg-tertiary)]' : 'hover:bg-[var(--bg-hover)]'
                    }`}
                    aria-expanded={isOpen}
                    aria-label={g.group}
                  >
                    <Icon className="h-5 w-5 text-[var(--text-muted)]" />
                  </button>
                  {/* Dropdown on hover in collapsed mode */}
                  {isOpen && (
                    <div className="absolute left-full top-0 ml-2 w-56 bg-[var(--card-bg)] border rounded-lg shadow-xl z-50 py-1 overflow-hidden animate-fade-in border-[var(--card-border)]">
                      <div className="px-2 py-1 border-b border-[var(--card-border)]">
                        <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">{g.group}</span>
                      </div>
                      <div className="py-1 space-y-0.5">
                        {g.items.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              onSelect(item.id);
                              onCollapsedChange(true);
                            }}
                            className={`flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm transition-colors ${
                              item.id === activeId
                                ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]'
                                : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                            }`}
                          >
                            <item.icon className="h-4 w-4 flex-shrink-0 text-[var(--text-muted)]" />
                            <span className="truncate flex-1">{item.label}</span>
                            {item.badge && item.badge > 0 && (
                              <span className="ml-auto px-1.5 py-0.5 text-[9px] font-medium rounded-full bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]">
                                {item.badge}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </nav>
    </aside>
  );
}