"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertCircle, XCircle } from "lucide-react";
import { memo } from "react";
import { StepStatus } from "./plan-utils";

export const StatusIcon = memo(({ status, index }: { status: StepStatus; index: number }) => {
  return (
    <div className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-card ring-2 ring-card">
      <AnimatePresence mode="sync">
        {status === "completed" ? (
          <motion.div
            key="completed"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm">
              <CheckCircle2 className="size-3.5" strokeWidth={2.5} />
            </div>
          </motion.div>
        ) : status === "failed" ? (
          <motion.div
            key="failed"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm">
              <XCircle className="size-3.5" strokeWidth={2.5} />
            </div>
          </motion.div>
        ) : status === "in_progress" ? (
          <motion.div
            key="in_progress"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="relative flex h-6 w-6 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/20 opacity-75"></span>
              <div className="relative flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                <span className="text-[10px] font-bold">{index + 1}</span>
              </div>
            </div>
          </motion.div>
        ) : status === "aborted" ? (
           <motion.div
            key="aborted"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full border border-muted-foreground/20 bg-muted/30 text-muted-foreground">
               <AlertCircle className="size-3.5" />
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="pending"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-full border border-muted-foreground/20 bg-muted/10 text-muted-foreground/70">
              <span className="text-[10px] font-medium">{index + 1}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
