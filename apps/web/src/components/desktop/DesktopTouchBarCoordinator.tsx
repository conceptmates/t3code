import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { getThreadSortTimestamp, sortThreads } from "../../lib/threadSort";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { useHandleNewThread, useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useProjectGroups } from "../../hooks/useProjectGroups";
import { useClientSettings, usePrimarySettings } from "../../hooks/useSettings";
import { useDesktopTouchBar } from "../../hooks/useDesktopTouchBar";
import { startNewThreadFromContext } from "../../lib/chatThreadActions";
import {
  chipSvg,
  projectIconKey,
  projectRowSvg,
  providerChipKey,
  providerRowKey,
  resolveProjectIcon,
  rowSvg,
} from "../../lib/touchBarArtwork";
import {
  providerChipSpec,
  providerRowSpec,
  rankProjects,
  type TouchBarChoiceInput,
  type TouchBarProviderInput,
} from "../../lib/touchBarStrip";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { useActiveEnvironmentId, useThreadShells } from "../../state/entities";
import { environmentServerConfigsAtom, primaryServerProvidersAtom } from "../../state/server";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useTouchBarThreadStore } from "../../touchBarThreadStore";
import { useUiStateStore } from "../../uiStateStore";

/** The sidebar's own row for "no project filter"; the key must match. */
const ALL_PROJECTS_KEY = "all";

/**
 * Drives the macOS Touch Bar for the whole app.
 *
 * It lives here rather than in the chat view so the strip survives the project
 * picker and settings — an empty strip outside a thread reads as a broken
 * feature. The one thread-scoped item, the run button, arrives through
 * `useTouchBarThreadStore`, which the chat view fills while it is mounted.
 *
 * A no-op on web, Windows, Linux, and any desktop build without the bridge.
 */
