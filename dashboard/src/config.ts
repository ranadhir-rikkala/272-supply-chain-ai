export const config = {
  useMocks: import.meta.env.VITE_USE_MOCKS === "true",
  apiBase: import.meta.env.VITE_API_BASE ?? "/api/v1",
  oidcAuthority: import.meta.env.VITE_OIDC_AUTHORITY ?? `${window.location.origin}/auth/realms/supplychain`,
  oidcClientId: import.meta.env.VITE_OIDC_CLIENT_ID ?? "dashboard",
};
