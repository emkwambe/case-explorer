// src/profiles/activeProfile.js — The active lender profile, shared through React context.

import { createContext, createElement, useContext, useMemo, useState } from "react";
import { PROFILES, APP_DEFAULT_PROFILE_ID, getProfile } from "./index.js";

const ActiveProfileContext = createContext(null);

/**
 * Provides the active profile, opening on the app default unless `initialProfileId` names another.
 * `registry` can be replaced, for example by tests; without the app default it opens on its first profile.
 */
export function ActiveProfileProvider({ registry = PROFILES, initialProfileId, children }) {
  const [profileId, setProfileId] = useState(initialProfileId ?? (registry.some((p) => p.id === APP_DEFAULT_PROFILE_ID) ? APP_DEFAULT_PROFILE_ID : registry[0].id));
  const value = useMemo(() => ({ registry, profileId, profile: getProfile(profileId, registry), setProfileId }), [registry, profileId]);
  return createElement(ActiveProfileContext.Provider, { value }, children);
}

/** { profile, profileId, setProfileId, registry } for the active lender profile. */
export function useActiveProfile() {
  const value = useContext(ActiveProfileContext);
  if (!value) throw new Error("useActiveProfile must be used inside an ActiveProfileProvider");
  return value;
}
