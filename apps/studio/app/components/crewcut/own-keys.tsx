import { callAction } from "@agent-native/core/client/hooks";
import { resolveAgentProviderLogo } from "@agent-native/core/client/resources";
import { type AgentProviderId, ProviderDialog } from "@agent-native/toolkit/app/settings";
import { IconCheck, IconChevronDown, IconChevronRight, IconPlus } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button, Dialog } from "@/components/ds";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { errorMessage } from "@/lib/crewcut";
import { cn } from "@/lib/utils";

/**
 * People's own AI keys: a picker with each provider's logo (a menu on
 * desktop, a bottom drawer on phones), then that provider's form. Model
 * providers use Agent-Native's own provider dialog, which checks the key,
 * saves it encrypted and lets the person pick the model. ElevenLabs isn't a
 * model provider, so it has a small form of its own in the same place.
 */

export interface OwnKeyProvider {
  id: string;
  kind: "model" | "voice";
  name: string;
  note: string;
  ownKey: boolean;
}

/** Engine ids the framework's logo catalogue knows the providers by. */
const ENGINE: Record<string, string> = { anthropic: "anthropic", openai: "ai-sdk:openai", google: "ai-sdk:google", openrouter: "ai-sdk:openrouter", groq: "ai-sdk:groq", mistral: "ai-sdk:mistral", cohere: "ai-sdk:cohere" };

/** The provider's logo on a white tile, so every logo reads the same in light and dark. */
export function ProviderMark({ id, name, className }: { id: string; name: string; className?: string }) {
  const logoUrl = ENGINE[id] ? resolveAgentProviderLogo(ENGINE[id] as string, name).logoUrl : "";
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-ds-sm bg-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]", className)} aria-hidden>
      {id === "elevenlabs" ? (
        // The ElevenLabs mark: two upright bars.
        <svg viewBox="0 0 24 24" className="size-5" fill="#000">
          <rect x="7" y="4" width="3.6" height="16" />
          <rect x="13.4" y="4" width="3.6" height="16" />
        </svg>
      ) : logoUrl ? (
        <img src={logoUrl} alt="" className="size-5 object-contain" />
      ) : (
        <span className="text-[13px] font-semibold text-black">{name.slice(0, 1)}</span>
      )}
    </span>
  );
}

function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px)");
    const update = () => setPhone(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return phone;
}

function ProviderOption({ provider }: { provider: OwnKeyProvider }) {
  return (
    <>
      <ProviderMark id={provider.id} name={provider.name} />
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[14px] font-medium text-ds-text">{provider.name}</span>
        <span className="block truncate text-[12px] text-ds-text-3">{provider.note}</span>
      </span>
      {provider.ownKey ? (
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-supported">
          <IconCheck className="size-3.5" aria-hidden /> Added
        </span>
      ) : null}
    </>
  );
}

/** "Add a key": the provider list as a menu (desktop) or a bottom drawer (phones). */
export function OwnKeyPicker({ providers, onPick, label = "Add a key" }: { providers: readonly OwnKeyProvider[]; onPick: (provider: OwnKeyProvider) => void; label?: string }) {
  const phone = usePhone();
  const [open, setOpen] = useState(false);
  const pick = (provider: OwnKeyProvider) => {
    setOpen(false);
    // After the menu or drawer has closed: opening a dialog while one is closing fights over focus.
    window.setTimeout(() => onPick(provider), 120);
  };
  const trigger = (
    <Button size="sm" className="pc-press" onClick={phone ? () => setOpen(true) : undefined}>
      <IconPlus className="size-4" /> {label} <IconChevronDown className="size-3.5 opacity-70" aria-hidden />
    </Button>
  );
  if (phone) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-ds-xl px-3 pb-6">
            <SheetHeader className="px-1 text-left">
              <SheetTitle>Add your own key</SheetTitle>
              <SheetDescription>Pick a provider. Your key goes straight to them and costs no credits.</SheetDescription>
            </SheetHeader>
            <ul className="mt-3 flex flex-col">
              {providers.map((provider) => (
                <li key={provider.id}>
                  <button type="button" onClick={() => pick(provider)} className="pc-press flex min-h-14 w-full items-center gap-3 rounded-ds-md px-2 py-2 outline-none hover:bg-ds-surface-2 focus-visible:ring-2 focus-visible:ring-ds-accent">
                    <ProviderOption provider={provider} />
                    <IconChevronRight className="size-4 shrink-0 text-ds-text-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </SheetContent>
        </Sheet>
      </>
    );
  }
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[min(70dvh,480px)] w-80 overflow-y-auto p-1.5">
        {providers.map((provider) => (
          <DropdownMenuItem key={provider.id} onSelect={() => pick(provider)} className="flex cursor-pointer items-center gap-3 rounded-ds-sm px-2 py-2">
            <ProviderOption provider={provider} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The form for one provider: Agent-Native's provider dialog for models, ours for ElevenLabs. */
export function OwnKeyDialog({ provider, onClose, onChanged }: { provider: OwnKeyProvider | null; onClose: () => void; onChanged: () => void }) {
  const model = provider?.kind === "model" ? provider : null;
  const voice = provider?.kind === "voice" ? provider : null;
  return (
    <>
      {model ? (
        <ProviderDialog
          open
          onOpenChange={(open) => (open ? undefined : onClose())}
          mode={model.ownKey ? "manage" : "add"}
          trackingFlow="settings"
          provider={model.id as AgentProviderId}
          onSaved={() => {
            onChanged();
            onClose();
          }}
          onRemoved={() => {
            onChanged();
            onClose();
          }}
        />
      ) : null}
      <VoiceKeyDialog provider={voice} onClose={onClose} onChanged={onChanged} />
    </>
  );
}

function VoiceKeyDialog({ provider, onClose, onChanged }: { provider: OwnKeyProvider | null; onClose: () => void; onChanged: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(""), [provider?.id]);
  const send = async (next: string | undefined) => {
    setBusy(true);
    try {
      await callAction("save-own-key" as never, { service: "elevenlabs", ...(next ? { value: next } : {}) } as never);
      toast.success(next ? "ElevenLabs key saved. Voice-overs now use your account." : "ElevenLabs key removed");
      onChanged();
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={provider !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={provider?.ownKey ? "Your ElevenLabs key" : "Add your ElevenLabs key"}
      description="Voice-overs then run on your ElevenLabs account: no credits, billed by ElevenLabs. The key is checked, stored encrypted, and never shown again."
      footer={
        <>
          {provider?.ownKey ? (
            <Button variant="outline-destructive" className="mr-auto" disabled={busy} onClick={() => void send(undefined)}>
              Remove key
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || value.trim().length < 8} onClick={() => void send(value.trim())}>
            {busy ? "Checking…" : provider?.ownKey ? "Replace key" : "Save key"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && value.trim().length >= 8) void send(value.trim());
        }}
      >
        <label htmlFor="own-key-elevenlabs" className="text-[13px] font-medium text-ds-text">
          API key
        </label>
        <input
          id="own-key-elevenlabs"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={provider?.ownKey ? "Paste a new key to replace the saved one" : "sk_…"}
          className="h-10 w-full rounded-ds-md bg-ds-surface-2 px-3 font-mono text-[13px] text-ds-text shadow-[inset_0_0_0_1px_var(--ds-hairline)] outline-none placeholder:text-ds-text-3 focus:shadow-[inset_0_0_0_1.5px_var(--ds-accent)]"
        />
        <p className="text-[12px] text-ds-text-3">
          Find it in ElevenLabs under{" "}
          <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">
            Settings → API keys
          </a>
          .
        </p>
      </form>
    </Dialog>
  );
}
