"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { LogOut } from "lucide-react";
import type { Person } from "@/lib/types";
import styles from "./ProfileDialog.module.css";

export type ProfileValues = { name: string; status: string };

export default function ProfileForm({ person, avatar, demo, pending, onSave, onClose, onSignOut }: {
  person: Person;
  avatar: ReactNode;
  demo: boolean;
  pending: boolean;
  onSave: (values: ProfileValues) => Promise<void>;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const [name, setName] = useState(person.name);
  const [status, setStatus] = useState(person.status || "");
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const dirty = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    // A newly reopened, untouched form follows a previous save's acknowledgement.
    // Never replace edits made in this form with a background profile refresh.
    if (!dirty.current) {
      setName(person.name);
      setStatus(person.status || "");
    }
  }, [person.name, person.status]);
  useEffect(() => {
    if (pending && submitting.current) form.current?.focus();
  }, [pending]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || submitting.current) return;
    submitting.current = true;
    setError("");
    try {
      await onSave({ name, status });
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Your profile could not be saved. Please try again.");
    } finally {
      submitting.current = false;
    }
  }

  return <div className={styles.content}>
    <div className={styles.identity}>
      {avatar}
      <div className={styles.identityText}>
        <strong>{person.name}</strong>
        <span>{person.email}</span>
        {demo && <span className="demo-badge">DEMO PROFILE · NOT SIGNED IN</span>}
      </div>
    </div>
    <form ref={form} tabIndex={-1} className={styles.form} onSubmit={submit} aria-busy={pending}>
      <label>Display name
        <input name="name" value={name} onChange={event => { dirty.current = true; setName(event.target.value); }} maxLength={80} required disabled={pending} />
      </label>
      <label>Status
        <input name="status" value={status} onChange={event => { dirty.current = true; setStatus(event.target.value); }} placeholder="Set a status" maxLength={80} disabled={pending} />
      </label>
      <div className={styles.presets} aria-label="Status presets">
        {["Active", "Away", "Do not disturb"].map(preset => <button key={preset} type="button" disabled={pending}
          aria-pressed={status === preset || (preset === "Active" && status === "Available")}
          onClick={() => { dirty.current = true; setStatus(preset); }}>
          <span className={`status-dot ${preset === "Do not disturb" ? "dnd" : preset === "Away" ? "away" : ""}`} />
          {preset}
        </button>)}
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.editingActions}>
        <button type="button" className="text-button" onClick={onClose}>Cancel</button>
        <button className="primary-button" disabled={pending}>Save</button>
      </div>
    </form>
    <div className={styles.accountAction}>
      <button type="button" className="text-button" disabled={pending} onClick={onSignOut}>
        {demo ? "Leave demo" : "Sign out"}<LogOut size={16} />
      </button>
    </div>
    {demo && <p className="dialog-note">Demo conversations are private to this browser. Sign in with Google to chat with your friends. Your conversations are private to this app.</p>}
  </div>;
}
