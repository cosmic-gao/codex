"use client";

import { cn } from "lib/utils";
import type { ComponentProps } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "ui/collapsible";
import { ScrollArea } from "ui/scroll-area";
import { Button } from "ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "ui/card";
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  Loader2,
  XCircle,
} from "lucide-react";

export type QueueProps = ComponentProps<"div"> & {
  viewportClassName?: string;
  maxHeightClassName?: string;
};

export function Queue({
  className,
  viewportClassName,
  maxHeightClassName = "max-h-96",
  children,
  ...props
}: QueueProps) {
  return (
    <div className={cn("w-full", className)} data-slot="queue" {...props}>
      <ScrollArea className={cn("w-full", maxHeightClassName)}>
        <div className={cn("space-y-3 pr-3", viewportClassName)}>{children}</div>
      </ScrollArea>
    </div>
  );
}

export type QueueSectionProps = ComponentProps<typeof Collapsible> & {
  title: string;
  description?: string;
  defaultOpen?: boolean;
};

export function QueueSection({
  title,
  description,
  defaultOpen = true,
  children,
  ...props
}: QueueSectionProps) {
  return (
    <Collapsible defaultOpen={defaultOpen} {...props} data-slot="queue-section">
      <Card className="shadow-none">
        <CardHeader className="py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-sm">{title}</CardTitle>
              {description ? (
                <CardDescription className="text-xs">
                  {description}
                </CardDescription>
              ) : null}
            </div>
            <QueueSectionTrigger />
          </div>
        </CardHeader>
        <QueueSectionContent>
          <CardContent className="pt-0">{children}</CardContent>
        </QueueSectionContent>
      </Card>
    </Collapsible>
  );
}

export type QueueSectionTriggerProps = ComponentProps<typeof CollapsibleTrigger>;

export function QueueSectionTrigger({
  className,
  ...props
}: QueueSectionTriggerProps) {
  return (
    <CollapsibleTrigger asChild>
      <Button
        size="icon"
        variant="ghost"
        className={cn("size-8", className)}
        data-slot="queue-section-trigger"
        {...props}
      >
        <ChevronDown className="size-4" />
        <span className="sr-only">Toggle queue section</span>
      </Button>
    </CollapsibleTrigger>
  );
}

export type QueueSectionContentProps = ComponentProps<typeof CollapsibleContent>;

export function QueueSectionContent(props: QueueSectionContentProps) {
  return (
    <CollapsibleContent data-slot="queue-section-content" {...props} />
  );
}

export type QueueListProps = ComponentProps<"ul">;

export function QueueList({ className, ...props }: QueueListProps) {
  return (
    <ul
      className={cn("space-y-2", className)}
      data-slot="queue-list"
      {...props}
    />
  );
}

export type QueueItemStatus = "pending" | "in_progress" | "completed" | "failed";

export type QueueItemProps = ComponentProps<"li"> & {
  status?: QueueItemStatus;
};

export function QueueItem({
  className,
  status = "pending",
  children,
  ...props
}: QueueItemProps) {
  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-lg border bg-background/50 px-3 py-2",
        className,
      )}
      data-slot="queue-item"
      data-status={status}
      {...props}
    >
      {children}
    </li>
  );
}

export type QueueItemIndicatorProps = ComponentProps<"div"> & {
  status?: QueueItemStatus;
};

export function QueueItemIndicator({
  className,
  status = "pending",
  ...props
}: QueueItemIndicatorProps) {
  return (
    <div
      className={cn("mt-0.5 text-muted-foreground", className)}
      data-slot="queue-item-indicator"
      {...props}
    >
      {status === "completed" ? (
        <CheckCircle2 className="size-4 text-emerald-500" />
      ) : status === "failed" ? (
        <XCircle className="size-4 text-red-500" />
      ) : status === "in_progress" ? (
        <Loader2 className="size-4 animate-spin text-blue-500" />
      ) : (
        <Circle className="size-4" />
      )}
    </div>
  );
}

export type QueueItemContentProps = ComponentProps<"div"> & {
  title: string;
};

export function QueueItemContent({
  className,
  title,
  children,
  ...props
}: QueueItemContentProps) {
  return (
    <div
      className={cn("min-w-0 flex-1", className)}
      data-slot="queue-item-content"
      {...props}
    >
      <div className="text-sm font-medium leading-5">{title}</div>
      {children}
    </div>
  );
}

export type QueueItemDescriptionProps = ComponentProps<"div">;

export function QueueItemDescription({
  className,
  ...props
}: QueueItemDescriptionProps) {
  return (
    <div
      className={cn("mt-1 text-xs text-muted-foreground whitespace-pre-wrap", className)}
      data-slot="queue-item-description"
      {...props}
    />
  );
}

