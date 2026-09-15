import type { LaunchInputPrompt } from "@t3tools/contracts";
import { useState } from "react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

export interface LaunchInputsRequest {
  readonly name: string;
  readonly prompts: ReadonlyArray<LaunchInputPrompt>;
}

const defaultValues = (prompts: ReadonlyArray<LaunchInputPrompt>) =>
  Object.fromEntries(
    prompts.map((prompt) => [prompt.id, prompt.default ?? prompt.options[0]?.value ?? ""]),
  );

/** Collects `${input:…}` values before a configuration runs, like VS Code's prompts. */
export function LaunchInputsDialog({
  request,
  onCancel,
  onSubmit,
}: {
  readonly request: LaunchInputsRequest | null;
  readonly onCancel: () => void;
  readonly onSubmit: (values: Record<string, string>) => void;
}) {
  // Remount per request so each run starts from its own defaults.
  return request === null ? null : (
    <LaunchInputsDialogForm
      key={`${request.name}:${request.prompts.map((prompt) => prompt.id).join(",")}`}
      request={request}
      onCancel={onCancel}
      onSubmit={onSubmit}
    />
  );
}

function LaunchInputsDialogForm({
  request,
  onCancel,
  onSubmit,
}: {
  readonly request: LaunchInputsRequest;
  readonly onCancel: () => void;
  readonly onSubmit: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    defaultValues(request.prompts),
  );

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Run {request.name}</DialogTitle>
          <DialogDescription>This configuration asks for values before it runs.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id="launch-inputs-form"
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit(values);
            }}
          >
            {request.prompts.map((prompt) => (
              <div key={prompt.id} className="flex flex-col gap-1.5">
                <Label htmlFor={`launch-input-${prompt.id}`}>
                  {prompt.description ?? prompt.id}
                </Label>
                {prompt.type === "pickString" ? (
                  <Select
                    value={values[prompt.id] ?? ""}
                    onValueChange={(value) => {
                      if (typeof value === "string") {
                        setValues((current) => ({ ...current, [prompt.id]: value }));
                      }
                    }}
                  >
                    <SelectTrigger size="sm" id={`launch-input-${prompt.id}`}>
                      <SelectValue>{values[prompt.id] ?? ""}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {prompt.options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                ) : (
                  <Input
                    id={`launch-input-${prompt.id}`}
                    type={prompt.password ? "password" : "text"}
                    value={values[prompt.id] ?? ""}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [prompt.id]: event.target.value }))
                    }
                  />
                )}
              </div>
            ))}
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" form="launch-inputs-form">
            Run
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
