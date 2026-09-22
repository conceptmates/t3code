import { useMemo } from "react";

import {
  orderItemsByPreferredIds,
  sortLogicalProjectsForSidebar,
} from "../components/Sidebar.logic";
import { getProjectOrderKey, selectProjectGroupingSettings } from "../logicalProject";
import {
  buildSidebarProjectSnapshots,
  type SidebarProjectSnapshot,
} from "../sidebarProjectGrouping";
import { useProjects, useThreadShells } from "../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { legacyProjectCwdPreferenceKey, useUiStateStore } from "../uiStateStore";
import { useClientSettings } from "./useSettings";

/**
 * The sidebar's grouped project list, in the order the sidebar shows it.
 *
 * The same derivation is currently inlined in `Sidebar`, `CommandPalette` and
 * `DraftHeroHeadline`; this is the shared home for it, and those three should
 * move here rather than gain a fourth copy. Anything keyed off `projectKey`
 * must agree with the sidebar, or a project filter set from one surface would
 * not match the rows in another.
 */
export function useProjectGroups(): readonly SidebarProjectSnapshot[] {
  const projects = useProjects();
  const threads = useThreadShells();
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const sidebarProjectSortOrder = useClientSettings((settings) => settings.sidebarProjectSortOrder);
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();

  const environmentLabelById = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
      ),
    [environments],
  );

  const orderedProjects = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: projects,
        preferredIds: projectOrder,
        getId: getProjectOrderKey,
        getPreferenceIds: (project) => [
          getProjectOrderKey(project),
          legacyProjectCwdPreferenceKey(project.workspaceRoot),
        ],
      }),
    [projectOrder, projects],
  );

  const unsorted = useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects: sidebarProjectSortOrder === "manual" ? orderedProjects : projects,
        settings: projectGroupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: (environmentId) => environmentLabelById.get(environmentId) ?? null,
      }),
    [
      environmentLabelById,
      orderedProjects,
      primaryEnvironmentId,
      projectGroupingSettings,
      projects,
      sidebarProjectSortOrder,
    ],
  );

  return useMemo(
    () => sortLogicalProjectsForSidebar(unsorted, threads, sidebarProjectSortOrder),
    [sidebarProjectSortOrder, threads, unsorted],
  );
}
