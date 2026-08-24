"use client";

import { useState, useTransition } from "react";
import { Mail, Pencil } from "lucide-react";
import {
  resendBookingConfirmation,
  updateBookingCustomer,
} from "@/lib/actions/customers";

/**
 * Customer contact details, editable by a manager, with a one-click confirmation resend.
 *
 * The problem this solves: customers mistype their email at checkout, never receive the
 * confirmation, and staff had no way to correct it — there was no update path against `customers`
 * anywhere in the product.
 *
 * Follows the BookingNote pattern: `canEdit` is resolved by the parent and passed as a plain prop,
 * the action returns `{ ok, error }` rather than throwing, and errors render inline.
 */
export function CustomerEditor({
  slug,
  bookingId,
  firstName,
  lastName,
  email,
  phone,
  canEdit,
  onChanged,
}: {
  slug: string;
  bookingId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  canEdit: boolean;
  onChanged?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState(firstName ?? "");
  const [l, setL] = useState(lastName ?? "");
  const [e, setE] = useState(email ?? "");
  const [p, setP] = useState(phone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [sending, startSend] = useTransition();

  const display = [firstName, lastName].filter(Boolean).join(" ") || "Customer";
  const synthetic = !!email?.endsWith("@import.invalid");

  function save() {
    setError(null);
    setNote(null);
    startSave(async () => {
      const r = await updateBookingCustomer(slug, bookingId, {
        email: e,
        firstName: f,
        lastName: l,
        phone: p,
      });
      if (!r.ok) {
        setError(r.error ?? "Could not save.");
        return;
      }
      // Worth saying out loud — the booking now belongs to a different customer record, which is
      // surprising if you were only trying to fix a typo.
      if (r.repointed) {
        setNote("That address already existed here, so this booking now points at that customer.");
      }
      setEditing(false);
      onChanged?.();
    });
  }

  function resend() {
    setError(null);
    setNote(null);
    startSend(async () => {
      const r = await resendBookingConfirmation(slug, bookingId);
      if (!r.ok) setError(r.error ?? "Could not send.");
      else setNote(`Confirmation re-sent to ${email}.`);
    });
  }

  if (!editing) {
    return (
      <div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm">{display}</span>
          <span className="text-sm text-zinc-500">
            {email ? `· ${email}` : ""} {phone ? `· ${phone}` : ""}
          </span>
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-1.5 py-0.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <Pencil className="h-3 w-3" /> Edit
            </button>
          )}
          {canEdit && email && !synthetic && (
            <button
              type="button"
              disabled={sending}
              onClick={resend}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-1.5 py-0.5 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <Mail className="h-3 w-3" /> {sending ? "Sending…" : "Resend confirmation"}
            </button>
          )}
        </div>
        {note && <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">{note}</p>}
        {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input
          value={f}
          onChange={(x) => setF(x.target.value)}
          placeholder="First name"
          className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <input
          value={l}
          onChange={(x) => setL(x.target.value)}
          placeholder="Last name"
          className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>
      <input
        value={e}
        onChange={(x) => setE(x.target.value)}
        placeholder="Email"
        type="email"
        autoFocus
        className="w-full rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      <input
        value={p}
        onChange={(x) => setP(x.target.value)}
        placeholder="Phone"
        className="w-full rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      <p className="text-xs text-zinc-500">
        Fixing the email also corrects any reminders already queued for this booking. Use{" "}
        <span className="font-medium">Resend confirmation</span> afterwards to send it again.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="rounded-md bg-zinc-900 px-3 py-1 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setEditing(false);
            setF(firstName ?? "");
            setL(lastName ?? "");
            setE(email ?? "");
            setP(phone ?? "");
            setError(null);
          }}
          className="rounded-md border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
