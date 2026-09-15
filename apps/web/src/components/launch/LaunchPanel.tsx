import {
  launchEntryBlockedReason,
  launchEntryMissingBinary,
  type LaunchSessionView,
} from "@t3tools/client-runtime/launch-sessions";
import type {
  EnvironmentId,
  LaunchConfigEntry,
  LaunchListConfigsResult,
  LaunchRunStep,
} from "@t3tools/contracts";
import { LAUNCH_JSON_RELATIVE_PATH } from "@t3tools/contracts";
import { FileCodeIcon, LayersIcon, PlayIcon, PlusIcon, SquareIcon } from "lucide-react";
import { useState } from "react";

import { launchEnvironment } from "~/state/launch";
import { projectEnvironment } from "~/state/projects";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { cn } from "~/lib/utils";
import { setProjectFileQueryData, useProjectFileQuery } from "../files/projectFilesQueryState";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import {
  formatEnvFieldValue,
  formatListFieldValue,
  launchFormFields,
  parseEnvFieldValue,
  parseListFieldValue,
  type LaunchFormField,
} from "./launchFormFields";
import {
  addLaunchConfigurations,
  readLaunchConfigurations,
  setLaunchConfigurationField,
} from "./launchJsonEdits";

interface LaunchPanelProps {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly configs: LaunchListConfigsResult | null;
  readonly configsError: string | null;
  readonly sessions: ReadonlyArray<LaunchSessionView>;
  readonly onRefresh: () => void;
  readonly onRun: (name: string) => void;
  readonly onStop: (session: LaunchSessionView) => void;
  readonly onOpenLaunchJson: () => void;
  readonly onAskAgentToInstall: (binary: string) => void;
}

/** The command a runnable entry starts, for the form's preview line. */
function describeStep(step: LaunchRunStep): string {
  return step._tag === "shell" ? step.commandLine : [step.command, ...step.args].join(" ");
}

function entrySteps(entry: LaunchConfigEntry): ReadonlyArray<LaunchRunStep> {
  return entry.status._tag === "runnable" ? entry.status.steps : [];
}

/**
 * Run & Debug: the workspace's launch configurations, their state, and a form
 * over `.vscode/launch.json`. Edits are written back into the file itself, so
 * comments and anything T3 doesn't know about survive.
 */
