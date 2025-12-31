"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { TranslatorSettingsForm } from "./translator-settings-form";

type TranslatorModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const TranslatorModal = ({
  open,
  onOpenChange,
}: TranslatorModalProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-[#0B121A] text-white">
        <DialogHeader>
          <DialogTitle>Live Translator</DialogTitle>
          <DialogDescription className="text-white/60">
            Configure live captions and translation for this call.
          </DialogDescription>
        </DialogHeader>
        <TranslatorSettingsForm />
      </DialogContent>
    </Dialog>
  );
};