export function DesktopTouchBarCoordinator() {
  const enabled = usePrimarySettings((settings) => settings.touchBarEnabled);
  // Providers come from the environment the user is actually working in, not
  // just the primary one. Reading only the primary is why a quota that had
  // visibly changed in the app could leave the strip showing a stale number:
  // the two were reading different environments.
  const activeEnvironmentId = useActiveEnvironmentId();
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const activeConfig =
    activeEnvironmentId === null ? undefined : serverConfigs.get(activeEnvironmentId);
  const primaryProviders = useAtomValue(primaryServerProvidersAtom);
  const primarySettings = usePrimarySettings();
  const providerSnapshots = activeConfig?.providers ?? primaryProviders;
  const settings = activeConfig?.settings ?? primarySettings;
  const projectGroups = useProjectGroups();
  const threads = useThreadShells();
  const threadSortOrder = useClientSettings((value) => value.sidebarThreadSortOrder);
  const projectScopeKey = useUiStateStore((store) => store.sidebarProjectScopeKey);
  const setProjectScopeKey = useUiStateStore((store) => store.setSidebarProjectScopeKey);
  const thread = useTouchBarThreadStore();
  // Read through context, not a store: SidebarProvider keeps this in React
  // state, which is why this component is mounted inside it.
  // Quota countdowns are shown to the minute, so the artwork is redrawn on
  // that cadence and no faster.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [enabled]);
  const navigate = useNavigate();
  const openThread = useNewThreadHandler();
  const newThreadContext = useHandleNewThread();

  const providers = useMemo<readonly TouchBarProviderInput[]>(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(providerSnapshots), settings),
      )
        .filter(
          (entry) => entry.enabled && entry.isAvailable && entry.snapshot.usageLimits !== undefined,
        )
        .map((entry) => ({
          instanceId: entry.instanceId,
          displayName: entry.displayName,
          driverKind: entry.driverKind,
          accentColor: entry.accentColor,
          usageLimits: entry.snapshot.usageLimits,
        })),
    [providerSnapshots, settings],
  );

  /**
   * When each project was last worked in. Gathering the data is this
   * component's job; deciding the order is `rankProjects`.
   */
  const lastActiveAt = useMemo(() => {
    const keyByProjectRef = new Map<string, string>();
    for (const group of projectGroups) {
      for (const ref of group.memberProjectRefs) {
        keyByProjectRef.set(`${ref.environmentId}:${ref.projectId}`, group.projectKey);
      }
    }
    const latest = new Map<string, number>();
    for (const candidate of threads) {
      if (candidate.archivedAt !== null) continue;
      const key = keyByProjectRef.get(`${candidate.environmentId}:${candidate.projectId}`);
      if (key === undefined) continue;
      const at = getThreadSortTimestamp(candidate, threadSortOrder);
      if (at === null) continue;
      const known = latest.get(key);
      if (known === undefined || at > known) latest.set(key, at);
    }
    return latest;
  }, [projectGroups, threadSortOrder, threads]);

  const rankedProjects = useMemo(
    () =>
      rankProjects({
        projects: projectGroups.map((group) => ({
          key: group.projectKey,
          label: group.displayName,
        })),
        lastActiveAt,
        currentKey: projectScopeKey,
      }),
    [lastActiveAt, projectGroups, projectScopeKey],
  );

  /**
   * Every project, not a capped slice: the switcher is a scrubber now, which
   * scrolls, so nothing falls off the end. Ranking still decides what you
   * reach first without scrolling at all.
   */
  const projects = useMemo<readonly TouchBarChoiceInput[]>(
    () => rankedProjects.map((project) => ({ ...project, selected: false })),
    [rankedProjects],
  );

  /**
   * A row image per project on the strip: its own icon and name. Only the
   * projects that survived the cap are drawn — the rest are unreachable.
   */
  const projectArtwork = useMemo(() => {
    if (!enabled) return [];
    return projects.flatMap((choice) => {
      const group = projectGroups.find((candidate) => candidate.projectKey === choice.key);
      if (group === undefined) return [];
      return [
        {
          key: projectIconKey(choice.key),
          svg: projectRowSvg({
            icon: resolveProjectIcon(group.projectIcon, group.displayName),
            label: choice.label,
          }),
        },
      ];
    });
  }, [enabled, projectGroups, projects]);

  const input = useMemo(
    () => ({
      providers,
      selectedInstanceId: thread.selectedInstanceId,
      rightPanelOpen: thread.rightPanelOpen,
      terminalOpen: thread.terminalOpen,
      projects,
      projectFilter: [],
      run: thread.run,
    }),
    [
      projects,
      providers,
      thread.rightPanelOpen,
      thread.run,
      thread.selectedInstanceId,
      thread.terminalOpen,
    ],
  );

  // Mirrors the command palette's project result: go to the project's most
  // recent live thread, and start one when it has none.
  const onOpenProject = useCallback(
    (key: string) => {
      const group = projectGroups.find((candidate) => candidate.projectKey === key);
      if (group === undefined) return;
      const memberKeys = new Set(
        group.memberProjectRefs.map((ref) => `${ref.environmentId}:${ref.projectId}`),
      );
      const [latest] = sortThreads(
        threads.filter(
          (candidate) =>
            candidate.archivedAt === null &&
            memberKeys.has(`${candidate.environmentId}:${candidate.projectId}`),
        ),
        threadSortOrder,
      );
      if (latest !== undefined) {
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(scopeThreadRef(latest.environmentId, latest.id)),
        });
        return;
      }
      void openThread(scopeProjectRef(group.environmentId, group.id));
    },
    [navigate, openThread, projectGroups, threadSortOrder, threads],
  );

  const handlers = useMemo(
    () => ({
      onSelectProvider: (instanceId: string) => thread.onSelectProvider?.(instanceId),
      onOpenProject,
      // The filter button is gone from the strip; the handler stays because
      // the contract still carries the action for older desktop shells.
      onFilterProject: (key: string) => {
        setProjectScopeKey(key === ALL_PROJECTS_KEY ? null : key);
      },
      onToggleRightPanel: () => thread.onToggleRightPanel?.(),
      onToggleTerminal: () => thread.onToggleTerminal?.(),
      onNewProject: () => openCommandPalette({ open: "add-project" }),
      onNewThread: () => {
        void startNewThreadFromContext({
          activeDraftThread: newThreadContext.activeDraftThread,
          activeThread: newThreadContext.activeThread ?? undefined,
          defaultProjectRef: newThreadContext.defaultProjectRef,
          handleNewThread: newThreadContext.handleNewThread,
        });
      },
      onRunToggle: () => thread.onRunToggle?.(),
    }),
    [newThreadContext, onOpenProject, setProjectScopeKey, thread],
  );

  /** Provider chips and their popover rows, redrawn when quota or countdown moves. */
  const providerArtwork = useMemo(() => {
    if (!enabled) return [];
    return providers.flatMap((provider) => {
      const selected = provider.instanceId === thread.selectedInstanceId;
      const row = providerRowSpec(provider, selected, now);
      const chip = providerChipSpec(provider);
      if (row === null || chip === null) return [];
      return [
        { key: providerChipKey(provider.instanceId), svg: chipSvg(chip) },
        { key: providerRowKey(provider.instanceId), svg: rowSvg(row) },
      ];
    });
  }, [enabled, now, providers, thread.selectedInstanceId]);

  const artwork = useMemo(
    () => [...providerArtwork, ...projectArtwork],
    [projectArtwork, providerArtwork],
  );

  useDesktopTouchBar(enabled, input, artwork, handlers);
  return null;
}