export function LaunchPanel({
  environmentId,
  cwd,
  configs,
  configsError,
  sessions,
  onRefresh,
  onRun,
  onStop,
  onOpenLaunchJson,
  onAskAgentToInstall,
}: LaunchPanelProps) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const fileQuery = useProjectFileQuery(environmentId, cwd, LAUNCH_JSON_RELATIVE_PATH);
  const startersQuery = useEnvironmentQuery(
    launchEnvironment.starters({ environmentId, input: { cwd } }),
  );
  const writeFile = useAtomCommand(projectEnvironment.writeFile, "write launch.json");

  const entries = configs?.entries ?? [];
  const selectedEntry =
    entries.find((entry) => entry.name === selectedName) ??
    entries.find((entry) => entry.kind === "configuration") ??
    null;
  const contents = fileQuery.data?.contents ?? null;
  const rawConfigurations = contents === null ? null : readLaunchConfigurations(contents);
  const selectedIndex =
    selectedEntry === null || selectedEntry.kind !== "configuration"
      ? -1
      : entries.filter((entry) => entry.kind === "configuration").indexOf(selectedEntry);
  const selectedRaw = selectedIndex === -1 ? undefined : rawConfigurations?.[selectedIndex];

  const saveContents = async (nextContents: string | null) => {
    if (nextContents === null) {
      setEditError("launch.json isn't valid JSON, so T3 didn't change it.");
      return;
    }
    setEditError(null);
    setProjectFileQueryData(environmentId, cwd, LAUNCH_JSON_RELATIVE_PATH, nextContents);
    const result = await writeFile({
      environmentId,
      input: { cwd, relativePath: LAUNCH_JSON_RELATIVE_PATH, contents: nextContents },
    });
    if (result._tag === "Failure") {
      setEditError("Failed to write launch.json.");
      return;
    }
    fileQuery.refresh();
    onRefresh();
  };

  const commitField = (field: LaunchFormField, rawValue: string) => {
    if (contents === null || selectedIndex === -1) return;
    const value =
      field.kind === "list"
        ? parseListFieldValue(rawValue)
        : field.kind === "env"
          ? parseEnvFieldValue(rawValue)
          : rawValue.trim().length === 0
            ? undefined
            : rawValue;
    void saveContents(setLaunchConfigurationField(contents, selectedIndex, [field.key], value));
  };

  const addStarter = (configuration: Readonly<Record<string, unknown>>) =>
    void saveContents(addLaunchConfigurations(contents, [configuration]));

  const addConfigurationMenu = (
    <Menu>
      <MenuTrigger render={<Button size="xs" variant="outline" />}>
        <PlusIcon className="size-3.5" />
        Add configuration
      </MenuTrigger>
      <MenuPopup align="end" className="max-w-80">
        {(startersQuery.data?.starters ?? []).map((starter) => (
          <MenuItem key={starter.label} onClick={() => addStarter(starter.configuration)}>
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{starter.label}</span>
              <span className="truncate text-muted-foreground text-xs">{starter.description}</span>
            </span>
          </MenuItem>
        ))}
        {(startersQuery.data?.starters.length ?? 0) === 0 && (
          <MenuItem disabled>Nothing detected in this project</MenuItem>
        )}
      </MenuPopup>
    </Menu>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="font-medium text-sm">Run &amp; Debug</span>
        <div className="flex items-center gap-1.5">
          {addConfigurationMenu}
          <Button size="xs" variant="ghost" onClick={onOpenLaunchJson}>
            <FileCodeIcon className="size-3.5" />
            JSON
          </Button>
        </div>
      </div>

      {editError && <p className="px-3 py-2 text-destructive text-xs">{editError}</p>}
      {configsError && <p className="px-3 py-2 text-destructive text-xs">{configsError}</p>}
      {configs?.launchFile._tag === "invalid" && (
        <p className="px-3 py-2 text-destructive text-xs">{configs.launchFile.message}</p>
      )}
      {configs?.warnings.map((warning) => (
        <p key={warning} className="px-3 py-1 text-muted-foreground text-xs">
          {warning}
        </p>
      ))}

      <ScrollArea className="min-h-0 flex-1">
        {entries.length === 0 ? (
          <p className="px-3 py-6 text-center text-muted-foreground text-sm">
            {configs?.launchFile._tag === "missing"
              ? "This project has no .vscode/launch.json yet. Add a configuration to create one."
              : "No launch configurations yet."}
          </p>
        ) : (
          <ul className="flex flex-col py-1">
            {entries.map((entry) => {
              const session = sessions.find((candidate) => candidate.entryName === entry.name);
              const blockedReason = launchEntryBlockedReason(entry);
              const missingBinary = launchEntryMissingBinary(entry);
              const Icon = entry.kind === "compound" ? LayersIcon : PlayIcon;
              return (
                <li key={`${entry.kind}:${entry.name}`}>
                  <div
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5",
                      entry === selectedEntry && "bg-accent/50",
                    )}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => setSelectedName(entry.name)}
                    >
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm">{entry.name}</span>
                        <span className="truncate text-muted-foreground text-xs">
                          {blockedReason ??
                            (session?.running
                              ? "Running"
                              : session
                                ? `Exited (${session.exitCode ?? "?"})`
                                : (entry.type ?? "compound"))}
                        </span>
                      </span>
                    </button>
                    {missingBinary && (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => onAskAgentToInstall(missingBinary)}
                      >
                        Ask agent to install
                      </Button>
                    )}
                    {session?.running ? (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Stop ${entry.name}`}
                        onClick={() => onStop(session)}
                      >
                        <SquareIcon className="size-3.5" />
                      </Button>
                    ) : (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Run ${entry.name}`}
                        disabled={blockedReason !== null}
                        onClick={() => onRun(entry.name)}
                      >
                        <PlayIcon className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {selectedEntry && selectedRaw && selectedEntry.type && (
          <div className="flex flex-col gap-3 border-t px-3 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium text-sm">{selectedEntry.name}</span>
              <span className="text-muted-foreground text-xs">
                {selectedEntry.type} · {selectedEntry.request ?? "launch"}
              </span>
            </div>
            {launchFormFields(selectedEntry.type).map((field) => {
              const value = selectedRaw[field.key];
              const fieldId = `launch-field-${selectedIndex}-${field.key}`;
              return (
                <div key={field.key} className="flex flex-col gap-1.5">
                  <Label htmlFor={fieldId}>{field.label}</Label>
                  {field.kind === "choice" ? (
                    <Select
                      value={typeof value === "string" ? value : ""}
                      onValueChange={(next) => {
                        if (typeof next === "string") commitField(field, next);
                      }}
                    >
                      <SelectTrigger size="sm" id={fieldId}>
                        <SelectValue>{typeof value === "string" ? value : "Default"}</SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        {(field.choices ?? []).map((choice) => (
                          <SelectItem key={choice} value={choice}>
                            {choice}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  ) : field.kind === "text" ? (
                    <Input
                      id={fieldId}
                      defaultValue={typeof value === "string" ? value : ""}
                      placeholder={field.placeholder ?? ""}
                      onBlur={(event) => commitField(field, event.target.value)}
                    />
                  ) : (
                    <Textarea
                      id={fieldId}
                      rows={3}
                      defaultValue={
                        field.kind === "env"
                          ? formatEnvFieldValue(value)
                          : formatListFieldValue(value)
                      }
                      placeholder={field.kind === "env" ? "KEY=value" : "One per line"}
                      onBlur={(event) => commitField(field, event.target.value)}
                    />
                  )}
                </div>
              );
            })}
            {entrySteps(selectedEntry).length > 0 && (
              <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-2">
                <span className="text-muted-foreground text-xs">Runs</span>
                {entrySteps(selectedEntry).map((step) => (
                  <code
                    key={`${step.label}:${describeStep(step)}`}
                    className="whitespace-pre-wrap break-all font-mono text-xs"
                  >
                    {describeStep(step)}
                  </code>
                ))}
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
