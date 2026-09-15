import { launchEntryBlockedReason } from "@t3tools/client-runtime/launch-sessions";
import type { LaunchConfigEntry, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { ChevronDownIcon, FileCodeIcon, LayersIcon, PlayIcon } from "lucide-react";

import { isElectron } from "~/env";
import { shortcutLabelForCommand } from "~/keybindings";
import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface LaunchControlProps {
  readonly entries: ReadonlyArray<LaunchConfigEntry>;
  readonly primaryEntry: LaunchConfigEntry;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly onRun: (name: string) => void;
  readonly onOpenLaunchJson: () => void;
  /** Called when the picker opens, so the list reflects edits made outside T3. */
  readonly onMenuOpen: () => void;
}

/** Header split button for `.vscode/launch.json`: run the last entry, or pick another. */
export function LaunchControl({
  entries,
  primaryEntry,
  keybindings,
  onRun,
  onOpenLaunchJson,
  onMenuOpen,
}: LaunchControlProps) {
  const primaryBlockedReason = launchEntryBlockedReason(primaryEntry);
  const runShortcut = shortcutLabelForCommand(keybindings, "launch.run", {
    context: { desktop: isElectron },
  });

  return (
    <Group aria-label="Launch configurations">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="xs"
              variant="outline"
              className="ps-[8.5px]"
              aria-label={`Run ${primaryEntry.name}`}
              disabled={primaryBlockedReason !== null}
              // The tooltip wrapper replaces data-slot="button", so themed
              // toolbar styling needs its own hook.
              data-toolbar-control=""
              onClick={() => onRun(primaryEntry.name)}
            />
          }
        >
          <PlayIcon className="size-3.5" />
          <span className="sr-only max-w-40 truncate @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
            {primaryEntry.name}
          </span>
        </TooltipTrigger>
        <TooltipPopup side="top">
          {primaryBlockedReason ?? `Run ${primaryEntry.name}`}
          {runShortcut ? ` (${runShortcut})` : ""}
        </TooltipPopup>
      </Tooltip>
      <GroupSeparator className="hidden @3xl/header-actions:block" />
      <Menu
        onOpenChange={(open) => {
          if (open) onMenuOpen();
        }}
      >
        <MenuTrigger
          render={
            <Button aria-label="Choose launch configuration" size="icon-xs" variant="outline" />
          }
        >
          <ChevronDownIcon className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end" className="max-w-80">
          <MenuGroup>
            <MenuGroupLabel>Launch configurations</MenuGroupLabel>
            {entries.map((entry) => {
              const blockedReason = launchEntryBlockedReason(entry);
              const Icon = entry.kind === "compound" ? LayersIcon : PlayIcon;
              return (
                <MenuItem
                  key={`${entry.kind}:${entry.name}`}
                  disabled={blockedReason !== null}
                  onClick={() => onRun(entry.name)}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{entry.name}</span>
                    {blockedReason && (
                      <span className="truncate text-muted-foreground text-xs">
                        {blockedReason}
                      </span>
                    )}
                  </span>
                  {entry === primaryEntry && runShortcut && (
                    <MenuShortcut className="ms-auto">{runShortcut}</MenuShortcut>
                  )}
                </MenuItem>
              );
            })}
          </MenuGroup>
          <MenuSeparator />
          <MenuItem onClick={onOpenLaunchJson}>
            <FileCodeIcon className="size-4" />
            Open launch.json
          </MenuItem>
        </MenuPopup>
      </Menu>
    </Group>
  );
}
