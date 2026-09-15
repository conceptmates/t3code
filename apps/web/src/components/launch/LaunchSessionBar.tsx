import type { LaunchSessionView } from "@t3tools/client-runtime/launch-sessions";
import * as Schema from "effect/Schema";
import {
  ChevronDownIcon,
  GripVerticalIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SquareIcon,
  SquareTerminalIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  DEFAULT_LAUNCH_BAR_POSITION,
  clampLaunchBarPosition,
  dragLaunchBarPosition,
} from "./LaunchSessionBar.logic";

const POSITION_STORAGE_KEY = "t3code:launch-bar-position";

function readStoredPosition(): number {
  try {
    return clampLaunchBarPosition(
      getLocalStorageItem(POSITION_STORAGE_KEY, Schema.Number) ?? DEFAULT_LAUNCH_BAR_POSITION,
    );
  } catch {
    return DEFAULT_LAUNCH_BAR_POSITION;
  }
}

function statusDotClassName(session: LaunchSessionView) {
  // Orange while running, the colour VS Code gives an active debug session.
  if (session.running) return "bg-amber-500";
  return session.exitCode === 0 ? "bg-muted-foreground" : "bg-destructive";
}

function BarButton(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={props.label}
            disabled={props.disabled ?? false}
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

interface LaunchSessionBarProps {
  readonly sessions: ReadonlyArray<LaunchSessionView>;
  readonly onRestart: (session: LaunchSessionView) => void;
  readonly onStop: (session: LaunchSessionView) => void;
  /** The terminal showing in the drawer, so the button can hide it again. */
  readonly visibleTerminalId: string | null;
  readonly onToggleTerminal: (session: LaunchSessionView, visible: boolean) => void;
  readonly onDismiss: (session: LaunchSessionView) => void;
  readonly onHotReload: (session: LaunchSessionView, mode: "reload" | "restart") => void;
}

/**
 * Floating controls for a thread's launch sessions, like VS Code's debug
 * toolbar. Drag the grip to move it along the top of the chat. A session that
 * exits stays here with its exit code until it's dismissed.
 */
export function LaunchSessionBar({
  sessions,
  onRestart,
  onStop,
  visibleTerminalId,
  onToggleTerminal,
  onDismiss,
  onHotReload,
}: LaunchSessionBarProps) {
  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(null);
  const [position, setPosition] = useState(readStoredPosition);
  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startPosition: number } | null>(null);

  const session =
    sessions.find((candidate) => candidate.terminalId === selectedTerminalId) ??
    sessions.find((candidate) => candidate.running) ??
    sessions[0];
  if (!session) return null;
  const terminalVisible = session.terminalId === visibleTerminalId;

  const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startPosition: position,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const drag = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = dragRef.current;
    const bar = barRef.current;
    const container = bar?.parentElement;
    if (!gesture || gesture.pointerId !== event.pointerId || !bar || !container) return;
    setPosition(
      dragLaunchBarPosition({
        startPosition: gesture.startPosition,
        deltaX: event.clientX - gesture.startX,
        containerWidth: container.clientWidth,
        barWidth: bar.offsetWidth,
      }),
    );
  };
  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try {
      setLocalStorageItem(POSITION_STORAGE_KEY, position, Schema.Number);
    } catch {
      // Losing the remembered position is harmless.
    }
  };

  const statusLabel = session.running
    ? `${session.name} is running`
    : `${session.name} exited with code ${session.exitCode ?? "unknown"}`;

  return (
    <div className="pointer-events-none absolute inset-x-2 top-2 z-30">
      <div
        ref={barRef}
        role="toolbar"
        aria-label="Launch session controls"
        className={cn(
          "pointer-events-auto absolute top-0 flex items-center gap-0.5 rounded-full border bg-popover/95 py-0.5 ps-0.5 pe-1 text-popover-foreground shadow-md",
          session.running && "border-amber-500/50",
        )}
        style={{ left: `${position * 100}%`, transform: `translateX(-${position * 100}%)` }}
      >
        <button
          type="button"
          aria-label="Move launch controls"
          className="flex h-6 cursor-grab touch-none items-center px-0.5 text-muted-foreground active:cursor-grabbing"
          onPointerDown={beginDrag}
          onPointerMove={drag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <GripVerticalIcon className="size-3.5" />
        </button>
        <span
          role="img"
          aria-label={statusLabel}
          className={cn("size-2 shrink-0 rounded-full", statusDotClassName(session))}
        />
        {sessions.length > 1 ? (
          <Menu>
            <MenuTrigger
              render={<Button size="xs" variant="ghost" className="max-w-48 gap-1 px-1.5" />}
            >
              <span className="truncate">{session.name}</span>
              <ChevronDownIcon className="size-3.5 shrink-0" />
            </MenuTrigger>
            <MenuPopup align="start">
              {sessions.map((candidate) => (
                <MenuItem
                  key={candidate.terminalId}
                  onClick={() => setSelectedTerminalId(candidate.terminalId)}
                >
                  <span
                    className={cn("size-2 shrink-0 rounded-full", statusDotClassName(candidate))}
                  />
                  <span className="truncate">{candidate.name}</span>
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        ) : (
          <span className="max-w-48 truncate px-1.5 text-xs">{session.name}</span>
        )}
        {!session.running && (
          <span className="pe-1 text-muted-foreground text-xs">
            exited ({session.exitCode ?? "?"})
          </span>
        )}
        {session.running && session.hotReload && (
          <>
            <BarButton label="Hot reload" onClick={() => onHotReload(session, "reload")}>
              <ZapIcon className="size-3.5" />
            </BarButton>
            <BarButton label="Hot restart" onClick={() => onHotReload(session, "restart")}>
              <RotateCcwIcon className="size-3.5" />
            </BarButton>
          </>
        )}
        <BarButton
          label={session.running ? "Restart" : "Run again"}
          disabled={session.entryName === null}
          onClick={() => onRestart(session)}
        >
          <RefreshCwIcon className="size-3.5" />
        </BarButton>
        {session.running ? (
          <BarButton label="Stop" onClick={() => onStop(session)}>
            <SquareIcon className="size-3.5" />
          </BarButton>
        ) : (
          <BarButton label="Dismiss" onClick={() => onDismiss(session)}>
            <XIcon className="size-3.5" />
          </BarButton>
        )}
        <BarButton
          label={terminalVisible ? "Hide terminal" : "Show terminal"}
          onClick={() => onToggleTerminal(session, terminalVisible)}
        >
          <SquareTerminalIcon className="size-3.5" />
        </BarButton>
      </div>
    </div>
  );
}
